/**
 * Сбор сигналов для языка дворца: то, что можно прочитать у хоста и на машине.
 *
 * Чистые правила — в `src/i18n/palace-language.ts`; здесь только чтение источников
 * и приведение их к общему виду. Всё, чего прочитать нельзя, честно помечено
 * в комментарии, а не выдумано сигналом.
 *
 * Что читается сегодня:
 * - **preference интерфейса** — переданной функцией: сам сервис настроек живёт
 *   в `src/settings-bridge.ts`, чтобы этот модуль оставался тестируемым без хоста;
 * - **локаль Windows** — через `Intl` (`systemLanguage`).
 *
 * Чего здесь намеренно нет:
 * - **диалоги**. Раньше реплики человека читались из журналов сессий, и это стоило
 *   дорого: журнал читается целиком (`read(offset, length)` в JSONL-бэкенде парсит
 *   весь файл и только потом режет массив), а на живых данных это десятки тысяч
 *   событий и сотни мегабайт кучи на каждом старте — ради сорока реплик. Пока нет
 *   дешёвого способа взять из журнала хвост, диалоги не читаются вовсе (решение 20.10);
 *   правила взвешивания в `palace-language.ts` при этом сохранены: источник вернётся,
 *   когда появится дешёвое чтение.
 * - **установленные языковые пакеты**. Хостовый сервер знает только `preference`
 *   (строку), а реестр языков живёт в браузерной половине хоста.
 * @module @kenz1117/dsh-engram/language-signals
 */

import { decideLanguage, type LanguageDecision, type LanguageSignal } from './i18n/palace-language.ts'
import { isEngramLanguage, resolveLanguage, type EngramLanguage } from './i18n/language.ts'

/** Откуда брать сигналы. Все источники, кроме системной локали, необязательны. */
export interface LanguageSignalDeps {
  /** Активный `preference` интерфейса хоста; отсутствует — сигнала нет. */
  readonly readInterfacePreference?: (() => Promise<string | undefined>) | undefined
  /** Локаль машины (по умолчанию `systemLanguage`). */
  readonly systemLocale?: (() => EngramLanguage) | undefined
}

/** Собранные сигналы и решение по ним. */
export interface CollectedSignals {
  /** Решение с обоснованием. */
  readonly decision: LanguageDecision
}

/**
 * Собрать сигналы и решить язык дворца.
 * @param deps - источники сигналов.
 * @returns Решение по сигналам.
 */
export async function collectLanguageSignals(deps: LanguageSignalDeps = {}): Promise<CollectedSignals> {
  const signals: LanguageSignal[] = []

  if (deps.readInterfacePreference !== undefined) {
    try {
      const preference = await deps.readInterfacePreference()
      const base = preference?.split('-')[0]?.toLowerCase()
      if (base !== undefined && isEngramLanguage(base)) signals.push({ source: 'interface', language: base })
    } catch {
      // Настройки недоступны — сигнала интерфейса нет.
    }
  }

  const windows = (deps.systemLocale ?? (() => resolveLanguage('auto')))()
  signals.push({ source: 'windows', language: windows })

  return { decision: decideLanguage(signals) }
}
