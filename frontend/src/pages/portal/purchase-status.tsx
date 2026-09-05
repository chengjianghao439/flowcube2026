import { QueryErrorState } from '@/components/shared/QueryErrorState'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Truck } from 'lucide-react'
import PageHeader from '@/components/shared/PageHeader'
import DataTable from '@/components/shared/DataTable'
import Pagination from '@/components/shared/Pagination'
import { FilterCard } from '@/components/shared/FilterCard'
import { SoftStatusLabel } from '@/components/shared/StatusBadge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SupplierFinder } from '@/components/finder/SupplierFinder'
import { getPortalPurchaseStatusApi, type PortalPurchaseStatusRow } from '@/api/portal'
import type { TableColumn } from '@/types'

const PAGE_SIZE = 20

export default function PortalPurchaseStatusPage() {
  const [supplier, setSupplier] = useState<{ id: number; name: string } | null>(null)
  const [finderOpen, setFinderOpen] = useState(false)
  const [page, setPage] = useState(1)

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['portal-purchase-status', supplier?.id, page],
    queryFn: () => getPortalPurchaseStatusApi({ supplierId: supplier!.id, page, pageSize: PAGE_SIZE }),
    enabled: !!supplier,
  })

  const total = data?.pagination?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const columns: TableColumn<PortalPurchaseStatusRow>[] = [
    { key: 'orderNo', title: '采购单号', width: 150, render: v => <span className="text-doc-code">{String(v)}</span> },
    { key: 'status', title: '状态', width: 90, render: (_, row) => {
      const r = row as PortalPurchaseStatusRow
      const tone = r.status === 3 ? 'success' : r.status === 4 ? 'danger' : r.status === 2 ? 'active' : 'draft'
      return <SoftStatusLabel label={r.statusName} tone={tone} />
    } },
    { key: 'expectedDate', title: '预计到货', width: 110, render: v => v ? String(v).slice(0, 10) : '—' },
    { key: 'orderedQty', title: '订购量', width: 90, align: 'right', render: v => <span className="tabular-nums">{Number(v).toFixed(2)}</span> },
    { key: 'receivedQty', title: '已收量', width: 90, align: 'right', render: v => <span className="font-medium tabular-nums">{Number(v).toFixed(2)}</span> },
    { key: 'totalAmount', title: '金额', width: 110, align: 'right', render: v => <span className="tabular-nums">¥{Number(v).toFixed(2)}</span> },
    { key: 'warehouseName', title: '仓库', width: 100 },
    { key: 'createdAt', title: '创建时间', width: 150, render: v => String(v).slice(0, 16) },
  ]

  return (
    <div className="space-y-4">
      <PageHeader
        title="供应商到货门户"
        description="供应商查看本司采购订单的到货进度：单号、状态、预计到货与已收量，只读。"
      />

      <FilterCard>
        <Input
          className="w-56"
          placeholder={supplier ? `当前供应商：${supplier.name}` : '请选择供应商'}
          value={supplier?.name ?? ''}
          readOnly
          onClick={() => setFinderOpen(true)}
        />
        <Button variant="outline" onClick={() => setFinderOpen(true)}>选择供应商</Button>
        {supplier && (
          <Button variant="ghost" size="sm" onClick={() => { setSupplier(null); setPage(1) }}>清空</Button>
        )}
      </FilterCard>

      {supplier && (isError ? <QueryErrorState error={error} onRetry={() => void refetch()} /> : <>
        <DataTable columns={columns} data={data?.list ?? []} loading={isLoading} emptyText="该供应商暂无采购订单" />
        <Pagination page={page} totalPages={totalPages} total={total} unit="单" onPageChange={setPage} />
      </>)}

      <SupplierFinder
        open={finderOpen}
        onClose={() => setFinderOpen(false)}
        onConfirm={(r) => { setSupplier({ id: r.id, name: r.name }); setPage(1) }}
      />

      {!supplier && (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed bg-card py-20 text-muted-foreground">
          <Truck className="h-8 w-8 opacity-40" />
          <span className="text-sm">选择供应商后查看到货进度</span>
        </div>
      )}
    </div>
  )
}
