import { useEffect, useMemo, useState } from 'react'
import { usePermission } from '@/hooks/usePermission'
import { PERMISSIONS } from '@/lib/permission-codes'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { X } from 'lucide-react'
import PageHeader from '@/components/shared/PageHeader'
import DataTable from '@/components/shared/DataTable'
import ListSummary from '@/components/shared/ListSummary'
import { SoftStatusLabel } from '@/components/shared/StatusBadge'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { AppDialog } from '@/components/shared/AppDialog'
import { LimitedTextarea } from '@/components/shared/LimitedTextarea'
import { Button } from '@/components/ui/button'
import TableActionsMenu from '@/components/shared/TableActionsMenu'
import { getTransferListApi, confirmTransferApi, cancelTransferApi, forceCloseTransferApi } from '@/api/transfer'
import { downloadExport } from '@/lib/exportDownload'
import { formatDisplayDateTime, defaultRangeYmds } from '@/lib/dateTime'
import { readStringParam, upsertSearchParams } from '@/lib/urlSearchParams'
import { toast } from '@/lib/toast'
import { useWorkspaceStore } from '@/store/workspaceStore'
import TransferQueryDialog, { type TransferQueryValues } from './TransferQueryDialog'
import type { TransferOrder } from '@/api/transfer'
import type { TableColumn } from '@/types'

const STATUS_LABELS: Record<string, string> = { '1': '草稿', '2': '待出库', '3': '在途', '4': '已完成', '5': '已取消' }

/** 默认筛选的天数窗口（最近一周，含今天），口径与销售/采购/收货一致 */
const DEFAULT_RANGE_DAYS = 7

