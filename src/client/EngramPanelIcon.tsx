/**
 * 顶层侧栏「记忆宫殿」入口图标。
 *
 * v0.8.10:侧栏邻居「Hyreal FDE 工作台」是彩色 app tile,裸线条图标在旁边
 * 又黑又弱。改为品牌渐变圆角 tile(amber→orange→rose,与面板水印
 * --brand-1/--brand-3/--brand-2 同源)+ 白色宫殿剪影(屋顶/墙身/门洞),
 * 宿主主题只影响不了它——插件品牌色恒定,与 FDE tile 同一视觉量级。
 *
 * 宿主只传 size(塌缩 16 / 展开 18);tile 全尺寸出血,无需 active 差分
 * (选中态由 sidebar 行底色承担)。
 * @module @kenz1117/dsh-engram/client/EngramPanelIcon
 */

import type { ReactElement } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'

export function EngramPanelIcon({ size }: PropsRuntime<'sidebar.panellist'>): ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="engram-tile-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#F59E0B" />
          <stop offset="55%" stopColor="#FB923C" />
          <stop offset="100%" stopColor="#F43F5E" />
        </linearGradient>
      </defs>
      {/* 品牌 tile */}
      <rect x="1" y="1" width="22" height="22" rx="6" fill="url(#engram-tile-grad)" />
      {/* 白宫殿剪影:屋顶 / 墙身 / 门洞 */}
      <g fill="none" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6.5 10.4 L12 6.4 L17.5 10.4" />
        <path d="M7.8 10.4 V17 H16.2 V10.4" />
        <path d="M10.6 17 V13.6 Q10.6 12.5 12 12.5 Q13.4 12.5 13.4 13.6 V17" />
      </g>
    </svg>
  )
}
