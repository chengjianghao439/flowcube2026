// 仪表盘小组件共享的图表主题与格式化工具。
// 仪表盘、资金看板及报表复用同一配色、网格和格式化；提示框与图例见 ChartPresentation。

export const axisTick = { fontSize: 11, fill: 'hsl(var(--muted-foreground))' } as const

/** 分类配色复用品牌蓝与语义色，不另外维护图表色板。 */
export const CHART_COLORS = [
  'hsl(var(--blue-70))', 'hsl(var(--success))', 'hsl(var(--warning))', 'hsl(var(--blue-60))',
  'hsl(var(--blue-80))', 'hsl(var(--success-ink))', 'hsl(var(--destructive))', 'hsl(var(--blue-30))',
]

/** 图形采用克制的分类色；状态与错误文案仍沿用原业务语义色。 */
export const CHART_TONES = {
  primary: 'hsl(var(--primary))', success: 'hsl(var(--success))', destructive: 'hsl(var(--destructive))',
  warning: 'hsl(var(--warning))', info: 'hsl(var(--blue-60))',
} as const

/** 金额格式化与业务/财务页面同源（lib/format 的 money），仪表盘不再另存一份实现 */
export { money } from '@/lib/format'
export const wan = (n: number) => Math.abs(n) >= 10000 ? `${(n / 10000).toFixed(Math.abs(n) >= 1e6 ? 0 : 1)}万` : String(Math.round(n))
export const pct = (n: number) => `${(n * 100).toFixed(1)}%`

/** 空数据占位（图表/列表统一）：撑满卡片并居中，避免固定卡高下顶部留大片空白 */
export const EMPTY_HINT = 'flex h-full min-h-[6rem] items-center justify-center text-center text-sm text-muted-foreground'

export const chartGrid = { stroke: 'hsl(var(--border))', strokeOpacity: 0.65, vertical: false } as const
export const chartBarCursor = { fill: 'hsl(var(--muted))', fillOpacity: 0.55 } as const
