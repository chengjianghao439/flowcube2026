import { useState } from 'react'
import { AppDialog } from '@/components/shared/AppDialog'
import { Button } from '@/components/ui/button'
import DataTable from '@/components/shared/DataTable'
import { qty } from '@/lib/format'
import type { InboundQuantityField, InboundQuantityGroup } from '@/types/inbound-tasks'
import { areInboundQuantitiesZero, inboundQuantityValue as value } from './inboundQuantity'

export function InboundQuantitySummary({ groups, field = 'orderedQty', label = '数量', collapseZero = false }: { groups?: InboundQuantityGroup[]; field?: InboundQuantityField; label?: string; collapseZero?: boolean }) {
  const [open, setOpen] = useState(false)
  if (!groups) return <span className="text-muted-foreground">{label}待核对</span>
  if (!groups.length) return <span className="text-muted-foreground">{label} —</span>
  if (collapseZero && areInboundQuantitiesZero(groups, field)) return <span aria-label={label} className="tabular-nums">0</span>
  return <>
    {groups.length <= 3 ? <span className="inline-flex flex-wrap gap-x-3 gap-y-1" aria-label={label}>{groups.map(group => <span key={group.key} title={[group.productName, group.spec, group.articleNumber].filter(Boolean).join(' · ')}>{group.productName}：<span className="tabular-nums">{qty(value(group, field))}</span> {group.unit || '单位未提供'}</span>)}</span>
      : <Button type="button" size="sm" variant="ghost" className="h-6 px-0 text-muted-foreground" onClick={() => setOpen(true)}>{label} · {groups.length} 组</Button>}
    <AppDialog descriptionInHeader description={"按商品与单位核对本次收货数量。"} open={open} onOpenChange={setOpen} captureFocusOnOpen dialogId="inbound-quantity-summary" title={label} defaultWidth={680} defaultHeight={480} minWidth={420} minHeight={320} footer={<Button variant="outline" onClick={() => setOpen(false)}>关闭</Button>}>
      <div className="h-full overflow-y-auto p-4" data-workspace-scroll><DataTable columns={[
        { key: 'productName', title: '商品 / 规格', width: 70, render: (_, group) => <span>{group.productName}{group.spec && ` · ${group.spec}`}{group.articleNumber && ` · ${group.articleNumber}`}</span> },
        { key: field, title: label, width: 30, align: 'right', render: (_, group) => <span className="tabular-nums">{qty(value(group, field))} {group.unit || '单位未提供'}</span> },
      ]} data={groups} rowKey="key" fluid virtualized columnStorageKey="inbound-quantity-summary" /></div>
    </AppDialog>
  </>
}
