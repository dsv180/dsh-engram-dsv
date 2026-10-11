#!/usr/bin/env node
/**
 * Поиск китайских иероглифов в исходниках — вне комментариев.
 *
 * Это приёмка языковой работы. Комментарии остаются на языке автора (они для
 * разработчика), а всё, что видит пользователь или модель, должно быть вынесено
 * в словари. Скрипт вырезает комментарии и показывает остаток.
 *
 * Исключены каталоги словарей: там китайский — исходный текст автора, он и должен
 * там лежать. Отдельно перечислены «законные исключения» — места, где китайский
 * стоит в самой логике (регекспы, распознающие китайский текст): их перевод сломал
 * бы поведение. Они показываются, но не считаются провалом.
 *
 * Запуск: node scripts/check-chinese.mjs
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

const SRC = resolve(import.meta.dirname, '..', 'src')
/** Каталоги и файлы, где китайский — это данные словаря. */
const DICTIONARIES = ['i18n/catalog', 'i18n/rooms.ts', 'i18n/dates.ts', 'i18n/patterns.ts', 'client/locales']
/**
 * Места, где китайский стоит в самой логике распознавания текста: перевод сломал бы
 * поведение. Признак — пара «файл + образец строки», а не файл целиком: иначе одна
 * законная строка открывала бы дорогу любому китайскому в том же файле.
 *
 * Образцы распознавания китайского ввода (`security/redact.ts`, `ingest/hook.ts`) здесь
 * больше не перечислены: они переехали в словарь `i18n/patterns.ts` вместе с остальными
 * языковыми данными (F-10).
 */
const ACKNOWLEDGED = new Map([
  ['mirror/markdown.ts', /u4e00/],
])
/** Файлы, которые никуда не подключены: их китайский до пользователя не доходит. */
const DEAD_CODE = new Set(['page.ts'])
const HAN = /[\u4e00-\u9fff]/

/** Символы, после которых `/` начинает регексп, а не деление. */
const REGEX_AFTER_CHAR = new Set(['(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '<', '>', '~', '^'])
/** Слова, после которых `/` начинает регексп. */
const REGEX_AFTER_WORD = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'case', 'do', 'else', 'yield', 'await'])

/**
 * Вырезает комментарии и регексп-литералы, сохраняя номера строк.
 * Регекспы нужны потому, что внутри символьного класса может стоять кавычка или
 * обратная кавычка — без их разбора разбор уходит в режим строки и не возвращается.
 */
function stripComments(text) {
  const out = [...text]
  let state = 'code'
  let quote = ''
  let inClass = false
  let prevChar
  let lastWord = ''
  const blank = (index) => { if (out[index] !== '\n') out[index] = ' ' }

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    const next = text[i + 1]

    if (state === 'code') {
      if (ch === '/' && next === '/') { state = 'line'; blank(i); continue }
      if (ch === '/' && next === '*') { state = 'block'; blank(i); continue }
      if (ch === '/' && (prevChar === undefined || REGEX_AFTER_CHAR.has(prevChar) || REGEX_AFTER_WORD.has(lastWord))) {
        state = 'regex'
        inClass = false
        blank(i)
        continue
      }
      if (ch === "'" || ch === '"' || ch === '`') { state = 'string'; quote = ch; continue }
      if (!/\s/.test(ch)) {
        prevChar = ch
        lastWord = /[A-Za-z_$]/.test(ch) ? lastWord + ch : ''
      }
      continue
    }

    if (state === 'line') {
      if (ch === '\n') { state = 'code'; continue }
      blank(i)
      continue
    }

    if (state === 'block') {
      if (ch === '*' && next === '/') { blank(i); blank(i + 1); i++; state = 'code'; continue }
      blank(i)
      continue
    }

    if (state === 'regex') {
      // Содержимое регекспа не вырезаем: китайский внутри него — это логика
      // распознавания китайского текста, и его полезно видеть в отчёте.
      if (ch === '\\') { i++; continue }
      if (ch === '\n') { state = 'code'; continue }
      if (ch === '[') inClass = true
      else if (ch === ']') inClass = false
      else if (ch === '/' && !inClass) { state = 'code'; prevChar = '/'; lastWord = '' }
      continue
    }

    if (state === 'string') {
      if (ch === '\\') { i++; continue }
      if (ch === quote) { state = 'code'; quote = '' }
    }
  }
  return out.join('')
}

const files = []
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full)
    else if (/\.(ts|tsx)$/.test(name)) files.push(full)
  }
}
walk(SRC)

let failures = 0
const acknowledged = []
const dead = []
for (const file of files.sort()) {
  const rel = relative(SRC, file).replace(/\\/g, '/')
  if (DICTIONARIES.some((prefix) => rel.startsWith(prefix))) continue
  const lines = stripComments(readFileSync(file, 'utf8')).split('\n')
  const hits = []
  lines.forEach((line, index) => { if (HAN.test(line)) hits.push({ line: index + 1, text: line }) })
  if (hits.length === 0) continue

  const ackPattern = ACKNOWLEDGED.get(rel)
  const acked = ackPattern === undefined ? [] : hits.filter((hit) => ackPattern.test(hit.text))
  const rest = hits.filter((hit) => !acked.includes(hit))
  if (acked.length > 0) acknowledged.push(`${rel}: ${acked.length} — строки ${acked.map((hit) => hit.line).join(', ')}`)
  if (rest.length === 0) continue
  if (DEAD_CODE.has(rel)) { dead.push(`${rel}: ${rest.length}`); continue }
  failures += rest.length
  console.log(`${rel}: ${rest.length} — строки ${rest.map((hit) => hit.line).join(', ')}`)
}

if (acknowledged.length > 0) {
  console.log('\nзаконные исключения (языкозависимая логика, не переводятся):')
  for (const line of acknowledged) console.log(`  ${line}`)
}
if (dead.length > 0) {
  console.log('\nмёртвый код (нигде не подключён, до пользователя не доходит):')
  for (const line of dead) console.log(`  ${line}`)
}

console.log(`\nстрок с китайским вне комментариев: ${failures}`)
if (failures > 0) process.exitCode = 1
