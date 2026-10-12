/**
 * Локальный эмбеддер на transformers.js: вывод офлайн, веса скачиваются один раз
 * в каталог кэша.
 *
 * По умолчанию модель — Xenova/bge-small-zh-v1.5 (китайская bge-модель, 512 измерений).
 * Но выбор модели есть свойство развёртывания, а не свойство кода: для русских
 * текстов нужна многоязычная модель, поэтому идентификатор и способ пулинга
 * приходят из конфигурации.
 * @module @kenz1117/dsh-engram/embedder/local
 */

import { mkdir } from 'node:fs/promises'
import { EngramError } from '../types.ts'
import { message } from '../i18n/messages.ts'
import type { EngramEmbedder } from './interface.ts'

/** Идентификатор модели по умолчанию (китайская bge-small, 512 измерений); оставлен для совместимости с прежними конфигурациями. */
export const ENGRAM_MODEL_ID = 'Xenova/bge-small-zh-v1.5'

/**
 * Многоязычная модель (384 измерения, пулинг mean).
 *
 * Китайская bge-small-zh на русских и английских текстах работает плохо: она обучалась
 * на китайском. Поэтому для всех языков, кроме китайского, по умолчанию берётся эта
 * модель — выбор модели не то, чем стоит занимать человека.
 */
export const ENGRAM_MULTILINGUAL_MODEL_ID = 'Xenova/paraphrase-multilingual-MiniLM-L12-v2'

/**
 * Способ сведения токенов в один вектор.
 *
 * bge-small-zh и большинство моделей sentence-transformers обучены на mean;
 * bge-m3 и родственные XLM-R-модели требуют cls — с mean их вектор теряет качество.
 */
export type PoolingMode = 'mean' | 'cls'

/** 进程内单例：重复调用 createLocalEmbedder 共享同一模型实例，避免重复加载权重。 */
let cached: { dir: string; model: string; pooling: PoolingMode; embedder: EngramEmbedder } | undefined

/**
 * 创建本地嵌入器。
 * @param cacheDir - 模型缓存目录；不存在会自动创建（0o700）。
 * @param remoteHost - 模型下载端点；默认 huggingface.co，网络受限环境可配镜像（如 https://hf-mirror.com）。
 * @param modelId - 模型标识；默认 ENGRAM_MODEL_ID。更换模型会让进程内单例失效并重新加载。
 * @param pooling - 池化方式；默认 mean。
 * @returns 就绪的 EngramEmbedder。
 * @throws EngramError(code=EMBEDDER_DOWNLOAD_FAILED) 模型下载/加载失败（调用方据此降级）。
 */
export async function createLocalEmbedder(
  cacheDir: string,
  remoteHost?: string,
  modelId: string = ENGRAM_MODEL_ID,
  pooling: PoolingMode = 'mean',
): Promise<EngramEmbedder> {
  if (cached?.dir === cacheDir && cached.model === modelId && cached.pooling === pooling) return cached.embedder
  await mkdir(cacheDir, { recursive: true, mode: 0o700 })
  try {
    const { pipeline, env } = await import('@huggingface/transformers')
    env.cacheDir = cacheDir
    if (remoteHost !== undefined && remoteHost !== '') env.remoteHost = remoteHost
    const extractor = await pipeline('feature-extraction', modelId, { dtype: 'q8' })
    const embedder: EngramEmbedder = {
      model: modelId,
      async embed(texts) {
        if (texts.length === 0) return []
        const output = await extractor([...texts], { pooling, normalize: true })
        const lists = output.tolist() as number[][]
        return lists.map(list => new Float32Array(list))
      },
      // 管线由模块级 cached 持有；close 仅解除本实例引用，不销毁共享权重。
      close: async () => {
        if (cached?.embedder === embedder) cached = undefined
      },
    }
    cached = { dir: cacheDir, model: modelId, pooling, embedder }
    return embedder
  } catch (error) {
    throw new EngramError('EMBEDDER_DOWNLOAD_FAILED', message('store.embedderDownloadFailed'), { cause: error })
  }
}
