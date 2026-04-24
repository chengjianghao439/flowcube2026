import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { SALE_STATUS_NAME, SALE_STATUS_TONE } from '@/generated/status'
import { WT_STATUS_NAME, WT_STATUS_CLASS } from '@/constants/warehouseTaskStatus'
import type { WtStatus } from '@/constants/warehouseTaskStatus'

export type OrderType = 'purchase' | 'sale' | 'transfer' | 'task' | 'stockcheck' | 'returns'

interface StatusConfig {
  label: string
  className: string
}

export const SOFT_STATUS_CLASS = {
  draft: 'bg-secondary text-secondary-foreground border-secondary',
  active: 'bg-primary/10 text-primary border-primary/20',
  success: 'bg-success/10 text-success border-success/20',
  danger: 'bg-destructive/10 text-destructive border-destructive/20',
} as const

const SALE_STATUS_CONFIG = Object.fromEntries(
  Object.entries(SALE_STATUS_NAME).map(([status, label]) => [
    Number(status),
    {
      label,
      className: SOFT_STATUS_CLASS[SALE_STATUS_TONE[status as keyof typeof SALE_STATUS_TONE]],
    },
  ]),
) as Record<number, StatusConfig>

const CONFIG: Record<OrderType, Record<number, StatusConfig>> = {
  sale: SALE_STATUS_CONFIG,
  purchase: {
    1: { label: '草稿',   className: 'bg-secondary text-secondary-foreground border-secondary' },
    2: { label: '已提交', className: 'bg-primary/10 text-primary border-primary/20' },
    3: { label: '已完成', className: 'bg-success/10 text-success border-success/20' },
    4: { label: '已取消', className: 'bg-destructive/10 text-destructive border-destructive/20' },
  },
  transfer: {
    1: { label: '草稿',   className: 'bg-secondary text-secondary-foreground border-secondary' },
    2: { label: '已确认', className: 'bg-primary/10 text-primary border-primary/20' },
    3: { label: '已执行', className: 'bg-success/10 text-success border-success/20' },
    4: { label: '已取消', className: 'bg-destructive/10 text-destructive border-destructive/20' },
  },
  task: Object.fromEntries(
    (Object.keys(WT_STATUS_NAME) as unknown as WtStatus[]).map(s => [
      s,
      { label: WT_STATUS_NAME[s], className: WT_STATUS_CLASS[s] },
    ])
  ) as Record<number, StatusConfig>,
  stockcheck: {
    1: { label: '进行中', className: 'bg-primary/10 text-primary border-primary/20' },
    2: { label: '已完成', className: 'bg-success/10 text-success border-success/20' },
    3: { label: '已取消', className: 'bg-destructive/10 text-destructive border-destructive/20' },
  },
  returns: {
    1: { label: '草稿',   className: 'bg-secondary text-secondary-foreground border-secondary' },
    2: { label: '已确认', className: 'bg-primary/10 text-primary border-primary/20' },
    3: { label: '已执行', className: 'bg-success/10 text-success border-success/20' },
    4: { label: '已取消', className: 'bg-destructive/10 text-destructive border-destructive/20' },
  },
}

interface StatusBadgeProps {
  type: OrderType
  status: number
  className?: string
  ariaLabel?: string
}

export function StatusBadge({ type, status, className, ariaLabel }: StatusBadgeProps) {
  const cfg = CONFIG[type]?.[status]
  if (!cfg) {
    return (
      <Badge variant="outline" className={cn('text-xs', className)}>
        未知
      </Badge>
    )
  }
  return (
    <Badge
      variant="outline"
      className={cn('text-xs font-medium', cfg.className, className)}
      aria-label={ariaLabel}
    >
      {cfg.label}
    </Badge>
  )
}

interface SoftStatusLabelProps {
  label: string
  tone: keyof typeof SOFT_STATUS_CLASS
  className?: string
}

export function SoftStatusLabel({ label, tone, className }: SoftStatusLabelProps) {
  return (
    <Badge variant="outline" className={cn('text-xs font-medium', SOFT_STATUS_CLASS[tone], className)}>
      {label}
    </Badge>
  )
}
