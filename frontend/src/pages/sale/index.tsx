import { TabPathContext } from '@/components/layout/TabPathContext'
import { useContext } from 'react'
import { OrderStatusFilter } from '@/components/shared/OrderStatusFilter'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { X } from 'lucide-react'
import { downloadExport } from '@/lib/exportDownload'
import PageHeader from '@/components/shared/PageHeader'
import DataTable from '@/components/shared/DataTable'
import ListSummary from '@/components/shared/ListSummary'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { Button } from '@/components/ui/button'
import { SoftStatusLabel } from '@/components/shared/StatusBadge'
import { SaleRowActions } from './components/SaleRowActions'
import StockShortageDialog, { type StockShortageItem } from './components/StockShortageDialog'
import ReserveAllocationDialog from './components/ReserveAllocationDialog'
import SaleQueryDialog, { type SaleQueryValues } from './SaleQueryDialog'
import { useSaleList, useCancelSale, useDeleteSale } from '@/hooks/useSale'
import { getSaleDetailApi } from '@/api/sale'
import { PrintPreviewOverlay } from '@/components/print/SaleOrderPrintTemplate'
import { useWorkspaceStore } from '@/store/workspaceStore'
import { toast } from '@/lib/toast'
import { formatDisplayDateTime, defaultRangeYmds } from '@/lib/dateTime'
import { readStringParam, upsertSearchParams } from '@/lib/urlSearchParams'
import { getSaleWorkflowStatus } from '@/lib/saleWorkflowStatus'
import { getReceivableStatus } from '@/lib/receivableStatus'
import { QueryErrorState } from '@/components/shared/QueryErrorState'
import { usePermission } from '@/hooks/usePermission'
import { PERMISSIONS } from '@/lib/permission-codes'
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
const STATUS_LABELS: Record<string, string> = { '1': '待占库', '2': '已占库', '3': '执行中', '4': '已出库', '5': '已取消', '6': '部分占库' }
const QUICK_STATUSES = [
  { value: '', label: '全部订单' }, { value: '1', label: '待占库' }, { value: '6', label: '部分占库' },
  { value: '2', label: '已占库' }, { value: '3', label: '执行中' }, { value: '4', label: '已出库' },
] as const

/** 首次打开销售页时默认筛选的天数窗口（最近一周） */
const DEFAULT_RANGE_DAYS = 7
// ─── 主页面 ───────────────────────────────────────────────────────────────────