export default function TransferPage() {
  // 2026-09-17 验收修复（G-10）：新建调拨按钮按权限渲染
  const { can } = usePermission()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { addTab } = useWorkspaceStore()
  const [searchParams, setSearchParams] = useSearchParams()

  const [queryOpen, setQueryOpen] = useState(false)
  const [confirmState, setConfirmState] = useState<{ open: boolean; title: string; description: string; onConfirm: () => void }>({ open: false, title: '', description: '', onConfirm: () => {} })
  const openConfirm = (title: string, description: string, onConfirm: () => void) => setConfirmState({ open: true, title, description, onConfirm })
  const closeConfirm = () => setConfirmState(s => ({ ...s, open: false }))
  const [pendingId, setPendingId] = useState<number | null>(null)
  // 在途异常了结：必须填写原因，走独立的小弹窗（ConfirmDialog 在桌面端会切到系统原生消息框，
  // 无法嵌入文本输入框，这里不能复用它）
  const [forceCloseState, setForceCloseState] = useState<{ open: boolean; id: number | null }>({ open: false, id: null })
  const [forceCloseReason, setForceCloseReason] = useState('')

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

  // 默认窗口在「构造查询参数处」兜底（与销售/采购/收货同一写法）：不依赖那个只跑一次的 effect，
  // 因此首次打开与从菜单切回已挂载页签的范围一致。range=all 是「清空」写下的显式意图（看全部）。
  const rangeAll = searchParams.get('range') === 'all'
  const defaultRange = useMemo(() => defaultRangeYmds(DEFAULT_RANGE_DAYS), [])
  const effectiveStartDate = startDate || (rangeAll ? '' : defaultRange.start)
  const effectiveEndDate = endDate || (rangeAll ? '' : defaultRange.end)

  const PAGE_SIZE = 20
  const { data, isLoading } = useQuery({
    queryKey: ['transfer', { keyword, remark, operatorId, statusFilter, productId, warehouseId, effectiveStartDate, effectiveEndDate }],
    queryFn: () => getTransferListApi({
      page: 1,
      pageSize: PAGE_SIZE,
      keyword,
      remark: remark || undefined,
      operatorId: operatorId || undefined,
      status: statusFilter || undefined,
      productId: productId || undefined,
      warehouseId: warehouseId || undefined,
      startDate: effectiveStartDate || undefined,
      endDate: effectiveEndDate || undefined,
    }).then(r => r!),
  })
  const total = data?.pagination?.total ?? 0

  const mut = (fn: () => Promise<unknown>, id?: number) => {
    if (id) setPendingId(id)
    fn()
      .then(() => qc.invalidateQueries({ queryKey: ['transfer'] }))
      .catch(() => { /* 失败已由全局拦截器弹 toast */ })
      .finally(() => { if (id) setPendingId(null) })
  }

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
    ...(effectiveStartDate ? { startDate: effectiveStartDate } : {}),
    ...(effectiveEndDate ? { endDate: effectiveEndDate } : {}),
  }

  // 查询弹窗初始值：日期用「当前实际生效」的范围（含默认窗口），用户打开就能看见
  const initialQuery: TransferQueryValues = {
    keyword, remark, operatorId, operatorName, status: statusFilter,
    productId, productCode, productName,
    warehouseId, warehouseName,
    startDate: effectiveStartDate, endDate: effectiveEndDate,
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
      // 弹窗里清空日期＝明确要看全部；设了日期则清掉 range 标记
      range: (!v.startDate && !v.endDate) ? 'all' : null,
      page: 1, // 筛选变化回到第一页
    })
    setQueryOpen(false)
  }

  function clearAll() {
    updateParams({
      keyword: null, remark: null, operatorId: null, operatorName: null, status: null,
      productId: null, productCode: null, productName: null,
      warehouseId: null, warehouseName: null,
      startDate: null, endDate: null,
      // 显式声明「看全部」：否则「没有日期」会被默认窗口接管，清空之后又只剩最近一周
      range: 'all',
      page: 1,
    })
  }

  // 当前生效筛选摘要（可逐项移除）
  const chips = [
    keyword && { key: 'keyword', label: `单号：${keyword}`, onRemove: () => updateParams({ keyword: null, page: 1 }) },
    remark && { key: 'remark', label: `备注：${remark}`, onRemove: () => updateParams({ remark: null, page: 1 }) },
    operatorId && { key: 'operator', label: `经办人：${operatorName || operatorId}`, onRemove: () => updateParams({ operatorId: null, operatorName: null, page: 1 }) },
    statusFilter && { key: 'status', label: `状态：${STATUS_LABELS[statusFilter] ?? statusFilter}`, onRemove: () => updateParams({ status: null, page: 1 }) },
    warehouseId && { key: 'warehouse', label: `仓库：${warehouseName || warehouseId}`, onRemove: () => updateParams({ warehouseId: null, warehouseName: null, page: 1 }) },
    productId && { key: 'product', label: `商品：${productName || productId}`, onRemove: () => updateParams({ productId: null, productCode: null, productName: null, page: 1 }) },
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
        ? <span className="min-w-0 whitespace-normal [overflow-wrap:anywhere] text-xs text-muted-foreground" title={String(v)}>{String(v)}</span>
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
              label: pendingId === r.id ? '处理中…' : '确认派发',
              onClick: () => mut(() => confirmTransferApi(r.id), r.id),
              disabled: pendingId === r.id,
            }] : []),
            ...((r.status === 1 || r.status === 2) ? [{
              label: pendingId === r.id ? '处理中…' : '取消',
              onClick: () => openConfirm('取消调拨', '确认取消此调拨单？', () => mut(() => cancelTransferApi(r.id), r.id)),
              disabled: pendingId === r.id,
              destructive: true,
              separatorBefore: true,
            }] : []),
            ...(r.status === 3 ? [{
              label: '异常了结（运输丢失）',
              onClick: () => { setForceCloseReason(''); setForceCloseState({ open: true, id: r.id }) },
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
          {can(PERMISSIONS.TRANSFER_ORDER_CREATE) && <Button onClick={goToNew}>+ 新建调拨单</Button>}
        </>
      } />

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

      <DataTable columns={columns} data={data?.list || []} loading={isLoading} onRowDoubleClick={goToDetail} />

      <ListSummary total={total} unit="单" />

      <ConfirmDialog
        open={confirmState.open}
        title={confirmState.title}
        description={confirmState.description}
        variant={confirmState.title.includes('取消') ? 'destructive' : 'default'}
        confirmText={confirmState.title.includes('取消') ? '确认取消' : '确认'}
        onConfirm={() => { closeConfirm(); confirmState.onConfirm() }}
        onCancel={closeConfirm}
      />

      <AppDialog
        open={forceCloseState.open}
        onOpenChange={(v) => { if (!v && pendingId !== forceCloseState.id) setForceCloseState({ open: false, id: null }) }}
        dialogId="transfer-force-close-dialog"
        resizable={false}
        defaultWidth={600}
        defaultHeight={400}
        minWidth={380}
        minHeight={280}
        title="在途异常了结"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setForceCloseState({ open: false, id: null })} disabled={pendingId === forceCloseState.id}>
              取消
            </Button>
            <Button
              variant="destructive"
              disabled={pendingId === forceCloseState.id || !forceCloseReason.trim()}
              onClick={() => {
                if (!forceCloseState.id) return
                mut(() => forceCloseTransferApi(forceCloseState.id!, forceCloseReason.trim()), forceCloseState.id)
                setForceCloseState({ open: false, id: null })
              }}
            >
              {pendingId === forceCloseState.id ? '处理中…' : '确认异常了结'}
            </Button>
          </div>
        }
      >
        <div className="space-y-4 px-1 py-1 text-sm leading-6">
          <p className="text-muted-foreground">
            仅用于运输途中货物丢失、长期无法送达等无法正常扫码入库的情况。确认后，在途库存条码按运输损耗核销：不退回调出仓，也不计入调入仓；调拨单直接标记为已完成，不能撤回。
          </p>
          <LimitedTextarea
            maxLength={200}
            placeholder="请填写异常了结原因（必填，会记入操作记录）"
            value={forceCloseReason}
            onChange={(e) => setForceCloseReason(e.target.value)}
          />
        </div>
      </AppDialog>

      <TransferQueryDialog
        open={queryOpen}
        initial={initialQuery}
        resetValues={{ startDate: defaultRange.start, endDate: defaultRange.end }}
        onClose={() => setQueryOpen(false)}
        onApply={applyQuery}
      />
    </div>
  )
}
