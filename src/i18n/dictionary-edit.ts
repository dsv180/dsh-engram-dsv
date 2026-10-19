/**
 * Правка словарей: что можно править, где это лежит и как записать.
 *
 * Словарь перевода — файл, а не код (см. ./dictionary-file): слоёв два, поставка и
 * пользовательский. Панель правит только второй: он лежит в каталоге данных
 * (`<dbDir>/i18n/<имя>`) и потому переживает переустановку плагина, а поставка
 * остаётся неприкосновенной — обновление плагина не спорит с правками человека.
 *
 * Записываем ровно то, что человек изменил: пустая клетка таблицы снимает правку и
 * возвращает текст поставки. Если бы сохранялся весь словарь целиком, первое же
 * сохранение заморозило бы все переводы и обновление поставки перестало бы доходить.
 *
 * Формат и экранирование — те же, что читает `./dictionary`: `<слева><TAB><справа>`,
 * `\\`, `\n`, `\r`, `\t`, `\s` (значимый пробел на краю), `\/` (косая черта, которой
 * иначе начиналась бы строка-комментарий). Пишем во временный файл и переименовываем:
 * файл либо старый, либо новый, оборванного на полуслове не бывает.
 *
 * @module @kenz1117/dsh-engram/i18n/dictionary-edit
 */

import { mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { packageRoot } from '../registry/root.ts'
import { parseDictionary } from './dictionary.ts'
import { readDictionaryLayer } from './dictionary-file.ts'
import type { DictionaryProblem, LoadedDictionary } from './dictionary-file.ts'
import { dictionaryBuiltin, dictionaryTerms, isDictionarySet } from './dictionary-terms.ts'
import type { DictionarySet } from './dictionary-terms.ts'
import type { EngramLanguage } from './language.ts'

export { isDictionarySet }
export type { DictionarySet }

/** Строка таблицы правки: английская строка, что стоит справа и откуда это взялось. */
export interface DictionaryRow {
  /** Английская строка — она же ключ словаря. */
  readonly left: string
  /** Перевод, который виден сейчас; пусто — перевода нет. */
  readonly right: string
  /** Откуда взят правый столбец: правка, поставка, вшитый набор или ничего. */
  readonly source: 'user' | 'delivery' | 'builtin' | 'none'
  /** Значение пользовательского слоя; null — правки нет. */
  readonly override: string | null
}

/** Набор словаря, каким его видит таблица правки. */
export interface DictionarySetView {
  readonly set: DictionarySet
  readonly language: EngramLanguage
  readonly rows: readonly DictionaryRow[]
  readonly files: {
    /** Файл поставки (внутри пакета) — только чтение. */
    readonly delivery: string
    /** Пользовательский слой — его и пишет панель. */
    readonly user: string
    /** Прочитанные файлы в порядке наложения. */
    readonly read: readonly string[]
  }
  readonly problems: readonly DictionaryProblem[]
}

/** Итог записи словаря: сколько строк легло и куда. */
export interface DictionaryWriteResult {
  readonly file: string
  readonly written: number
  readonly bytes: number
}

/** Откуда берём словари: язык, каталог данных и корень пакета. */
export interface DictionarySources {
  readonly set: DictionarySet
  readonly language: EngramLanguage
  readonly dbDir: string
  readonly packageRoot?: string
}

/** Имя файла набора: у панели своё, у серверных сообщений своё (см. ./dictionary-file). */
export function dictionaryFileName(set: DictionarySet, language: EngramLanguage): string {
  return set === 'panel' ? `panel.${language}.txt` : `${language}.txt`
}

/** Пути обоих слоёв набора. */
export function dictionaryPaths(sources: DictionarySources): { readonly delivery: string, readonly user: string } {
  const root = sources.packageRoot ?? packageRoot()
  const name = dictionaryFileName(sources.set, sources.language)
  return { delivery: join(root, 'i18n', name), user: join(sources.dbDir, 'i18n', name) }
}

/** Раскрытие экранирования при записи: обратное к таблице `UNESCAPE` в ./dictionary. */
const ESCAPE: Readonly<Record<string, string>> = {
  '\\': '\\\\',
  '\t': '\\t',
  '\n': '\\n',
  '\r': '\\r',
}

/**
 * Экранировать поле словаря.
 *
 * Краевые пробелы пишутся как `\s`: разбор их и так не срезает, но формат объявляет
 * их значимыми, и строка, пережившая чужой trim, должна остаться той же строкой.
 * @param value - текст левой или правой части.
 * @returns текст, безопасный в строке словаря.
 */
export function escapeField(value: string): string {
  let text = value.replace(/[\\\t\n\r]/g, char => ESCAPE[char] ?? char)
  text = text.replace(/^ +/, spaces => '\\s'.repeat(spaces.length))
  text = text.replace(/ +$/, spaces => '\\s'.repeat(spaces.length))
  // Строка, начинающаяся с `//`, была бы комментарием: экранируем косу черту.
  return text.startsWith('//') ? `\\/${text.slice(1)}` : text
}

/** Собрать текст файла словаря: заголовок комментарием, затем строки данных. */
export function stringifyDictionary(
  entries: readonly (readonly [string, string])[],
  header: readonly string[],
): string {
  const lines = header.map(line => (line === '' ? '' : `// ${line}`))
  for (const [left, right] of entries) lines.push(`${escapeField(left)}\t${escapeField(right)}`)
  return `${lines.join('\n')}\n`
}

/** Заголовок записанного словаря: чем он является и что с ним делает панель. */
function header(set: DictionarySet, language: EngramLanguage): readonly string[] {
  const what = set === 'panel' ? 'Словарь панели dsh-engram' : 'Словарь служебных сообщений dsh-engram'
  const where = set === 'panel' ? 'src/client/locales/en.ts' : 'src/i18n/catalog/*'
  return [
    `${what}: ${language}. Правка из панели обслуживания.`,
    `Слева — ровно та строка, что стоит в коде (${where}), справа — перевод.`,
    'Формат: <слева><TAB><справа>. Этот файл главнее поставки; строки нет — берётся поставка,',
    'пустая клетка в панели снимает правку и возвращает текст поставки.',
    '',
  ]
}

/**
 * Записать пользовательский слой набора.
 *
 * Порядок строк — порядок терминов набора (он же порядок таблицы), затем строки,
 * которых в наборе уже нет: потерять их молча нельзя, они могли остаться от прежней
 * версии текстов. Пустое значение — не строка файла, а снятая правка.
 * @param input - набор, источники и карта правок «английская строка → перевод».
 * @returns путь файла, число записанных строк и размер.
 */
export function writeDictionarySet(input: DictionarySources & { readonly entries: ReadonlyMap<string, string> }): DictionaryWriteResult {
  const paths = dictionaryPaths(input)
  const ordered: (readonly [string, string])[] = []
  const listed = new Set<string>()
  for (const left of dictionaryTerms(input.set)) {
    const right = input.entries.get(left)
    if (right === undefined || right === '') continue
    listed.add(left)
    ordered.push([left, right])
  }
  for (const [left, right] of input.entries) {
    if (listed.has(left) || left === '' || right === '') continue
    listed.add(left)
    ordered.push([left, right])
  }

  const text = stringifyDictionary(ordered, header(input.set, input.language))
  mkdirSync(dirname(paths.user), { recursive: true })
  const temporary = `${paths.user}.tmp`
  writeFileSync(temporary, text, 'utf8')
  // Переименование в пределах каталога: читатель видит либо прежний файл, либо новый.
  renameSync(temporary, paths.user)
  return { file: paths.user, written: ordered.length, bytes: Buffer.byteLength(text, 'utf8') }
}

/** Разобрать прочитанный слой в карту: пустой слой — пустая карта. */
function layerEntries(layer: LoadedDictionary): ReadonlyMap<string, string> {
  return layer.entries
}

/** Одна строка таблицы: правка главнее поставки, поставка — вшитого набора. */
function row(
  left: string,
  user: ReadonlyMap<string, string>,
  delivery: ReadonlyMap<string, string>,
  builtin: string | undefined,
): DictionaryRow {
  const override = user.get(left)
  if (override !== undefined) return { left, right: override, source: 'user', override }
  const shipped = delivery.get(left)
  if (shipped !== undefined) return { left, right: shipped, source: 'delivery', override: null }
  if (builtin !== undefined) return { left, right: builtin, source: 'builtin', override: null }
  return { left, right: '', source: 'none', override: null }
}

/**
 * Прочитать набор для таблицы правки: термины набора плюс строки пользовательского
 * слоя, которых в наборе уже нет (иначе первое сохранение их потеряет).
 * @param input - набор, язык и источники.
 * @returns строки таблицы, пути файлов и претензии разбора.
 */
export function readDictionarySet(input: DictionarySources): DictionarySetView {
  const paths = dictionaryPaths(input)
  const delivery = readDictionaryLayer(paths.delivery)
  const user = readDictionaryLayer(paths.user)
  const rows: DictionaryRow[] = []
  const listed = new Set<string>()
  for (const left of dictionaryTerms(input.set)) {
    listed.add(left)
    rows.push(row(left, layerEntries(user), layerEntries(delivery), dictionaryBuiltin(input.set, input.language, left)))
  }
  for (const [left, right] of user.entries) {
    if (listed.has(left)) continue
    rows.push({ left, right, source: 'user', override: right })
  }
  return {
    set: input.set,
    language: input.language,
    rows,
    files: { delivery: paths.delivery, user: paths.user, read: [...delivery.files, ...user.files] },
    problems: [...delivery.problems, ...user.problems],
  }
}

/**
 * Разобрать тело запроса в карту правок.
 * Мусор в теле не должен ни падать, ни попадать в файл: чужие типы пропускаются,
 * повтор левой части решает последняя строка (как и в самом формате).
 */
export function entriesFromRequest(raw: unknown): Map<string, string> {
  const entries = new Map<string, string>()
  if (!Array.isArray(raw)) return entries
  for (const item of raw) {
    if (!Array.isArray(item) || item.length < 2) continue
    const left: unknown = item[0]
    const right: unknown = item[1]
    if (typeof left !== 'string' || left === '' || typeof right !== 'string') continue
    entries.set(left, right)
  }
  return entries
}

/** Проверка «строка словаря разбирается» — тем же разбором, что и при чтении. */
export function parsesAsDictionary(text: string): boolean {
  return parseDictionary(text).issues.length === 0
}
