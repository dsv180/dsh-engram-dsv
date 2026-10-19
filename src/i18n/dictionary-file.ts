/**
 * Чтение словарей перевода с диска: сначала поставка, поверх неё — слой пользователя.
 *
 * Словарь лежит файлом `<корень пакета>/i18n/<язык>.txt`; пользователь может
 * положить свой рядом с данными плагина — `<dbDir>/i18n/<язык>.txt` — и он
 * главнее поставки, не переживая переустановку. Отсутствие любого из файлов
 * не ошибка: нет файла — нет слоя, сообщения остаются английскими.
 *
 * Разбор отделён от чтения (см. ./dictionary): этот модуль знает про диск,
 * `dictionary.ts` — только про формат.
 *
 * @module @kenz1117/dsh-engram/i18n/dictionary-file
 */

import { existsSync, readFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseDictionary } from './dictionary.ts'
import type { DictionaryIssueKind, ParsedDictionary } from './dictionary.ts'
import type { EngramLanguage } from './language.ts'

/** Претензия к файлу словаря: где и что именно. */
export interface DictionaryProblem {
  /** Путь к файлу; в предупреждение попадает только имя. */
  readonly file: string
  /** Номер строки, с единицы; ноль — претензия ко всему файлу. */
  readonly line: number
  readonly kind: DictionaryIssueKind | 'unreadable'
  readonly detail: string
}

/** Что получилось прочитать. */
export interface LoadedDictionary {
  /** Английский текст → перевод; пустая карта, если слоёв нет. */
  readonly entries: ReadonlyMap<string, string>
  readonly problems: readonly DictionaryProblem[]
  /** Прочитанные файлы, в порядке наложения: поставка, затем пользователь. */
  readonly files: readonly string[]
}

/** Откуда брать словарь. */
export interface DictionarySources {
  readonly language: EngramLanguage
  /** Каталог данных плагина — там же, где базы. */
  readonly dbDir: string
  /** Корень пакета; по умолчанию вычисляется от расположения модуля. */
  readonly packageRoot?: string
}

/** Насколько высоко подниматься в поисках `package.json`. */
const ROOT_SEARCH_DEPTH = 6

/**
 * Корень пакета.
 *
 * От `'..'` считать нельзя: в исходниках модуль лежит на два уровня ниже корня
 * (`src/i18n/`), а в сборке — на один (`lib/`). Поэтому поднимаемся до первого
 * каталога с `package.json`: правило одно и для репозитория, и для установки.
 */
function packageRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url))
  for (let depth = 0; depth < ROOT_SEARCH_DEPTH; depth += 1) {
    if (existsSync(join(dir, 'package.json'))) return dir
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return dir
}

/** Прочитать один файл словаря; отсутствие файла — не претензия. */
function readDictionary(path: string, problems: DictionaryProblem[]): ParsedDictionary | undefined {
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    // Нет файла — нет слоя. Всё остальное (права, каталог вместо файла) — повод сказать.
    if (code !== 'ENOENT') {
      problems.push({ file: path, line: 0, kind: 'unreadable', detail: code ?? String(error) })
    }
    return undefined
  }
  const parsed = parseDictionary(text)
  for (const issue of parsed.issues) {
    problems.push({ file: path, line: issue.line, kind: issue.kind, detail: issue.detail })
  }
  return parsed
}

/**
 * Загрузить словарь языка: поставка, затем пользовательский слой.
 * Чистое чтение: сеть и база не нужны, исключений не бросает.
 */
export function loadMessageDictionary(sources: DictionarySources): LoadedDictionary {
  const root = sources.packageRoot ?? packageRoot()
  const name = `${sources.language}.txt`
  const entries = new Map<string, string>()
  const problems: DictionaryProblem[] = []
  const files: string[] = []

  for (const path of [join(root, 'i18n', name), join(sources.dbDir, 'i18n', name)]) {
    const parsed = readDictionary(path, problems)
    if (parsed === undefined) continue
    files.push(path)
    // Повтор той же левой части побеждает: пользовательский слой правит поставку.
    for (const [left, right] of parsed.entries) entries.set(left, right)
  }

  return { entries, problems, files }
}

/** Короткая сводка претензий для одного предупреждения. */
export function describeDictionaryProblems(problems: readonly DictionaryProblem[], limit = 3): string {
  const head = problems
    .slice(0, limit)
    .map(problem => `${basename(problem.file)}${problem.line > 0 ? `:${problem.line}` : ''} ${problem.kind} — ${problem.detail}`)
  const rest = problems.length - head.length
  return rest > 0 ? `${head.join('; ')}; ещё ${rest}` : head.join('; ')
}
