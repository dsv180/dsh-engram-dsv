#!/usr/bin/env node
/**
 * Пересчёт эмбеддингов для записей, у которых вектор отсутствует.
 *
 * Когда запускать:
 *   — после смены модели эмбеддингов: старые векторы сравнивать с новыми нельзя,
 *     потому что косинус считает по min(длина) и молча вернёт мусор вместо ошибки;
 *   — когда эмбеддер был недоступен в момент записи (вектор не посчитался).
 *
 * Обнулить векторы перед сменой модели:
 *   node scripts/backfill-embeddings.mjs --clear --model <новый-id>
 *
 * Использование:
 *   node scripts/backfill-embeddings.mjs [--db-dir <путь>] [--model <id>]
 *                                        [--pooling mean|cls] [--clear]
 *
 * Отличие от прежней версии: сканируются все базы в каталоге памяти (прежний
 * список ['user.db', 'project-db'] не совпадал с реальными именами и потому
 * не находил ни одной базы проекта), и заполняются обе таблицы с векторами.
 */

import { DatabaseSync } from 'node:sqlite'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { pipeline, env } from '@huggingface/transformers'

const args = process.argv.slice(2)
const argValue = (name, fallback) => {
  const index = args.indexOf(name)
  return index === -1 ? fallback : args[index + 1]
}

const dbDir = argValue('--db-dir', join(homedir(), '.dsh', 'engram'))
const modelId = argValue('--model', 'Xenova/paraphrase-multilingual-MiniLM-L12-v2')
const pooling = argValue('--pooling', 'mean')
const clear = args.includes('--clear')

/** Таблицы, где хранятся векторы. */
const TABLES = ['nodes', 'observations']

const dbs = readdirSync(dbDir).filter(name => name.endsWith('.db')).map(name => join(dbDir, name))
if (dbs.length === 0) {
  console.log('[backfill] баз не найдено — нечего пересчитывать')
  process.exit(0)
}
console.log(`[backfill] баз: ${dbs.length}, модель: ${modelId} (${pooling})`)

if (clear) {
  let cleared = 0
  for (const path of dbs) {
    const db = new DatabaseSync(path)
    for (const table of TABLES) {
      try {
        cleared += db.prepare(`UPDATE ${table} SET embedding = NULL WHERE embedding IS NOT NULL`).run().changes
      } catch { /* таблицы может не быть в старой схеме */ }
    }
    db.close()
  }
  console.log(`[backfill] обнулено векторов: ${cleared}`)
}

env.cacheDir = join(dbDir, 'models')
// Скачивание можно увести на зеркало через HF_ENDPOINT; при готовом кэше сеть не нужна.
if (process.env.HF_ENDPOINT) env.remoteHost = process.env.HF_ENDPOINT
const extractor = await pipeline('feature-extraction', modelId, { dtype: 'q8' })
const embed = async text => {
  const output = await extractor([text], { pooling, normalize: true })
  return new Float32Array(output.tolist()[0])
}

let patched = 0
for (const path of dbs) {
  const db = new DatabaseSync(path)
  for (const table of TABLES) {
    let rows = []
    try {
      rows = db.prepare(`SELECT id, content FROM ${table} WHERE embedding IS NULL AND content IS NOT NULL`).all()
    } catch {
      continue
    }
    if (rows.length === 0) continue
    db.exec('BEGIN')
    try {
      for (const row of rows) {
        const vector = await embed(String(row.content))
        db.prepare(`UPDATE ${table} SET embedding = ? WHERE id = ?`)
          .run(new Uint8Array(vector.buffer, vector.byteOffset, vector.byteLength), row.id)
        patched += 1
      }
      db.exec('COMMIT')
      console.log(`[backfill] ${path} / ${table}: посчитано ${rows.length}`)
    } catch (error) {
      db.exec('ROLLBACK')
      db.close()
      throw error
    }
  }
  db.close()
}
console.log(`[backfill] готово: всего посчитано ${patched}`)

// Проверка однородности: смесь размерностей недопустима — косинус считает по
// min(длина), поэтому разнородные векторы дают правдоподобные, но бессмысленные числа.
for (const path of dbs) {
  const db = new DatabaseSync(path, { readOnly: true })
  for (const table of TABLES) {
    try {
      const rows = db.prepare(`SELECT length(embedding) AS bytes, count(*) AS total FROM ${table} WHERE embedding IS NOT NULL GROUP BY bytes`).all()
      if (rows.length > 0) {
        console.log(`[backfill] ${path} / ${table}: ${rows.map(row => `${row.total}×${row.bytes}Б`).join(', ')}`)
      }
    } catch { /* нет таблицы */ }
  }
  db.close()
}
