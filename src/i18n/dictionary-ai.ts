/**
 * Заполнение словаря с помощью модели: собрать запрос и разобрать ответ.
 *
 * Клетки словаря переводит вспомогательная модель: панель отдаёт английские строки
 * набора, получает переводы на язык набора и кладёт их в черновик таблицы. Ключ
 * словаря — сама английская строка, поэтому в запрос уходит она же: перевод
 * сопоставляется по точному совпадению, а не по позиции (модель вправе пропустить
 * строку или ответить короче).
 *
 * Запросы режутся на партии (см. `FILL_BATCH`): ответ на сотни терминов сразу
 * приходит с обрывами и потерями, а партию видно в прогрессе и можно прервать.
 * Резка — у вызывающего (панель): здесь только «одна партия → переводы».
 *
 * @module @kenz1117/dsh-engram/i18n/dictionary-ai
 */

import { parseJsonArray } from '../llm/client.ts'
import type { EngramLanguage } from './language.ts'
import { message } from './messages.ts'
import { EngramError } from '../types.ts'
import { FILL_REQUEST_MAX } from './dictionary-limits.ts'

/**
 * Язык в запросе: модель должна понимать, на какой язык переводить.
 * Имя английское — это метаязык инструкции, а не тот, на который переводим.
 */
const LANGUAGE_NAMES: Readonly<Record<EngramLanguage, string>> = {
  en: 'English',
  ru: 'Russian',
  zh: 'Chinese',
}

/** Что отправляем модели: системная инструкция и данные. */
export interface FillPrompt {
  readonly system: string
  readonly userText: string
}

/** Пара «английская строка → перевод»: тот же вид, что у правок из панели. */
export type FillPair = readonly [string, string]

/**
 * Запрос на перевод партии терминов.
 *
 * Требования к ответу перечислены в инструкции явно: слева — строка байт в байт как
 * дана (иначе перевод не с чем сопоставить), подстановки `{имя}` остаются как есть
 * (панель подставляет их потом), ответ — только JSON-массив пар.
 * @param terms - английские строки набора.
 * @param language - язык, на который переводим.
 * @returns системная инструкция и JSON-массив терминов.
 */
export function fillPrompt(terms: readonly string[], language: EngramLanguage): FillPrompt {
  const name = LANGUAGE_NAMES[language]
  return {
    system: message('llm.dictionaryFillSystem', { language: name }),
    userText: JSON.stringify(terms, null, 1),
  }
}

/** Вырезать JSON-объект из ответа: тот же приём, что у `parseJsonArray`, но для карты. */
function parseJsonObject(text: string): Record<string, unknown> | undefined {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text)
  const candidate = (fenced?.[1] ?? text).trim()
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start < 0 || end <= start) return undefined
  try {
    const parsed: unknown = JSON.parse(candidate.slice(start, end + 1))
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined
  } catch {
    return undefined
  }
}

/**
 * Разобрать ответ модели в пары «строка → перевод».
 *
 * Принимаются оба вида ответа: массив пар (`[["English","перевод"]]`) и объект-карта
 * (`{"English":"перевод"}`) — модель отвечает то так, то так, и терять из-за формы
 * весь ответ незачем. Отбрасывается всё, что нельзя положить в словарь: строки,
 * которых не спрашивали (модель любит добавлять своё), повтор (побеждает первый),
 * пустой перевод и перевод, совпавший с английским текстом — последнее значит
 * «перевести не удалось», и записывать это как перевод нельзя: тогда «уже переведено»
 * не отличить от «перевода нет».
 * @param text - ответ модели.
 * @param terms - то, что спрашивали: ответ вне списка не принимается.
 * @returns пары в порядке ответа модели.
 */
export function parseFillAnswer(text: string, terms: readonly string[]): readonly FillPair[] {
  const asked = new Set(terms)
  const out: FillPair[] = []
  const seen = new Set<string>()

  const accept = (left: unknown, right: unknown): void => {
    if (typeof left !== 'string' || typeof right !== 'string') return
    if (!asked.has(left) || seen.has(left)) return
    const value = right.trim()
    if (value === '' || value === left) return
    seen.add(left)
    out.push([left, value])
  }

  const parsed = parseJsonArray(text)
  if (parsed !== undefined) {
    for (const item of parsed) {
      if (Array.isArray(item)) accept(item[0], item[1])
      else if (typeof item === 'object' && item !== null) {
        const pair = item as { left?: unknown, right?: unknown, term?: unknown, translation?: unknown }
        accept(pair.left ?? pair.term, pair.right ?? pair.translation)
      }
    }
    if (out.length > 0) return out
  }

  const map = parseJsonObject(text)
  if (map !== undefined) for (const [left, right] of Object.entries(map)) accept(left, right)
  return out
}

/**
 * Проверка партии перед запросом: пустая партия — не ошибка, а отсутствие работы.
 * @param terms - английские строки партии.
 * @returns нормализованный список терминов.
 */
export function fillBatch(terms: readonly string[]): readonly string[] {
  const list: string[] = []
  const seen = new Set<string>()
  for (const term of terms) {
    const value = term.trim()
    if (value === '' || seen.has(value)) continue
    seen.add(value)
    list.push(value)
  }
  if (list.length > FILL_REQUEST_MAX) {
    throw new EngramError('DICTIONARY_FILL_TOO_MANY', message('llm.dictionaryFillTooMany', {
      n: String(list.length),
      max: String(FILL_REQUEST_MAX),
    }))
  }
  return list
}
