/**
 * Правка словарей из панели: что показывать в таблице и что писать в файл.
 *
 * Проверяется два обещания, на которых держится экран правки. Первое: таблица
 * показывает правду о слоях — пользовательский главнее поставки, поставка главнее
 * вшитого набора, а пустая клетка значит «перевода нет», а не «перевод пустой».
 * Второе: запись кладёт в файл ровно изменённое и только в пользовательский слой,
 * иначе первое же сохранение заморозило бы весь словарь и обновление поставки
 * перестало бы доходить.
 *
 * Термины берутся из настоящих наборов (`messageVocabulary`), а не выдумываются:
 * словарь ключуется английской строкой, и выдуманная строка проверяла бы не тот
 * механизм, который работает в жизни.
 */
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadMessageDictionary } from '../src/i18n/dictionary-file.ts'
import { entriesFromRequest, readDictionarySet, writeDictionarySet } from '../src/i18n/dictionary-edit.ts'
import { isDictionarySet, panelTwinTerms } from '../src/i18n/dictionary-terms.ts'
import { messageVocabulary } from '../src/i18n/messages.ts'
import { en as panelEn, ru as panelRu } from '../src/client/locales/index.ts'

/** Каталоги поставки и данных: те же слои, что у плагина в работе. */
async function makeRoots(files: {
  readonly shipped?: Readonly<Record<string, string>>
  readonly user?: Readonly<Record<string, string>>
}): Promise<{ packageRoot: string; dbDir: string }> {
  const packageRoot = await mkdtemp(join(tmpdir(), 'engram-edit-'))
  const dbDir = await mkdtemp(join(tmpdir(), 'engram-edit-db-'))
  for (const [dir, set] of [[join(packageRoot, 'i18n'), files.shipped], [join(dbDir, 'i18n'), files.user]] as const) {
    if (set === undefined) continue
    await mkdir(dir, { recursive: true })
    for (const [name, text] of Object.entries(set)) await writeFile(join(dir, name), text)
  }
  return { packageRoot, dbDir }
}

/** Первый термин набора сообщений: настоящая английская строка из кода. */
const TERM = messageVocabulary()[0] ?? ''

describe('наборы словаря', () => {
  it('имена наборов проверяются: чужое имя не должно попадать в путь файла', () => {
    expect(isDictionarySet('panel')).toBe(true)
    expect(isDictionarySet('messages')).toBe(true)
    expect(isDictionarySet('../../etc/passwd')).toBe(false)
    expect(isDictionarySet(undefined)).toBe(false)
  })

  it('термины панели — уникальные английские строки, а не ключи', () => {
    const terms = Object.keys(panelEn).map(key => panelEn[key as keyof typeof panelEn])
    expect(TERM).not.toBe('')
    // Ключей у панели больше, чем строк: тексты-близнецы правятся одной клеткой.
    expect(panelTwinTerms().every(twin => terms.includes(twin))).toBe(true)
    expect(terms.length).toBeGreaterThan(400)
  })
})

describe('таблица правки показывает слои как они есть', () => {
  it('правка главнее поставки', async () => {
    const roots = await makeRoots({
      shipped: { 'ru.txt': `${TERM}\tИз поставки\n` },
      user: { 'ru.txt': `${TERM}\tИз правки\n` },
    })
    const view = readDictionarySet({ set: 'messages', language: 'ru', ...roots })
    const row = view.rows.find(candidate => candidate.left === TERM)
    expect(row?.right).toBe('Из правки')
    expect(row?.source).toBe('user')
    expect(row?.override).toBe('Из правки')
    expect(view.files.read).toHaveLength(2)
    expect(view.problems).toEqual([])
  })

  it('поставка главнее вшитого набора', async () => {
    const roots = await makeRoots({ shipped: { 'ru.txt': `${TERM}\tИз поставки\n` } })
    const view = readDictionarySet({ set: 'messages', language: 'ru', ...roots })
    expect(view.rows.find(candidate => candidate.left === TERM)?.source).toBe('delivery')

    // У русского вшитого набора нет вовсе: без файла текста нет, и это не ошибка.
    const bare = await makeRoots({})
    const empty = readDictionarySet({ set: 'messages', language: 'ru', ...bare })
    const row = empty.rows.find(candidate => candidate.left === TERM)
    expect(row?.source).toBe('none')
    expect(row?.right).toBe('')
    expect(empty.problems).toEqual([])
  })

  it('у китайского вшитый набор есть, и он виден как вшитый', async () => {
    const roots = await makeRoots({})
    const view = readDictionarySet({ set: 'messages', language: 'zh', ...roots })
    expect(view.rows.find(candidate => candidate.left === TERM)?.source).toBe('builtin')
  })

  it('строки пользовательского слоя вне набора не теряются', async () => {
    const roots = await makeRoots({ user: { 'ru.txt': 'Строка которой нет в коде\tПеревод\n' } })
    const view = readDictionarySet({ set: 'messages', language: 'ru', ...roots })
    const row = view.rows.find(candidate => candidate.left === 'Строка которой нет в коде')
    expect(row?.right).toBe('Перевод')
    expect(row?.source).toBe('user')
  })

  it('сломанная строка видна как претензия, а не как молчание', async () => {
    const roots = await makeRoots({ user: { 'ru.txt': 'без табуляции\n' } })
    const view = readDictionarySet({ set: 'messages', language: 'ru', ...roots })
    expect(view.problems).toHaveLength(1)
    expect(view.problems[0]?.kind).toBe('noTab')
  })
})

