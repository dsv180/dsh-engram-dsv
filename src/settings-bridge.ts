/**
 * Мост к хостовому сервису настроек: чтение preference интерфейса и запись языка дворца.
 *
 * Зачем мост отдельным модулем: сам сервис — хостовый, в тестах его нет, а правила
 * «какой язык считается объявленным» и «как найти свою запись» проверить хочется
 * без поднятия хоста. Поэтому здесь только формы данных и чистые функции над ними;
 * всё, что требует `ctx`, остаётся в `src/index.ts`.
 *
 * Что известно про сервис (по коду `@deepseek-ai/dsh-settings` и `dsh-client-locale`):
 * - `describe()` отдаёт формы только тех записей, у которых есть volatile-поля,
 *   с ключом `ns` = идентификатор записи в профиле и номером ревизии;
 * - `update(ns, patch, revision)` вливает поля в конфигурацию записи и сохраняет её
 *   в профильном patch; значения применяются на живом фибере без перемонтирования;
 * - интерфейсный язык живёт в записи `locale` в поле `preference`.
 * @module @kenz1117/dsh-engram/settings-bridge
 */

/** Запись настройки языка в `preference` интерфейса. */
export const LOCALE_NAMESPACE = 'locale'

/** Поле, в котором лежит выбранный язык интерфейса. */
export const LOCALE_PREFERENCE_FIELD = 'preference'

/** Поле нашей собственной настройки — по нему находим свою запись в `describe()`. */
export const PALACE_LANGUAGE_FIELD = 'language'

/** Форма записи в том виде, в каком она нужна нам (подмножество ответа `describe()`). */
export interface SettingsEntryView {
  /** Идентификатор записи в профиле. */
  readonly ns: string
  /** Ревизия: её требует `update`, чтобы не затереть чужую правку. */
  readonly revision: number
  /** Живые значения volatile-полей. */
  readonly value?: Record<string, unknown> | undefined
  /** Схема формы: по ней отличаем свою запись от чужой. */
  readonly schema?: { readonly properties?: Record<string, unknown> | undefined } | undefined
}

/** Сервис настроек в узком виде — ровно те два метода, которые нам нужны. */
export interface SettingsServiceView {
  describe(options?: { readonly redactSecrets?: boolean }): readonly SettingsEntryView[]
  update(ns: string, patch: Record<string, unknown>, expectedRevision: number): Promise<void>
}

/**
 * Язык интерфейса из формы записи `locale`.
 * @param entries - ответ `describe()`.
 * @returns Строка `preference` либо `undefined`, если поле не задано.
 */
export function interfacePreference(entries: readonly SettingsEntryView[]): string | undefined {
  const locale = entries.find(entry => entry.ns === LOCALE_NAMESPACE)
  const raw = locale?.value?.[LOCALE_PREFERENCE_FIELD]
  return typeof raw === 'string' && raw !== '' ? raw : undefined
}

/**
 * Найти свою запись: в её форме есть поле языка дворца.
 *
 * Ищем не по имени пакета, а по составу формы: идентификатор записи в профиле —
 * дело хоста, и полагаться на конкретную строку значило бы зависеть от того, как
 * пользователь назвал запись. Если форм с полем `language` несколько, берём ту,
 * где это поле единственное (наша форма состоит только из него), иначе — никакую:
 * молча писать в чужую настройку хуже, чем не записать вовсе.
 * @param entries - ответ `describe()`.
 * @returns Запись с ревизией либо `undefined`.
 */
export function findPalaceEntry(entries: readonly SettingsEntryView[]): { ns: string; revision: number } | undefined {
  const candidates = entries.filter(entry => entry.schema?.properties !== undefined
    && Object.hasOwn(entry.schema.properties, PALACE_LANGUAGE_FIELD))
  if (candidates.length === 0) return undefined
  const exact = candidates.filter(entry => {
    const fields = Object.keys(entry.schema?.properties ?? {})
    return fields.length === 1 && fields[0] === PALACE_LANGUAGE_FIELD
  })
  const picked = exact.length === 1 ? exact[0] : candidates.length === 1 ? candidates[0] : undefined
  return picked === undefined ? undefined : { ns: picked.ns, revision: picked.revision }
}
