/**
 * 顶层侧栏「记忆宫殿」入口图标：宫殿正视图 + 中心门洞。
 *
 * Phosphor 风：24px viewBox、stroke 1.75、round cap/join、currentColor 跟随宿主主题。
 * 颜色由 sidebar 按钮的 `color` 接管（`SidebarPanelIconOwnerProps.active` 时不变色，
 * 由 sidebar 自身的 row 选中态负责着色 — 跟随现有的「Hyreal FDE 工作台」入口行为）。
 *
 * 设计取舍：宫殿剪影能在 16px 下保持识别度（屋顶三角 + 中部门洞 + 两侧窗格），
 * 比抽象的「脑/节点」图标更贴合「记忆宫殿」叙事。
 * @module @kenz1117/dsh-engram/client/EngramPanelIcon
 */

import type { ReactElement } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'

/** Sidebar 传入的 owner-share：size 为正方形边长（rail 16/wide 18），active 标识选中态。 */
export function EngramPanelIcon({ size }: PropsRuntime<'sidebar.panellist'>): ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {/* 屋顶三角 */}
      <path d="M3 10 L12 4 L21 10" />
      {/* 宫殿主体（屋顶三角下方的方形） */}
      <path d="M5 10 V20 H19 V10" />
      {/* 中心门洞（拱形） */}
      <path d="M10 20 V14 Q10 12 12 12 Q14 12 14 14 V20" />
      {/* 左侧窗 */}
      <rect x="6.5" y="12" width="2" height="2.5" rx="0.4" />
      {/* 右侧窗 */}
      <rect x="15.5" y="12" width="2" height="2.5" rx="0.4" />
    </svg>
  )
}