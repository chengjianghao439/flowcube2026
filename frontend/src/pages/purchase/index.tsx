import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { X } from 'lucide-react'
import PageHeader from '@/components/shared/PageHeader'
import DataTable from '@/components/shared/DataTable'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { Button } from '@/components/ui/button'
import TableActionsMenu from '@/components/shared/TableActionsMenu'
import { usePurchaseList, useConfirmPurchase, useCancelPurchase, useClosePurchase, usePurchaseDetail } from '@/hooks/usePurchase'
import { OrderPrintOverlay } from '@/components/print/OrderPrintOverlay'
import { mapPurchaseOrderToPrint } from '@/lib/orderPrintData'
import { downloadExport } from '@/lib/exportDownload'
import { formatDisplayDateTime } from '@/lib/dateTime'
import { useWorkspaceStore } from '@/store/workspaceStore'
import { toast } from '@/lib/toast'
import { readStringParam, upsertSearchParams } from '@/lib/urlSearchParams'
import PurchaseQueryDialog, { type PurchaseQueryValues } from './PurchaseQueryDialog'
import type { PurchaseOrder } from '@/types/purchase'
import type { TableColumn } from '@/types'

const STATUS_LABELS: Record<string, string> = { '1': '草稿', '2': '已提交', '3': '已完成', '4': '已取消' }

