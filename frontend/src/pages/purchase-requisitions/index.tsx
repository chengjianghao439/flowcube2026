import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { X } from 'lucide-react'
import PageHeader from '@/components/shared/PageHeader'
import DataTable from '@/components/shared/DataTable'
import { Button } from '@/components/ui/button'
import { SoftStatusLabel } from '@/components/shared/StatusBadge'
import { usePermission } from '@/hooks/usePermission'
import { PERMISSIONS } from '@/lib/permission-codes'
import { useWorkspaceStore } from '@/store/workspaceStore'
import { formatDisplayDateTime } from '@/lib/dateTime'
import { listRequisitionsApi } from '@/api/purchase-requisitions'
import { readStringParam, upsertSearchParams } from '@/lib/urlSearchParams'
import RequisitionQueryDialog, { type RequisitionQueryValues } from './RequisitionQueryDialog'
import type { PurchaseRequisition } from '@/types/purchase-requisition'
import type { TableColumn } from '@/types'

const STATUS_LABELS: Record<string, string> = {
  '1': '草稿', '2': '待审批', '3': '已批准',
  '4': '已驳回', '5': '已取消', '6': '已转采购',
}

export default function RequisitionsPage() {
  const navigate = useNavigate()
  const addTab = useWorkspaceStore(s => s.addTab)
  const { can } = usePermission()
  const [searchParams, setSearchParams] = useSearchParams()
  const [queryOpen, setQueryOpen] = useState(false)

  // ── 当前生效的筛选（全部存于 URL 参数，刷新/分享可保留） ──
  const keyword       = readStringParam(searchParams, 'keyword')
  const statusFilter  = readStringParam(searchParams, 'status')
  const warehouseId   = Number(searchParams.get('warehouseId') || '') || null
  const warehouseName = readStringParam(searchParams, 'warehouseName')
  const applicantId   = Number(searchParams.get('applicantId') || '') || null
  const applicantName = readStringParam(searchParams, 'applicantName')
  const startDate     = readStringParam(searchParams, 'startDate')
  const endDate       = readStringParam(searchParams, 'endDate')

  const { data, isLoading } = useQuery({
    queryKey: ['requisitions', keyword, statusFilter, warehouseId, applicantId, startDate, endDate],
    queryFn: () => listRequisitionsApi({
      page: 1, pageSize: 200,
      keyword: keyword || undefined,
      status: statusFilter || undefined,
      warehouseId: warehouseId ?? undefined,
      applicantId: applicantId ?? undefined,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
    }),
  })
  const list = data?.list ?? []

  function open(path: string, title: string) { addTab({ key: path, title, path }); navigate(path) }

  function updateParams(updates: Record<string, string | number | null | undefined>) {
    setSearchParams(upsertSearchParams(searchParams, updates))
  }

  // 查询弹窗初始值
  const initialQuery: RequisitionQueryValues = {
    keyword, status: statusFilter,
    warehouseId, warehouseName,
    applicantId, applicantName,
    startDate, endDate,
  }

  function applyQuery(v: RequisitionQueryValues) {
    updateParams({
      keyword: v.keyword || null,
      status: v.status || null,
      warehouseId: v.warehouseId || null,
      warehouseName: v.warehouseName || null,
      applicantId: v.applicantId || null,
      applicantName: v.applicantName || null,
      startDate: v.startDate || null,
      endDate: v.endDate || null,
    })
    setQueryOpen(false)
  }

  function clearAll() {
    updateParams({
      keyword: null, status: null,
      warehouseId: null, warehouseName: null,
      applicantId: null, applicantName: null,
      startDate: null, endDate: null,
    })
  }

  // 当前生效筛选摘要（可逐项移除）
  const chips = [
    keyword && { key: 'keyword', label: `关键字：${keyword}`, onRemove: () => updateParams({ keyword: null }) },
    statusFilter && { key: 'status', label: `状态：${STATUS_LABELS[statusFilter] ?? statusFilter}`, onRemove: () => updateParams({ status: null }) },
    warehouseId && { key: 'warehouse', label: `仓库：${warehouseName || warehouseId}`, onRemove: () => updateParams({ warehouseId: null, warehouseName: null }) },
    applicantId && { key: 'applicant', label: `申请人：${applicantName || applicantId}`, onRemove: () => updateParams({ applicantId: null, applicantName: null }) },
  ].filter(Boolean) as { key: string; label: string; onRemove: () => void }[]

  const columns: TableColumn<PurchaseRequisition>[] = [
    { key: 'requisitionNo', title: '采购申请单号', width: 150, render: v => <span className="text-doc-code">{String(v)}</span> },
    { key: 'title', title: '事由', render: v => (v as string) || '—' },
    { key: 'warehouseName', title: '期望入库仓', width: 120 },
    { key: 'applicantName', title: '申请人', width: 100 },
    { key: 'estimatedAmount', title: '预估金额', width: 110, align: 'right', render: v => <span className="tabular-nums">¥{Number(v).toFixed(2)}</span> },
    { key: 'itemCount', title: '明细数', width: 80, align: 'right', render: v => <span className="tabular-nums">{Number(v ?? 0)}</span> },
    { key: 'status', title: '状态', width: 100, render: (_, r) => <SoftStatusLabel label={r.statusName} tone={r.statusTone} /> },
    { key: 'createdAt', title: '创建时间', width: 160, render: v => formatDisplayDateTime(String(v)) },
  ]

  return (
    <div className="space-y-4">
      <PageHeader
        title="采购申请"
        description="登记采购需求，审批后按供应商转为采购单。"
        actions={
          <>
            <Button variant="outline" onClick={() => setQueryOpen(true)}>查询</Button>
            {can(PERMISSIONS.PURCHASE_REQUISITION_CREATE)
              ? <Button onClick={() => open('/purchase-requisitions/new', '新建采购申请单')}>新建采购申请单</Button>
              : undefined}
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

      <DataTable
        columns={columns}
        data={list}
        loading={isLoading}
        rowKey="id"
        emptyText="暂无采购申请单"
        onRowDoubleClick={r => open(`/purchase-requisitions/${r.id}`, `采购申请单 ${r.requisitionNo}`)}
      />

      <RequisitionQueryDialog
        open={queryOpen}
        initial={initialQuery}
        onClose={() => setQueryOpen(false)}
        onApply={applyQuery}
      />
    </div>
  )
}
