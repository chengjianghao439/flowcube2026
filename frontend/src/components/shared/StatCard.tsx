/**
 * StatCard — 数据统计卡片（KPI 卡片）
 *
 * 用于仪表盘、概览页等场景展示单一指标。
 * 支持图标、趋势（↑↓）、辅助描述。
 *
 * 使用示例：
 * ```tsx
 * <StatCard
 *   title="本月销售额"
 *   value="¥128,450"
 *   description="较上月 +12.5%"
 *   icon={<ShoppingCart className="h-5 w-5" />}
 *   trend={{ direction: 'up', label: '+12.5%' }}
 * />
 *
 * // 加载态
 * <StatCard title="库存总量" value="..." loading />
 *
 * // 颜色强调
 * <StatCard title="预警商品" value={12} accent="warning" />
 * ```
 */

import { cn } from '@/lib/utils'
import { TrendingUp, TrendingDown, Minus } from 'lucide-react'

export type StatCardAccent = 'default' | 'primary' | 'success' | 'warning' | 'destructive'

export interface StatCardTrend {
  /** 趋势方向 */
  direction: 'up' | 'down' | 'flat'
  /** 显示文字，如 "+12.5%" */
  label: string
}

export interface StatCardProps {
  /** 指标名称 */
  title: string
  /** 主要数值（支持字符串、数字、ReactNode） */
  value: React.ReactNode
  /** 辅助说明文字 */
  description?: string
  /** 左上角图标 */
  icon?: React.ReactNode
  /** 趋势信息 */
  trend?: StatCardTrend
  /** 颜色强调（影响图标背景和 value 颜色） */
  accent?: StatCardAccent
  /** 是否显示骨架加载态 */
  loading?: boolean
  /** 额外 className */
  className?: string
  /** 点击回调（整张卡片可点击） */
  onClick?: () => void
}

// ── 强调色映射 ──────────────────────────────────────────────────────────────

const ACCENT_ICON_BG: Record<StatCardAccent, string> = {
  default:     'bg-muted text-muted-foreground',
  primary:     'bg-primary/10 text-primary',
  success:     'bg-success/10 text-success',
  warning:     'bg-warning/10 text-warning',
  destructive: 'bg-destructive/10 text-destructive',
}

const TREND_CONFIG = {
  up:   { icon: TrendingUp,   color: 'text-success'     },
  down: { icon: TrendingDown, color: 'text-destructive'  },
  flat: { icon: Minus,        color: 'text-muted-foreground' },
}

// ── 组件 ────────────────────────────────────────────────────────────────────

export function StatCard({
  title,
  value,
  description,
  icon,
  trend,
  accent = 'default',
  loading = false,
  className,
  onClick,
}: StatCardProps) {
  const Tag = onClick ? 'button' : 'div'

  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={cn(
        'rounded-xl border border-border bg-card p-5 shadow-sm text-left',
        onClick && 'cursor-pointer transition-shadow hover:shadow-md focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
        className,
      )}
    >
      {/* 顶部行：图标 + 标题 */}
      <div className="mb-3 flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-muted-foreground">{title}</p>
        {icon && (
          <div className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', ACCENT_ICON_BG[accent])}>
            {icon}
          </div>
        )}
      </div>

      {/* 主数值 */}
      {loading ? (
        <div className="mb-1 h-8 w-24 animate-pulse rounded bg-muted" />
      ) : (
        <p className="mb-1 text-2xl font-bold leading-none tracking-tight text-foreground">
          {value}
        </p>
      )}

      {/* 底部：趋势 + 描述 */}
      {(trend || description) && (
        <div className="mt-2 flex items-center gap-2">
          {trend && (() => {
            const { icon: TrendIcon, color } = TREND_CONFIG[trend.direction]
            return (
              <span className={cn('flex items-center gap-0.5 text-xs font-medium', color)}>
                <TrendIcon className="h-3 w-3" />
                {trend.label}
              </span>
            )
          })()}
          {description && (
            <span className="text-xs text-muted-foreground">{description}</span>
          )}
        </div>
      )}
    </Tag>
  )
}
