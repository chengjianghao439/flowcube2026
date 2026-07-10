import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { X } from 'lucide-react'
import PageHeader from '@/components/shared/PageHeader'
import DataTable from '@/components/shared/DataTable'
import { SoftStatusLabel } from '@/components/shared/StatusBadge'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { Button } from '@/components/ui/button'
import TableActionsMenu from '@/components/shared/TableActionsMenu'
import { getTransferListApi, confirmTransferApi, cancelTransferApi } from '@/api/transfer'
import { downloadExport } from '@/lib/exportDownload'
import { formatDisplayDateTime } from '@/lib/dateTime'
import { readStringParam, upsertSearchParams } from '@/lib/urlSearchParams'
import { toast } from '@/lib/toast'
import { useWorkspaceStore } from '@/store/workspaceStore'
import TransferQueryDialog, { type TransferQueryValues } from './TransferQueryDialog'
import type { TransferOrder } from '@/api/transfer'
import type { TableColumn } from '@/types'

const STATUS_LABELS: Record<string, string> = { '1': '草稿', '2': '待出库', '3': '在途', '4': '已完成', '5': '已取消' }

/** 首次打开调拨页时默认筛选的天数窗口（最近一周） */
const DEFAULT_RANGE_DAYS = 7
function toYmd(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export default function TransferPage() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { addTab } = useWorkspaceStore()
  const [searchParams, setSearchParams] = useSearchParams()

  const [queryOpen, setQueryOpen] = useState(false)
  const [confirmState, setConfirmState] = useState<{ open: boolean; title: string; description: string; onConfirm: () => void }>({ open: false, title: '', description: '', onConfirm: () => {} })
  const openConfirm = (title: string, description: string, onConfirm: () => void) => setConfirmState({ open: true, title, description, onConfirm })
  const closeConfirm = () => setConfirmState(s => ({ ...s, open: false }))
  const [pendingId, setPendingId] = useState<number | null>(null)

  // ── 当前生效的筛选（全部存于 URL 参数，刷新/分享可保留） ──
  const keyword       = readStringParam(searchParams, 'keyword')
  const remark        = readStringParam(searchParams, 'remark')
  const operatorId    = Number(searchParams.get('operatorId') || '') || null
  const operatorName  = readStringParam(searchParams, 'operatorName')
  const statusFilter  = readStringParam(searchParams, 'status')
  const productId     = Number(searchParams.get('productId') || '') || null
  const productCode   = readStringParam(searchParams, 'productCode')
  const productName   = readStringParam(searchParams, 'productName')
  const warehouseId   = Number(searchParams.get('warehouseId') || '') || null
  const warehouseName = readStringParam(searchParams, 'warehouseName')
  const startDate     = readStringParam(searchParams, 'startDate')
  const endDate       = readStringParam(searchParams, 'endDate')

  const { data, isLoading } = useQuery({
    queryKey: ['transfer', { keyword, remark, operatorId, statusFilter, productId, warehouseId, startDate, endDate }],
    queryFn: () => getTransferListApi({
      pageSize: 99999,
      keyword,
      remark: remark || undefined,
      operatorId: operatorId || undefined,
      status: statusFilter || undefined,
      productId: productId || undefined,
      warehouseId: warehouseId || undefined,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
    }).then(r => r!),
  })

  const mut = (fn: () => Promise<unknown>, id?: number) => {
    if (id) setPendingId(id)
    fn()
      .then(() => qc.invalidateQueries({ queryKey: ['transfer'] }))
      .finally(() => { if (id) setPendingId(null) })
  }

  function updateParams(updates: Record<string, string | number | null | undefined>) {
    setSearchParams(upsertSearchParams(searchParams, updates))
  }

  // 首次打开：无日期筛选时默认套用最近一周
  useEffect(() => {
    if (!startDate && !endDate) {
      const end = new Date()
      const start = new Date()
      start.setDate(start.getDate() - DEFAULT_RANGE_DAYS)
      setSearchParams(upsertSearchParams(searchParams, { startDate: toYmd(start), endDate: toYmd(end) }), { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function goToNew() {
    addTab({ key: '/transfer/new', title: '新建调拨单', path: '/transfer/new' })
    navigate('/transfer/new')
  }
  function goToDetail(order: TransferOrder) {
    const key = `/transfer/${order.id}`
    addTab({ key, title: order.orderNo, path: key })
    navigate(key)
  }

  // 导出参数（与列表当前筛选保持一致）
  const exportParams = {
    ...(keyword ? { keyword } : {}),
    ...(remark ? { remark } : {}),
    ...(operatorId ? { operatorId: String(operatorId) } : {}),
    ...(statusFilter ? { status: statusFilter } : {}),
    ...(productId ? { productId: String(productId) } : {}),
    ...(warehouseId ? { warehouseId: String(warehouseId) } : {}),
    ...(startDate ? { startDate } : {}),
    ...(endDate ? { endDate } : {}),
  }

  // 查询弹窗初始值
  const initialQuery: TransferQueryValues = {
    keyword, remark, operatorId, operatorName, status: statusFilter,
    productId, productCode, productName,
    warehouseId, warehouseName,
    startDate, endDate,
  }

  function applyQuery(v: TransferQueryValues) {
    updateParams({
      keyword: v.keyword || null,
      remark: v.remark || null,
      operatorId: v.operatorId || null,
      operatorName: v.operatorName || null,
      status: v.status || null,
      productId: v.productId || null,
      productCode: v.productCode || null,
      productName: v.productName || null,
      warehouseId: v.warehouseId || null,
      warehouseName: v.warehouseName || null,
      startDate: v.startDate || null,
      endDate: v.endDate || null,
    })
    setQueryOpen(false)
  }

  function clearAll() {
    updateParams({
      keyword: null, remark: null, operatorId: null, operatorName: null, status: null,
      productId: null, productCode: null, productName: null,
      warehouseId: null, warehouseName: null,
      startDate: null, endDate: null,
    })
  }

  // 当前生效筛选摘要（可逐项移除）
  const chips = [
    keyword && { key: 'keyword', label: `单号：${keyword}`, onRemove: () => updateParams({ keyword: null }) },
    remark && { key: 'remark', label: `备注：${remark}`, onRemove: () => updateParams({ remark: null }) },
    operatorId && { key: 'operator', label: `经办人：${operatorName || operatorId}`, onRemove: () => updateParams({ operatorId: null, operatorName: null }) },
    statusFilter && { key: 'status', label: `状态：${STATUS_LABELS[statusFilter] ?? statusFilter}`, onRemove: () => updateParams({ status: null }) },
    warehouseId && { key: 'warehouse', label: `仓库：${warehouseName || warehouseId}`, onRemove: () => updateParams({ warehouseId: null, warehouseName: null }) },
    productId && { key: 'product', label: `产品：${productName || productId}`, onRemove: () => updateParams({ productId: null, productCode: null, productName: null }) },
  ].filter(Boolean) as { key: string; label: string; onRemove: () => void }[]

  const columns: TableColumn<TransferOrder>[] = [
    { key: 'orderNo', title: '调拨单号', width: 170, render: (v) => <span className="text-doc-code">{String(v)}</span> },
    { key: 'fromWarehouseName', title: '调出仓库', width: 130 },
    { key: 'toWarehouseName', title: '调入仓库', width: 130 },
    { key: 'status', title: '状态', width: 90, render: (v, row) => {
      const status = v as number
      const tone = status === 4 ? 'success' : status === 5 ? 'danger' : status === 1 ? 'draft' : 'active'
      return <SoftStatusLabel label={(row as TransferOrder).statusName} tone={tone} />
    } },
    { key: 'operatorName', title: '经办人', width: 90 },
    { key: 'createdAt', title: '创建时间', width: 160, render: (v) => formatDisplayDateTime(v) },
    {
      key: 'remark', title: '备注', width: 200,
      render: (v) => v
        ? <span className="line-clamp-1 text-xs text-muted-foreground" title={String(v)}>{String(v)}</span>
        : <span className="text-xs text-muted-foreground/50">—</span>
    },
    { key: 'id', title: '操作', width: 120, render: (_, row) => {
      const r = row as TransferOrder
      return (
        <TableActionsMenu
          primaryLabel="详情"
          primaryVariant="outline"
          onPrimaryClick={() => goToDetail(r)}
          items={[
            ...(r.status === 1 ? [{
              label: pendingId === r.id ? '处理中...' : '确认派发',
              onClick: () => mut(() => confirmTransferApi(r.id), r.id),
              disabled: pendingId === r.id,
            }] : []),
            ...((r.status === 1 || r.status === 2) ? [{
              label: pendingId === r.id ? '处理中...' : '取消',
              onClick: () => openConfirm('取消调拨', '确认取消此调拨单？', () => mut(() => cancelTransferApi(r.id), r.id)),
              disabled: pendingId === r.id,
              destructive: true,
              separatorBefore: true,
            }] : []),
          ]}
        />
      )
    } },
  ]

  return (
    <div className="space-y-4">
      <PageHeader title="库存调拨" description="在仓库之间调拨商品，自动同步两端库存" actions={
        <>
          <Button variant="outline"
            onClick={() => downloadExport('/export/transfer', exportParams).catch(e => toast.error((e as Error).message))}>
            导出 Excel
          </Button>
          <Button variant="outline" onClick={() => setQueryOpen(true)}>查询</Button>
          <Button onClick={goToNew}>+ 新建调拨单</Button>
        </>
      } />

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

      <DataTable columns={columns} data={data?.list || []} loading={isLoading} onRowDoubleClick={goToDetail} />

      <ConfirmDialog
        open={confirmState.open}
        title={confirmState.title}
        description={confirmState.description}
        variant={confirmState.title.includes('取消') ? 'destructive' : 'default'}
        confirmText={confirmState.title.includes('取消') ? '确认取消' : '确认'}
        onConfirm={() => { closeConfirm(); confirmState.onConfirm() }}
        onCancel={closeConfirm}
      />

      <TransferQueryDialog
        open={queryOpen}
        initial={initialQuery}
        onClose={() => setQueryOpen(false)}
        onApply={applyQuery}
      />
    </div>
  )
}
