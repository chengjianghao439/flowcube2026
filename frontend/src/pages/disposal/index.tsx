import { AppliedDateRange } from '@/components/shared/AppliedDateRange'
import { OrderStatusFilter } from '@/components/shared/OrderStatusFilter'
import { HandlingSourcesPanel } from './HandlingSourcesPanel'
import { HandlingIntentDialog } from './HandlingIntentDialog'
import { ConversionDialog } from './ConversionDialog'
import { useApprovalDetailHandoff } from '@/hooks/useApprovalDetailHandoff'
import { ApprovalHandoffNotice } from '@/components/shared/ApprovalHandoffNotice'
import { getDisposalDetailApi } from '@/api/disposal'
import { money } from '@/lib/format'
import { useMemo, useState } from 'react'
import { X } from 'lucide-react'
import PageHeader from '@/components/shared/PageHeader'
import TableActionsMenu from '@/components/shared/TableActionsMenu'
import DataTable from '@/components/shared/DataTable'
import { QueryErrorState } from '@/components/shared/QueryErrorState'
import ListSummary from '@/components/shared/ListSummary'
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
import { DISPOSAL_STATUS_TONE, DISPOSAL_STATUS_OPTIONS } from './constants'

const QUICK_STATUSES = [
  { value: '', label: '全部处置单' },
  ...DISPOSAL_STATUS_OPTIONS,
]

