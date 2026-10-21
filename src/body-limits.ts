/**
 * 回环 API 的 body 字节上限（服务端与面板共用一份数字）。
 *
 * 单列一个模块的原因：上限既要写在服务端路由里，也要写在面板的前置检查里，
 * 两边各写一份迟早漂移——而漂移的后果是「面板放行、服务端拒收」或反过来，
 * 用户看到的却是另一句不相干的话。
 *
 * 本模块刻意不依赖任何运行时（无 node API、无 DOM API），服务端与浏览器端都能直接内联。
 *
 * @module @kenz1117/dsh-engram/body-limits
 */

/** 普通写接口的 body 上限：64 KiB（防坏/恶意 body 拖住 handler）。 */
export const BODY_LIMIT_BYTES = 64 * 1024

/**
 * 导入接口的 body 上限：16 MiB。
 * 导入 payload 是整份导出（records + edges + entities），实测导出件动辄上百 KB
 * （issue #34 的现场导出件是 117 KB 与 165 KB），16 MiB 给足余量同时留住上限。
 */
export const IMPORT_BODY_LIMIT_BYTES = 16 * 1024 * 1024

/** 字节数 → 可读上限文案（上限要能让人一眼看出量级）。 */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${String(Math.round(bytes / 1024 / 1024))} MB`
  if (bytes >= 1024) return `${String(Math.round(bytes / 1024))} KB`
  return `${String(bytes)} B`
}
