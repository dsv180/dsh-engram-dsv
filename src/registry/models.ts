/**
 * Реестр моделей и таблица привязок: разбор JSON, отдельно от чтения с диска.
 *
 * Оба реестра лежат в JSON, потому что их пишет не человек: каталог моделей
 * кладёт поставка, привязки — интерфейс по выбору пользователя. Поля берутся по
 * именам, поэтому добавление или удаление поля не сдвигает соседей, а номер
 * версии формата лежит внутри файла и позволяет понять, что файл старый.
 *
 * Разбор не бросает исключений: любая странность становится замечанием, а
 * строка либо принимается, либо пропускается. Пропуск строки каталога не
 * смертелен — пострадает только выбор этой модели; пропуск строки привязок
 * означает, что язык останется на умолчании.
 *
 * @module @kenz1117/dsh-engram/registry/models
 */

import type { ModelDtype, PoolingMode } from '../embedder/local.ts'

/** Способы сведения токенов, которые понимает разбор. */
const POOLING_MODES: readonly PoolingMode[] = ['mean', 'cls']

/** Виды весов, которые понимает разбор (множество transformers.js). */
const DTYPES: readonly ModelDtype[] = ['q8', 'fp32', 'fp16', 'int8', 'uint8', 'q4', 'q4f16', 'bnb4']

/** Код языка в привязках: `*` — все остальные, иначе код вида `zh` или `zh-Hans`. */
const LANGUAGE_CODE = /^(\*|[a-z]{2,3}(-[A-Za-z0-9]{2,8})*)$/

/**
 * Одна строка каталога моделей.
 *
 * Здесь только свойства самой модели. Всё, что относится к машине или к
 * развёртыванию — каталог кэша, зеркало загрузки, адрес удалённого конца,
 * размер пакета, таймаут, — живёт в настройках: это свойства не модели, и в
 * строке они продублировались бы в каждой строке и разъехались.
 */
export interface ModelRecord {
  readonly id: string
  readonly pooling: PoolingMode
  readonly dtype: ModelDtype
  /**
   * Объявленная размерность вектора.
   *
   * У локальной модели её можно объявить заранее и упредить несовпадение с уже
   * записанными векторами. У удалённой модели длину вектора задаёт сервер,
   * объявить её нечем — там размерность узнаётся по первому ответу, поэтому
   * поле необязательное.
   */
  readonly dimensions: number | undefined
}

/** Вид замечания к реестру. */
export type RegistryIssueKind =
  | 'badJson'
  | 'badShape'
  | 'badField'
  | 'duplicateId'
  | 'duplicateLanguage'
  | 'unknownModel'

/** Замечание к реестру. */
export interface RegistryIssue {
  readonly kind: RegistryIssueKind
  /** Что именно не так, с указанием места. */
  readonly detail: string
}

/** Разобранный каталог моделей. */
export interface ParsedModels {
  /** Идентификатор модели → её свойства. */
  readonly models: ReadonlyMap<string, ModelRecord>
  readonly issues: readonly RegistryIssue[]
}

/** Разобранная таблица привязок. */
export interface ParsedBindings {
  /** Код языка → идентификатор модели. */
  readonly bindings: ReadonlyMap<string, string>
  readonly issues: readonly RegistryIssue[]
}

/** Разбор корневого объекта: снять BOM, разобрать JSON, убедиться, что это объект. */
function rootObject(text: string, issues: RegistryIssue[]): Record<string, unknown> | undefined {
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  let value: unknown
  try {
    value = JSON.parse(body)
  } catch (error) {
    issues.push({ kind: 'badJson', detail: error instanceof Error ? error.message : String(error) })
    return undefined
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    issues.push({ kind: 'badShape', detail: 'корень — не объект' })
    return undefined
  }
  return value as Record<string, unknown>
}

/** Поле-массив внутри корневого объекта. */
function arrayField(
  root: Record<string, unknown>,
  name: string,
  issues: RegistryIssue[],
): readonly unknown[] | undefined {
  const value = root[name]
  if (!Array.isArray(value)) {
    issues.push({ kind: 'badShape', detail: `поле ${name} — не массив` })
    return undefined
  }
  return value
}

