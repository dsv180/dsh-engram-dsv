/**
 * dsh-engram client half: 注册顶层侧栏「记忆宫殿」入口与主列面板。
 * v0.7.16+ 由设置弹窗内的 section 升级为顶层入口，与「Hyreal FDE 工作台」平起平坐：
 * 一击进入 + 主列满宽，不再被设置弹窗的 ~600px 限制。
 * 数据经回环 API（/api/engram/*）读取与操作，与 host 半的路由对齐。
 * 文案经宿主 locale 服务（zh/en 词典，语言切换由渲染器自动重渲染）。
 * @module @kenz1117/dsh-engram/client
 */

import type { Context } from '@deepseek-ai/cordis'
// Type-only: ctx.locale 服务声明（宿主 locale 插件的 Context merge）。
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: ctx.slots（renderer 的 SlotMap 渲染接线）。
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: 'main' 槽位与 MainPanelId 类型（ui-layout 契约）。
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
// Type-only: 'sidebar.panellist' 槽位（ui-sidebar 契约）。
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
// Type-only: LocaleNamespaceMap 声明合并目标（t 席位的键类型检查）。
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { bindEngramSection } from './EngramPanel.tsx'
import type { SessionsLike, WorkspacesLike } from './EngramPanel.tsx'
import { EngramPanelIcon } from './EngramPanelIcon.tsx'
import { NS, en, zh, type EngramKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    [NS]: EngramKey
  }
}

/** 必需服务：slots 渲染接线 + locale 词典注册。 */
export const inject = ['slots', 'locale']

/** 顶层侧栏入口与主列内容的共享 key：与 ui-layout 的 MainPanelId 对齐。 */
export const PANEL_ID = 'engram' as MainPanelId

/**
 * Client plugin body: 注册 zh/en 词典、双槽位（main + sidebar.panellist）。
 *
 * 面板的「项目宫殿」跟随 GUI 当前工作区，需要宿主的工作区/会话清单服务；
 * 两者都**可选取用**（`ctx.get`，不写进必需 inject）：缺席时面板其余功能照常，
 * 只有项目宫殿来源 chip 显示「无工作区信息（进程默认）」。
 * @param ctx - client root context.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-engram: dictionaries')
  const t = ctx.locale.bind(NS)
  // 可选服务：按运行时形状取用（不硬依赖 @deepseek-ai/dsh-api-* 客户端包）；
  // 用 getter 现取而不是 apply 时取实例——这两个服务可能在本插件之后才挂载。
  const workspaces = (): WorkspacesLike | undefined => ctx.get('workspaces' as never) as WorkspacesLike | undefined
  const sessions = (): SessionsLike | undefined => ctx.get('sessions' as never) as SessionsLike | undefined
  // 主列面板：选中侧栏入口后，layout 把 main 切到 key=PANEL_ID 的组件上。
  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main',
    key: PANEL_ID,
    locale: NS,
  }, bindEngramSection({ workspaces, sessions })))
  // 顶层侧栏入口：order=50 排在「上下文洞察」「Hyreal FDE 工作台」之后。
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist',
    id: PANEL_ID,
    order: 50,
    label: () => t('nav'),
    locale: NS,
  }, EngramPanelIcon))
}
