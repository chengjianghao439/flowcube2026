import { useState } from 'react'
import { AppDialog } from '@/components/shared/AppDialog'
import DataTable from '@/components/shared/DataTable'
import { Button } from '@/components/ui/button'
import { qty, unitConversionRate } from '@/lib/format'
import type { PurchaseQuantityGroup } from './purchaseSummary'

function relationship(group: PurchaseQuantityGroup) {
  return group.conversionRate == null ? '换算待确认' : group.entryUnit === group.baseUnit ? group.baseUnit : `1 ${group.entryUnit} = ${unitConversionRate(group.conversionRate)} ${group.baseUnit}`
}

export function PurchaseQuantitySummary({ groups }: { groups: PurchaseQuantityGroup[] }) {
  const [open, setOpen] = useState(false)
  if (!groups.length) return null
  return <>
    {groups.length <= 3 ? <div className="flex min-w-0 flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-label="数量汇总">
      {groups.map(group => <span key={group.key} className="[overflow-wrap:anywhere]" title={relationship(group)}>{group.productName}：<span className="tabular-nums">{qty(group.quantity)}</span> {group.entryUnit}{group.conversionRate == null && <span className="ml-1 text-warning-ink">换算待确认</span>}</span>)}
    </div> : <Button type="button" size="sm" variant="ghost" className="h-7 px-0 text-muted-foreground" onClick={() => setOpen(true)}>数量汇总 · {groups.length.toLocaleString()} 组</Button>}
    <AppDialog open={open} onOpenChange={setOpen} captureFocusOnOpen dialogId="purchase-quantity-summary" title="数量汇总" defaultWidth={680} defaultHeight={480} minWidth={420} minHeight={320}
      footer={<Button variant="outline" onClick={() => setOpen(false)}>关闭</Button>}>
      <div className="h-full min-h-0 overflow-y-auto p-4" data-workspace-scroll>
        <DataTable columns={[
          { key: 'productName', title: '商品', width: 40 },
          { key: 'quantity', title: '数量', width: 20, align: 'right', render: (v, row) => <span className="tabular-nums">{qty(v as number | null)} {row.entryUnit}</span> },
          { key: 'conversionRate', title: '单位关系', width: 40, render: (_, row) => relationship(row) },
        ]} data={groups} rowKey="key" fluid virtualized columnStorageKey="purchase-quantity-summary" />
      </div>
    </AppDialog>
  </>
}
