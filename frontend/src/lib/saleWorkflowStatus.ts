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
  /** 补充信息（如履约中的已发/应发进度），不进状态名本身，鼠标悬停查看 */
  detail?: string
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

  // 部分发货：分仓/分批订单尚在履约、还没按订单量全发完。「部分发货」四个字是唯一
  // 允许超出统一 3 字符规则的例外。主动关闭剩余时明细会被精简为"要求量=实发量"
  // （见 sale.service.js 的 cancel()），订单直接落回普通"已出库"，不会停留在这个状态。
  if (order.status === 3 && (order.isMultiWarehouse || (order.shippedTotalQty ?? 0) > 0)) {
    const shipped = order.shippedTotalQty ?? 0
    const ordered = order.orderedTotalQty ?? 0
    return status('部分发货', 'active', `已发 ${shipped}/${ordered}`)
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

function status(label: string, tone: WorkflowTone, detail?: string): WorkflowStatus {
  return { label, tone, className: TONE_CLASS[tone], detail }
}
