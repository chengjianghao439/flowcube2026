import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import PageHeader from '@/components/shared/PageHeader'
import DataTable from '@/components/shared/DataTable'
import { FilterCard } from '@/components/shared/FilterCard'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { WarehouseSelect } from '@/components/shared/WarehouseSelect'
import { getProcurementPlanApi, type ProcurementPlanItem } from '@/api/inventory'
import type { TableColumn } from '@/types'

function fmtQty(v: unknown): string {
  const n = Number(v)
  if (!Number.isFinite(n)) return '—'
  return Number.isInteger(n) ? n.toLocaleString() : n.toFixed(2)
}

export default function ProcurementPlanPage() {
  const [warehouseId, setWarehouseId] = useState<number | null>(null)
  const [search, setSearch] = useState('')
  const [keyword, setKeyword] = useState('')
  const [win, setWin] = useState(30)
  const [horizon, setHorizon] = useState(30)

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['procurement-plan', keyword, warehouseId, win, horizon],
    queryFn: () => getProcurementPlanApi({ window: win, horizon, keyword: keyword || undefined, warehouseId: warehouseId ?? undefined }),
  })
  const list = data?.list ?? []

  const columns: TableColumn<ProcurementPlanItem>[] = [
    { key: 'productCode', title: '商品编码', width: 120, render: v => <span className="text-doc-code">{String(v)}</span> },
    { key: 'productName', title: '商品名称' },
    { key: 'warehouseName', title: '仓库', width: 100 },
    { key: 'adu', title: '日均销量', width: 90, align: 'right', render: v => <span className="tabular-nums">{fmtQty(v)}</span> },
    { key: 'forecastDemand', title: '毛需求', width: 90, align: 'right', render: v => <span className="tabular-nums" title="日均 × (提前期 + 覆盖周期)">{fmtQty(v)}</span> },
    { key: 'safetyStock', title: '安全库存', width: 90, align: 'right', render: v => <span className="tabular-nums text-muted-foreground">{fmtQty(v)}</span> },
    { key: 'available', title: '可用', width: 80, align: 'right', render: v => <span className="tabular-nums">{fmtQty(v)}</span> },
    { key: 'inTransit', title: '在途', width: 80, align: 'right', render: v => Number(v) > 0 ? <span className="tabular-nums text-blue-600">{fmtQty(v)}</span> : <span className="tabular-nums text-muted-foreground">—</span> },
    { key: 'leadTimeDays', title: '提前期', width: 80, align: 'right', render: v => <span className="tabular-nums">{Number(v)} 天</span> },
    { key: 'suggestedQty', title: '建议采购量', width: 110, align: 'right', render: (v, r) => <span className="tabular-nums font-semibold text-primary">{fmtQty(v)}<span className="ml-1 text-xs font-normal text-muted-foreground">{r.unit}</span></span> },
    { key: 'expectedArrival', title: '建议到货日', width: 120, render: v => <span className="tabular-nums text-muted-foreground">{v ? String(v).slice(0, 10) : '—'}</span> },
    { key: 'supplierName', title: '建议供应商', width: 140, render: v => (v as string) || <span className="text-muted-foreground">待选</span> },
  ]

  return (
    <div className="space-y-4">
      <PageHeader
        title="采购计划（需求预测）"
        description="基于近 N 天真实出库趋势预测未来需求，套 MRP 净需求给出建议采购量：建议量 = 日均销量×(提前期+覆盖周期) + 安全库存 − 可用 − 在途。数据基于库存缓存与历史趋势，仅供参考。"
        actions={<Button onClick={() => refetch()}>重新预测</Button>}
      />

      <FilterCard>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <Input placeholder="商品编码 / 名称..." value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && setKeyword(search)} className="w-48" />
            <Button variant="outline" onClick={() => setKeyword(search)}>搜索</Button>
          </div>
          <WarehouseSelect value={warehouseId} onChange={id => setWarehouseId(id)} allowClear placeholder="全部仓库" className="w-40" />
          <div className="flex items-center gap-1.5">
            <Label className="text-sm text-muted-foreground">预测窗口</Label>
            <Input type="number" min="1" max="365" value={String(win)} onChange={e => setWin(Number(e.target.value) || 30)} className="h-9 w-20" />
            <span className="text-sm text-muted-foreground">天</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Label className="text-sm text-muted-foreground">覆盖周期</Label>
            <Input type="number" min="1" max="365" value={String(horizon)} onChange={e => setHorizon(Number(e.target.value) || 30)} className="h-9 w-20" />
            <span className="text-sm text-muted-foreground">天</span>
          </div>
          <div className="ml-auto text-sm text-muted-foreground">共 <span className="font-semibold text-foreground">{list.length}</span> 项需采购</div>
        </div>
      </FilterCard>

      <DataTable
        columns={columns}
        data={list}
        loading={isLoading}
        rowKey="id"
        emptyText="暂无需采购的商品（近期有出库的商品，未来需求都能被现有可用+在途覆盖）"
      />
    </div>
  )
}
