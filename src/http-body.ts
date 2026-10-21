/**
 * 回环 API 的 JSON body 读取器。
 *
 * 独立成模块有三个原因：
 *  1. **上限要按路由分档**——普通写接口 64 KiB 足够（防坏/恶意 body 拖住 handler），
 *     但导入路由要装下一整份导出（实测 165 KB 量级，issue #34），沿用 64 KiB 就会把
 *     合法导出件当成坏 body 拒掉。
 *  2. **失败原因必须可辨**——「超出上限」「JSON 坏了」「不是对象」三件事要分开报。
 *     一律说成「不是 JSON 对象」，用户会去查自己的文件，而真凶是服务端上限。
 *  3. **口径要统一**——限额按字节算，解码按整块 UTF-8 算（详见下面两段注释）。
 *
 * @module @kenz1117/dsh-engram/http-body
 */

import type { IncomingMessage } from 'node:http'
import { BODY_LIMIT_BYTES, IMPORT_BODY_LIMIT_BYTES } from './body-limits.ts'

export { BODY_LIMIT_BYTES, IMPORT_BODY_LIMIT_BYTES }

/** body 读取失败的三种原因。 */
export type JsonBodyFailure = 'too-large' | 'malformed' | 'not-object'

/** 读取结果：成功给 body，失败给可辨的原因。 */
export type JsonBodyResult =
  | { readonly ok: true; readonly body: Record<string, unknown> }
  | { readonly ok: false; readonly reason: 'too-large'; readonly limit: number }
  | { readonly ok: false; readonly reason: 'malformed'; readonly error: string }
  | { readonly ok: false; readonly reason: 'not-object' }

/**
 * 读取并解析 JSON body。
 *
 * 字节口径：限额按 body 的**字节数**算，不是字符数。中文一字 3 字节，按字符算
 * 会让实际字节上限虚高到 3 倍——等于把防滥用防线悄悄放宽了。
 *
 * 解码口径：先攒 Buffer，最后一次性 UTF-8 解码。逐块 `String(chunk)` 会在多字节
 * 字符跨块边界时被切成两个 U+FFFD——大文件必中招（导出件全是中文）。
 *
 * @param req - 请求。
 * @param limit - 字节上限（默认 64 KiB）。
 */
export async function readJsonBody(req: IncomingMessage, limit: number = BODY_LIMIT_BYTES): Promise<JsonBodyResult> {
  // Content-Length 先判：超限直接拒，不把 body 读进内存。
  const declared = Number(req.headers['content-length'])
  if (Number.isFinite(declared) && declared > limit) {
    req.resume() // 丢弃剩余请求体，让连接能正常收尾（响应里会带 413）
    return { ok: false, reason: 'too-large', limit }
  }
  const chunks: Buffer[] = []
  let size = 0
  let tooLarge = false
  await new Promise<void>((resolve, reject) => {
    let ended = false
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > limit) {
        // 超限后不再攒：本读取器持有的字节封顶在 limit，剩下的请求体由 Node 流自己丢弃。
        // （进程 RSS 仍会随 body 大小涨——那是 Node 的流缓冲与 GC 滞后，不是这里攒下来的。）
        tooLarge = true
        chunks.length = 0
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => { ended = true; resolve() })
    req.on('error', (error: Error) => reject(error))
    req.on('aborted', () => reject(new Error('request aborted')))
    req.on('close', () => { if (!ended) reject(new Error('request closed before end')) })
  })
  if (tooLarge) return { ok: false, reason: 'too-large', limit }
  const text = Buffer.concat(chunks).toString('utf8')
  let parsed: unknown
  try {
    parsed = JSON.parse(text === '' ? '{}' : text)
  } catch (error) {
    return { ok: false, reason: 'malformed', error: error instanceof Error ? error.message : String(error) }
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, reason: 'not-object' }
  }
  return { ok: true, body: parsed as Record<string, unknown> }
}
