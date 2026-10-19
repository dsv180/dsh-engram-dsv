/**
 * Чтение реестров с диска: каталог моделей — только поставка, привязки —
 * поставка плюс слой пользователя.
 *
 * Каталог лежит в `<корень пакета>/registry/models.json`, умолчания привязок —
 * в `<корень пакета>/registry/bindings.json`, пользовательский слой — в
 * `<dbDir>/registry/bindings.json`; он главнее поставки и переживает
 * переустановку. Пользовательский слой пишет интерфейс, а не человек, поэтому
 * отсутствие файла — норма, а вот отсутствие файлов поставки нормой не является:
 * без каталога модель выбрать нечем, и об этом надо сказать, а не молчать.
 *
 * Разбор отделён от чтения (см. ./models): этот модуль знает про диск,
 * `models.ts` — только про формат.
 *
 * @module @kenz1117/dsh-engram/registry/registry-file
 */

import { readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { checkBindingModels, parseBindings, parseModels } from './models.ts'
import type { ModelRecord, RegistryIssueKind } from './models.ts'
import { packageRoot } from './root.ts'

/** Претензия к файлу реестра: где и что именно. */
export interface RegistryProblem {
  /** Путь к файлу; в предупреждение попадает только имя. */
  readonly file: string
  readonly kind: RegistryIssueKind | 'unreadable' | 'missing'
  readonly detail: string
}

/** Что получилось прочитать. */
export interface LoadedRegistry {
  /** Идентификатор модели → её свойства; пустая карта, если каталога нет. */
  readonly models: ReadonlyMap<string, ModelRecord>
  /** Код языка → идентификатор модели; `*` — умолчание для остальных. */
  readonly bindings: ReadonlyMap<string, string>
  readonly problems: readonly RegistryProblem[]
  /** Прочитанные файлы, в порядке наложения: поставка, затем пользователь. */
  readonly files: readonly string[]
}

/** Откуда брать реестры. */
export interface RegistrySources {
  /** Каталог данных плагина — там же, где базы и пользовательские словари. */
  readonly dbDir: string
  /** Корень пакета; по умолчанию вычисляется от расположения модуля. */
  readonly packageRoot?: string
}

/** Прочитать файл реестра; отсутствие необязательного файла — не претензия. */
function readText(path: string, problems: RegistryProblem[], required: boolean): string | undefined {
  try {
    return readFileSync(path, 'utf8')
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') {
      if (required) problems.push({ file: path, kind: 'missing', detail: 'файл поставки не найден' })
      return undefined
    }
    problems.push({ file: path, kind: 'unreadable', detail: code ?? String(error) })
    return undefined
  }
}

/**
 * Загрузить каталог моделей и привязки.
 * Чистое чтение: сеть и база не нужны, исключений не бросает.
 */
export function loadRegistry(sources: RegistrySources): LoadedRegistry {
  const root = sources.packageRoot ?? packageRoot()
  const problems: RegistryProblem[] = []
  const files: string[] = []
  const models = new Map<string, ModelRecord>()
  const bindings = new Map<string, string>()

  const modelsPath = join(root, 'registry', 'models.json')
  const modelsText = readText(modelsPath, problems, true)
  if (modelsText !== undefined) {
    files.push(modelsPath)
    const parsed = parseModels(modelsText)
    for (const issue of parsed.issues) problems.push({ file: modelsPath, kind: issue.kind, detail: issue.detail })
    for (const [id, record] of parsed.models) models.set(id, record)
  }

  // Привязки: поставка задаёт умолчания, пользовательский слой их перекрывает.
  const layers: readonly { path: string; required: boolean }[] = [
    { path: join(root, 'registry', 'bindings.json'), required: true },
    { path: join(sources.dbDir, 'registry', 'bindings.json'), required: false },
  ]
  for (const layer of layers) {
    const text = readText(layer.path, problems, layer.required)
    if (text === undefined) continue
    files.push(layer.path)
    const parsed = parseBindings(text)
    for (const issue of parsed.issues) problems.push({ file: layer.path, kind: issue.kind, detail: issue.detail })
    for (const [language, model] of parsed.bindings) bindings.set(language, model)
  }

  // Сверка слоёв с каталогом: привязка на модель, которой в каталоге нет, не работает.
  for (const issue of checkBindingModels(models, bindings)) {
    problems.push({ file: join(root, 'registry', 'bindings.json'), kind: issue.kind, detail: issue.detail })
  }

  return { models, bindings, problems, files }
}

/** Короткая сводка претензий для одного предупреждения. */
export function describeRegistryProblems(problems: readonly RegistryProblem[], limit = 3): string {
  const head = problems
    .slice(0, limit)
    .map(problem => `${basename(problem.file)} ${problem.kind} — ${problem.detail}`)
  const rest = problems.length - head.length
  return rest > 0 ? `${head.join('; ')}; ещё ${rest}` : head.join('; ')
}
