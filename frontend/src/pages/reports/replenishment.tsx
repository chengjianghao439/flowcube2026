import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import PageHeader from '@/components/shared/PageHeader'
import DataTable from '@/components/shared/DataTable'
import { FilterCard } from '@/components/shared/FilterCard'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { WarehouseSelect } from '@/components/shared/WarehouseSelect'
import { QueryErrorState } from '@/components/shared/QueryErrorState'
import { getReplenishmentApi, type ReplenishmentItem } from '@/api/inventory'
import type { TableColumn } from '@/types'

/** 数量展示：整数带千分位，小数保留两位 */
function fmtQty(v: unknown): string {
  const n = Number(v)
  if (!Number.isFinite(n)) return '—'
  return Number.isInteger(n) ? n.toLocaleString() : n.toFixed(2)
}

export default function ReplenishmentPage() {
  const [warehouseId, setWarehouseId] = useState<number | null>(null)
  const [search, setSearch] = useState('')
  const [applied, setApplied] = useState<{ keyword: string; warehouseId: number | null }>({ keyword: '', warehouseId: null })

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['replenishment', applied],
    queryFn: () => getReplenishmentApi({
      page: 1,
      pageSize: 500,
      keyword: applied.keyword || undefined,
      warehouseId: applied.warehouseId ?? undefined,
    }),
  })

  const list = data?.list ?? []
  const total = data?.pagination?.total ?? 0

  const columns: TableColumn<ReplenishmentItem>[] = [
    { key: 'productCode', title: '商品编码', width: 130, render: v => <span className="text-doc-code">{String(v)}</span> },
    { key: 'productName', title: '商品名称' },
    { key: 'warehouseName', title: '仓库', width: 110 },
    { key: 'available', title: '可用', width: 90, align: 'right', render: v => <span className="tabular-nums">{fmtQty(v)}</span> },
    { key: 'inTransit', title: '在途采购', width: 100, align: 'right', render: v => Number(v) > 0
        ? <span className="tabular-nums text-blue-600">{fmtQty(v)}</span>
        : <span className="tabular-nums text-muted-foreground">—</span> },
    { key: 'safetyStock', title: '安全库存', width: 100, align: 'right', render: v => <span className="tabular-nums text-muted-foreground">{fmtQty(v)}</span> },
    { key: 'reorderPoint', title: '补货点', width: 90, align: 'right', render: v => <span className="tabular-nums">{fmtQty(v)}</span> },
    { key: 'suggestQty', title: '建议采购量', width: 120, align: 'right', render: (v, r) => (
        <span className="tabular-nums font-semibold text-primary">{fmtQty(v)}<span className="ml-1 text-xs font-normal text-muted-foreground">{r.unit}</span></span>
      ) },
  ]

  function apply() { setApplied({ keyword: search, warehouseId }) }
  function reset() { setSearch(''); setWarehouseId(null); setApplied({ keyword: '', warehouseId: null }) }

  return (
    <div className="space-y-4">
      <PageHeader
        title="补货建议"
        description="按仓列出「可用 + 在途已低于补货点」的商品，并给出建议采购量（= 目标库存 − 可用 − 在途采购）。补货基准可在商品档案设通用默认，或在此按仓覆盖。"
        actions={<Button onClick={() => refetch()}>立即刷新</Button>}
      />

      <FilterCard>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <Input
              placeholder="商品编码 / 名称..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && apply()}
              className="w-52"
            />
            <Button variant="outline" onClick={apply}>搜索</Button>
          </div>
          <div className="h-5 w-px bg-border" />
          <WarehouseSelect value={warehouseId} onChange={id => setWarehouseId(id)} allowClear placeholder="全部仓库" className="w-44" />
          {(applied.keyword || applied.warehouseId != null) && (
            <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={reset}>重置</Button>
          )}
          <div className="ml-auto text-sm text-muted-foreground">共 <span className="font-semibold text-foreground">{total}</span> 项待补货</div>
        </div>
      </FilterCard>

      {isError && !data ? (
        <QueryErrorState
          error={error}
          onRetry={() => void refetch()}
          title="补货建议加载失败"
          description="补货建议数据暂时无法加载，请点击重试或稍后再试"
          compact
        />
      ) : (
        <DataTable
          columns={columns}
          data={list}
          loading={isLoading}
          rowKey="id"
          emptyText="暂无待补货商品（所有商品的可用 + 在途都在补货点之上，或尚未设置补货点）"
        />
      )}
    </div>
  )
}
