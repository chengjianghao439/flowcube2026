import { OrderStatusFilter } from '@/components/shared/OrderStatusFilter'
import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { X } from 'lucide-react'
import PageHeader from '@/components/shared/PageHeader'
import DataTable from '@/components/shared/DataTable'
import Pagination from '@/components/shared/Pagination'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import TableActionsMenu from '@/components/shared/TableActionsMenu'
import { usePurchaseList, useConfirmPurchase, useWithdrawConfirmPurchase, useApprovePurchase, useRejectPurchase, useCancelPurchase, useClosePurchase, usePurchaseDetail } from '@/hooks/usePurchase'
import { usePermission } from '@/hooks/usePermission'
import { PERMISSIONS } from '@/lib/permission-codes'
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

const STATUS_LABELS: Record<string, string> = { '1': '草稿', '2': '已提交', '3': '已完成', '4': '已取消', '5': '待审批' }

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
  // 到货看板"逾期未到"跳转筛选：草稿/已确认且预计到货日已过
  const [overdueOnly, setOverdueOnly] = useState(false)
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
  const operatorId    = Number(searchParams.get('operatorId') || '') || null
  const operatorName  = readStringParam(searchParams, 'operatorName')
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
  const page          = Math.max(1, Number(searchParams.get('page') || '1') || 1)

  const [confirmState, setConfirmState] = useState<{
    open: boolean
    title: string
    description: string
    confirmText?: string
    variant?: 'default' | 'destructive'
    onConfirm: () => void
  }>({ open: false, title: '', description: '', onConfirm: () => {} })

  // 驳回弹窗（审计 4.7）：审批人驳回待审批采购单，需填写原因
  const [rejectTarget, setRejectTarget] = useState<PurchaseOrder | null>(null)
  const [rejectReason, setRejectReason] = useState('')

  const PAGE_SIZE = 20
  const { data, isLoading } = usePurchaseList({
    page,
    pageSize: PAGE_SIZE,
    keyword,
    remark: remark || undefined,
    operatorId: operatorId || undefined,
    status: statusFilter || undefined,
    productId: productId || undefined,
    supplierId: supplierId || undefined,
    warehouseId: warehouseId || undefined,
    startDate: overdueOnly ? undefined : (startDate || undefined),
    endDate: overdueOnly ? undefined : (endDate || undefined),
    overdueOnly: overdueOnly || undefined,
  })
  const total = data?.pagination?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const confirm = useConfirmPurchase()
  const withdrawConfirm = useWithdrawConfirmPurchase()
  const approve = useApprovePurchase()
  const reject = useRejectPurchase()
  const cancel = useCancelPurchase()
  const close = useClosePurchase()
  const { can } = usePermission()
  const canApprove = can(PERMISSIONS.PURCHASE_ORDER_APPROVE)
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
    ...(operatorId ? { operatorId: String(operatorId) } : {}),
    ...(statusFilter ? { status: statusFilter } : {}),
    ...(productId ? { productId: String(productId) } : {}),
    ...(supplierId ? { supplierId: String(supplierId) } : {}),
    ...(warehouseId ? { warehouseId: String(warehouseId) } : {}),
    ...(startDate ? { startDate } : {}),
    ...(endDate ? { endDate } : {}),
  }

  // 查询弹窗初始值
  const initialQuery: PurchaseQueryValues = {
    keyword, remark, operatorId, operatorName, status: statusFilter,
    productId, productCode, productName,
    supplierId, supplierName,
    warehouseId, warehouseName,
    startDate, endDate,
  }

  function applyQuery(v: PurchaseQueryValues) {
    updateParams({
      keyword: v.keyword || null,
      remark: v.remark || null,
      operatorId: v.operatorId || null,
      operatorName: v.operatorName || null,
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
      page: 1, // 筛选变化回到第一页
    })
    setQueryOpen(false)
  }

  function clearAll() {
    updateParams({
      keyword: null, remark: null, operatorId: null, operatorName: null, status: null,
      productId: null, productCode: null, productName: null,
      supplierId: null, supplierName: null,
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
    supplierId && { key: 'supplier', label: `供应商：${supplierName || supplierId}`, onRemove: () => updateParams({ supplierId: null, supplierName: null, page: 1 }) },
    warehouseId && { key: 'warehouse', label: `仓库：${warehouseName || warehouseId}`, onRemove: () => updateParams({ warehouseId: null, warehouseName: null, page: 1 }) },
    productId && { key: 'product', label: `商品：${productName || productId}`, onRemove: () => updateParams({ productId: null, productCode: null, productName: null, page: 1 }) },
    // 日期筛选按需求不在主页展示，仅在查询弹窗中呈现
  ].filter(Boolean) as { key: string; label: string; onRemove: () => void }[]

  const columns: TableColumn<PurchaseOrder>[] = [
    { key: 'orderNo', title: '采购单号', width: 12 },
    { key: 'supplierName', title: '供应商', width: 17 },
    { key: 'warehouseName', title: '仓库', width: 9 },
    { key: 'totalAmount', title: '金额', width: 9, align: 'right', render: (v) => <span className="tabular-nums">¥{Number(v).toFixed(2)}</span> },
    {
      key: 'status', title: '状态', width: 8,
      render: (v, row) => <StatusBadge type="purchase" status={v as number} aria-label={(row as PurchaseOrder).statusName} />
    },
    { key: 'operatorName', title: '经办人', width: 11 },
    { key: 'createdAt', title: '创建时间', width: 13, render: (v) => formatDisplayDateTime(v) },
    {
      key: 'remark', title: '备注', width: 11,
      render: (v) => v
        ? <span className="line-clamp-1 text-muted-foreground" title={String(v)}>{String(v)}</span>
        : <span className="text-muted-foreground/50">—</span>
    },
    {
      key: 'id', title: '操作', width: 10, render: (_, row) => {
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
              ...(r.status === 2 || r.status === 5 ? [{
                label: '撤回确认',
                separatorBefore: true,
                onClick: () => openConfirm(
                  '撤回确认',
                  '撤回后采购单将恢复为草稿状态，可重新编辑后再次提交。若已创建收货订单，需先取消收货订单后才能撤回确认。',
                  () => withdrawConfirm.mutate(r.id, { onSettled: closeConfirm }),
                  { confirmText: '撤回确认' },
                ),
                disabled: withdrawConfirm.isPending,
              }] : []),
              // 待审批(5)单：审批通过/驳回（审计 4.7），需 purchase.order.approve 权限
              ...(r.status === 5 && canApprove ? [{
                label: '审批通过',
                onClick: () => openConfirm(
                  '审批通过',
                  '通过后该采购单可创建收货订单。',
                  () => approve.mutate(r.id, { onSettled: closeConfirm }),
                  { confirmText: '通过' },
                ),
                disabled: approve.isPending,
              }, {
                label: '驳回',
                destructive: true,
                onClick: () => setRejectTarget(r),
                disabled: reject.isPending,
              }] : []),
              // 关闭剩余只有在已经有实收数量、且相关收货订单都已上架完成时才可能成功
              // （对应后端 closeRemaining 的两条硬性前提），条件不满足就不展示，
              // 避免对必然失败的订单（如还没收过货）诱导点击。
              ...(r.status === 2 && r.canCloseRemaining ? [{
                label: '关闭未收结案',
                onClick: () => openConfirm(
                  '关闭未收结案',
                  '将按已入库的实收数量结算应付并完成采购单，未收部分不再收货。',
                  () => close.mutate(r.id, { onSettled: closeConfirm }),
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
                  () => cancel.mutate(r.id, { onSettled: closeConfirm }),
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
        description="采购单用于登记与提交采购需求；实际到货请在「收货订单」中按本次到货创建收货单"
        actions={
          <>
            <Button variant="outline"
              onClick={() => downloadExport('/export/purchase', exportParams).catch(e => toast.error((e as Error).message))}>
              导出 Excel
            </Button>
            <Button variant="outline" onClick={() => setQueryOpen(true)}>查询</Button>
            <Button
              variant={overdueOnly ? 'default' : 'outline'}
              onClick={() => setOverdueOnly(v => !v)}
            >{overdueOnly ? '✕ 仅看逾期未到' : '逾期未到'}</Button>
            <Button onClick={goToNew}>+ 新建采购单</Button>
          </>
        }
      />

      <OrderStatusFilter label="采购状态分类" value={statusFilter}
        options={[{value: '', label: '全部订单'}, ...Object.entries(STATUS_LABELS).map(([value, label]) => ({value, label}))]}
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

      <DataTable
        columns={columns}
        data={data?.list || []}
        loading={isLoading}
        onRowDoubleClick={goToDetail}
        fluid
        columnStorageKey="purchase:status-v3"
      />

      {/* 分页 */}
      <Pagination page={page} totalPages={totalPages} total={total} unit="单"
        onPageChange={(p) => updateParams({ page: p })} />

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
        loading={withdrawConfirm.isPending || close.isPending || cancel.isPending}
        onConfirm={confirmState.onConfirm}
        onCancel={closeConfirm}
      />

      <PurchaseQueryDialog
        open={queryOpen}
        initial={initialQuery}
        onClose={() => setQueryOpen(false)}
        onApply={applyQuery}
      />

      {/* 驳回弹窗（审计 4.7）：审批人驳回待审批采购单 */}
      <Dialog open={!!rejectTarget} onOpenChange={(v) => !v && setRejectTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>驳回采购单 {rejectTarget?.orderNo}</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <Label>驳回原因 *</Label>
            <Input
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              maxLength={300}
              placeholder="请填写驳回原因"
            />
          </div>
          <DialogFooter className="pt-2">
            <Button variant="outline" onClick={() => setRejectTarget(null)}>取消</Button>
            <Button
              variant="destructive"
              disabled={reject.isPending || !rejectReason.trim()}
              onClick={() => rejectTarget && reject.mutate(
                { id: rejectTarget.id, reason: rejectReason.trim() },
                { onSettled: () => { setRejectTarget(null); setRejectReason('') } },
              )}
            >
              {reject.isPending ? '驳回中…' : '确认驳回'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
