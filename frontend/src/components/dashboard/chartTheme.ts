// 仪表盘小组件共享的图表主题与格式化工具。
// 仪表盘、资金看板及报表复用同一配色、网格和格式化；提示框与图例见 ChartPresentation。

export const axisTick = { fontSize: 11, fill: 'hsl(var(--muted-foreground))' } as const

/** 分类配色：语义色打头，其余用几个协调的固定色轮转（饼图/多序列） */
export const CHART_COLORS = [
  'hsl(var(--primary))', '#4a8a78', '#b78b46', '#4e83aa',
  '#7775a8', '#578b93', '#a87955', '#a36676',
]

/** 图形采用克制的分类色；状态与错误文案仍沿用原业务语义色。 */
export const CHART_TONES = {
  primary: 'hsl(var(--primary))', success: '#4a8a78', destructive: '#b96a65',
  warning: '#b78b46', info: '#4e83aa',
} as const

/** 金额格式化与业务/财务页面同源（lib/format 的 money），仪表盘不再另存一份实现 */
export { money } from '@/lib/format'
export const wan = (n: number) => Math.abs(n) >= 10000 ? `${(n / 10000).toFixed(Math.abs(n) >= 1e6 ? 0 : 1)}万` : String(Math.round(n))
export const pct = (n: number) => `${(n * 100).toFixed(1)}%`

/** 空数据占位（图表/列表统一）：撑满卡片并居中，避免固定卡高下顶部留大片空白 */
export const EMPTY_HINT = 'flex h-full min-h-[6rem] items-center justify-center text-center text-sm text-muted-foreground'

export const chartGrid = { stroke: 'hsl(var(--border))', strokeOpacity: 0.65, vertical: false } as const
export const chartBarCursor = { fill: 'hsl(var(--muted))', fillOpacity: 0.55 } as const
