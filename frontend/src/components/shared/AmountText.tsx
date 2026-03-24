/**
 * AmountText — 金额展示组件
 *
 * 统一金额展示规范：千分位分隔、保留小数位、颜色语义化。
 * 底层使用 Intl.NumberFormat，无需第三方依赖。
 *
 * 使用示例：
 * ```tsx
 * <AmountText value={12345.6} />              // ¥12,345.60
 * <AmountText value={-500} color="negative" /> // 红色 -¥500.00
 * <AmountText value={200}  color="positive" /> // 绿色 ¥200.00
 * <AmountText value={0}    color="muted" />    // 灰色 ¥0.00
 * <AmountText value={99999} size="xl" />        // 大字号
 * <AmountText value={100}  prefix="USD " decimals={0} />  // USD 100
 * ```
 */

import { cn } from '@/lib/utils'

export type AmountColor = 'default' | 'positive' | 'negative' | 'warning' | 'muted'
export type AmountSize  = 'xs' | 'sm' | 'md' | 'lg' | 'xl'

export interface AmountTextProps {
  /** 数值（string 会先 parseFloat） */
  value: number | string | null | undefined
  /** 货币前缀，默认 "¥" */
  prefix?: string
  /** 小数位数，默认 2 */
  decimals?: number
  /** 颜色语义 */
  color?: AmountColor
  /** 字号 */
  size?: AmountSize
  /** 额外 className */
  className?: string
  /** 数值为空时的占位符 */
  placeholder?: string
}

// ── 配置 ────────────────────────────────────────────────────────────────────

const COLOR_CLASS: Record<AmountColor, string> = {
  default:  'text-foreground',
  positive: 'text-success',
  negative: 'text-destructive',
  warning:  'text-warning',
  muted:    'text-muted-foreground',
}

const SIZE_CLASS: Record<AmountSize, string> = {
  xs: 'text-xs',
  sm: 'text-sm',
  md: 'text-base',
  lg: 'text-lg font-semibold',
  xl: 'text-2xl font-bold',
}

// ── 格式化逻辑 ───────────────────────────────────────────────────────────────

function formatAmount(
  raw: number | string | null | undefined,
  decimals: number,
): { formatted: string; isNegative: boolean } | null {
  if (raw === null || raw === undefined || raw === '') return null
  const num = typeof raw === 'string' ? parseFloat(raw) : raw
  if (Number.isNaN(num)) return null
  const formatted = new Intl.NumberFormat('zh-CN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(Math.abs(num))
  return { formatted, isNegative: num < 0 }
}

// ── 组件 ────────────────────────────────────────────────────────────────────

export function AmountText({
  value,
  prefix = '¥',
  decimals = 2,
  color = 'default',
  size = 'md',
  className,
  placeholder = '—',
}: AmountTextProps) {
  const result = formatAmount(value, decimals)

  if (!result) {
    return (
      <span className={cn('tabular-nums', COLOR_CLASS.muted, SIZE_CLASS[size], className)}>
        {placeholder}
      </span>
    )
  }

  const { formatted, isNegative } = result

  // 负数且颜色未手动指定时自动切换为 negative
  const resolvedColor = color === 'default' && isNegative ? 'negative' : color

  return (
    <span className={cn('tabular-nums', COLOR_CLASS[resolvedColor], SIZE_CLASS[size], className)}>
      {isNegative && '-'}
      {prefix}
      {formatted}
    </span>
  )
}
