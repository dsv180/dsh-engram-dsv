/**
 * Реестр привязок: служебное умолчание пакета (`default`).
 *
 * Умолчание — язык, который пакет считает своим. Оно складывается слоями, как и
 * строки привязок, и главнее системной локали, но не главнее настройки плагина.
 */
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isEngramLanguage, pickLanguage, systemLanguage } from '../src/i18n/language.ts'
import { parseBindings, parseModels } from '../src/registry/models.ts'
import { loadRegistry } from '../src/registry/registry-file.ts'
import { packageRoot } from '../src/registry/root.ts'

const MODELS = JSON.stringify({
  formatVersion: 1,
  models: [{ id: 'm-zh', pooling: 'mean', dtype: 'q8', dimensions: 512 }],
})

/** Каталог поставки (`<root>/registry/*.json`) и каталог данных пользователя. */
async function makeRoots(bindings: string, userBindings?: string): Promise<{ packageRoot: string; dbDir: string }> {
  const root = await mkdtemp(join(tmpdir(), 'engram-models-'))
  const dbDir = await mkdtemp(join(tmpdir(), 'engram-models-db-'))
  await mkdir(join(root, 'registry'), { recursive: true })
  await writeFile(join(root, 'registry', 'models.json'), MODELS)
  await writeFile(join(root, 'registry', 'bindings.json'), bindings)
  if (userBindings !== undefined) {
    await mkdir(join(dbDir, 'registry'), { recursive: true })
    await writeFile(join(dbDir, 'registry', 'bindings.json'), userBindings)
  }
  return { packageRoot: root, dbDir }
}

describe('умолчание пакета в разборе привязок', () => {
  it('читается корневым полем; подстановка звёздочкой умолчанием быть не может', () => {
    const declared = parseBindings('{"default":"ru","bindings":[{"language":"*","model":"m-zh"}]}')
    expect(declared.default).toBe('ru')
    expect(declared.issues).toEqual([])
    const star = parseBindings('{"default":"*","bindings":[]}')
    expect(star.default).toBeUndefined()
    expect(star.issues.map(issue => issue.kind)).toEqual(['badField'])
    const wrongType = parseBindings('{"default":7,"bindings":[]}')
    expect(wrongType.default).toBeUndefined()
    expect(wrongType.issues.map(issue => issue.kind)).toEqual(['badField'])
  })

  it('отсутствие строк привязок не отменяет объявленное умолчание', () => {
    const parsed = parseBindings('{"default":"ru"}')
    expect(parsed.default).toBe('ru')
    expect(parsed.issues.map(issue => issue.kind)).toEqual(['badShape'])
  })
})

describe('loadRegistry: умолчание складывается слоями', () => {
  it('поставка задаёт, пользовательский слой перекрывает', async () => {
    const roots = await makeRoots('{"default":"ru","bindings":[{"language":"*","model":"m-zh"}]}', '{"default":"en","bindings":[]}')
    const loaded = loadRegistry(roots)
    expect(loaded.defaultLanguage).toBe('en')
    expect(loaded.problems).toEqual([])
  })

  it('умолчание без словаря — претензия, а не тихое неисполнение', async () => {
    const roots = await makeRoots('{"default":"de","bindings":[{"language":"*","model":"m-zh"}]}')
    const loaded = loadRegistry(roots)
    expect(loaded.defaultLanguage).toBe('de')
    expect(loaded.problems.map(problem => problem.kind)).toEqual(['unknownLanguage'])
  })

  it('поставка объявляет умолчание, для которого у плагина есть словарь', async () => {
    const dbDir = await mkdtemp(join(tmpdir(), 'engram-models-db-'))
    const loaded = loadRegistry({ packageRoot: packageRoot(), dbDir })
    expect(loaded.defaultLanguage).toBeDefined()
    expect(isEngramLanguage(loaded.defaultLanguage ?? '')).toBe(true)
    expect(loaded.problems).toEqual([])
  })
})

describe('pickLanguage', () => {
  it('настройка главнее умолчания, и явный auto — это выбор пользователя', () => {
    expect(pickLanguage('zh', 'ru')).toBe('zh')
    expect(pickLanguage('ru', undefined)).toBe('ru')
    expect(pickLanguage('auto', 'ru')).toBe(systemLanguage())
  })

  it('умолчание пакета главнее системной локали', () => {
    expect(pickLanguage(undefined, 'ru')).toBe('ru')
    expect(pickLanguage(undefined, 'zh')).toBe('zh')
  })

  it('умолчание без словаря не принимается; ничего не объявлено — язык системы', () => {
    const system = systemLanguage()
    expect(pickLanguage(undefined, 'de')).toBe(system)
    expect(pickLanguage(undefined, undefined)).toBe(system)
  })
})

describe('метка модели в каталоге', () => {
  it('короткая метка читается, длинная и с косой чертой — претензия и пропуск строки', () => {
    const ok = parseModels(JSON.stringify({
      formatVersion: 1,
      models: [{ id: 'Xenova/m', label: 'minilm-l12', pooling: 'mean', dtype: 'q8', dimensions: 384 }],
    }))
    expect(ok.issues).toEqual([])
    expect(ok.models.get('Xenova/m')?.label).toBe('minilm-l12')

    const idInLabel = parseModels(JSON.stringify({
      formatVersion: 1,
      models: [{ id: 'Xenova/m', label: 'Xenova/m', pooling: 'mean', dtype: 'q8' }],
    }))
    expect(idInLabel.models.size).toBe(0)
    expect(idInLabel.issues.map(issue => issue.kind)).toEqual(['badField'])

    const long = parseModels(JSON.stringify({
      formatVersion: 1,
      models: [{ id: 'Xenova/m', label: 'a'.repeat(25), pooling: 'mean', dtype: 'q8' }],
    }))
    expect(long.models.size).toBe(0)
    expect(long.issues.map(issue => issue.kind)).toEqual(['badField'])
  })

  it('без метки строка принимается: метка необязательна', () => {
    const parsed = parseModels(JSON.stringify({
      formatVersion: 1,
      models: [{ id: 'Xenova/m', pooling: 'mean', dtype: 'q8' }],
    }))
    expect(parsed.issues).toEqual([])
    expect(parsed.models.get('Xenova/m')?.label).toBeUndefined()
  })

  it('повтор метки — претензия: по метке база находит модель, и две одинаковые её обманут', () => {
    const parsed = parseModels(JSON.stringify({
      formatVersion: 1,
      models: [
        { id: 'Xenova/a', label: 'same', pooling: 'mean', dtype: 'q8' },
        { id: 'Xenova/b', label: 'same', pooling: 'mean', dtype: 'q8' },
      ],
    }))
    expect(parsed.models.size).toBe(1)
    expect(parsed.issues.map(issue => issue.kind)).toEqual(['duplicateLabel'])
  })
})

describe('каталог поставки: метки уникальны и по форме', () => {
  it('обе поставляемые модели названы коротко', async () => {
    const dbDir = await mkdtemp(join(tmpdir(), 'engram-models-db-'))
    const loaded = loadRegistry({ packageRoot: packageRoot(), dbDir })
    const labels = [...loaded.models.values()].map(row => row.label)
    expect(loaded.problems).toEqual([])
    expect(labels.every(label => label !== undefined && label.length <= 24)).toBe(true)
    expect(new Set(labels).size).toBe(labels.length)
  })
})
