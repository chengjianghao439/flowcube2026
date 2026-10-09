import DataTable from '@/components/shared/DataTable'
import { SectionCard } from '@/components/shared/SectionCard'
import { money, unitPrice } from '@/lib/format'
import type { TableColumn } from '@/types'
import type { SaleOrder } from '@/types/sale'
import type { CommercialGroup, CommercialComponent } from '@/types/sale-commercial'
import { CommercialItemIdentity } from './CommercialItemIdentity'
import { componentDisplayQuantity, SALE_KIT_TABLE_CLASSES } from './commercialPresentation'
import { commercialUnit } from './commercialDraft'
import { commercialWarehouseName } from './warehouseName'

/** 客户成交行保留服务端量价，仓库组件金额不参与订单汇总。 */
export function CommercialOrderItems({ order }: { order: SaleOrder }) {
  type DisplayRow = CommercialGroup & { rowKey: string; remark: string; component?: CommercialComponent }
  const rows: DisplayRow[] = (order.commercialGroups ?? []).flatMap(group => [
    { ...group, remark: group.metadata.input.remark || '—', rowKey: `group-${group.id}` },
    ...(group.kind === 'kit' ? group.components.map((component, index) => ({ ...group, component, remark: '—', rowKey: `group-${group.id}-component-${index}` })) : []),
  ])
  const columns: TableColumn<DisplayRow>[] = [
    { key: 'kind', title: '商品', width: 440, render: (_, group) => {
      if (group.component) return <CommercialItemIdentity code={group.component.productCode} name={group.component.productName} {...group.component} kitLine="component" groupKey={group.lineKey} />
      const identity = group.kind === 'kit' ? group.metadata.kitIdentity : group.components[0]
      const code = group.kind === 'kit' ? group.kitCode : group.components[0]?.productCode
      const name = group.kind === 'kit' ? group.kitName : group.components[0]?.productName
      return <CommercialItemIdentity code={code} name={name} {...identity} kitLine={group.kind === 'kit' ? 'parent' : undefined} groupKey={group.lineKey} />
    } },
    { key: 'quantity', title: '单位', width: 70, render: (_, group) => group.component?.unit ?? commercialUnit(group) },
    ...(order.isMultiWarehouse ? [{ key: 'warehouseId', title: '发货仓库', width: 120, render: (_: unknown, group: DisplayRow) => commercialWarehouseName(order, group.warehouseId) }] : []),
    { key: 'targetQty', title: '数量', width: 120, align: 'right', render: (_, group) => <span className="tabular-nums">{group.component ? componentDisplayQuantity(group.component.baseQty, group.targetQty) ?? '—' : group.targetQty}</span> },
    { key: 'unitPrice', title: '单价', width: 130, align: 'right', render: (value, group) => group.component ? '—' : <span className="tabular-nums">{unitPrice(value as number | null | undefined, 8)}</span> },
    { key: 'amount', title: '金额', width: 110, align: 'right', render: (value, group) => group.component ? '—' : <span className="font-semibold tabular-nums">{money(Number(value))}</span> },
    { key: 'remark', title: '备注', width: 180, expandableText: true },
  ]
  return <SectionCard title="商品明细" compact noPadding>
    <div data-sale-detail-items>
      <div data-workspace-scroll tabIndex={0} aria-label="销售商品明细" className={`max-h-[min(60vh,36rem)] overflow-auto [&>div]:rounded-none [&>div]:border-0 [&>div]:overflow-visible [&_[data-table-scroll]]:overflow-visible [&_thead]:sticky [&_thead]:top-0 [&_thead]:z-10 ${SALE_KIT_TABLE_CLASSES}`}>
        <DataTable columns={columns} data={rows} rowKey="rowKey" virtualized emptyText="暂无商品明细" />
      </div>
      <div className="flex flex-wrap items-center justify-end gap-x-6 gap-y-2 border-t px-4 py-3 text-sm">
        <span className="mr-auto tabular-nums"><span className="text-muted-foreground">明细</span> {order.commercialGroups?.length ?? 0} 行</span>
        <span className="tabular-nums"><span className="mr-2 text-muted-foreground">折扣金额</span>{Number(order.discountAmount ?? 0) > 0 ? money(-Number(order.discountAmount)) : money(0)}</span>
        <strong className="tabular-nums"><span className="mr-2 font-normal">订单金额</span>{money(Math.max(0, order.totalAmount - (order.discountAmount ?? 0)))}</strong>
      </div>
    </div>
  </SectionCard>
}
