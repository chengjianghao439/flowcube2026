import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { X } from 'lucide-react'
import { downloadExport } from '@/lib/exportDownload'
import PageHeader from '@/components/shared/PageHeader'
import DataTable from '@/components/shared/DataTable'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { Button } from '@/components/ui/button'
import { SoftStatusLabel } from '@/components/shared/StatusBadge'
import type { StatusTone } from '@/lib/statusTone'
import { SaleRowActions } from './components/SaleRowActions'
import StockShortageDialog, { type StockShortageItem } from './components/StockShortageDialog'
import ReserveAllocationDialog from './components/ReserveAllocationDialog'
import SaleQueryDialog, { type SaleQueryValues } from './SaleQueryDialog'
import { useSaleList, useReleaseSale, useShipSale, useCancelSale, useDeleteSale } from '@/hooks/useSale'
import { getSaleDetailApi } from '@/api/sale'
import { PrintPreviewOverlay } from '@/components/print/SaleOrderPrintTemplate'
import { useWorkspaceStore } from '@/store/workspaceStore'
import { toast } from '@/lib/toast'
import { formatDisplayDateTime } from '@/lib/dateTime'
import { readStringParam, upsertSearchParams } from '@/lib/urlSearchParams'
import { getSaleWorkflowStatus } from '@/lib/saleWorkflowStatus'
import type { SaleOrder } from '@/types/sale'
import type { TableColumn } from '@/types'

// ─── 二次确认 state 类型 ─────────────────────────────────────────────────────
interface ConfirmState {
  open: boolean
  title: string
  description: string
  onConfirm: () => void
}

const EMPTY_CONFIRM: ConfirmState = { open: false, title: '', description: '', onConfirm: () => {} }
const STATUS_LABELS: Record<string, string> = { '1': '草稿', '2': '已占库', '3': '拣货中', '4': '已出库', '5': '已取消' }

