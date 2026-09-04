import { useEffect, useState, lazy, Suspense } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { CalendarDays, Download, Plus, RefreshCw, Search, SlidersHorizontal, X } from 'lucide-react'
import { downloadExport } from '@/lib/exportDownload'
import PageHeader from '@/components/shared/PageHeader'
import DataTable from '@/components/shared/DataTable'
import Pagination from '@/components/shared/Pagination'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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
import { formatDisplayDateTime, formatDisplayDate } from '@/lib/dateTime'
import { readStringParam, upsertSearchParams } from '@/lib/urlSearchParams'
import { getSaleWorkflowStatus } from '@/lib/saleWorkflowStatus'
import { getReceivableStatus } from '@/lib/receivableStatus'
import { getSaleAttention } from '@/lib/salePresentation'
import { QueryErrorState } from '@/components/shared/QueryErrorState'
import { usePermission } from '@/hooks/usePermission'
import { PERMISSIONS } from '@/lib/permission-codes'
import type { SaleOrder } from '@/types/sale'
import type { TableColumn } from '@/types'

const SaleOrderPreview = lazy(() => import('./components/SaleOrderPreview'))

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
  const [searchParams, setSearchParams] = useSearchParams()

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
  const page          = Math.max(1, Number(searchParams.get('page') || '1') || 1)

  const [previewId, setPreviewId] = useState<number | null>(null)
  const [compact, setCompact] = useState(() => { try { return localStorage.getItem('flowcube:sale-density') !== 'comfortable' } catch { return true } })
  const { can } = usePermission()
  function changeDensity(value: boolean) { setCompact(value); try { localStorage.setItem('flowcube:sale-density', value ? 'compact' : 'comfortable') } catch { /* 存储不可用不阻断切换 */ } }
  const [queryOpen, setQueryOpen] = useState(false)
  const [quickKeyword, setQuickKeyword] = useState(keyword)
  const [confirmState, setConfirmState] = useState<ConfirmState>(EMPTY_CONFIRM)
  const [printOrder,   setPrintOrder]   = useState<SaleOrder | null>(null)

  const PAGE_SIZE = 20
  const { data, isLoading, isFetching, refetch, error } = useSaleList({
    page,
    pageSize: PAGE_SIZE,
    focus: focus || undefined,
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
  const total = data?.pagination?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const [shortageDialog, setShortageDialog] = useState<{ orderId: number; shortages: StockShortageItem[] } | null>(null)
  const [reserveDialogOrderId, setReserveDialogOrderId] = useState<number | null>(null)
  const cancel        = useCancelSale()
  const deleteMutate  = useDeleteSale()
  const navigate  = useNavigate()
  const { addTab } = useWorkspaceStore()

  function updateParams(updates: Record<string, string | number | null | undefined>) {
    setSearchParams(upsertSearchParams(searchParams, updates))
  }

  // 首次打开：无日期筛选时默认套用最近一周（打开即看本周订单；之后可自由改或清空看全部）
  useEffect(() => {
    if (!startDate && !endDate && searchParams.get('range') !== 'all') {
      const end = new Date()
      const start = new Date()
      start.setTime(end.getTime() - (DEFAULT_RANGE_DAYS - 1) * 86400000)
      setSearchParams(upsertSearchParams(searchParams, { startDate: formatDisplayDate(start), endDate: formatDisplayDate(end) }), { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => setQuickKeyword(keyword), [keyword])

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
      page: 1,
    })
  }
  function submitQuickSearch() { updateParams({ keyword: quickKeyword.trim() || null, page: 1 }) }

  // 当前生效筛选摘要（可逐项移除）
  const chips = [
    focus && {key:'focus',label:'优先待办排序',onRemove:()=>updateParams({focus:null,page:1})},
    keyword && { key: 'keyword', label: `单号：${keyword}`, onRemove: () => updateParams({ keyword: null, page: 1 }) },
    remark && { key: 'remark', label: `备注：${remark}`, onRemove: () => updateParams({ remark: null, page: 1 }) },
    operatorId && { key: 'operator', label: `经办人：${operatorName || operatorId}`, onRemove: () => updateParams({ operatorId: null, operatorName: null, page: 1 }) },
    statusFilter && { key: 'status', label: `状态：${STATUS_LABELS[statusFilter] ?? statusFilter}`, onRemove: () => updateParams({ status: null, page: 1 }) },
    customerId && { key: 'customer', label: `客户：${customerName || customerId}`, onRemove: () => updateParams({ customerId: null, customerName: null, page: 1 }) },
    warehouseId && { key: 'warehouse', label: `仓库：${warehouseName || warehouseId}`, onRemove: () => updateParams({ warehouseId: null, warehouseName: null, page: 1 }) },
    productId && { key: 'product', label: `商品：${productName || productId}`, onRemove: () => updateParams({ productId: null, productCode: null, productName: null, page: 1 }) },
    // 日期筛选按需求不在主页展示，仅在查询弹窗中呈现
  ].filter(Boolean) as { key: string; label: string; onRemove: () => void }[]

  // ── 列定义 ───────────────────────────────────────────────────────────────
  const columns: TableColumn<SaleOrder>[] = [
    { key:'orderNo', title:'订单号 / 创建时间', width:17, render:(_,r) => <div><button className="font-medium text-primary hover:underline focus-visible:ring-2 focus-visible:ring-primary" onClick={() => setPreviewId(r.id)}>{r.orderNo}</button><p className="mt-1 text-xs text-muted-foreground">{formatDisplayDateTime(r.createdAt)} · {r.operatorName}</p></div> },
    { key:'customerName', title:'客户 / 仓库', width:17, render:(_,r) => <div><p className="truncate font-medium" title={r.customerName}>{r.customerName}</p><p className="mt-1 text-xs text-muted-foreground">{r.warehouseName}{r.isMultiWarehouse ? ' · 多仓' : ''}</p></div> },
    { key:'totalAmount', title:'折后金额', width:10, align:'right', render:(_,r) => <span className="font-medium tabular-nums">¥{Math.max(0,r.totalAmount-(r.discountAmount ?? 0)).toFixed(2)}</span> },
    { key:'status', title:'履约状态', width:9, render:(_,r) => {const ws=getSaleWorkflowStatus(r); return <SoftStatusLabel label={ws.label} tone={ws.tone} title={ws.detail} />} },
    { key:'quantitySummary', title:'已占 / 已派发 / 已出库', width:17, render:(_,r) => <div className="space-y-1 text-xs tabular-nums">{r.quantitySummary?.length ? r.quantitySummary.map(q => <div key={q.unit}><p>占 {q.reserved}　派 {q.dispatched}　出 {q.shipped}</p><p className="mt-1 text-muted-foreground">订单 {q.ordered} {q.unit}</p></div>) : '—'}</div> },
    { key:'pendingAdjustment', title:'当前关注', width:12, render:(_,r) => {const a=getSaleAttention(r);return <div title={r.remark || a.label}>{a.label ? <SoftStatusLabel label={a.label} tone={a.tone}/> : <span className="text-muted-foreground">—</span>}{r.remark && <p className="mt-1 truncate text-xs text-muted-foreground">{r.remark}</p>}</div>} },
    { key:'receivableStatus',title:'回款状态',width:8,render:(_,r)=>{const rs=getReceivableStatus(r);return <SoftStatusLabel label={rs.label} tone={rs.tone}/>}},
    { key:'id', title:'操作', width:10, render:(_,r) => <SaleRowActions row={r} anyPending={cancel.isPending || deleteMutate.isPending}
        onAsk={(title,desc,cb)=>openConfirm(title,desc,()=>{closeConfirm();cb()})}
        onReserveSale={setReserveDialogOrderId} onCancelSale={id=>cancel.mutate(id)} onDeleteSale={id=>deleteMutate.mutate(id)}
        onViewTask={()=>setPreviewId(r.id)} onDetail={()=>goToDetail(r)} onPrint={()=>handlePrint(r.id)} /> },
  ]

  // ── 渲染 ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">
      {/* 页头 */}
      <PageHeader
        title="销售订单"
        description="先看订单卡在哪里，再处理下一步。点击订单号可快速预览。"
        actions={
          <>
            <Button variant="outline" className="hidden sm:inline-flex"
              onClick={() => downloadExport('/export/sale', exportParams).catch(e => toast.error((e as Error).message))}>
              <Download className="h-4 w-4" /> 导出
            </Button>
            {can(PERMISSIONS.SALE_ORDER_CREATE) && <Button onClick={goToNew}><Plus className="h-4 w-4" /> 新建销售单</Button>}
          </>
        }
      />

      <section className="overflow-hidden rounded-xl border border-border bg-card" aria-label="销售订单筛选">
        <div className="flex flex-col gap-4 border-b border-border px-4 py-4">
          <div className="flex min-w-0 flex-wrap items-center gap-2 border-b border-border pb-3">
            {QUICK_STATUSES.map(item => (
              <button key={item.value || 'all'} type="button" aria-pressed={statusFilter === item.value}
                onClick={() => updateParams({ status: item.value || null, page: 1 })}
                className={`min-h-8 rounded-md px-3 text-sm font-medium transition-[background-color,color,box-shadow] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${statusFilter === item.value ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-background/60 hover:text-foreground'}`}>
                {item.label}<span className="ml-1.5 text-xs tabular-nums">{data?.statusCounts ? (item.value ? data.statusCounts[item.value] ?? 0 : Object.values(data.statusCounts).reduce((a,b)=>a+b,0)) : '—'}</span>
              </button>
            ))}
          </div>
          <div className="flex w-full items-center gap-2 xl:w-auto">
            <div className="relative min-w-0 flex-1 xl:w-72 xl:flex-none">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={quickKeyword} onChange={event => setQuickKeyword(event.target.value)}
                onKeyDown={event => { if (event.key === 'Enter') submitQuickSearch() }} placeholder="搜索销售单号" aria-label="搜索销售单号" className="pl-9 pr-16" />
              <button type="button" onClick={submitQuickSearch} className="absolute right-1.5 top-1/2 min-h-7 -translate-y-1/2 rounded px-2 text-xs font-medium text-primary hover:bg-primary/10">搜索</button>
            </div>
            <Button variant="outline" onClick={() => setQueryOpen(true)}><SlidersHorizontal className="h-4 w-4" /><span className="hidden sm:inline">高级查询</span></Button>
            <div className="ml-auto hidden items-center gap-1 sm:flex" aria-label="表格密度"><Button size="sm" variant={!compact?'secondary':'ghost'} aria-pressed={!compact} onClick={()=>changeDensity(false)}>舒适</Button><Button size="sm" variant={compact?'secondary':'ghost'} aria-pressed={compact} onClick={()=>changeDensity(true)}>紧凑</Button></div>
            <Button variant="ghost" size="icon" onClick={() => void refetch()} aria-label="刷新订单" title="刷新订单"><RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} /></Button>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 bg-muted/20 px-4 py-2.5 text-xs text-muted-foreground">
          <span>共 <strong className="font-semibold tabular-nums text-foreground">{total}</strong> 张订单{statusFilter ? ` · ${STATUS_LABELS[statusFilter] ?? statusFilter}` : ''}</span>
          {(startDate || endDate) && <span className="inline-flex items-center gap-1.5"><CalendarDays className="h-3.5 w-3.5" />{startDate || '不限'} 至 {endDate || '不限'}</span>}
        </div>
      </section>

      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/20 px-3 py-2">
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

      {error ? <QueryErrorState error={error} onRetry={()=>void refetch()} /> : <div className={compact ? '[&_tbody_td]:!py-2 [&_table]:min-w-[1180px]' : '[&_tbody_td]:!py-4 [&_table]:min-w-[1180px]'}><DataTable
        columns={columns}
        data={data?.list ?? []}
        loading={isLoading}
        onRowDoubleClick={goToDetail}
        selectedIds={previewId != null ? new Set([previewId]) : undefined}
        fluid
        columnStorageKey="sale:fluid-v2"
      /></div>}

      {/* 分页 */}
      <Pagination page={page} totalPages={totalPages} total={total} unit="单"
        onPageChange={(p) => updateParams({ page: p })} />

      <p className="text-xs text-muted-foreground">数量按基本单位分别展示。未占量不等于缺货；待实物归还期间，已占量可暂高于改单目标。</p>
      {previewId != null && <Suspense fallback={null}><SaleOrderPreview id={previewId} navigation={{ids:(data?.list ?? []).map(r=>r.id),onSelect:setPreviewId}} onClose={()=>setPreviewId(null)} onDetail={goToDetail} onReserve={setReserveDialogOrderId}/></Suspense>}
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
