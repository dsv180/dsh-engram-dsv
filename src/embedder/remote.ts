/**
 * Эмбеддер, работающий через OpenAI-совместимый эндпоинт `POST {baseUrl}/embeddings`.
 *
 * Эндпоинт может быть и публичным сервисом эмбеддингов, и сервером вывода
 * в локальной сети (LM Studio, Ollama, vLLM). Для плагина это различие сводится
 * к значению baseUrl: где проходит граница «своё / чужое» — решение развёртывания,
 * а не решение кода, поэтому реализация одна.
 *
 * Ключ читается только из конфигурации или переменной окружения: он не попадает
 * ни в логи, ни в текст ошибок, ни в диагностическое поле model.
 * @module @kenz1117/dsh-engram/embedder/remote
 */

import { EngramError } from '../types.ts'
import type { EngramEmbedder } from './interface.ts'

/** Предел числа текстов в одном запросе: слишком крупный пакет сервер обычно отклоняет целиком. */
const DEFAULT_BATCH_SIZE = 32

/** Таймаут одного запроса в миллисекундах. */
const DEFAULT_TIMEOUT_MS = 30_000

/** Параметры создания удалённого эмбеддера. */
export interface RemoteEmbedderOptions {
  /** Идентификатор модели, передаётся серверу как есть (например text-embedding-3-small). */
  readonly model: string
  /** Корень эндпоинта вида https://api.example.com/v1 — реализация сама дописывает /embeddings. */
  readonly baseUrl: string
  /** Ключ Bearer; пустое значение означает эндпоинт без аутентификации (обычное дело в локальной сети). */
  readonly apiKey?: string
  /** Предел числа текстов в одном запросе; по умолчанию 32. */
  readonly batchSize?: number
  /** Таймаут одного запроса; по умолчанию 30000 мс. */
  readonly timeoutMs?: number
}

/** Минимальная форма ответа: берём только нужные поля, остальное игнорируем. */
interface EmbeddingsResponse {
  data?: { index?: number; embedding?: number[] }[]
}

/**
 * Приведение вектора к единичной длине.
 *
 * Интерфейс обещает нормализованные векторы, и это же снимает расхождение между
 * косинусом и скалярным произведением: при ненулевой норме они совпадают.
 * Нулевой вектор возвращается как есть — вызывающий код трактует его как «нет сигнала».
 */
function toUnitVector(values: readonly number[]): Float32Array {
  const out = new Float32Array(values.length)
  let sumSquares = 0
  for (let i = 0; i < values.length; i++) sumSquares += values[i]! * values[i]!
  if (sumSquares === 0) return out
  const scale = 1 / Math.sqrt(sumSquares)
  for (let i = 0; i < values.length; i++) out[i] = values[i]! * scale
  return out
}

/**
 * Создать удалённый эмбеддер.
 *
 * При создании отправляется одна пробная вставка: недоступный эндпоинт, неверный
 * ключ и отсутствующая модель выявляются на этапе загрузки, и вызывающий код
 * переводит поиск в режим «только ключевые слова» — вместо отказа при первой записи.
 *
 * @param options - Параметры эндпоинта.
 * @returns Готовый EngramEmbedder.
 * @throws EngramError(code=EMBEDDER_REMOTE_FAILED) Пробный запрос не удался.
 */
export async function createRemoteEmbedder(options: RemoteEmbedderOptions): Promise<EngramEmbedder> {
  const endpoint = `${options.baseUrl.replace(/\/+$/, '')}/embeddings`
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const apiKey = options.apiKey
  if (apiKey !== undefined && apiKey !== '') headers['Authorization'] = `Bearer ${apiKey}`

  /** Один запрос; порядок ответа восстанавливается по index, если сервер его прислал. */
  const request = async (texts: readonly string[]): Promise<Float32Array[]> => {
    let response: Response
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({ model: options.model, input: [...texts], encoding_format: 'float' }),
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch (error) {
      throw new EngramError(
        'EMBEDDER_REMOTE_FAILED',
        `эндпоинт эмбеддингов недоступен (${options.baseUrl}, таймаут ${timeoutMs} мс)`,
        { cause: error },
      )
    }
    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw new EngramError(
        'EMBEDDER_REMOTE_FAILED',
        `эндпоинт эмбеддингов вернул HTTP ${response.status}${detail === '' ? '' : `: ${detail.slice(0, 200)}`}`,
      )
    }
    const payload = await response.json() as EmbeddingsResponse
    const data = payload.data
    if (!Array.isArray(data) || data.length !== texts.length) {
      throw new EngramError(
        'EMBEDDER_REMOTE_FAILED',
        `эндпоинт эмбеддингов вернул ${Array.isArray(data) ? data.length : 'не массив'} векторов вместо ${texts.length}`,
      )
    }
    const ordered = data.every(item => typeof item.index === 'number')
      ? [...data].sort((left, right) => (left.index ?? 0) - (right.index ?? 0))
      : data
    return ordered.map(item => {
      const values = item.embedding
      if (!Array.isArray(values) || values.length === 0) {
        throw new EngramError('EMBEDDER_REMOTE_FAILED', 'эндпоинт эмбеддингов вернул пустой вектор')
      }
      return toUnitVector(values)
    })
  }

  const embed = async (texts: readonly string[]): Promise<Float32Array[]> => {
    if (texts.length === 0) return []
    const vectors: Float32Array[] = []
    for (let start = 0; start < texts.length; start += batchSize) {
      vectors.push(...await request(texts.slice(start, start + batchSize)))
    }
    return vectors
  }

  // Пробная вставка идёт тем же путём, что и рабочие вызовы: отдельной «проверки
  // соединения», которая может разойтись с реальным запросом, здесь не заводится.
  await embed(['dsh-engram: проверка эмбеддера'])

  return {
    model: options.model,
    embed,
    // Локальных ресурсов нет: соединения пулирует среда исполнения.
    close: async () => { /* нечего освобождать */ },
  }
}