/** 首次打开销售页时默认筛选的天数窗口（最近一周） */
const DEFAULT_RANGE_DAYS = 7
function toYmd(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// ─── 主页面 ───────────────────────────────────────────────────────────────────

export default function SalePage() {
  const [searchParams, setSearchParams] = useSearchParams()

  // ── 当前生效的筛选（全部存于 URL 参数，刷新/分享可保留） ──
  const keyword       = readStringParam(searchParams, 'keyword')
  const remark        = readStringParam(searchParams, 'remark')
  const operatorId    = Number(searchParams.get('operatorId') || '') || null
  const operatorName  = readStringParam(searchParams, 'operatorName')
  const statusFilter  = readStringParam(searchParams, 'status')
  const productId     = Number(searchParams.get('productId') || '') || null
  const productCode   = readStringParam(searchParams, 'productCode')
  const productName   = readStringParam(searchParams, 'productName')
  const customerId    = Number(searchParams.get('customerId') || '') || null
  const customerName  = readStringParam(searchParams, 'customerName')
  const warehouseId   = Number(searchParams.get('warehouseId') || '') || null
  const warehouseName = readStringParam(searchParams, 'warehouseName')
  const startDate     = readStringParam(searchParams, 'startDate')
  const endDate       = readStringParam(searchParams, 'endDate')

  const [queryOpen, setQueryOpen] = useState(false)
  const [confirmState, setConfirmState] = useState<ConfirmState>(EMPTY_CONFIRM)
  const [printOrder,   setPrintOrder]   = useState<SaleOrder | null>(null)

  const { data, isLoading } = useSaleList({
    pageSize: 99999,
    keyword,
    remark: remark || undefined,
    operatorId: operatorId || undefined,
    status: statusFilter || undefined,
    productId: productId || undefined,
    customerId: customerId || undefined,
    warehouseId: warehouseId || undefined,
    startDate: startDate || undefined,
    endDate: endDate || undefined,
  })
  const [shortageDialog, setShortageDialog] = useState<{ orderId: number; shortages: StockShortageItem[] } | null>(null)
  const [reserveDialogOrderId, setReserveDialogOrderId] = useState<number | null>(null)
  const releaseMutate = useReleaseSale()
  const ship          = useShipSale()
  const cancel        = useCancelSale()
  const deleteMutate  = useDeleteSale()
  const navigate  = useNavigate()
  const { addTab } = useWorkspaceStore()

  function updateParams(updates: Record<string, string | number | null | undefined>) {
    setSearchParams(upsertSearchParams(searchParams, updates))
  }

  // 首次打开：无日期筛选时默认套用最近一周（打开即看本周订单；之后可自由改或清空看全部）
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
    addTab({ key: '/sale/new', title: '新建销售单', path: '/sale/new' })
    navigate('/sale/new')
  }

  function goToDetail(order: SaleOrder) {
    const key = `/sale/${order.id}`
    addTab({ key, title: order.orderNo, path: key })
    navigate(key)
  }

  function openConfirm(title: string, description: string, onConfirm: () => void) {
    setConfirmState({ open: true, title, description, onConfirm })
  }
  const closeConfirm = () => setConfirmState(s => ({ ...s, open: false }))

  async function handlePrint(id: number) {
    try {
      const res = await getSaleDetailApi(id)
      setPrintOrder(res)
    } catch {
      toast.error('获取订单详情失败，无法打印')
    }
  }

  // 导出参数（与列表当前筛选保持一致）
  const exportParams = {
    ...(keyword ? { keyword } : {}),
    ...(remark ? { remark } : {}),
    ...(operatorId ? { operatorId: String(operatorId) } : {}),
    ...(statusFilter ? { status: statusFilter } : {}),
    ...(productId ? { productId: String(productId) } : {}),
    ...(customerId ? { customerId: String(customerId) } : {}),
    ...(warehouseId ? { warehouseId: String(warehouseId) } : {}),
    ...(startDate ? { startDate } : {}),
    ...(endDate ? { endDate } : {}),
  }

  // 查询弹窗初始值
  const initialQuery: SaleQueryValues = {
    keyword, remark, operatorId, operatorName, status: statusFilter,
    productId, productCode, productName,
    customerId, customerName,
    warehouseId, warehouseName,
    startDate, endDate,
  }

  function applyQuery(v: SaleQueryValues) {
    updateParams({
      keyword: v.keyword || null,
      remark: v.remark || null,
      operatorId: v.operatorId || null,
      operatorName: v.operatorName || null,
      status: v.status || null,
      productId: v.productId || null,
      productCode: v.productCode || null,
      productName: v.productName || null,
      customerId: v.customerId || null,
      customerName: v.customerName || null,
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
      customerId: null, customerName: null,
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
    customerId && { key: 'customer', label: `客户：${customerName || customerId}`, onRemove: () => updateParams({ customerId: null, customerName: null }) },
    warehouseId && { key: 'warehouse', label: `仓库：${warehouseName || warehouseId}`, onRemove: () => updateParams({ warehouseId: null, warehouseName: null }) },
    productId && { key: 'product', label: `产品：${productName || productId}`, onRemove: () => updateParams({ productId: null, productCode: null, productName: null }) },
    // 日期筛选按需求不在主页展示，仅在查询弹窗中呈现
  ].filter(Boolean) as { key: string; label: string; onRemove: () => void }[]

  // ── 列定义 ───────────────────────────────────────────────────────────────
  const columns: TableColumn<SaleOrder>[] = [
    { key: 'orderNo',      title: '销售单号', width: 11.68 },
    { key: 'customerName', title: '客户', width: 13.79 },
    { key: 'warehouseName',title: '仓库',     width: 7.11 },
    {
      key: 'totalAmount', title: '金额', width: 5.63, align: 'right',
      render: v => <span className="font-medium tabular-nums">¥{Number(v).toFixed(2)}</span>,
    },
    { key: 'remark', title: '备注', width: 22.45, render: v => (v as string) || '-' },
    {
      key: 'status', title: '状态', width: 7.11,
      render: (_, row) => {
        const r = row as SaleOrder
        const ws = getSaleWorkflowStatus(r)
        const hasTask = r.taskNo && r.taskId
        return (
          <SoftStatusLabel
            label={ws.label}
            tone={ws.tone}
            title={ws.detail}
            onClick={hasTask ? () => navigate(`/sale/${r.id}`) : undefined}
          />
        )
      },
    },
    {
      key: 'receivableStatus', title: '回款', width: 5.63,
      render: (_, row) => {
        const r = row as SaleOrder
        if (r.receivableStatus == null) return <span className="text-xs text-muted-foreground">—</span>
        const tone: StatusTone = r.receivableOverdue
          ? 'danger'
          : r.receivableStatus === 3
            ? 'success'
            : r.receivableStatus === 2
              ? 'active'
              : 'draft'
        const label = r.receivableOverdue ? `${r.receivableStatusName}·逾期` : (r.receivableStatusName ?? '—')
        return (
          <SoftStatusLabel
            label={label}
            tone={tone}
            title={r.receivableDueDate ? `账期至 ${r.receivableDueDate.slice(0, 10)}` : undefined}
          />
        )
      },
    },
    { key: 'operatorName', title: '经办人',   width: 7.11 },
    { key: 'createdAt',    title: '创建时间', width: 11.05, render: v => formatDisplayDateTime(v) },
    {
      key: 'id', title: '操作', width: 8.44,
      render: (_, row) => {
        const r = row as SaleOrder
        return (
          <SaleRowActions
            row={r}
            anyPending={releaseMutate.isPending || ship.isPending || cancel.isPending || deleteMutate.isPending}
            onAsk={(title, desc, cb) => openConfirm(title, desc, () => { closeConfirm(); cb() })}
            onReserveSale={id => setReserveDialogOrderId(id)}
            onReleaseSale={id => releaseMutate.mutate(id)}
            onShipSale={id => ship.mutate({ id })}
            onCancelSale={id => cancel.mutate(id)}
            onDeleteSale={id => deleteMutate.mutate(id)}
            onViewTask={() => goToDetail(r)}
            onDetail={() => goToDetail(r)}
            onPrint={() => handlePrint(r.id)}
          />
        )
      },
    },
  ]

  // ── 渲染 ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {/* 页头 */}
      <PageHeader
        title="销售管理"
        description="销售单创建、确认与出库"
        actions={
          <>
            <Button variant="outline"
              onClick={() => downloadExport('/export/sale', exportParams).catch(e => toast.error((e as Error).message))}>
              导出 Excel
            </Button>
            <Button variant="outline" onClick={() => setQueryOpen(true)}>查询</Button>
            <Button onClick={goToNew}>+ 新建销售单</Button>
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

      {/* 数据表格 */}
      <DataTable
        columns={columns}
        data={data?.list ?? []}
        loading={isLoading}
        onRowDoubleClick={goToDetail}
        fluid
        columnStorageKey="sale:fluid-v1"
      />

      {/* 二次确认弹窗 */}
      <ConfirmDialog
        open={confirmState.open}
        title={confirmState.title}
        description={confirmState.description}
        variant={confirmState.title.includes('取消') ? 'destructive' : 'default'}
        confirmText={confirmState.title.includes('取消') ? '确认取消' : '确认'}
        onConfirm={confirmState.onConfirm}
        onCancel={closeConfirm}
      />

      {/* 打印预览全屏遮罩 */}
      {printOrder && (
        <PrintPreviewOverlay order={printOrder} onClose={() => setPrintOrder(null)} />
      )}

      <SaleQueryDialog
        open={queryOpen}
        initial={initialQuery}
        onClose={() => setQueryOpen(false)}
        onApply={applyQuery}
      />

      <StockShortageDialog
        open={!!shortageDialog}
        onClose={() => setShortageDialog(null)}
        orderId={shortageDialog?.orderId ?? null}
        shortages={shortageDialog?.shortages ?? []}
      />

      <ReserveAllocationDialog
        open={!!reserveDialogOrderId}
        orderId={reserveDialogOrderId}
        onClose={() => setReserveDialogOrderId(null)}
        onShortage={(orderId, shortages) => setShortageDialog({ orderId, shortages })}
      />
    </div>
  )
}
