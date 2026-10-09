import { SectionCard } from '@/components/shared/SectionCard'
import { SoftStatusLabel } from '@/components/shared/StatusBadge'
import { formatDisplayDateTime } from '@/lib/dateTime'
import { getReceivableStatus } from '@/lib/receivableStatus'
import type { SaleOrder } from '@/types/sale'

export function SaleOrderInfoCard({ order }: { order: SaleOrder }) {
  const receivable = getReceivableStatus(order)
  return <SectionCard title="基础信息" compact contentClassName="p-3">
    <div className="grid grid-cols-1 gap-x-8 gap-y-2 text-sm sm:grid-cols-2 xl:grid-cols-6 [&>div]:min-w-0 [&>div]:[overflow-wrap:anywhere]">
      <div><span className="text-muted-foreground">客户：</span>{order.customerName}</div>
      <div><span className="text-muted-foreground">仓库：</span>{order.warehouseName}</div>
      <div><span className="text-muted-foreground">时间：</span>{formatDisplayDateTime(order.createdAt)}</div>
      <div><span className="text-muted-foreground">经办人：</span>{order.operatorName}</div>
      <div><span className="text-muted-foreground">承运商：</span>{order.carrier || '-'}</div>
      <div><span className="text-muted-foreground">发货产品：</span>{order.shippingProduct || '沿用承运商配置'}</div>
      <div><span className="text-muted-foreground">运费方式：</span>{order.freightTypeName || '-'}</div>
      <div><span className="text-muted-foreground">收货人：</span>{order.receiverName || '-'}</div>
      <div><span className="text-muted-foreground">联系电话：</span>{order.receiverPhone || '-'}</div>
      <div className="sm:col-span-2"><span className="text-muted-foreground">收货地址：</span>{order.receiverAddress || '-'}</div>
      <div><span className="text-muted-foreground">备注：</span>{order.remark || '-'}</div>
      <div><span className="text-muted-foreground">回款：</span><SoftStatusLabel label={receivable.label} tone={receivable.tone} />
        {receivable.dueDate && <span className="ml-1.5 text-xs text-muted-foreground">账期至 {receivable.dueDate.slice(0, 10)}</span>}
      </div>
    </div>
  </SectionCard>
}
