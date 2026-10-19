import { describe, expect, it } from 'vitest'
import { cosine } from '../src/vec.ts'

describe('cosine', () => {
  it('同维度照常计算：同向为 1，正交为 0', () => {
    expect(cosine(new Float32Array([1, 0]), new Float32Array([1, 0]))).toBeCloseTo(1, 6)
    expect(cosine(new Float32Array([1, 0]), new Float32Array([0, 1]))).toBeCloseTo(0, 6)
  })

  it('零范数返回 0，而不是 NaN', () => {
    expect(cosine(new Float32Array([0, 0]), new Float32Array([1, 1]))).toBe(0)
  })

  it('维度不同直接拒绝，不做逐维截断的比较', () => {
    // 384 维与 512 维放在一起是「换了模型但没重建向量」的现场：
    // 截断比较会给出一个像样的相似度，合并决策却会据此做出。
    let code: string | undefined
    try {
      cosine(new Float32Array(384), new Float32Array(512))
    } catch (error) {
      code = (error as { code?: string }).code
    }
    expect(code).toBe('EMBEDDER_DIMENSION_MISMATCH')
  })
})