/** Непустое строковое поле. */
function textField(row: Record<string, unknown>, name: string): string | undefined {
  const value = row[name]
  return typeof value === 'string' && value !== '' ? value : undefined
}

/** Разобрать каталог моделей. */
export function parseModels(text: string): ParsedModels {
  const issues: RegistryIssue[] = []
  const models = new Map<string, ModelRecord>()
  const root = rootObject(text, issues)
  if (root === undefined) return { models, issues }
  const rows = arrayField(root, 'models', issues)
  if (rows === undefined) return { models, issues }

  rows.forEach((row, index) => {
    const at = `models[${index}]`
    if (typeof row !== 'object' || row === null || Array.isArray(row)) {
      issues.push({ kind: 'badShape', detail: `${at} — не объект` })
      return
    }
    const record = row as Record<string, unknown>
    const id = textField(record, 'id')
    if (id === undefined) {
      issues.push({ kind: 'badField', detail: `${at}.id — не непустая строка` })
      return
    }
    const pooling = textField(record, 'pooling')
    if (pooling === undefined || !POOLING_MODES.includes(pooling as PoolingMode)) {
      issues.push({ kind: 'badField', detail: `${at}.pooling = ${pooling ?? '—'}` })
      return
    }
    const dtype = textField(record, 'dtype')
    if (dtype === undefined || !DTYPES.includes(dtype as ModelDtype)) {
      issues.push({ kind: 'badField', detail: `${at}.dtype = ${dtype ?? '—'}` })
      return
    }
    const dimensions = record.dimensions
    if (dimensions !== undefined && (typeof dimensions !== 'number' || !Number.isInteger(dimensions) || dimensions <= 0)) {
      issues.push({ kind: 'badField', detail: `${at}.dimensions = ${String(dimensions)}` })
      return
    }
    if (models.has(id)) {
      issues.push({ kind: 'duplicateId', detail: id })
      return
    }
    models.set(id, {
      id,
      pooling: pooling as PoolingMode,
      dtype: dtype as ModelDtype,
      dimensions: dimensions as number | undefined,
    })
  })

  return { models, issues }
}

/** Разобрать таблицу привязок. */
export function parseBindings(text: string): ParsedBindings {
  const issues: RegistryIssue[] = []
  const bindings = new Map<string, string>()
  const root = rootObject(text, issues)
  if (root === undefined) return { bindings, issues }
  const rows = arrayField(root, 'bindings', issues)
  if (rows === undefined) return { bindings, issues }

  rows.forEach((row, index) => {
    const at = `bindings[${index}]`
    if (typeof row !== 'object' || row === null || Array.isArray(row)) {
      issues.push({ kind: 'badShape', detail: `${at} — не объект` })
      return
    }
    const record = row as Record<string, unknown>
    const language = textField(record, 'language')
    if (language === undefined || !LANGUAGE_CODE.test(language)) {
      issues.push({ kind: 'badField', detail: `${at}.language = ${language ?? '—'}` })
      return
    }
    const model = textField(record, 'model')
    if (model === undefined) {
      issues.push({ kind: 'badField', detail: `${at}.model — не непустая строка` })
      return
    }
    // Повтор языка: побеждает последняя строка — так пользовательский слой
    // правит поставку, и так же ведёт себя словарь.
    if (bindings.has(language)) {
      issues.push({ kind: 'duplicateLanguage', detail: language })
    }
    bindings.set(language, model)
  })

  return { bindings, issues }
}

/** Сверить привязки с каталогом: привязка на модель, которой нет, не работает. */
export function checkBindingModels(
  models: ReadonlyMap<string, ModelRecord>,
  bindings: ReadonlyMap<string, string>,
): RegistryIssue[] {
  const issues: RegistryIssue[] = []
  for (const [language, model] of bindings) {
    if (!models.has(model)) {
      issues.push({ kind: 'unknownModel', detail: `${language} → ${model}` })
    }
  }
  return issues
}
