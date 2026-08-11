import { useQuery } from '@tanstack/react-query'
import PageHeader from '@/components/shared/PageHeader'
import DataTable from '@/components/shared/DataTable'
import { Button } from '@/components/ui/button'
import { SoftStatusLabel } from '@/components/shared/StatusBadge'
import { QueryErrorState } from '@/components/shared/QueryErrorState'
import { payloadClient } from '@/api/client'
import type { TableColumn } from '@/types'

interface AvgCostRow {
  rowKey: string
  productId: number
  productCode: string
  productName: string
  unit: string
  warehouseId: number
  unitCost: number
  cacheQty: number
  containerQty: number
  diffQty: number
  cacheValue: number
  containerValue: number
  diffValue: number
  drifted: boolean
}
interface AvgCostResult {
  ok: boolean
  driftedCount: number
  totalDiffValue: number
  totalRows: number
  list: AvgCostRow[]
}

const money = (n: number) => `¥${Number(n).toFixed(2)}`
const fmtQty = (v: unknown) => Number(v).toLocaleString()

export default function AvgCostReconciliationPage() {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['avg-cost-reconciliation'],
    queryFn: () => payloadClient.get<AvgCostResult>('/reports/avg-cost-reconciliation').then(r => r ?? null),
  })

  const columns: TableColumn<AvgCostRow>[] = [
    { key: 'productCode', title: '商品编码', width: 130, render: v => <span className="text-doc-code">{String(v)}</span> },
    { key: 'productName', title: '商品名称' },
    { key: 'unitCost', title: '单位成本', width: 90, align: 'right', render: v => <span className="tabular-nums">{money(Number(v))}</span> },
    { key: 'cacheQty', title: '缓存数量', width: 100, align: 'right', render: v => <span className="tabular-nums">{fmtQty(v)}</span> },
    { key: 'containerQty', title: '容器实际', width: 100, align: 'right', render: v => <span className="tabular-nums">{fmtQty(v)}</span> },
    { key: 'diffQty', title: '数量差异', width: 100, align: 'right', render: (_, r) => <span className={`tabular-nums ${r.diffQty !== 0 ? 'text-destructive font-semibold' : 'text-muted-foreground'}`}>{r.diffQty}</span> },
    { key: 'diffValue', title: '价值差异', width: 110, align: 'right', render: (_, r) => <span className={`tabular-nums ${r.diffValue !== 0 ? 'text-destructive font-semibold' : 'text-muted-foreground'}`}>{money(r.diffValue)}</span> },
    {
      key: 'drifted',
      title: '状态',
      width: 100,
      render: (_, r) => <SoftStatusLabel label={r.drifted ? '缓存漂移' : '一致'} tone={r.drifted ? 'danger' : 'success'} />,
    },
  ]

  return (
    <div className="space-y-4">
      <PageHeader
        title="成本对账"
        description="容器口径（ACTIVE 容器 remaining_qty，唯一事实源）vs 缓存口径（inventory_stock.quantity）的数量/价值对比。有差异说明缓存漂移，需执行 resync 修复。"
        actions={
          <div className="flex items-center gap-2">
            {data && (
              <SoftStatusLabel
                label={data.ok ? `一致 · ${data.totalRows} 行` : `${data.driftedCount} 项漂移`}
                tone={data.ok ? 'success' : 'danger'}
              />
            )}
            <Button variant="outline" onClick={() => refetch()}>刷新</Button>
          </div>
        }
      />

      {data && data.driftedCount > 0 && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-2 text-sm text-destructive">
          检测到 {data.driftedCount} 项缓存漂移，总价值差 {money(data.totalDiffValue)}。
          可执行 <code className="text-doc-code">npm --prefix backend run resync:inventory-stock</code> 修复缓存。
        </div>
      )}

      {isError && !data ? (
        <QueryErrorState error={error} onRetry={() => void refetch()} title="对账加载失败" compact />
      ) : (
        <DataTable
          columns={columns}
          data={data?.list ?? []}
          loading={isLoading}
          rowKey="rowKey"
          emptyText="无可对账数据"
        />
      )}
    </div>
  )
}
