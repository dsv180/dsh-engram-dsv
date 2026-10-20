/**
 * 嵌入器组装：按解析后的配置在本地离线模型与远程 OpenAI 兼容端点之间选择。
 *
 * 选择点只有一处：否则「当前用的是哪个嵌入器」就不再是可检验的部署属性，
 * 而变成每个调用点各自的属性。
 * @module @kenz1117/dsh-engram/embedder/select
 */

import type { ResolvedEngramConfig } from '../config.ts'
import type { EngramEmbedder } from './interface.ts'
import { createLocalEmbedder } from './local.ts'
import { createRemoteEmbedder } from './remote.ts'

/**
 * 按配置创建嵌入器。
 * @param config - 插件解析后的配置。
 * @returns 就绪的 EngramEmbedder。
 * @throws EngramError 本地模型加载失败，或远程端点没有响应。
 */
export function createEmbedder(config: ResolvedEngramConfig): Promise<EngramEmbedder> {
  const embedder = config.embedder
  const remote = embedder.remote
  if (remote !== undefined) {
    return createRemoteEmbedder({
      model: remote.model,
      baseUrl: remote.baseUrl,
      // 环境变量优先于配置里的密钥：这样密钥可以完全不落在文件里。
      // 变量名整名交给嵌入器，由它在每次请求时读取——换密钥不必重启插件。
      apiKey: remote.apiKey,
      apiKeyEnv: remote.apiKeyEnv,
      batchSize: remote.batchSize,
      timeoutMs: remote.timeoutMs,
    })
  }
  return createLocalEmbedder(config.modelCacheDir, config.hfEndpoint, embedder.localModel, embedder.localPooling)
}
