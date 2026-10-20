/**
 * Сбор сигналов для языка дворца: то, что можно прочитать у хоста и на машине.
 *
 * Чистые правила — в `src/i18n/palace-language.ts`; здесь только чтение источников
 * и приведение их к общему виду. Всё, чего прочитать нельзя, честно помечено
 * в комментарии, а не выдумано сигналом.
 *
 * Что читается сегодня:
 * - **диалоги** — через `sessionPersistence` (тот же сервис, что у исторического
 *   заполнения): заголовки сессий и их события, реплики человека без плагинных вставок;
 * - **локаль Windows** — через `Intl` (`systemLanguage`);
 * - **preference интерфейса** — переданной функцией: сам сервис настроек живёт
 *   в `src/settings-bridge.ts`, чтобы этот модуль оставался тестируемым без хоста.
 *
 * Чего прочитать нельзя: **установленные языковые пакеты**. Хостовый сервер знает
 * только `preference` (строку), а реестр языков живёт в браузерной половине хоста.
 * Поэтому сигнала `packs` здесь нет — он появится, когда панель начнёт сообщать
 * доступные языки сама.
 * @module @kenz1117/dsh-engram/language-signals
 */

import type { HistoryLogSource } from './ingest/history.ts'
import { decideLanguage, dominantLanguage, type LanguageDecision, type LanguageSignal } from './i18n/palace-language.ts'
import { isEngramLanguage, resolveLanguage, type EngramLanguage } from './i18n/language.ts'

/** Откуда брать сигналы. Все источники, кроме системной локали, необязательны. */
export interface LanguageSignalDeps {
  /** Источник истории сессий; отсутствует — сигнала диалога нет. */
  readonly history?: HistoryLogSource | undefined
  /** Активный `preference` интерфейса хоста; отсутствует — сигнала нет. */
  readonly readInterfacePreference?: (() => Promise<string | undefined>) | undefined
  /** Локаль машины (по умолчанию `systemLanguage`). */
  readonly systemLocale?: (() => EngramLanguage) | undefined
  /** Сколько последних сессий просматривать (по умолчанию 12). */
  readonly sessions?: number | undefined
  /** Сколько реплик брать из одной сессии (по умолчанию 40). */
  readonly perSession?: number | undefined
}

/** Собранные сигналы и решение по ним. */
export interface CollectedSignals {
  /** Решение с обоснованием. */
  readonly decision: LanguageDecision
  /** Что удалось прочитать в диалогах: сколько сессий и реплик легло в выборку. */
  readonly dialogue: { readonly sessions: number; readonly texts: number }
}

/** Реплики человека из журнала сессии: плагинные вставки пропускаются. */
function userTexts(events: readonly unknown[], limit: number): string[] {
  const texts: string[] = []
  for (const event of events) {
    if (texts.length >= limit) break
    const typed = event as { type?: unknown; data?: unknown } | null
    if (typed?.type !== 'user/message') continue
    const data = typed.data as { source?: { kind?: unknown }; content?: unknown } | null
    // Плагин сам пишет в сессию снимки памяти — это не речь человека.
    if (typeof data?.source?.kind === 'string' && data.source.kind.startsWith('plugin')) continue
    const blocks = Array.isArray(data?.content) ? data.content : []
    for (const block of blocks) {
      const text = (block as { type?: unknown; text?: unknown } | null)
      if (text?.type === 'text' && typeof text.text === 'string' && text.text.trim() !== '') texts.push(text.text)
      if (texts.length >= limit) break
    }
  }
  return texts
}

/**
 * Собрать сигналы и решить язык дворца.
 * @param deps - источники сигналов.
 * @returns Решение и краткая статистика по диалогам (она идёт в панель как объяснение).
 */
export async function collectLanguageSignals(deps: LanguageSignalDeps): Promise<CollectedSignals> {
  const signals: LanguageSignal[] = []
  let dialogueTexts = 0
  let dialogueSessions = 0

  if (deps.history !== undefined) {
    const limit = deps.sessions ?? 12
    const perSession = deps.perSession ?? 40
    try {
      const headers = [...(await deps.history.list())]
        .sort((left, right) => right.createdAt - left.createdAt)
        .slice(0, limit)
      const texts: string[] = []
      for (const header of headers) {
        try {
          const log = await deps.history.load(header.id)
          const part = userTexts(log.events, perSession)
          if (part.length > 0) dialogueSessions += 1
          dialogueTexts += part.length
          texts.push(...part)
        } catch {
          // Одна нечитаемая сессия не должна отменять определение: пропускаем её.
        }
      }
      const dominant = dominantLanguage(texts)
      if (dominant !== undefined) signals.push({ source: 'dialogue', language: dominant.language })
    } catch {
      // История недоступна — сигнала диалога просто нет.
    }
  }

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

  return { decision: decideLanguage(signals), dialogue: { sessions: dialogueSessions, texts: dialogueTexts } }
}
