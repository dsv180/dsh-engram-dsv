/**
 * 向量相似度共享实现：store 检索与巩固聚类共用一份，替代历史上的两处复制。
 * @module @kenz1117/dsh-engram/vec
 */

import { message } from './i18n/messages.ts'
import { EngramError } from './types.ts'

/**
 * 余弦相似度；任一向量零范数时返回 0。
 *
 * 维度不同的两个向量不比较，而是抛错。逐维截断会得到一个「看起来像相似度」的数，
 * 而嵌入器现在是可配置的部署属性：换模型之后存量向量与新向量维度不同是常规情形，
 * 不是意外。与其静默降级、让人按错误的相似度做合并决定，不如在第一次比较时就说清
 * 两边的维度——错误原样交给上层，人就有机会改回模型，或用新模型重建向量。
 * @param a - 向量 A。
 * @param b - 向量 B。
 * @returns 余弦相似度，范围约 [-1, 1]；零范数输入返回 0。
 * @throws EngramError(code=EMBEDDER_DIMENSION_MISMATCH) 两向量维度不同。
 */
export function cosine(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    throw new EngramError(
      'EMBEDDER_DIMENSION_MISMATCH',
      message('store.embedderDimensionMismatch', { expected: b.length, found: a.length }),
    )
  }
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!
    na += a[i]! * a[i]!
    nb += b[i]! * b[i]!
  }
  if (na === 0 || nb === 0) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}