export default function SalePage() {
  const tabPath = useContext(TabPathContext)
  const [locationParams, setSearchParams] = useSearchParams()
  const searchParams = tabPath ? new URLSearchParams(tabPath.split('?')[1] || '') : locationParams

  // ── 当前生效的筛选（全部存于 URL 参数，刷新/分享可保留） ──
  const focus = readStringParam(searchParams, 'focus')
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
  // 用户没填日期时按默认窗口（最近一周）筛选。默认值在「构造查询」这一层兜底，
  // 而不是只靠下面那个只跑一次的 effect 去写 URL——否则"进入页面是否带默认窗口"取决于
  // 该页签是否已挂载过：首次打开是 7 天，之后从菜单切回来却是全部，同一个入口两种范围
  // （2026-09-16 用户确认 7 天是既定规则，这里让它在任何入口都稳定生效）。
  // range=all 是「清空」写下的显式意图（看全部），不再套默认。
  const rangeAll = searchParams.get('range') === 'all'
  const defaultRange = useMemo(() => defaultRangeYmds(DEFAULT_RANGE_DAYS), [])
  const effectiveStartDate = startDate || (rangeAll ? '' : defaultRange.start)
  const effectiveEndDate = endDate || (rangeAll ? '' : defaultRange.end)

  const { can } = usePermission()
  const [queryOpen, setQueryOpen] = useState(false)
  const [confirmState, setConfirmState] = useState<ConfirmState>(EMPTY_CONFIRM)
  const [printOrder,   setPrintOrder]   = useState<SaleOrder | null>(null)

  const PAGE_SIZE = 20
  const { data, isLoading, refetch, error } = useSaleList({
    page: 1,
    pageSize: PAGE_SIZE,
    focus: focus || undefined,
    keyword,
    remark: remark || undefined,
    operatorId: operatorId || undefined,
    status: statusFilter || undefined,
    productId: productId || undefined,
    customerId: customerId || undefined,
    warehouseId: warehouseId || undefined,
    startDate: effectiveStartDate || undefined,
    endDate: effectiveEndDate || undefined,
  })
  const total = data?.pagination?.total ?? 0
  const [shortageDialog, setShortageDialog] = useState<{ orderId: number; shortages: StockShortageItem[] } | null>(null)
  const [reserveDialogOrderId, setReserveDialogOrderId] = useState<number | null>(null)
  const cancel        = useCancelSale()
  const deleteMutate  = useDeleteSale()
  const navigate  = useNavigate()
  const { addTab } = useWorkspaceStore()

  function updateParams(updates: Record<string, string | number | null | undefined>) {
    setSearchParams(upsertSearchParams(searchParams, updates))
  }

  // 首次打开：把默认窗口写进 URL（便于分享与回看）。这只是让 URL 反映筛选，
  // 真正的筛选兜底在构造查询处——所以即使这个 effect 没跑（页签已挂载），范围也一致。
  useEffect(() => {
    if (!startDate && !endDate && searchParams.get('range') !== 'all') {
      setSearchParams(upsertSearchParams(searchParams, { startDate: defaultRange.start, endDate: defaultRange.end }), { replace: true })
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
    ...(focus ? {focus} : {}),
    ...(keyword ? { keyword } : {}),
    ...(remark ? { remark } : {}),
    ...(operatorId ? { operatorId: String(operatorId) } : {}),
    ...(statusFilter ? { status: statusFilter } : {}),
    ...(productId ? { productId: String(productId) } : {}),
    ...(customerId ? { customerId: String(customerId) } : {}),
    ...(warehouseId ? { warehouseId: String(warehouseId) } : {}),
    ...(effectiveStartDate ? { startDate: effectiveStartDate } : {}),
    ...(effectiveEndDate ? { endDate: effectiveEndDate } : {}),
  }

  // 查询弹窗初始值：日期用「当前实际生效」的范围（含默认窗口），用户打开就能看见
  const initialQuery: SaleQueryValues = {
    keyword, remark, operatorId, operatorName, status: statusFilter,
    productId, productCode, productName,
    customerId, customerName,
    warehouseId, warehouseName,
    startDate: effectiveStartDate, endDate: effectiveEndDate,
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
      // 弹窗里清空日期＝明确要看全部；设了日期则清掉 range 标记
      range: (!v.startDate && !v.endDate) ? 'all' : null,
      page: 1, // 筛选变化回到第一页
    })
    setQueryOpen(false)
  }

  function clearAll() {
    updateParams({
      focus:null, keyword: null, remark: null, operatorId: null, operatorName: null, status: null,
      productId: null, productCode: null, productName: null,
      customerId: null, customerName: null,
      warehouseId: null, warehouseName: null,
      startDate: null, endDate: null,
      // 显式声明「看全部」：否则「没有日期」会被默认窗口接管，清空之后又只剩最近一周
      range: 'all',
      page: 1,
    })
  }

  // 当前生效筛选摘要（可逐项移除）
  const chips = [
    focus && {key:'focus',label:'优先待办排序',onRemove:()=>updateParams({focus:null,page:1})},
    keyword && { key: 'keyword', label: `单号：${keyword}`, onRemove: () => updateParams({ keyword: null, page: 1 }) },
    remark && { key: 'remark', label: `备注：${remark}`, onRemove: () => updateParams({ remark: null, page: 1 }) },
    operatorId && { key: 'operator', label: `经办人：${operatorName || operatorId}`, onRemove: () => updateParams({ operatorId: null, operatorName: null, page: 1 }) },
    statusFilter && !QUICK_STATUSES.some(item => item.value === statusFilter) && { key: 'status', label: `状态：${STATUS_LABELS[statusFilter] ?? statusFilter}`, onRemove: () => updateParams({ status: null, page: 1 }) },
    customerId && { key: 'customer', label: `客户：${customerName || customerId}`, onRemove: () => updateParams({ customerId: null, customerName: null, page: 1 }) },
    warehouseId && { key: 'warehouse', label: `仓库：${warehouseName || warehouseId}`, onRemove: () => updateParams({ warehouseId: null, warehouseName: null, page: 1 }) },
    productId && { key: 'product', label: `商品：${productName || productId}`, onRemove: () => updateParams({ productId: null, productCode: null, productName: null, page: 1 }) },
    // 日期筛选在查询弹窗中呈现
  ].filter(Boolean) as { key: string; label: string; onRemove: () => void }[]

  // ── 列定义 ───────────────────────────────────────────────────────────────
  const columns: TableColumn<SaleOrder>[] = [
    { key: 'orderNo', title: '销售单号', width: 14, render: v => <span className="whitespace-nowrap">{String(v ?? '')}</span> },
    { key: 'customerName', title: '客户', width: 14 },
    { key: 'warehouseName', title: '仓库', width: 8 },
    { key: 'totalAmount', title: '折后金额', width: 10, align: 'right', render: (_, r) => <span className="font-medium tabular-nums whitespace-nowrap">¥{Math.max(0, r.totalAmount - (r.discountAmount ?? 0)).toFixed(2)}</span> },
    { key: 'remark', title: '备注', width: 15, render: v => (v as string) || '—' },
    { key: 'status', title: '状态', width: 8, render: (_, r) => { const ws = getSaleWorkflowStatus(r); return <SoftStatusLabel label={ws.label} tone={ws.tone} title={ws.detail} onClick={r.taskNo && r.taskId ? () => goToDetail(r) : undefined} /> } },
    { key: 'receivableStatus', title: '回款状态', width: 8, render: (_, r) => { const rs = getReceivableStatus(r); return <SoftStatusLabel label={rs.label} tone={rs.tone} title={rs.dueDate ? `账期至 ${rs.dueDate.slice(0, 10)}` : undefined} /> } },
    { key: 'operatorName', title: '经办人', width: 7 },
    { key: 'createdAt', title: '创建时间', width: 10, render: v => formatDisplayDateTime(v) },
    { key:'id', title:'操作', width:10, render:(_,r) => <SaleRowActions row={r} anyPending={cancel.isPending || deleteMutate.isPending}
        onAsk={(title,desc,cb)=>openConfirm(title,desc,()=>{closeConfirm();cb()})}
        onReserveSale={setReserveDialogOrderId} onCancelSale={id=>cancel.mutate(id)} onDeleteSale={id=>deleteMutate.mutate(id)}
        onViewTask={()=>goToDetail(r)} onDetail={()=>goToDetail(r)} onPrint={()=>handlePrint(r.id)} /> },
  ]

  // ── 渲染 ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {/* 页头 */}
      <PageHeader
        title="销售订单"
        description="销售单创建、占库与出库"
        actions={
          <>
            <Button variant="outline"
              onClick={() => downloadExport('/export/sale', exportParams).catch(e => toast.error((e as Error).message))}>
              导出 Excel
            </Button>
            <Button variant="outline" onClick={() => setQueryOpen(true)}>查询</Button>
            {can(PERMISSIONS.SALE_ORDER_CREATE) && <Button onClick={goToNew}>+ 新建销售单</Button>}
          </>
        }
      />

      <OrderStatusFilter label="销售状态分类" value={statusFilter}
        options={QUICK_STATUSES}
        onChange={status => updateParams({status: status || null, page: 1})} />

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

      {error ? <QueryErrorState error={error} onRetry={()=>void refetch()} /> : <DataTable virtualized
        columns={columns}
        data={data?.list ?? []}
        loading={isLoading}
        onRowDoubleClick={goToDetail}
        fluid
        columnStorageKey="sale:classic-v5"
      />}

      <ListSummary total={total} unit="单" />

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
