import type {
  SaleOrder,
  SaleOrderItem,
  SaleQuantitySummary,
} from '@/types/sale'
import type { StatusTone } from '@/lib/statusTone'
const roundQty = (n: number) => Math.round(n * 10000) / 10000
export function summarizeSaleQuantities(
  items: Pick<
    SaleOrderItem,
    'unit' | 'quantity' | 'reservedQty' | 'dispatchedQty' | 'shippedQty'
  >[],
): SaleQuantitySummary[] {
  const result = new Map<string, SaleQuantitySummary>()
  for (const item of items) {
    const unit = item.unit || '未标注单位'
    const group = result.get(unit) ?? {
      unit,
      ordered: 0,
      reserved: 0,
      dispatched: 0,
      shipped: 0,
    }
    group.ordered = roundQty(group.ordered + item.quantity)
    group.reserved = roundQty(group.reserved + (item.reservedQty ?? 0))
    group.dispatched = roundQty(group.dispatched + (item.dispatchedQty ?? 0))
    group.shipped = roundQty(group.shipped + (item.shippedQty ?? 0))
    result.set(unit, group)
  }
  return [...result.values()]
}
export function getSaleAttention(order: SaleOrder): {
  label: string
  tone: StatusTone
} {
  if (order.pendingReturn || order.warehouseTaskCancelRequestedAt)
    return { label: '取消待实物归还', tone: 'warning' }
  if (order.status === 5) return { label: '订单已取消', tone: 'draft' }
  if (order.pendingAdjustment || order.warehouseTaskAdjustmentRequestedAt)
    return { label: '改单待实物归还', tone: 'warning' }
  if (order.pendingCredit) return { label: '等待授信审批', tone: 'warning' }
  const quantities =
    order.quantitySummary ?? summarizeSaleQuantities(order.items ?? [])
  if ([1, 6].includes(order.status)) {
    const remaining = quantities
      .filter((q) => q.ordered > q.reserved)
      .map((q) => `${roundQty(q.ordered - q.reserved)} ${q.unit}`)
    return {
      label: remaining.length
        ? `待占 ${remaining.join(' / ')}`
        : '等待分配库存',
      tone: 'warning',
    }
  }
  if (order.hasUndispatchedItems || order.status === 2)
    return { label: '已占库存可派发', tone: 'active' }
  if (order.receivableStatus != null && order.receivableOverdue)
    return { label: '存在逾期未收款', tone: 'danger' }
  if (order.status === 4)
    return {
      label:
        order.closedReason === 'partial_ship_close'
          ? '剩余已关闭'
          : '',
      tone: 'success',
    }
  return { label: '', tone: 'draft' }
}
