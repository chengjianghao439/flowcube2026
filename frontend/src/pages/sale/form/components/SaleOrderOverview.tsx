import { Building2, CircleDollarSign, PackageOpen, Warehouse } from 'lucide-react'
import { SoftStatusLabel } from '@/components/shared/StatusBadge'
import { getReceivableStatus } from '@/lib/receivableStatus'
import type { SaleOrder } from '@/types/sale'

export function SaleOrderOverview({ order }: { order: SaleOrder }) {
  const receivable = getReceivableStatus(order)
  const payableAmount = Math.max(0, Number(order.totalAmount) - Number(order.discountAmount ?? 0))
  const cells = [
    { label: '客户', value: order.customerName || '—', icon: Building2 },
    { label: '出库仓库', value: order.isMultiWarehouse ? '多仓履约' : (order.warehouseName || '—'), icon: Warehouse },
    { label: '商品明细', value: `${order.items?.length ?? 0} 种`, icon: PackageOpen },
    { label: '订单金额', value: `¥${payableAmount.toFixed(2)}`, icon: CircleDollarSign },
  ]
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card" aria-label="订单摘要">
      <div className="grid divide-y divide-border sm:grid-cols-2 sm:divide-x sm:divide-y-0 xl:grid-cols-[1.25fr_1fr_.75fr_1fr_1fr]">
        {cells.map(({ label, value, icon: Icon }) => (
          <div key={label} className="flex min-w-0 items-center gap-2.5 px-4 py-2.5">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary"><Icon className="h-3.5 w-3.5" /></span>
            <div className="min-w-0"><p className="text-[11px] text-muted-foreground">{label}</p><p className="mt-0.5 truncate text-sm font-semibold text-foreground" title={value}>{value}</p></div>
          </div>
        ))}
        <div className="flex min-w-0 items-center justify-between gap-3 px-4 py-2.5">
          <div><p className="text-[11px] text-muted-foreground">回款状态</p><div className="mt-1"><SoftStatusLabel label={receivable.label} tone={receivable.tone} /></div></div>
          {receivable.dueDate && <span className="text-[11px] text-muted-foreground">至 {receivable.dueDate.slice(0, 10)}</span>}
        </div>
      </div>
    </section>
  )
}
