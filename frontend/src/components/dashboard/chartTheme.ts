// 仪表盘小组件共享的图表主题与格式化工具。
// 与资金看板（pages/finance/dashboard）保持一致：主题感知的 Tooltip（暗色也用卡片底色）、
// 语义色打头的配色轮转、金额/万/百分比格式化。改配色请连带核对资金看板，避免两处漂移。

/** 主题感知 Tooltip 样式：暗色模式下用卡片底色，避免 recharts 默认白底刺眼 */
export const chartTooltip = {
  borderRadius: 8,
  border: '1px solid hsl(var(--border))',
  background: 'hsl(var(--card))',
  color: 'hsl(var(--foreground))',
  fontSize: 12,
} as const

export const axisTick = { fontSize: 11, fill: 'hsl(var(--muted-foreground))' } as const

/** 分类配色：语义色打头，其余用几个协调的固定色轮转（饼图/多序列） */
export const CHART_COLORS = [
  'hsl(var(--primary))', 'hsl(var(--success))', 'hsl(var(--warning))', 'hsl(var(--info))',
  '#8b5cf6', '#0ea5e9', '#f97316', 'hsl(var(--destructive))',
]

export const money = (n: number) => `¥${Number(n).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
export const wan = (n: number) => Math.abs(n) >= 10000 ? `${(n / 10000).toFixed(Math.abs(n) >= 1e6 ? 0 : 1)}万` : String(Math.round(n))
export const pct = (n: number) => `${(n * 100).toFixed(1)}%`

/** 空数据占位（图表/列表统一）：撑满卡片并居中，避免固定卡高下顶部留大片空白 */
export const EMPTY_HINT = 'flex h-full min-h-[6rem] items-center justify-center text-center text-sm text-muted-foreground'
