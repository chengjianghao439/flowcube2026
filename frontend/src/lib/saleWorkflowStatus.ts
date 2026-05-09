import type { SaleOrder } from '@/types/sale'
import { WT_STATUS_NAME } from '@/constants/warehouseTaskStatus'
import { SALE_STATUS_NAME, SALE_STATUS_TONE } from '@/generated/status'

const TONE_CLASS = {
  draft: 'bg-secondary text-secondary-foreground border-secondary',
  active: 'bg-primary/10 text-primary border-primary/20',
  success: 'bg-success/10 text-success border-success/20',
  danger: 'bg-destructive/10 text-destructive border-destructive/20',
} as const

export type WorkflowTone = keyof typeof TONE_CLASS

export interface WorkflowStatus {
  label: string
  tone: WorkflowTone
  className: string
}

export function getSaleWorkflowStatus(order: SaleOrder): WorkflowStatus {
  // 已取消
  if (order.status === 5) return status('已取消', 'danger')

  // 有仓库任务时，用仓库作业状态展示真实进度
  if (order.taskNo && order.warehouseTaskStatus != null) {
    const wt = order.warehouseTaskStatus
    if (wt >= 2 && wt <= 7) {
      const label = WT_STATUS_NAME[String(wt) as keyof typeof WT_STATUS_NAME]
      if (label) {
        if (wt === 7) return status(label, 'success')
        return status(label, 'active')
      }
    }
    if (wt === 8) return status('已取消', 'danger')
  }

  // 兜底：使用销售单状态
  const key = String(order.status) as keyof typeof SALE_STATUS_NAME
  const tone = (SALE_STATUS_TONE as Record<string, string>)[String(order.status)] ?? 'active'
  return status(SALE_STATUS_NAME[key] ?? `状态 ${order.status}`, tone as WorkflowTone)
}

function status(label: string, tone: WorkflowTone): WorkflowStatus {
  return { label, tone, className: TONE_CLASS[tone] }
}
