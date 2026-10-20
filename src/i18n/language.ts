/**
 * Язык вывода — серверная половина плагина.
 *
 * Клиентская половина язык не выбирает: она отдаёт хосту свои словари
 * (см. src/client/locales), а нужный выбирает рендерер по настройке языка DSH.
 * У серверной половины такого сервиса нет — тексты инструментов формируются
 * задолго до отрисовки, — поэтому язык определяется здесь: из настройки плагина,
 * а при значении «auto» — из системной локали.
 *
 * @module @kenz1117/dsh-engram/i18n/language
 */

/** Языки, для которых у плагина есть словари. */
export const ENGRAM_LANGUAGES = ['zh', 'en', 'ru'] as const

/** Язык вывода. */
export type EngramLanguage = (typeof ENGRAM_LANGUAGES)[number]

/** Язык, когда системный не распознан или словаря для него нет. */
export const FALLBACK_LANGUAGE: EngramLanguage = 'en'

/** Настройка языка: конкретный язык либо автоопределение. */
export type LanguageSetting = 'auto' | EngramLanguage

/** Проверка, что строка — поддерживаемый язык. */
export function isEngramLanguage(value: string): value is EngramLanguage {
  return (ENGRAM_LANGUAGES as readonly string[]).includes(value)
}

/**
 * Локаль системы как есть, без сведения к поддерживаемым языкам: «fr-FR» → «fr».
 *
 * Нужна там, где важно не «каким словарём мы располагаем», а на каком языке человек
 * на самом деле работает: панель первого старта подставляет язык локали в выбор,
 * а если такого языка у дворца нет — предлагает отдельный выбор «другой язык»
 * (решение 21.10). Здесь ничего не подменяется умолчанием: пустая строка значит
 * «прочитать не удалось», и вызывающий решает сам.
 */
export function systemLocaleBase(): string {
  try {
    const tag = Intl.DateTimeFormat().resolvedOptions().locale
    return (tag.split('-')[0] ?? '').toLowerCase()
  } catch {
    return ''
  }
}

/**
 * Язык системы. Берётся из Intl: «ru-RU» → «ru».
 * Язык без словаря сводится к языку по умолчанию: показывать пустые подписи хуже,
 * чем показать английские.
 */
export function systemLanguage(): EngramLanguage {
  const base = systemLocaleBase()
  return isEngramLanguage(base) ? base : FALLBACK_LANGUAGE
}

/** Итоговый язык вывода: «auto» разворачивается в системный язык. */
export function resolveLanguage(setting: LanguageSetting): EngramLanguage {
  return setting === 'auto' ? systemLanguage() : setting
}

/**
 * Язык вывода с учётом умолчания пакета.
 *
 * Настройка главнее умолчания: её назвал пользователь, и «auto» в ней — тоже его
 * выбор, а не отсутствие выбора. Умолчание пакета (служебное поле `default`
 * реестра привязок) главнее системной локали: иначе язык зависел бы от машины,
 * на которой плагин запущен, а не от того, что объявлено выпуском. Умолчание без
 * словаря не принимается — показать английские подписи лучше, чем объявленные,
 * но пустые. Ни настройки, ни умолчания — «auto», то есть язык системы.
 * @param setting - настройка `language`; undefined, если её не задавали.
 * @param packaged - объявленное умолчание пакета; undefined, если его нет.
 * @returns язык вывода; отсутствие поля возвращает поведение к «auto».
 */
export function pickLanguage(setting: LanguageSetting | undefined, packaged: string | undefined): EngramLanguage {
  if (setting !== undefined) return resolveLanguage(setting)
  if (packaged !== undefined && isEngramLanguage(packaged)) return packaged
  return resolveLanguage('auto')
}
