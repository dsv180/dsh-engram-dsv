#!/usr/bin/env node
/**
 * Проверка журнала памяти: живой ли плагин, какая модель поднята, нет ли смеси размерностей.
 *
 * Скрипт только читает базы (параметр readOnly), ничего не пишет и не требует запущенного
 * DSH. Нужен, чтобы по одному вопросу «почему память не работает» не лазить по журналу
 * руками: он отвечает на три вопроса сразу — извлечение идёт, модель известна,
 * размерности векторов совпадают.
 *
 * Запуск: node scripts/check-journal.mjs [--db-dir <путь>] [--days <N>]
 */
import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const arg = (name, fallback) => {
  const index = process.argv.indexOf(name)
  return index === -1 || process.argv[index + 1] === undefined ? fallback : process.argv[index + 1]
}
const dbDir = arg('--db-dir', join(homedir(), '.dsh', 'engram'))
const days = Number(arg('--days', '7'))
const since = Date.now() - days * 24 * 60 * 60 * 1000

if (!existsSync(dbDir)) {
  console.error(`каталог памяти не найден: ${dbDir}`)
  console.error('плагин ещё не запускался либо каталог задан другим (config: dbDir)')
  process.exit(1)
}

const stamp = ms => (ms === null || ms === undefined ? '—' : new Date(ms).toLocaleString('ru-RU'))
const open = path => new DatabaseSync(path, { readOnly: true })
const rows = (db, sql, ...params) => db.prepare(sql).all(...params)

const problems = []
const notes = []

const userPath = join(dbDir, 'user.db')
if (!existsSync(userPath)) {
  console.error(`нет пользовательской базы: ${userPath}`)
  console.error('плагин запускался, но ничего не записал — проверьте настройки извлечения (ingest)')
  process.exit(1)
}

const user = open(userPath)
console.log(`журнал: ${userPath}`)
console.log(`окно: последние ${days} дн.`)

// ---- 1. Что за модель поднялась ----
const ready = rows(user, "SELECT at, detail FROM op_log WHERE op = 'embedder-ready' ORDER BY seq DESC LIMIT 1")
if (ready.length === 0) {
  notes.push('записи embedder-ready нет: сборка старше той, что пишет модель в журнал (обновите плагин)')
} else {
  let detail = {}
  try {
    detail = JSON.parse(ready[0].detail ?? '{}')
  } catch {
    detail = {}
  }
  console.log(`модель: ${detail.model ?? 'неизвестно'} (${detail.dim ?? '?'} измерений), запись ${stamp(ready[0].at)}`)
}

// ---- 2. Размерности векторов во всех базах ----
const dims = new Map()
const bases = readdirSync(dbDir).filter(name => name.endsWith('.db'))
for (const name of bases) {
  let db
  try {
    db = open(join(dbDir, name))
  } catch (error) {
    problems.push(`база ${name} не открылась: ${error instanceof Error ? error.message : String(error)}`)
    continue
  }
  const found = new Set()
  for (const sql of [
    'SELECT DISTINCT length(embedding) / 4 AS dim FROM nodes WHERE embedding IS NOT NULL',
    'SELECT DISTINCT length(embedding) / 4 AS dim FROM observations WHERE embedding IS NOT NULL',
  ]) {
    try {
      for (const row of rows(db, sql)) found.add(row.dim)
    } catch {
      // Таблицы может не быть: старая схема либо иная база рядом с памятью.
    }
  }
  const withoutVector = (() => {
    try {
      return rows(db, 'SELECT COUNT(*) AS n FROM nodes WHERE embedding IS NULL')[0].n
    } catch {
      return 0
    }
  })()
  db.close()
  if (found.size === 0 && withoutVector === 0) continue
  for (const dim of found) dims.set(dim, (dims.get(dim) ?? 0) + 1)
  console.log(`  ${name}: размерности ${[...found].sort((a, b) => a - b).join(', ') || 'нет'}`
    + (withoutVector > 0 ? `, без вектора ${withoutVector}` : ''))
}
if (dims.size > 1) {
  problems.push(`в библиотеке векторы разных размерностей: ${[...dims.keys()].sort((a, b) => a - b).join(', ')} — `
    + 'косинус считается по меньшей длине, поиск тихо испорчен. Пересчитайте: node scripts/backfill-embeddings.mjs')
}
if (dims.size === 0) notes.push('векторов нет вовсе: поиск по смыслу не работает, доступны только ключевые слова')

// ---- 3. Живое ли извлечение ----
const ops = rows(user, 'SELECT op, COUNT(*) AS n, MAX(at) AS last FROM op_log WHERE at >= ? GROUP BY op', since)
const byOp = new Map(ops.map(row => [row.op, row]))
for (const name of ['ingest-request', 'ingest-done', 'ingest-skip', 'ingest-nothing', 'ingest-truncated']) {
  const row = byOp.get(name)
  if (row !== undefined) console.log(`  ${name}: ${row.n}, последняя ${stamp(row.last)}`)
}
const lastAny = rows(user, 'SELECT MAX(at) AS last FROM op_log')[0]?.last
console.log(`последняя операция вообще: ${stamp(lastAny)}`)
if (lastAny === null || lastAny === undefined || lastAny < since) {
  notes.push(`за ${days} дн. операций нет: плагин не пишет — он не смонтирован или настройки выключены`)
}

// ---- 4. Почему пропускает ----
const skips = rows(user, "SELECT detail FROM op_log WHERE op = 'ingest-skip' AND at >= ?", since)
const reasons = new Map()
for (const row of skips) {
  let reason = 'без причины'
  try {
    reason = JSON.parse(row.detail ?? '{}').reason ?? reason
  } catch {
    const match = /"reason"\s*:\s*"([^"]+)"/.exec(row.detail ?? '')
    reason = match === null ? reason : match[1]
  }
  reasons.set(reason, (reasons.get(reason) ?? 0) + 1)
}
if (reasons.size > 0) {
  console.log('  пропуски извлечения: ' + [...reasons.entries()].sort((a, b) => b[1] - a[1]).map(([r, n]) => `${r} — ${n}`).join(', '))
}
const failed = reasons.get('failed') ?? 0
const lastDone = byOp.get('ingest-done')?.last ?? 0
const lastFailed = rows(user, "SELECT MAX(at) AS last FROM op_log WHERE op = 'ingest-skip' AND detail LIKE '%\"failed\"%'")[0]?.last ?? 0
if (failed > 0) {
  console.log(`  сбои извлечения: ${failed}, последний ${stamp(lastFailed)}`
    + (lastFailed > lastDone ? ' — сбой ПОСЛЕ последнего успеха' : ' — все до последнего успеха'))
}
if (lastFailed > lastDone) problems.push('последний сбой извлечения позже последнего успеха — смотрите журнал (op=ingest-skip, reason=failed)')

user.close()

// ---- Итог ----
console.log('')
for (const note of notes) console.log(`замечание: ${note}`)
if (problems.length === 0) {
  console.log('итог: журнал в порядке — извлечение идёт, модель записана, размерности совпадают')
  process.exit(0)
}
for (const problem of problems) console.log(`проблема: ${problem}`)
process.exit(1)
