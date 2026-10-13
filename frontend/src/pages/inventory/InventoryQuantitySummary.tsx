import { useId, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import DataTable from '@/components/shared/DataTable'
import { qty } from '@/lib/format'
import type { TableColumn } from '@/types'
import type { InventoryQuantityField, InventoryQuantityGroup, InventoryQuantitySummary as Summary } from './inventoryQuantities'

export function InventoryQuantitySummary({ summary, field, label, readState = 'ready' }: {
  summary: Summary; field: InventoryQuantityField; label: string; readState?: 'ready' | 'loading' | 'paused' | 'failed'
}) {
  const [expanded, setExpanded] = useState(false)
  const id = useId()
  const columns = useMemo<TableColumn<InventoryQuantityGroup>[]>(() => [
    { key: 'unit', title: '基本单位', width: 40 },
    { key: field, title: label, width: 60, align: 'right', render: value => <span className="tabular-nums">{qty(value as number)}</span> },
  ], [field, label])
  if (readState !== 'ready') return <span className="text-base font-normal text-foreground">{{ loading: '读取中', paused: '暂停读取', failed: '读取失败' }[readState]}</span>
  if (summary.state !== 'ready') return <span className="text-base font-normal text-foreground">{{ incomplete: '未取齐', summary_unavailable: '统计待核', unknown_unit: '单位待核', unknown_quantity: '数量待核' }[summary.state]}</span>
  if (!summary.groups.length) return <span className="tabular-nums">0</span>
  if (summary.groups.length <= 3) return <span className="flex flex-wrap gap-x-3 gap-y-1" aria-label={`${label}按基本单位汇总`}>{summary.groups.map(group =>
    <span key={group.unit} className="max-w-full tabular-nums [overflow-wrap:anywhere]">{qty(group[field])} <span className="text-sm font-normal text-foreground">{group.unit}</span></span>,
  )}</span>
  return <div className="space-y-2">
    <Button type="button" variant="link" size="sm" className="h-auto max-w-full whitespace-normal p-0 text-base" aria-expanded={expanded} aria-controls={id} onClick={() => setExpanded(value => !value)}>{expanded ? '收起' : '查看'} {summary.groups.length} 种单位</Button>
    {expanded && <div id={id} className="max-h-48 overflow-y-auto text-sm" data-workspace-scroll aria-label={`${label}单位明细`}>
      <DataTable columns={columns} data={summary.groups} rowKey="unit" fluid virtualized columnStorageKey={`inventory-unit-summary-${field}`} />
    </div>}
  </div>
}
