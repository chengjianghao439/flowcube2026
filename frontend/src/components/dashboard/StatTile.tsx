import type { LucideIcon } from 'lucide-react'
import { TrendingUp, TrendingDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { TONE_ICON, TONE_CARD, TONE_TEXT, type WidgetTone } from './tokens'

/**
 * KPI 磁贴：紧凑单值卡（图标底座 + 标签 + 大数值 + 提示 + 可选趋势指示）。
 * 比图表小组件更矮，多个并排组成 KPI 行。加载态给数值位骨架而非整卡 spinner。
 * - accent：整卡用 tone 的浅色底 + 数值用 tone 色（如 danger = 红底红字的告警卡）
 * - trendValue：带数值的环比标签（绿色升 / 红色降），与纯箭头 trend 互斥，优先生效
 */
export function StatTile({
  label, value, icon: Icon, tone = 'primary', hint, trend, trendValue, accent, loading,
}: {
  label: string
  value: string | number
  icon: LucideIcon
  tone?: WidgetTone
  hint?: string
  trend?: 'up' | 'down' | 'neutral'
  trendValue?: string
  accent?: boolean
  loading?: boolean
}) {
  return (
    <div className={cn('card-base flex h-full flex-col justify-between gap-3 overflow-hidden p-4', accent && TONE_CARD[tone])}>
      <div className="flex items-center justify-between">
        <span className={cn('flex h-8 w-8 items-center justify-center rounded-lg', TONE_ICON[tone])}>
          <Icon className="h-4 w-4" aria-hidden />
        </span>
        {trendValue ? (
          <span
            className={cn('text-xs font-medium tabular-nums', trendValue.startsWith('-') ? 'text-destructive' : 'text-success')}
            title={trendValue}
          >
            {trendValue}
          </span>
        ) : trend === 'up' && <TrendingUp className="h-4 w-4 text-success" aria-label="上升" />}
        {trend === 'down' && <TrendingDown className="h-4 w-4 text-destructive" aria-label="下降" />}
      </div>
      <div>
        <p className="text-sm text-muted-foreground">{label}</p>
        {loading ? (
          <div className="mt-1 h-8 w-20 animate-pulse rounded bg-muted" />
        ) : (
          <p
            className={cn('mt-0.5 truncate text-2xl font-bold tabular-nums', accent ? TONE_TEXT[tone] : 'text-foreground')}
            title={String(value)}
          >
            {value}
          </p>
        )}
        {hint && <p className="mt-1 truncate text-xs text-muted-foreground">{hint}</p>}
      </div>
    </div>
  )
}
