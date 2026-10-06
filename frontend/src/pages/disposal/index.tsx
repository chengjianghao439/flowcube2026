import { HandlingSourcesPanel } from './HandlingSourcesPanel'
import { HandlingIntentDialog } from './HandlingIntentDialog'
import { ConversionDialog } from './ConversionDialog'
import { useApprovalDetailHandoff } from '@/hooks/useApprovalDetailHandoff'
import { ApprovalHandoffNotice } from '@/components/shared/ApprovalHandoffNotice'
import { getDisposalDetailApi } from '@/api/disposal'
import { money } from '@/lib/format'
import { useState } from 'react'
import { X } from 'lucide-react'
import PageHeader from '@/components/shared/PageHeader'
import DataTable from '@/components/shared/DataTable'
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
import { DISPOSAL_STATUS_TONE, DISPOSAL_STATUS_LABEL } from './constants'

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

  const { data, isLoading } = useDisposalList({
    page: 1,
    pageSize: 20,
    keyword: keyword || undefined,
    status: statusFilter || undefined,
    warehouseId: warehouseFilter ?? undefined,
    startDate: startDate || undefined,
    endDate: endDate || undefined,
  })
  const total = data?.pagination?.total ?? 0

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
      render: (v) => <span className="text-right tabular-nums">{money(Number(v))}</span>,
    },
    { key: 'operatorName', title: '经办人', width: 100 },
    {
      key: 'createdAt', title: '创建时间', width: 160,
      render: (v) => formatDisplayDateTime(v),
    },
    {
      key: 'id', title: '操作', width: 100,
      render: (_, row) => (
        <div className="flex gap-1"><Button size="sm" variant="outline" onClick={() => setDetailId((row as DisposalOrder).id)}>查看/处理</Button>{(row as DisposalOrder).status === 3 && can(PERMISSIONS.INVENTORY_DISPOSAL_APPROVE) && <Button size="sm" variant="outline" onClick={() => { const id = (row as DisposalOrder).id; setConversionIds(ids => ids.includes(id) ? ids : [...ids, id]); setConversionId(id) }}>整单签认</Button>}</div>
      ),
    },
  ]

  return (
    <div className="space-y-4">
      <PageHeader
        title="滞销库存处理"
        description="促销走正常销售，退供应商走采购退货；新独立单只报废，沿原审批后执行。历史处理单保留追溯，旧已批准单待签认。"
        actions={
          <>
            <Button variant="outline" onClick={() => downloadExport('/export/disposals').catch(e => toast.error((e as Error).message))}>导出</Button>
            <Button variant="outline" onClick={() => setQueryOpen(true)}>查询</Button>
            <Button variant="outline" onClick={() => { setSuggestionVisited(true); setSuggestionOpen(true) }}>滞销建议</Button>
            {can(PERMISSIONS.INVENTORY_DISPOSAL_CREATE) ? (
              <Button onClick={() => { setSuggestionVisited(true); setCreateOpen(true) }}>+ 新建报废单</Button>
            ) : undefined}
          </>
        }
      />
      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {chips.map(c => (
            <span key={c.key} className="inline-flex items-center gap-1 rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">
              {c.label}
              <button type="button" onClick={c.onRemove} className="text-muted-foreground/70 hover:text-foreground" aria-label={`移除「${c.label}」`}>
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          <Button size="sm" variant="ghost" onClick={clearAll}>清空</Button>
        </div>
      )}

      {can(PERMISSIONS.INVENTORY_DISPOSAL_CREATE) && <Button variant="outline" onClick={() => { setIntentVisited(true); setIntentOpen(true) }}>保存处理意图</Button>}
      <HandlingSourcesPanel />
      <DataTable columns={columns} data={data?.list || []} loading={isLoading} />
      <ListSummary total={total} unit="单" />

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
