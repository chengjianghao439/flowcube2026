import { RecordIdentity } from '@/components/shared/RecordIdentity'
import { useEffect, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { X } from 'lucide-react'
import PageHeader from '@/components/shared/PageHeader'
import DataTable from '@/components/shared/DataTable'
import Pagination from '@/components/shared/Pagination'
import { Button } from '@/components/ui/button'
import TableActionsMenu from '@/components/shared/TableActionsMenu'
import { SoftStatusLabel } from '@/components/shared/StatusBadge'
import { getPurchaseReturnsApi, confirmPurchaseReturnApi, cancelPurchaseReturnApi, getSaleReturnsApi, confirmSaleReturnApi, cancelSaleReturnApi } from '@/api/returns'
import { downloadExport } from '@/lib/exportDownload'
import { OrderPrintOverlay } from '@/components/print/OrderPrintOverlay'
import { mapReturnOrderToPrint } from '@/lib/orderPrintData'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { toast } from '@/lib/toast'
import { useWorkspaceStore } from '@/store/workspaceStore'
import { formatDisplayDateTime } from '@/lib/dateTime'
import { readStringParam, upsertSearchParams } from '@/lib/urlSearchParams'
import ReturnQueryDialog, { type ReturnQueryValues } from './ReturnQueryDialog'
import type { PurchaseReturn, SaleReturn } from '@/api/returns'
import type { TableColumn } from '@/types'

type RowType = PurchaseReturn | SaleReturn
type ReturnType = 'purchase' | 'sale'

const STATUS_LABELS: Record<string, string> = { '1': '草稿', '2': '已确认', '3': '已执行', '4': '已取消' }

/** 首次打开退货页时默认筛选的天数窗口（最近一周） */
const DEFAULT_RANGE_DAYS = 7
function toYmd(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export default function ReturnsPage() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const location = useLocation()
  const { addTab } = useWorkspaceStore()
  const [searchParams, setSearchParams] = useSearchParams()

  /**
   * 退货类型由路由决定：/returns/purchase 与 /returns/sale 分别挂在「采购」「销售」菜单下，
   * 各自是独立的工作区标签（筛选互不干扰）。旧地址 /returns 经 alias 落到采购退货。
   */
  const type: ReturnType = location.pathname.startsWith('/returns/sale') ? 'sale' : 'purchase'
  const partyLabel = type === 'purchase' ? '供应商' : '客户'

  const [queryOpen, setQueryOpen] = useState(false)
  const [confirmState, setConfirmState] = useState<{ open: boolean; title: string; description: string; onConfirm: () => void }>({ open: false, title: '', description: '', onConfirm: () => {} })
  const openConfirm = (title: string, description: string, onConfirm: () => void) => setConfirmState({ open: true, title, description, onConfirm })
  const closeConfirm = () => setConfirmState(s => ({ ...s, open: false }))
  const [pendingId, setPendingId] = useState<number | null>(null)
  const [printTarget, setPrintTarget] = useState<RowType | null>(null)

  // ── 当前生效的筛选（全部存于 URL 参数，刷新/分享可保留） ──
  const keyword       = readStringParam(searchParams, 'keyword')
  const remark        = readStringParam(searchParams, 'remark')
  const operatorId    = Number(searchParams.get('operatorId') || '') || null
  const operatorName  = readStringParam(searchParams, 'operatorName')
  const statusFilter  = readStringParam(searchParams, 'status')
  const productId     = Number(searchParams.get('productId') || '') || null
  const productCode   = readStringParam(searchParams, 'productCode')
  const productName   = readStringParam(searchParams, 'productName')
  const partyId       = Number(searchParams.get('partyId') || '') || null
  const partyName     = readStringParam(searchParams, 'partyName')
  const warehouseId   = Number(searchParams.get('warehouseId') || '') || null
  const warehouseName = readStringParam(searchParams, 'warehouseName')
  const startDate     = readStringParam(searchParams, 'startDate')
  const endDate       = readStringParam(searchParams, 'endDate')
  const page          = Math.max(1, Number(searchParams.get('page') || '1') || 1)

  const apiList   = type === 'purchase' ? getPurchaseReturnsApi : getSaleReturnsApi
  const confirmFn = type === 'purchase' ? confirmPurchaseReturnApi : confirmSaleReturnApi
  const cancelFn  = type === 'purchase' ? cancelPurchaseReturnApi : cancelSaleReturnApi
  const partyParamKey = type === 'purchase' ? 'supplierId' : 'customerId'

  const PAGE_SIZE = 20
  const { data, isLoading } = useQuery({
    queryKey: ['returns', type, { keyword, remark, operatorId, statusFilter, productId, partyId, warehouseId, startDate, endDate, page }],
    queryFn: () => apiList({
      page,
      pageSize: PAGE_SIZE,
      keyword,
      remark: remark || undefined,
      operatorId: operatorId || undefined,
      status: statusFilter || undefined,
      productId: productId || undefined,
      [partyParamKey]: partyId || undefined,
      warehouseId: warehouseId || undefined,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
    }).then(r => r!),
  })
  const total = data?.pagination?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const inv = () => qc.invalidateQueries({ queryKey: ['returns', type] })
  const partyKey = type === 'purchase' ? 'supplierName' : 'customerName'

  const mut = (fn: () => Promise<unknown>, id?: number) => {
    if (id) setPendingId(id)
    fn()
      .then(inv)
      .catch(() => { /* 失败已由全局拦截器弹 toast，这里吞掉避免 unhandledrejection */ })
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
    const path = `/returns/${type}/new`
    addTab({ key: path, title: type === 'purchase' ? '新建采购退货单' : '新建销售退货单', path })
    navigate(path)
  }
  function goToDetail(row: RowType) {
    const path = `/returns/${type}/${row.id}`
    addTab({ key: path, title: row.returnNo, path })
    navigate(path)
  }

  // 导出参数（与列表当前筛选保持一致）
  const exportParams = {
    ...(keyword ? { keyword } : {}),
    ...(remark ? { remark } : {}),
    ...(operatorId ? { operatorId: String(operatorId) } : {}),
    ...(statusFilter ? { status: statusFilter } : {}),
    ...(productId ? { productId: String(productId) } : {}),
    ...(partyId ? { [partyParamKey]: String(partyId) } : {}),
    ...(warehouseId ? { warehouseId: String(warehouseId) } : {}),
    ...(startDate ? { startDate } : {}),
    ...(endDate ? { endDate } : {}),
  }

  // 查询弹窗初始值
  const initialQuery: ReturnQueryValues = {
    keyword, remark, operatorId, operatorName, status: statusFilter,
    productId, productCode, productName,
    partyId, partyName,
    warehouseId, warehouseName,
    startDate, endDate,
  }

  function applyQuery(v: ReturnQueryValues) {
    updateParams({
      keyword: v.keyword || null,
      remark: v.remark || null,
      operatorId: v.operatorId || null,
      operatorName: v.operatorName || null,
      status: v.status || null,
      productId: v.productId || null,
      productCode: v.productCode || null,
      productName: v.productName || null,
      partyId: v.partyId || null,
      partyName: v.partyName || null,
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
      keyword: null, remark: null, operatorId: null, operatorName: null, status: null,
      productId: null, productCode: null, productName: null,
      partyId: null, partyName: null,
      warehouseId: null, warehouseName: null,
      startDate: null, endDate: null,
      page: 1,
    })
  }

  // 当前生效筛选摘要（可逐项移除）
  const chips = [
    keyword && { key: 'keyword', label: `单号：${keyword}`, onRemove: () => updateParams({ keyword: null, page: 1 }) },
    remark && { key: 'remark', label: `备注：${remark}`, onRemove: () => updateParams({ remark: null, page: 1 }) },
    operatorId && { key: 'operator', label: `经办人：${operatorName || operatorId}`, onRemove: () => updateParams({ operatorId: null, operatorName: null, page: 1 }) },
    statusFilter && { key: 'status', label: `状态：${STATUS_LABELS[statusFilter] ?? statusFilter}`, onRemove: () => updateParams({ status: null, page: 1 }) },
    partyId && { key: 'party', label: `${partyLabel}：${partyName || partyId}`, onRemove: () => updateParams({ partyId: null, partyName: null, page: 1 }) },
    warehouseId && { key: 'warehouse', label: `仓库：${warehouseName || warehouseId}`, onRemove: () => updateParams({ warehouseId: null, warehouseName: null, page: 1 }) },
    productId && { key: 'product', label: `商品：${productName || productId}`, onRemove: () => updateParams({ productId: null, productCode: null, productName: null, page: 1 }) },
  ].filter(Boolean) as { key: string; label: string; onRemove: () => void }[]

  const columns: TableColumn<RowType>[] = [
    { key: 'returnNo', title: type === 'sale' ? '退货单 / 创建时间' : '退货单号', width: type === 'sale' ? 240 : 170, render: (v, row) => type === 'sale' ? <RecordIdentity title={String(v)} detail={formatDisplayDateTime(row.createdAt)} /> : String(v) },
    { key: partyKey, title: partyLabel, width: 140 },
    { key: 'warehouseName', title: '仓库', width: 140 },
    { key: 'totalAmount', title: '金额', width: 100, align: 'right', render: (v) => <span className="tabular-nums">¥{Number(v).toFixed(2)}</span> },
    { key: 'status', title: '状态', width: 90, render: (v, row) => {
      const status = v as number
      const tone = status === 3 ? 'success' : status === 4 ? 'danger' : status === 1 ? 'draft' : 'active'
      return <SoftStatusLabel label={(row as RowType).statusName} tone={tone} />
    } },
    { key: 'operatorName', title: '经办人', width: 90 },
    ...(type === 'purchase' ? [{ key: 'createdAt', title: '时间', width: 160, render: (v: unknown) => formatDisplayDateTime(v) } satisfies TableColumn<RowType>] : []),
    {
      key: 'remark', title: '备注', width: 200,
      render: (v) => v
        ? <span className="line-clamp-1 text-muted-foreground" title={String(v)}>{String(v)}</span>
        : <span className="text-muted-foreground/50">—</span>
    },
    { key: 'id', title: '操作', width: 140, render: (_, row) => {
      const r = row as RowType
      return (
        <TableActionsMenu
          primaryLabel="详情"
          primaryVariant="outline"
          onPrimaryClick={() => goToDetail(r)}
          items={[
            ...(r.status === 1 ? [{
              label: pendingId === r.id ? '处理中…' : '确认',
              onClick: () => mut(() => confirmFn(r.id), r.id),
              disabled: pendingId === r.id,
            }] : []),
            { label: '打印', onClick: () => setPrintTarget(r) },
            ...((r.status === 1 || r.status === 2) ? [{
              label: pendingId === r.id ? '处理中…' : '取消',
              onClick: () => openConfirm('取消退货单', '确认取消此退货单？', () => mut(() => cancelFn(r.id), r.id)),
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
      <PageHeader
        title={type === 'purchase' ? '采购退货' : '销售退货'}
        description={type === 'purchase' ? '退回供应商，出库减少库存' : '查看退货单、收货与质检进度；上架完成后更新库存和应收。'}
        actions={
          <>
            <Button variant="outline"
              onClick={() => downloadExport(type === 'purchase' ? '/export/purchase-returns' : '/export/sale-returns', exportParams).catch(e => toast.error((e as Error).message))}>
              导出 Excel
            </Button>
            <Button variant="outline" onClick={() => setQueryOpen(true)}>查询</Button>
            <Button onClick={goToNew}>+ 新建{type === 'purchase' ? '采购' : '销售'}退货单</Button>
          </>
        }
      />

      {type === 'sale' && <div className="flex items-center justify-between rounded-lg border bg-card px-4 py-3 text-sm"><span className="text-muted-foreground">创建日期：{startDate || '不限'} 至 {endDate || '不限'}</span><span className="text-xs text-muted-foreground">共 {total.toLocaleString()} 张退货单</span></div>}
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

      <DataTable columns={columns} data={(data?.list || []) as RowType[]} loading={isLoading} onRowDoubleClick={goToDetail} />

      {/* 分页 */}
      <Pagination page={page} totalPages={totalPages} total={total} unit="单"
        onPageChange={(p) => updateParams({ page: p })} />

      <ConfirmDialog
        open={confirmState.open}
        title={confirmState.title}
        description={confirmState.description}
        variant={confirmState.title.includes('取消') ? 'destructive' : 'default'}
        confirmText={confirmState.title.includes('取消') ? '确认取消' : '确认'}
        onConfirm={() => { closeConfirm(); confirmState.onConfirm() }}
        onCancel={closeConfirm}
      />

      {printTarget && (
        <OrderPrintOverlay
          templateType={3}
          title={printTarget.returnNo}
          {...mapReturnOrderToPrint({ ...printTarget, type })}
          onClose={() => setPrintTarget(null)}
        />
      )}

      <ReturnQueryDialog
        open={queryOpen}
        type={type}
        initial={initialQuery}
        onClose={() => setQueryOpen(false)}
        onApply={applyQuery}
      />
    </div>
  )
}