export default function DisposalPage() {
  const [intentVisited, setIntentVisited] = useState(false), [intentOpen, setIntentOpen] = useState(false), [conversionIds, setConversionIds] = useState<number[]>([]), [conversionId, setConversionId] = useState<number | null>(null)
  const [keyword, setKeyword] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [warehouseFilter, setWarehouseFilter] = useState<number | null>(null)
  const [warehouseName, setWarehouseName] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [queryOpen, setQueryOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [suggestionOpen, setSuggestionOpen] = useState(false)
  const [suggestionVisited, setSuggestionVisited] = useState(false)
  const [detailId, setDetailId] = useState<number | null>(null)
  const { can } = usePermission()
  const handoff = useApprovalDetailHandoff('/disposals', PERMISSIONS.INVENTORY_DISPOSAL_VIEW, getDisposalDetailApi, createOpen || suggestionOpen || queryOpen || detailId != null)
  const { data: warehouses } = useWarehousesActive()

  const { data, isLoading, isError, error, refetch } = useDisposalList({
    page: 1,
    pageSize: 20,
    keyword: keyword || undefined,
    status: statusFilter || undefined,
    warehouseId: warehouseFilter ?? undefined,
    startDate: startDate || undefined,
    endDate: endDate || undefined,
  })
  const total = data?.pagination?.total ?? 0

  const initialQuery = useMemo<DisposalQueryValues>(() => ({
    keyword, status: statusFilter,
    warehouseId: warehouseFilter, warehouseName,
    startDate, endDate,
  }), [keyword, statusFilter, warehouseFilter, warehouseName, startDate, endDate])
  function applyQuery(v: DisposalQueryValues) {
    setKeyword(v.keyword)
    setStatusFilter(v.status)
    setWarehouseFilter(v.warehouseId)
    setWarehouseName(v.warehouseName)
    setStartDate(v.startDate)
    setEndDate(v.endDate);
    setQueryOpen(false)
  }
  function clearAll() {
    setKeyword(''); setStatusFilter('')
    setWarehouseFilter(null); setWarehouseName('')
    setStartDate(''); setEndDate('');
  }

  const whName = warehouseFilter
    ? ((warehouses ?? []).find((w: { id: number; name: string }) => w.id === warehouseFilter)?.name ?? warehouseName) || ''
    : ''

  // 当前生效筛选摘要（可逐项移除）
  const chips = [
    keyword && { key: 'keyword', label: `关键字：${keyword}`, onRemove: () => setKeyword('') },
    statusFilter && !QUICK_STATUSES.some(option => option.value === statusFilter) && { key: 'status', label: `状态：${statusFilter}`, onRemove: () => setStatusFilter('') },
    warehouseFilter && { key: 'warehouse', label: `仓库：${whName || warehouseFilter}`, onRemove: () => { setWarehouseFilter(null); setWarehouseName('') } },
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
      render: (v) => <span className="text-right tabular-nums">{money(Number(v))}</span>,
    },
    { key: 'operatorName', title: '经办人', width: 100 },
    {
      key: 'createdAt', title: '创建时间', width: 160,
      render: (v) => formatDisplayDateTime(v),
    },
    {
      key: 'id', title: '操作', width: 148,
      render: (_, row) => <TableActionsMenu primaryLabel="查看/处理" rowLabel={row.disposalNo} primaryVariant="outline" onPrimaryClick={() => setDetailId(row.id)}
        items={row.status === 3 && can(PERMISSIONS.INVENTORY_DISPOSAL_APPROVE) ? [{
          label: '整单签认', afterMenuClose: true, onClick: () => {
            setConversionIds(ids => ids.includes(row.id) ? ids : [...ids, row.id])
            setConversionId(row.id)
          },
        }] : []} />,
    },
  ]

  return (
    <div className="space-y-4">
      <PageHeader
        title="滞销库存处理"
        description="处理滞销库存报废与历史处置单追溯。"
        actions={
          <>
            <Button variant="outline" onClick={() => downloadExport('/export/disposals').catch(e => toast.error((e as Error).message))}>导出 Excel</Button>
            <Button variant="outline" onClick={() => setQueryOpen(true)}>查询</Button>
            <Button variant="outline" onClick={() => { setSuggestionVisited(true); setSuggestionOpen(true) }}>滞销建议</Button>
            {can(PERMISSIONS.INVENTORY_DISPOSAL_CREATE) && <Button variant="outline" onClick={() => { setIntentVisited(true); setIntentOpen(true) }}>保存处理意图</Button>}
            {can(PERMISSIONS.INVENTORY_DISPOSAL_CREATE) ? (
              <Button onClick={() => { setSuggestionVisited(true); setCreateOpen(true) }}>新建报废单</Button>
            ) : undefined}
          </>
        }
      />

      <div className="fc-filter-bar">
        <div className="sample-status-strip">
          <OrderStatusFilter label="处置状态分类" value={statusFilter} options={QUICK_STATUSES}
            onChange={setStatusFilter} />
        </div>
        <div className="fc-filter-bar-filters" aria-label="已应用筛选">
          <AppliedDateRange label="创建日期" startDate={startDate} endDate={endDate}
            onClear={() => { setStartDate(''); setEndDate('') }} />
          {chips.map(c => (
            <span key={c.key} className="fc-query-chip">
              {c.label}
              <button type="button" onClick={c.onRemove} className="text-muted-foreground/70 hover:text-foreground" aria-label={`移除「${c.label}」`}>
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          {(chips.length > 0 || statusFilter || startDate || endDate) && <Button size="sm" variant="ghost" onClick={clearAll}>清空</Button>}
        </div>
      </div>

      {isError ? <QueryErrorState title="处置单读取失败" error={error} onRetry={() => void refetch()} /> :
        <DataTable fluid virtualized scrollLabel="处置单表格" columnStorageKey="disposal:v1" columns={columns} data={data?.list || []} loading={isLoading} />}
      {!isError && !isLoading && data && <ListSummary total={total} unit="单" />}

      <HandlingSourcesPanel />
      <ApprovalHandoffNotice {...handoff} />
      {handoff.data && <DisposalDetailDialog open={handoff.open} onClose={handoff.close} id={handoff.data.id} initialDetail={handoff.data} actionsDisabled={!handoff.ready} />}
      {suggestionVisited && <CreateDisposalDialog open={createOpen || suggestionOpen} mode={createOpen ? 'create' : 'suggestions'} onClose={() => { setCreateOpen(false); setSuggestionOpen(false) }} />}
      {intentVisited && <HandlingIntentDialog open={intentOpen} onClose={() => setIntentOpen(false)} />}
      {conversionIds.map(id => <ConversionDialog key={id} id={id} open={conversionId === id} onClose={() => setConversionId(null)} />)}
      <DisposalDetailDialog open={!!detailId} onClose={() => setDetailId(null)} id={detailId} />
      <DisposalQueryDialog
        open={queryOpen}
        initial={initialQuery}
        resetValues={{ startDate: '', endDate: '' }}
        onClose={() => setQueryOpen(false)}
        onApply={applyQuery}
      />
    </div>
  )
}
