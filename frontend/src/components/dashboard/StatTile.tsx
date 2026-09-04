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
    <div className={cn('card-base group flex h-full flex-col overflow-hidden p-5 transition-[border-color,box-shadow] duration-200 hover:border-primary/20 hover:shadow-sm', accent && TONE_CARD[tone])}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium text-muted-foreground">{label}</p>
          {loading ? <div className="mt-3 h-8 w-20 animate-pulse rounded bg-muted" /> : (
            <p className={cn('mt-2 truncate text-[28px] font-semibold leading-none tracking-tight tabular-nums', accent ? TONE_TEXT[tone] : 'text-foreground')} title={String(value)}>{value}</p>
          )}
        </div>
        <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-transform duration-200 group-hover:-translate-y-0.5', TONE_ICON[tone])}>
          <Icon className="h-[18px] w-[18px]" aria-hidden />
        </span>
      </div>
      <div className="mt-auto flex min-h-5 items-end justify-between gap-2 pt-4">
        <p className="truncate text-xs text-muted-foreground">{hint || '—'}</p>
        {trendValue ? (
          <span
            className={cn('shrink-0 text-xs font-medium tabular-nums', trendValue.startsWith('-') ? 'text-destructive' : 'text-success')}
            title={trendValue}
          >
            {trendValue}
          </span>
        ) : trend === 'up' ? <TrendingUp className="h-4 w-4 shrink-0 text-warning" aria-label="需要关注" />
          : trend === 'down' ? <TrendingDown className="h-4 w-4 shrink-0 text-destructive" aria-label="下降" /> : null}
      </div>
    </div>
  )
}
