/**
 * Сборка эмбеддера: выбор между локальной офлайн-моделью и удалённым
 * OpenAI-совместимым эндпоинтом по разобранной конфигурации.
 *
 * Точка выбора одна: иначе «какой эмбеддер работает» перестаёт быть проверяемым
 * свойством развёртывания и становится свойством места вызова.
 * @module @kenz1117/dsh-engram/embedder/select
 */

import type { ResolvedEngramConfig } from '../config.ts'
import type { EngramEmbedder } from './interface.ts'
import { createLocalEmbedder } from './local.ts'
import { createRemoteEmbedder } from './remote.ts'

/**
 * Прочитать ключ из переменной окружения.
 *
 * Имя переменной задаётся конфигурацией, значения в конфиг не попадают: одна и та же
 * cordis.yml остаётся пригодной для нескольких машин, а ключ не оседает в файле,
 * который читают при разборе настроек.
 */
function apiKeyFromEnv(name: string | undefined): string | undefined {
  if (name === undefined || name === '') return undefined
  const value = process.env[name]
  return value === undefined || value === '' ? undefined : value
}

/**
 * Создать эмбеддер, выбранный конфигурацией.
 * @param config - Разобранная конфигурация плагина.
 * @returns Готовый EngramEmbedder.
 * @throws EngramError Локальная модель не загрузилась либо удалённый эндпоинт не ответил.
 */
export function createEmbedder(config: ResolvedEngramConfig): Promise<EngramEmbedder> {
  const embedder = config.embedder
  const remote = embedder.remote
  if (remote !== undefined) {
    return createRemoteEmbedder({
      model: remote.model,
      baseUrl: remote.baseUrl,
      // Переменная окружения старше ключа из конфига: так ключ можно не хранить в файле вовсе.
      apiKey: apiKeyFromEnv(remote.apiKeyEnv) ?? remote.apiKey,
      batchSize: remote.batchSize,
      timeoutMs: remote.timeoutMs,
    })
  }
  return createLocalEmbedder(config.modelCacheDir, config.hfEndpoint, embedder.localModel, embedder.localPooling)
}
