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
  // 取消收尾中：销售单业务状态已经是「已取消」，但对应仓库任务的已拣容器还没
  // 逐个扫码归还完（cancelRequestedAt 非空），此时不能简单显示「已取消」，
  // 否则仓管会误以为货物已经妥善处理，实际货物可能还在拣货员手里未放回原位。
  if (order.status === 5 && order.warehouseTaskCancelRequestedAt) {
    return status('待归还', 'danger')
  }

  // 已取消
  if (order.status === 5) return status('已取消', 'danger')

  // 部分发货后取消剩余、以实发结案（分仓/分批）
  if (order.status === 4 && order.closedReason === 'partial_ship_close') {
    return status('部分发货结案', 'success')
  }

  // 缺货挂起：现场拣货缺货已上报、等待 ERP 端处理（按实拣改单/驳回）
  if (order.warehouseTaskShortageReportedAt) {
    return status('缺货待处理', 'danger')
  }

  // 履约中（分仓/分批）：多仓订单或已有部分发货时，用「已发/应发」进度汇总展示，
  // 而不是单个仓库任务的状态（多仓下最近任务状态不能代表整单进度）
  if (order.status === 3 && (order.isMultiWarehouse || (order.shippedTotalQty ?? 0) > 0)) {
    const shipped = order.shippedTotalQty ?? 0
    const ordered = order.orderedTotalQty ?? 0
    return status(`履约中 ${shipped}/${ordered}`, 'active')
  }

  // 单仓订单：用仓库作业状态展示真实进度（原逻辑，行为不变）
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
