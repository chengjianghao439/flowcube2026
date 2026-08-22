import { useState } from 'react'
import { X } from 'lucide-react'
import PageHeader from '@/components/shared/PageHeader'
import DataTable from '@/components/shared/DataTable'
import Pagination from '@/components/shared/Pagination'
import { Button } from '@/components/ui/button'
import { SoftStatusLabel } from '@/components/shared/StatusBadge'
import { useDisposalList } from '@/hooks/useDisposal'
import { useWarehousesActive } from '@/hooks/useWarehouses'
import { usePermission } from '@/hooks/usePermission'
import { PERMISSIONS } from '@/lib/permission-codes'
import { formatDisplayDateTime } from '@/lib/dateTime'
import { downloadExport } from '@/lib/exportDownload'
import { toast } from '@/lib/toast'
import type { DisposalOrder } from '@/types/disposal'
import type { TableColumn } from '@/types'
import DisposalDetailDialog from './components/DisposalDetailDialog'
import CreateDisposalDialog from './components/CreateDisposalDialog'
import DisposalQueryDialog, { type DisposalQueryValues } from './DisposalQueryDialog'
import { DISPOSAL_STATUS_TONE, DISPOSAL_STATUS_LABEL } from './constants'

export default function DisposalPage() {
  const [keyword, setKeyword] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [warehouseFilter, setWarehouseFilter] = useState<number | null>(null)
  const [warehouseName, setWarehouseName] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [queryOpen, setQueryOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [detailId, setDetailId] = useState<number | null>(null)
  const [page, setPage] = useState(1)
  const { can } = usePermission()
  const { data: warehouses } = useWarehousesActive()

  const { data, isLoading } = useDisposalList({
    page,
    pageSize: 20,
    keyword: keyword || undefined,
    status: statusFilter || undefined,
    warehouseId: warehouseFilter ?? undefined,
    startDate: startDate || undefined,
    endDate: endDate || undefined,
  })
  const total = data?.pagination?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / 20))

  const initialQuery: DisposalQueryValues = {
    keyword, status: statusFilter,
    warehouseId: warehouseFilter, warehouseName,
    startDate, endDate,
  }
  function applyQuery(v: DisposalQueryValues) {
    setKeyword(v.keyword)
    setStatusFilter(v.status)
    setWarehouseFilter(v.warehouseId)
    setWarehouseName(v.warehouseName)
    setStartDate(v.startDate)
    setEndDate(v.endDate)
    setPage(1)
    setQueryOpen(false)
  }
  function clearAll() {
    setKeyword(''); setStatusFilter('')
    setWarehouseFilter(null); setWarehouseName('')
    setStartDate(''); setEndDate('')
    setPage(1)
  }

  const whName = warehouseFilter
    ? ((warehouses ?? []).find((w: { id: number; name: string }) => w.id === warehouseFilter)?.name ?? warehouseName) || ''
    : ''

  // 当前生效筛选摘要（可逐项移除）
  const chips = [
    keyword && { key: 'keyword', label: `关键字：${keyword}`, onRemove: () => setKeyword('') },
    statusFilter && { key: 'status', label: `状态：${DISPOSAL_STATUS_LABEL[Number(statusFilter)] ?? statusFilter}`, onRemove: () => setStatusFilter('') },
    warehouseFilter && { key: 'warehouse', label: `仓库：${whName || warehouseFilter}`, onRemove: () => { setWarehouseFilter(null); setWarehouseName('') } },
    startDate && { key: 'startDate', label: `创建起始：${startDate}`, onRemove: () => setStartDate('') },
    endDate && { key: 'endDate', label: `创建截止：${endDate}`, onRemove: () => setEndDate('') },
  ].filter(Boolean) as { key: string; label: string; onRemove: () => void }[]

  const columns: TableColumn<DisposalOrder>[] = [
    { key: 'disposalNo', title: '处置单号', width: 180, render: (v) => <span className="text-doc-code">{String(v)}</span> },
    { key: 'warehouseName', title: '仓库', width: 120 },
    {
      key: 'status', title: '状态', width: 100,
      render: (v, row) => <SoftStatusLabel label={(row as DisposalOrder).statusName} tone={DISPOSAL_STATUS_TONE[v as number] ?? 'draft'} />,
    },
    {
      key: 'totalValue', title: '处置价值', width: 120,
      render: (v) => <span className="text-right tabular-nums">¥{Number(v).toLocaleString('zh-CN', { maximumFractionDigits: 2 })}</span>,
    },
    { key: 'operatorName', title: '经办人', width: 100 },
    {
      key: 'createdAt', title: '创建时间', width: 160,
      render: (v) => formatDisplayDateTime(v),
    },
    {
      key: 'id', title: '操作', width: 100,
      render: (_, row) => (
        <Button size="sm" variant="outline" onClick={() => setDetailId((row as DisposalOrder).id)}>查看/处理</Button>
      ),
    },
  ]

  return (
    <div className="space-y-4">
      <PageHeader
        title="呆滞库存处置"
        description="圈选呆滞商品生成处置单 → 审批 → 降价促销/退货供应商/报废（处置只走 ERP 端，出库自动扣库存）"
        actions={
          <>
            <Button variant="outline" onClick={() => downloadExport('/export/disposals').catch(e => toast.error((e as Error).message))}>导出</Button>
            <Button variant="outline" onClick={() => setQueryOpen(true)}>查询</Button>
            {can(PERMISSIONS.INVENTORY_DISPOSAL_CREATE) ? (
              <Button onClick={() => setCreateOpen(true)}>+ 新建处置单</Button>
            ) : undefined}
          </>
        }
      />
      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {chips.map(c => (
            <span key={c.key} className="inline-flex items-center gap-1 rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">
              {c.label}
              <button type="button" onClick={c.onRemove} className="text-muted-foreground/70 hover:text-foreground" aria-label={`移除筛选 ${c.label}`}>
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          <Button size="sm" variant="ghost" onClick={clearAll}>清空</Button>
        </div>
      )}

      <DataTable columns={columns} data={data?.list || []} loading={isLoading} />
      <Pagination page={page} totalPages={totalPages} total={total} unit="单" onPageChange={setPage} />

      <CreateDisposalDialog open={createOpen} onClose={() => setCreateOpen(false)} />
      <DisposalDetailDialog open={!!detailId} onClose={() => setDetailId(null)} id={detailId} />
      <DisposalQueryDialog
        open={queryOpen}
        initial={initialQuery}
        onClose={() => setQueryOpen(false)}
        onApply={applyQuery}
      />
    </div>
  )
}
