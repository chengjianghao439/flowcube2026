import { Building2, CircleDollarSign, PackageOpen, Warehouse } from 'lucide-react'
import { OrderOverviewStrip } from '@/components/shared/OrderOverviewStrip'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { money } from '@/lib/format'
import type { PurchaseOrder } from '@/types/purchase'

export function PurchaseOrderOverview({ order }: { order: PurchaseOrder }) {
  return <OrderOverviewStrip label="采购摘要" cells={[
    { label: '供应商', value: order.supplierName || '—', icon: Building2 },
    { label: '入库仓库', value: order.warehouseName || '—', icon: Warehouse },
    { label: '商品明细', value: `${order.items?.length ?? 0} 行`, icon: PackageOpen },
    { label: '采购金额', value: money(order.totalAmount), icon: CircleDollarSign },
  ]}>
    <div><p className="text-[11px] text-muted-foreground">采购状态</p><div className="mt-1"><StatusBadge type="purchase" status={order.status} /></div></div>
  </OrderOverviewStrip>
}