describe('запись идёт в пользовательский слой и только изменённым', () => {
  it('пишутся только правки, поставка не трогается', async () => {
    const shipped = `${TERM}\tИз поставки\n`
    const roots = await makeRoots({ shipped: { 'ru.txt': shipped } })
    const before = await readFile(join(roots.packageRoot, 'i18n', 'ru.txt'), 'utf8')
    const result = writeDictionarySet({
      set: 'messages',
      language: 'ru',
      ...roots,
      entries: new Map([[TERM, 'Правка человека']]),
    })
    expect(result.written).toBe(1)
    const written = await readFile(result.file, 'utf8')
    expect(written).toContain(`${TERM}\tПравка человека`)
    // Второй термин в файл не попал: сохраняется правка, а не весь словарь целиком.
    expect(written.split('\n').filter(line => line !== '' && !line.startsWith('//'))).toHaveLength(1)
    expect(await readFile(join(roots.packageRoot, 'i18n', 'ru.txt'), 'utf8')).toBe(before)
    // Временный файл не остаётся: читатель видит либо прежний файл, либо новый.
    const leftovers = (await readdir(join(roots.dbDir, 'i18n'))).filter(name => name.includes('.tmp'))
    expect(leftovers).toEqual([])
  })

  it('запись читается тем же разбором и доходит до словаря плагина', async () => {
    const roots = await makeRoots({})
    writeDictionarySet({
      set: 'messages',
      language: 'ru',
      ...roots,
      entries: new Map([[TERM, 'Правка человека']]),
    })
    const loaded = loadMessageDictionary({ language: 'ru', ...roots })
    expect(loaded.entries.get(TERM)).toBe('Правка человека')
    expect(loaded.problems).toEqual([])
  })

  it('пустое значение снимает правку, а не пишет пустую строку', async () => {
    const roots = await makeRoots({ user: { 'ru.txt': `${TERM}\tСтарая правка\n` } })
    const result = writeDictionarySet({
      set: 'messages',
      language: 'ru',
      ...roots,
      entries: new Map([[TERM, '']]),
    })
    expect(result.written).toBe(0)
    const written = await readFile(result.file, 'utf8')
    expect(written).not.toContain(TERM)
  })

  it('краевые пробелы, табуляции и косые черты переживают запись', async () => {
    const roots = await makeRoots({})
    const trick = '  // не комментарий \t и табуляция  '
    writeDictionarySet({
      set: 'messages',
      language: 'ru',
      ...roots,
      entries: new Map([[TERM, trick], ['Строка которой нет в коде', '  с краю  ']]),
    })
    const loaded = loadMessageDictionary({ language: 'ru', ...roots })
    expect(loaded.problems).toEqual([])
    expect(loaded.entries.get(TERM)).toBe(trick)
    expect(loaded.entries.get('Строка которой нет в коде')).toBe('  с краю  ')
  })

  it('каталог словарей создаётся сам', async () => {
    const roots = await makeRoots({})
    expect(existsSync(join(roots.dbDir, 'i18n'))).toBe(false)
    writeDictionarySet({ set: 'panel', language: 'ru', ...roots, entries: new Map([[TERM, 'Правка']]) })
    expect(existsSync(join(roots.dbDir, 'i18n', 'panel.ru.txt'))).toBe(true)
  })
})

describe('тело запроса разбирается без доверия к нему', () => {
  it('мусор пропускается, повтор решает последняя строка', () => {
    const entries = entriesFromRequest([
      ['Термин', 'Перевод'],
      ['Термин', 'Другой перевод'],
      ['', 'пустой левый не годится'],
      ['Правая часть не строка', 42],
      ['Не пара'],
      null,
    ])
    expect([...entries]).toEqual([['Термин', 'Другой перевод']])
  })

  it('не массив — пустая карта, а не исключение', () => {
    expect(entriesFromRequest(undefined).size).toBe(0)
    expect(entriesFromRequest('[]').size).toBe(0)
    expect(entriesFromRequest({ left: 'x' }).size).toBe(0)
  })
})

describe('вшитые наборы панели не разъезжаются с английским', () => {
  it('русский набор панели знает каждый ключ английского', () => {
    const missing = Object.keys(panelEn).filter(key => panelRu[key as keyof typeof panelRu] === undefined)
    expect(missing).toEqual([])
  })

  it('русские тексты не остались английскими заглушками', () => {
    // Совпадение с английским законно там, где текст и не переводится: знак (`—`,
    // букв нет) или имя подсистемы (`Jev`). Список имён закрытый — новая забытая
    // строка обязана упасть здесь, а не дойти до панели английским текстом.
    const names = new Set(['tabJev'])
    const same = Object.keys(panelEn).filter(key =>
      panelRu[key as keyof typeof panelRu] === panelEn[key as keyof typeof panelEn]
      && /\p{L}/u.test(panelEn[key as keyof typeof panelEn])
      && !names.has(key))
    expect(same).toEqual([])
  })
})