/** 首次打开采购页时默认筛选的天数窗口（最近一周） */
const DEFAULT_RANGE_DAYS = 7
function toYmd(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export default function PurchasePage() {
  const navigate   = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { addTab } = useWorkspaceStore()

  const [queryOpen, setQueryOpen] = useState(false)
  const [printId, setPrintId]     = useState<number | null>(null)

  function goToNew() {
    addTab({ key: '/purchase/new', title: '新建采购单', path: '/purchase/new' })
    navigate('/purchase/new')
  }

  function goToDetail(order: PurchaseOrder) {
    const key = `/purchase/${order.id}`
    addTab({ key, title: order.orderNo, path: key })
    navigate(key)
  }

  // ── 当前生效的筛选（全部存于 URL 参数，刷新/分享可保留） ──
  const keyword       = readStringParam(searchParams, 'keyword')
  const remark        = readStringParam(searchParams, 'remark')
  const operator      = readStringParam(searchParams, 'operator')
  const statusFilter  = readStringParam(searchParams, 'status')
  const productId     = Number(searchParams.get('productId') || '') || null
  const productCode   = readStringParam(searchParams, 'productCode')
  const productName   = readStringParam(searchParams, 'productName')
  const supplierId    = Number(searchParams.get('supplierId') || '') || null
  const supplierName  = readStringParam(searchParams, 'supplierName')
  const warehouseId   = Number(searchParams.get('warehouseId') || '') || null
  const warehouseName = readStringParam(searchParams, 'warehouseName')
  const startDate     = readStringParam(searchParams, 'startDate')
  const endDate       = readStringParam(searchParams, 'endDate')

  const [confirmState, setConfirmState] = useState<{
    open: boolean
    title: string
    description: string
    confirmText?: string
    variant?: 'default' | 'destructive'
    onConfirm: () => void
  }>({ open: false, title: '', description: '', onConfirm: () => {} })

  const { data, isLoading } = usePurchaseList({
    pageSize: 99999,
    keyword,
    remark: remark || undefined,
    operator: operator || undefined,
    status: statusFilter || undefined,
    productId: productId || undefined,
    supplierId: supplierId || undefined,
    warehouseId: warehouseId || undefined,
    startDate: startDate || undefined,
    endDate: endDate || undefined,
  })
  const confirm = useConfirmPurchase()
  const cancel = useCancelPurchase()
  const close = useClosePurchase()
  const { data: printDetail } = usePurchaseDetail(printId || 0)

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

  function openConfirm(
    title: string,
    description: string,
    onConfirm: () => void,
    options?: { confirmText?: string; variant?: 'default' | 'destructive' },
  ) {
    setConfirmState({ open: true, title, description, onConfirm, confirmText: options?.confirmText, variant: options?.variant })
  }
  function closeConfirm() {
    setConfirmState(s => ({ ...s, open: false }))
  }

  // 导出参数（与列表当前筛选保持一致）
  const exportParams = {
    ...(keyword ? { keyword } : {}),
    ...(remark ? { remark } : {}),
    ...(operator ? { operator } : {}),
    ...(statusFilter ? { status: statusFilter } : {}),
    ...(productId ? { productId: String(productId) } : {}),
    ...(supplierId ? { supplierId: String(supplierId) } : {}),
    ...(warehouseId ? { warehouseId: String(warehouseId) } : {}),
    ...(startDate ? { startDate } : {}),
    ...(endDate ? { endDate } : {}),
  }

  // 查询弹窗初始值
  const initialQuery: PurchaseQueryValues = {
    keyword, remark, operator, status: statusFilter,
    productId, productCode, productName,
    supplierId, supplierName,
    warehouseId, warehouseName,
    startDate, endDate,
  }

  function applyQuery(v: PurchaseQueryValues) {
    updateParams({
      keyword: v.keyword || null,
      remark: v.remark || null,
      operator: v.operator || null,
      status: v.status || null,
      productId: v.productId || null,
      productCode: v.productCode || null,
      productName: v.productName || null,
      supplierId: v.supplierId || null,
      supplierName: v.supplierName || null,
      warehouseId: v.warehouseId || null,
      warehouseName: v.warehouseName || null,
      startDate: v.startDate || null,
      endDate: v.endDate || null,
    })
    setQueryOpen(false)
  }

  function clearAll() {
    updateParams({
      keyword: null, remark: null, operator: null, status: null,
      productId: null, productCode: null, productName: null,
      supplierId: null, supplierName: null,
      warehouseId: null, warehouseName: null,
      startDate: null, endDate: null,
    })
  }

  // 当前生效筛选摘要（可逐项移除）
  const chips = [
    keyword && { key: 'keyword', label: `单号：${keyword}`, onRemove: () => updateParams({ keyword: null }) },
    remark && { key: 'remark', label: `备注：${remark}`, onRemove: () => updateParams({ remark: null }) },
    operator && { key: 'operator', label: `经办人：${operator}`, onRemove: () => updateParams({ operator: null }) },
    statusFilter && { key: 'status', label: `状态：${STATUS_LABELS[statusFilter] ?? statusFilter}`, onRemove: () => updateParams({ status: null }) },
    supplierId && { key: 'supplier', label: `供应商：${supplierName || supplierId}`, onRemove: () => updateParams({ supplierId: null, supplierName: null }) },
    warehouseId && { key: 'warehouse', label: `仓库：${warehouseName || warehouseId}`, onRemove: () => updateParams({ warehouseId: null, warehouseName: null }) },
    productId && { key: 'product', label: `产品：${productName || productId}`, onRemove: () => updateParams({ productId: null, productCode: null, productName: null }) },
    // 日期筛选按需求不在主页展示，仅在查询弹窗中呈现
  ].filter(Boolean) as { key: string; label: string; onRemove: () => void }[]

  const columns: TableColumn<PurchaseOrder>[] = [
    { key: 'orderNo', title: '采购单号', width: 160, render: v => <span className="text-doc-code">{String(v)}</span> },
    { key: 'supplierName', title: '供应商' },
    { key: 'warehouseName', title: '仓库', width: 120 },
    { key: 'totalAmount', title: '金额', width: 100, render: (v) => `¥${Number(v).toFixed(2)}` },
    {
      key: 'status', title: '状态', width: 100,
      render: (v, row) => <StatusBadge type="purchase" status={v as number} aria-label={(row as PurchaseOrder).statusName} />
    },
    { key: 'operatorName', title: '经办人', width: 90 },
    { key: 'createdAt', title: '创建时间', width: 160, render: (v) => formatDisplayDateTime(v) },
    {
      key: 'remark', title: '订单备注', width: 200,
      render: (v) => v
        ? <span className="line-clamp-1 text-xs text-muted-foreground" title={String(v)}>{String(v)}</span>
        : <span className="text-xs text-muted-foreground/50">—</span>
    },
    {
      key: 'id', title: '操作', width: 120, render: (_, row) => {
        const r = row as PurchaseOrder
        return (
          <TableActionsMenu
            primaryLabel="详情"
            onPrimaryClick={() => goToDetail(r)}
            primaryVariant="outline"
            items={[
              ...(r.status === 1 ? [{
                label: '编辑',
                onClick: () => goToDetail(r),
              }, {
                label: '提交',
                onClick: () => confirm.mutate(r.id),
                disabled: confirm.isPending,
              }] : []),
              {
                label: '打印',
                onClick: () => setPrintId(r.id),
              },
              ...(r.status === 2 ? [{
                label: '关闭剩余',
                separatorBefore: true,
                onClick: () => openConfirm(
                  '关闭剩余结案',
                  '将按已审核入库的实收数量结算应付并完成采购单，未收部分作罢。仅在相关收货订单均已审核通过时可用。',
                  () => { closeConfirm(); close.mutate(r.id) },
                  { confirmText: '确认结案' },
                ),
                disabled: close.isPending,
              }] : []),
              ...((r.status === 1 || r.status === 2) ? [{
                label: '取消',
                destructive: true,
                separatorBefore: true,
                onClick: () => openConfirm(
                  '取消采购单',
                  '取消后此采购单将无法恢复，请确认操作。',
                  () => { closeConfirm(); cancel.mutate(r.id) },
                  { variant: 'destructive', confirmText: '确认取消' },
                ),
                disabled: cancel.isPending,
              }] : []),
            ]}
          />
        )
      }
    },
  ]

  return (
    <div className="space-y-4">
      <PageHeader
        title="采购订单"
        description="采购单仅管理计划与提交；实际到货请在收货订单中按供应商创建本次收货单"
        actions={
          <>
            <Button variant="outline"
              onClick={() => downloadExport('/export/purchase', exportParams).catch(e => toast.error((e as Error).message))}>
              导出 Excel
            </Button>
            <Button variant="outline" onClick={() => setQueryOpen(true)}>查询</Button>
            <Button onClick={goToNew}>+ 新建采购单</Button>
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
        data={data?.list || []}
        loading={isLoading}
        onRowDoubleClick={goToDetail}
      />

      {printDetail && (
        <OrderPrintOverlay
          templateType={2}
          title={printDetail.orderNo}
          {...mapPurchaseOrderToPrint(printDetail)}
          onClose={() => setPrintId(null)}
        />
      )}

      <ConfirmDialog
        open={confirmState.open}
        title={confirmState.title}
        description={confirmState.description}
        variant={confirmState.variant ?? 'default'}
        confirmText={confirmState.confirmText ?? '确认'}
        loading={false}
        onConfirm={confirmState.onConfirm}
        onCancel={closeConfirm}
      />

      <PurchaseQueryDialog
        open={queryOpen}
        initial={initialQuery}
        onClose={() => setQueryOpen(false)}
        onApply={applyQuery}
      />
    </div>
  )
}
