import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { STATUS_TONE_CLASS, type StatusTone } from '@/lib/statusTone'
import { SALE_STATUS_NAME, SALE_STATUS_TONE } from '@/generated/status'
import { WT_STATUS_NAME, WT_STATUS_CLASS } from '@/constants/warehouseTaskStatus'
import type { WtStatus } from '@/constants/warehouseTaskStatus'

export type OrderType = 'purchase' | 'sale' | 'transfer' | 'task' | 'stockcheck' | 'returns'

interface StatusConfig {
  label: string
  className: string
}

const SALE_STATUS_CONFIG = Object.fromEntries(
  Object.entries(SALE_STATUS_NAME).map(([status, label]) => [
    Number(status),
    {
      label,
      className: STATUS_TONE_CLASS[SALE_STATUS_TONE[status as keyof typeof SALE_STATUS_TONE]],
    },
  ]),
) as Record<number, StatusConfig>

/** 单据状态 → tone。颜色语义见 `@/lib/statusTone`，这里只声明每个状态属于哪一档。 */
const DOC_TONE: Record<Exclude<OrderType, 'sale' | 'task'>, Record<number, [string, StatusTone]>> = {
  purchase: {
    1: ['草稿', 'draft'],
    2: ['已提交', 'active'],
    3: ['已完成', 'success'],
    4: ['已取消', 'danger'],
    5: ['待审批', 'warning'],
  },
  transfer: {
    1: ['草稿', 'draft'],
    2: ['待出库', 'active'],
    3: ['在途', 'warning'],
    4: ['已完成', 'success'],
    5: ['已取消', 'danger'],
  },
  stockcheck: {
    1: ['进行中', 'active'],
    2: ['已完成', 'success'],
    3: ['已取消', 'danger'],
  },
  returns: {
    1: ['草稿', 'draft'],
    2: ['已确认', 'active'],
    3: ['已执行', 'success'],
    4: ['已取消', 'danger'],
  },
}

function toConfig(map: Record<number, [string, StatusTone]>): Record<number, StatusConfig> {
  return Object.fromEntries(
    Object.entries(map).map(([status, [label, tone]]) => [
      Number(status),
      { label, className: STATUS_TONE_CLASS[tone] },
    ]),
  )
}

const CONFIG: Record<OrderType, Record<number, StatusConfig>> = {
  sale: SALE_STATUS_CONFIG,
  purchase: toConfig(DOC_TONE.purchase),
  transfer: toConfig(DOC_TONE.transfer),
  stockcheck: toConfig(DOC_TONE.stockcheck),
  returns: toConfig(DOC_TONE.returns),
  task: Object.fromEntries(
    (Object.keys(WT_STATUS_NAME) as unknown as WtStatus[]).map(s => [
      s,
      { label: WT_STATUS_NAME[s], className: WT_STATUS_CLASS[s] },
    ])
  ) as Record<number, StatusConfig>,
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
      <SoftStatusLabel label="未知" tone="draft" className={className} />
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
  tone: StatusTone
  className?: string
  /** 悬停提示，用于补充状态之外的进度信息（如「已发 3/10」） */
  title?: string
  onClick?: () => void
}

/**
 * 全站状态徽章。任何需要展示「状态」的地方都用它，不要自己拼 Badge + 颜色 class。
 */
export function SoftStatusLabel({ label, tone, className, title, onClick }: SoftStatusLabelProps) {
  return (
    <Badge
      variant="outline"
      title={title}
      onClick={onClick}
      className={cn(
        'text-xs font-medium',
        STATUS_TONE_CLASS[tone],
        onClick && 'cursor-pointer hover:opacity-80',
        className,
      )}
    >
      {label}
    </Badge>
  )
}
