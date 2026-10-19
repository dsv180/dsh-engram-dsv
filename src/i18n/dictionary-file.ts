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

import { readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { packageRoot } from '../registry/root.ts'
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
  return loadDictionary(sources, `${sources.language}.txt`)
}

/**
 * Загрузить словарь панели: то же самое, но другим файлом.
 *
 * У половины плагина два разных набора текстов, и сводить их в один файл нельзя:
 * слева стоит английская строка, а одинаковые английские строки в двух наборах
 * значат разное. Поэтому набор — это имя файла: серверные сообщения в
 * `<язык>.txt`, панель — в `panel.<язык>.txt`; формат, слои и правила разбора у
 * них общие.
 */
export function loadPanelDictionary(sources: DictionarySources): LoadedDictionary {
  return loadDictionary(sources, `panel.${sources.language}.txt`)
}

/**
 * Прочитать один файл словаря как отдельный слой.
 *
 * Нужно правке из панели (см. ./dictionary-edit): там важно не «что видно», а «что
 * лежит именно в этом слое» — иначе сохранение не отличит правку от поставки и
 * запишет в пользовательский файл весь словарь целиком.
 * @param path - путь к файлу; отсутствие файла — пустой слой без претензий.
 * @returns прочитанное: карта, претензии и список файлов (пустой, если файла нет).
 */
export function readDictionaryLayer(path: string): LoadedDictionary {
  const problems: DictionaryProblem[] = []
  const parsed = readDictionary(path, problems)
  return {
    entries: parsed?.entries ?? new Map<string, string>(),
    problems,
    files: parsed === undefined ? [] : [path],
  }
}

/** Прочитать словарь по имени файла: поставка, затем пользовательский слой. */
function loadDictionary(sources: DictionarySources, name: string): LoadedDictionary {
  const root = sources.packageRoot ?? packageRoot()
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
