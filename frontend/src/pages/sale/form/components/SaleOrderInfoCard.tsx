import { SectionCard } from '@/components/shared/SectionCard'
import { OrderFact, OrderFacts } from '@/components/shared/OrderFacts'
import { SoftStatusLabel } from '@/components/shared/StatusBadge'
import { formatDisplayDateTime } from '@/lib/dateTime'
import { getReceivableStatus } from '@/lib/receivableStatus'
import type { SaleOrder } from '@/types/sale'

export function SaleOrderInfoCard({ order }: { order: SaleOrder }) {
  const receivable = getReceivableStatus(order)
  return <SectionCard title="基础信息" compact contentClassName="p-3">
    <OrderFacts>
      <OrderFact label="客户">{order.customerName}</OrderFact>
      <OrderFact label="仓库">{order.warehouseName}</OrderFact>
      <OrderFact label="时间">{formatDisplayDateTime(order.createdAt)}</OrderFact>
      <OrderFact label="经办人">{order.operatorName}</OrderFact>
      <OrderFact label="承运商">{order.carrier || '-'}</OrderFact>
      <OrderFact label="发货产品">{order.shippingProduct || '沿用承运商配置'}</OrderFact>
      <OrderFact label="运费方式">{order.freightTypeName || '-'}</OrderFact>
      <OrderFact label="收货人">{order.receiverName || '-'}</OrderFact>
      <OrderFact label="联系电话">{order.receiverPhone || '-'}</OrderFact>
      <OrderFact label="收货地址" className="sm:col-span-2">{order.receiverAddress || '-'}</OrderFact>
      <OrderFact label="备注">{order.remark || '-'}</OrderFact>
      <OrderFact label="回款"><SoftStatusLabel label={receivable.label} tone={receivable.tone} />
        {receivable.dueDate && <span className="ml-1.5 text-xs text-muted-foreground">账期至 {receivable.dueDate.slice(0, 10)}</span>}
      </OrderFact>
    </OrderFacts>
  </SectionCard>
}
