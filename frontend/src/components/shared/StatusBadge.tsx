import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { WT_STATUS, WT_STATUS_NAME, WT_STATUS_CLASS } from '@/constants/warehouseTaskStatus'
import type { WtStatus } from '@/constants/warehouseTaskStatus'

export type OrderType = 'purchase' | 'sale' | 'transfer' | 'task' | 'stockcheck' | 'returns'

interface StatusConfig {
  label: string
  className: string
}

const CONFIG: Record<OrderType, Record<number, StatusConfig>> = {
  sale: {
    1: { label: '草稿',   className: 'bg-secondary text-secondary-foreground border-secondary' },
    2: { label: '已占库', className: 'bg-primary/10 text-primary border-primary/20' },
    3: { label: '拣货中', className: 'bg-warning/10 text-warning border-warning/20' },
    4: { label: '已出库', className: 'bg-success/10 text-success border-success/20' },
    5: { label: '已取消', className: 'bg-destructive/10 text-destructive border-destructive/20' },
  },
  purchase: {
    1: { label: '草稿',   className: 'bg-secondary text-secondary-foreground border-secondary' },
    2: { label: '已确认', className: 'bg-primary/10 text-primary border-primary/20' },
    3: { label: '已收货', className: 'bg-success/10 text-success border-success/20' },
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
}

export function StatusBadge({ type, status, className }: StatusBadgeProps) {
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
    >
      {cfg.label}
    </Badge>
  )
}
