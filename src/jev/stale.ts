/**
 * Поля Jev прежнего формата: ключ и адрес когда-то хранились у самого плагина
 * (`jev.apiKey`, `jev.baseUrl`). После переезда к провайдеру хоста они больше не
 * читаются, но продолжают лежать в уже написанных конфигурациях — и человек вправе
 * об этом узнать, а не гадать, почему судья молчит.
 *
 * Предупреждение одноразовое на процесс, причём отдельно для каждого источника и
 * поля: перекрытие панели читается при каждой сборке судьи, и без счётчика один и
 * тот же текст повторялся бы на каждой записи. Источники разделены намеренно —
 * `cordis.yml` и `jev-config.json` правятся в разных местах, и заглушить один
 * предупреждением о другом значило бы оставить половину работы незамеченной.
 *
 * @module @kenz1117/dsh-engram/jev/stale
 */

import { message } from '../i18n/messages.ts'

/** Прежние поля Jev, пережившие переезд ключа и адреса к провайдеру хоста. */
const LEGACY_FIELDS = ['apiKey', 'baseUrl'] as const

/** Уже прозвучавшие предупреждения: ключ — «источник + поле». */
const warned = new Set<string>()

/**
 * Имена полей прежнего формата, реально присутствующих в объекте.
 * @param value - разобранный JSON перекрытия или подконфигурация `jev` из cordis.yml.
 * @returns найденные имена полей; пустой массив — объект чист.
 */
export function legacyJevFields(value: unknown): string[] {
  if (value === null || typeof value !== 'object') return []
  const raw = value as Record<string, unknown>
  return LEGACY_FIELDS.filter(field => raw[field] !== undefined)
}

/**
 * Напомнить один раз, что поля прежнего формата игнорируются, и сказать, куда
 * переехал ключ. Текст берётся из служебного словаря: язык — состояние процесса.
 * @param where - где нашлись поля: `cordis.yml` или `jev-config.json`.
 * @param fields - имена полей (см. `legacyJevFields`).
 */
export function noteLegacyJevFields(where: string, fields: readonly string[]): void {
  for (const field of fields) {
    const seen = `${where}|${field}`
    if (warned.has(seen)) continue
    warned.add(seen)
    console.warn(message('core.warnJevLegacyFields', { where, field }))
  }
}
