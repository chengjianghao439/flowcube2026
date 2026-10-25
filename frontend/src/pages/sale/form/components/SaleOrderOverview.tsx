import { money } from '@/lib/format'
import { Building2, CircleDollarSign, PackageOpen, Warehouse } from 'lucide-react'
import { SoftStatusLabel } from '@/components/shared/StatusBadge'
import { getReceivableStatus } from '@/lib/receivableStatus'
import type { SaleOrder } from '@/types/sale'
import { OrderOverviewStrip } from '@/components/shared/OrderOverviewStrip'

export function SaleOrderOverview({ order }: { order: SaleOrder }) {
  const receivable = getReceivableStatus(order)
  const payableAmount = Math.max(0, Number(order.totalAmount) - Number(order.discountAmount ?? 0))
  const commercial = order.commercialModel === 'kit-v1'
  const lineCount = commercial ? (order.commercialGroups?.filter(group => group.targetQty > 0).length ?? 0) : (order.items?.length ?? 0)
  const cells = [
    { label: '客户', value: order.customerName || '—', icon: Building2 },
    { label: '出库仓库', value: order.isMultiWarehouse ? '多仓履约' : (order.warehouseName || '—'), icon: Warehouse },
    { label: '商品明细', value: `${lineCount} 行`, icon: PackageOpen },
    { label: '订单金额', value: money(payableAmount), icon: CircleDollarSign },
  ]
  return (
    <OrderOverviewStrip cells={cells}>
          <div><p className="text-[11px] text-muted-foreground">回款状态</p><div className="mt-1"><SoftStatusLabel label={receivable.label} tone={receivable.tone} className="whitespace-nowrap" /></div></div>
          {receivable.dueDate && <span className="text-[11px] text-muted-foreground">至 {receivable.dueDate.slice(0, 10)}</span>}
    </OrderOverviewStrip>
  )
}
