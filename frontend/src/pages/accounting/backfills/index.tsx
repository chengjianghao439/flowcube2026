import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { RefreshCw, ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import PageHeader from '@/components/shared/PageHeader'
import DataTable from '@/components/shared/DataTable'
import ListSummary from '@/components/shared/ListSummary'
import { SoftStatusLabel } from '@/components/shared/StatusBadge'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { amount } from '@/lib/format'
import { toast } from '@/lib/toast'
import { formatDisplayDate, formatDisplayDateTime } from '@/lib/dateTime'
import type { StatusTone } from '@/lib/statusTone'
import { useActiveWorkspaceTab } from '@/hooks/useActiveWorkspaceTab'
import { captureRefundOwner, refundOwnerCurrent, refundConfig, refundActivityEpoch, subscribeRefund, refundRevision, mayReadRefund } from '@/lib/supplierRefundRecovery'
import { usePermission } from '@/hooks/usePermission'
import { PERMISSIONS } from '@/lib/permission-codes'
import { getActiveAccountsApi } from '@/api/finance'
import { useWarehousesActive } from '@/hooks/useWarehouses'
import {
  useBackfills, useBackfillDetail, useApproveBackfill, useRejectBackfill, useCancelBackfill,
  useExecuteBackfill, useRegenerateBackfillVoucher, type SupplierRefundBackfillContext,
} from '@/hooks/useBackfills'
import type { TableColumn } from '@/types'
import {
  BACKFILL_STATUS_OPTIONS, BACKFILL_BIZ_TYPE_OPTIONS,
  type BackfillApplication, type BackfillOperationResult,
} from '@/types/accounting'

/**
 * 跨期补录审批（2026-09-26 一致性审查 · 任务 7 第二期）
 *
 * 背景：会计期间结账后，付款/核销/退款若还往那个期间写，凭证引擎会跳过生成——
 * 钱动了、账上却没有这笔，账实不符且没人知道。所以这类写入一律 409 拦下，
 * 由人显式申请补录：**先审批、后动账**。
 *
 * 三条规则决定了这个页面长什么样，前端不复述规则、只按后端给的状态位渲染：
 *   1. 申请只是留一张单子，一分钱不动账；批准（必须换个人）才真正写业务；
 *   2. 调整凭证落在**补录当期**（执行审批日所在会计期间），不是业务发生期间——
 *      所以「业务期间」与「凭证落期」是两列，不是一列；
 *   3. 批准即执行。批完执行不下去（业务已漂移等）会停在「已批准 · 待记账」，
 *      此时可重试执行，或作废后按新情况重新申请。
 *
 * 可见范围由后端决定（持审批权限看全部，否则只看自己提交的），本页不再二次过滤。
 */
/**
 * 一页 50 条 + 翻页。历史申请只会越积越多，若一页写死一个固定的大数字（早期是 200），
 * 超过这个数之后**旧申请永远翻不到**——待审批的单子被埋在第二页之外，审批人看不见就等于没人批。
 */
const PAGE_SIZE = 50
type BackfillTarget = BackfillApplication & { refundContext?: SupplierRefundBackfillContext }

/** 状态 → 展示。已批准要分「还没记账成功」与「已记账」两种，否则审批人看不出卡在哪 */
function statusOf(r: BackfillApplication): { label: string; tone: StatusTone } {
  switch (r.status) {
    case 0: return { label: '待审批', tone: 'warning' }
    case 1: return r.pendingExecution
      ? { label: '已批准 · 待记账', tone: 'warning' }
      : { label: '已记账', tone: 'success' }
    case 2: return { label: '已驳回', tone: 'danger' }
    case 4: return { label: '已作废', tone: 'draft' }
    default: return { label: '历史遗留', tone: 'draft' }
  }
}

/**
 * 申请时原请求的快照 —— **只有详情接口返回**（列表接口没有这一项）。
 *
 * 批准 = 按这份快照原样重放一次业务，所以审批人要核对的正是它：钱从哪个账户走、
 * 退款打回哪个仓库、核销了哪几笔。没有它，审批人只能看见「金额 + 一句原因」，
 * 等于闭着眼睛批。
 *
 * 快照来自历史数据、字段可能缺（旧单子、老版本写入），所以这里一律尽力渲染，
 * 缺什么显示「—」，绝不拿别的字段顶替。
 */
interface AllocationItem { recordId?: number; statementId?: number; amount?: number }
interface SnapshotBody {
  type?: number
  partyName?: string
  amount?: number
  paymentDate?: string
  method?: string | null
  accountId?: number | null
  remark?: string | null
  allocations?: AllocationItem[]
  // 报销付款专用：业务日期（后端快照写 happenedAt，与收付款的 paymentDate 不是同一个键）
  happenedAt?: string | null
  // 退款专用：申请当时的出款账户/金额/日期/客户，执行时会拿它们核对单据有没有被改过
  refundDate?: string | null
  saleOrderNo?: string | null
  customerName?: string | null
}
interface Snapshot {
  kind: 'payment' | 'receipt' | 'receipt_settle' | 'expense_pay' | 'refund' | 'supplier_refund'
  refundId?: number
  frozen?: { refundNo?: string; amount?: string; incomeAccountId?: number; refundDate?: string; purchaseReturnId?: number; purchaseOrderId?: number; supplierId?: number; paymentRecordId?: number; warehouseId?: number; createPayloadJson?: string; sourceSnapshotJson?: string }
  recordId?: number
  receiptId?: number
  claimId?: number
  orderId?: number
  warehouseIds?: number[] | null
  body?: SnapshotBody
}

function readSnapshot(raw: unknown): Snapshot | null {
  if (!raw || typeof raw !== 'object') return null
  const kind = (raw as { kind?: unknown }).kind
  return kind === 'payment' || kind === 'receipt' || kind === 'receipt_settle' || kind === 'expense_pay' || kind === 'refund' || kind === 'supplier_refund'
    ? raw as Snapshot
    : null
}

const dash = '—'
const money = (v: number | null | undefined) => (v == null ? dash : amount(Number(v)))
const zeroProof = '零分投影已核对/无需分位凭证'
const backfillMoney = (r: BackfillApplication) => r.amount == null ? dash : r.bizType === 'supplier_refund' ? Number(r.amount).toFixed(4) : amount(r.amount)
function backfillResultToast(r: BackfillOperationResult, ordinary: string) {
  let message = ordinary
  let pending = false
  if (r.bizType === 'supplier_refund') {
    if (r.voucherResult === 'notRequired' && !r.voucherRequired && !r.voucherError) message = zeroProof
    else if (r.voucherResult === 'generated' && !r.voucherError) message = '原回款已记账，调整凭证已生成'
    else { message = '原回款已记账，调整凭证仍待核对'; pending = true }
  } else if (r.voucherError) {
    message = `${ordinary}，但调整凭证未生成成功，请在列表里重试生成`
    pending = true
  } else if (!r.voucherRequired) message = '已记账，本类补录无需生成调整凭证'
  if (r.applicationPending) { message += '；申请详情待加载，请主动核对原申请'; pending = true }
  if (pending) toast.warning(message)
  else toast.success(message)
}

function AllocationLines({ items }: { items?: AllocationItem[] }) {
  if (!items?.length) return <span className="text-muted-foreground">{dash}</span>
  const total = items.reduce((sum, a) => sum + Number(a.amount || 0), 0)
  return (
    <div className="flex flex-col gap-0.5">
      {items.map((a, i) => (
        <span key={i} className="tabular-nums">
          {a.recordId ? `账款 #${a.recordId}` : `对账单 #${a.statementId}`} · {money(a.amount)}
        </span>
      ))}
      {items.length > 1 && <span className="text-xs text-muted-foreground">共 {items.length} 笔，合计 {amount(total)}</span>}
    </div>
  )
}

interface RefundBusinessSnapshot {
  po: { id: number; orderNo: string; supplierId: number; warehouseId: number }
  pr: { id: number; returnNo: string; items: { id: number; unit: string; quantity: string; unitPrice: string }[] }
  allocations: { entryId: number; amount: string }[]
}
function refundBusinessSnapshot(snap: Snapshot): RefundBusinessSnapshot | null {
  try {
    const frozen = snap.frozen
    if (!frozen?.createPayloadJson || !frozen.sourceSnapshotJson) return null
    const body = JSON.parse(frozen.createPayloadJson), source = JSON.parse(frozen.sourceSnapshotJson)
    const id = (v: unknown) => typeof v === 'number' && Number.isSafeInteger(v) && v > 0
    const money4 = (v: unknown) => typeof v === 'string' && /^\d+\.\d{4}$/.test(v)
    if (![frozen.purchaseReturnId,frozen.purchaseOrderId,frozen.incomeAccountId,frozen.paymentRecordId,frozen.supplierId,frozen.warehouseId].every(id) || !money4(frozen.amount) || body.purchaseReturnId !== frozen.purchaseReturnId || body.incomeAccountId !== frozen.incomeAccountId || body.refundDate !== frozen.refundDate || body.amount !== frozen.amount
      || source.version !== 1 || source.po.id !== frozen.purchaseOrderId || source.pr.id !== frozen.purchaseReturnId || source.pr.purchaseOrderId !== source.po.id
      || source.po.supplierId !== frozen.supplierId || source.pr.supplierId !== frozen.supplierId || source.po.warehouseId !== frozen.warehouseId || source.pr.warehouseId !== frozen.warehouseId
      || typeof source.po.orderNo !== 'string' || !source.po.orderNo || typeof source.pr.returnNo !== 'string' || !source.pr.returnNo || source.pr.purchaseOrderNo !== source.po.orderNo
      || !Array.isArray(body.allocations) || !body.allocations.length || !Array.isArray(source.entries) || !Array.isArray(source.pr.items) || !source.pr.items.length) return null
    if (body.allocations.some((a: { entryId?: unknown; amount?: unknown }) => !id(a.entryId) || !money4(a.amount) || !source.entries.some((e: { entryId?: unknown }) => e.entryId === a.entryId))
      || source.pr.items.some((i: { id?: unknown; unit?: unknown; quantity?: unknown; unitPrice?: unknown }) => !id(i.id) || typeof i.unit !== 'string' || !i.unit || typeof i.quantity !== 'string' || !/^\d+\.\d{2}$/.test(i.quantity) || !money4(i.unitPrice))) return null
    return { po: source.po, pr: source.pr, allocations: body.allocations }
  } catch { return null }
}
function RefundBusinessFields({ snap }: { snap: Snapshot }) {
  const business = refundBusinessSnapshot(snap)
  if (!business) return <p role="alert" className="col-span-2 text-warning">原退款依据不可核对：原付款分配或原单信息缺失、损坏或不一致，请核对原始业务单据，不按当前主档补齐。</p>
  return <>
    <Field label="原采购单号" value={business.po.orderNo} mono />
    <Field label="原采购退货单号" value={business.pr.returnNo} mono />
    <Field label="准确供应商身份" value={`#${business.po.supplierId}`} />
    <Field label="准确仓库身份" value={`#${business.po.warehouseId}`} />
    <div className="col-span-2 space-y-1"><span className="text-xs text-muted-foreground">本次原付款分配</span>{business.allocations.map(a => <p key={a.entryId}>原付款分配 {a.entryId} · 退款 {a.amount}</p>)}</div>
    <div className="col-span-2 space-y-1"><span className="text-xs text-muted-foreground">原采购退货成交行</span>{business.pr.items.map(i => <p key={i.id}>原退货行 {i.id} · {i.quantity} {i.unit} · 原成交单价 {i.unitPrice}</p>)}</div>
  </>
}

/** 原请求快照：按四种业务类型展开审批人要核对的字段 */
function SnapshotFields({ raw, accountName, warehouseName }: {
  raw: unknown
  accountName: (id: number | null | undefined) => string
  warehouseName: (ids: number[] | null | undefined) => string
}) {
  const snap = readSnapshot(raw)
  if (!snap) {
    return (
      <div className="rounded-md bg-muted/40 p-2 text-xs text-muted-foreground">
        这笔申请没有留下申请时的业务信息（历史单子或更早版本写入）。请以原始业务单据为准核对后再批。
      </div>
    )
  }
  const b = snap.body ?? {}
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
      {snap.kind === 'payment' && (
        <>
          <Field label="付款账户" value={accountName(b.accountId)} />
          <Field label="付款金额" value={money(b.amount)} />
          <Field label="付款日期" value={b.paymentDate ? formatDisplayDate(b.paymentDate) : dash} />
          <Field label="支付方式" value={b.method || dash} />
          <Field label="原账款" value={snap.recordId ? `#${snap.recordId}` : dash} mono />
          <div className="col-span-2"><Field label="备注" value={b.remark || dash} /></div>
        </>
      )}
      {snap.kind === 'receipt' && (
        <>
          <Field label="方向" value={b.type === 1 ? '付款' : b.type === 2 ? '收款' : dash} />
          <Field label="往来单位" value={b.partyName || dash} />
          <Field label="金额" value={money(b.amount)} />
          <Field label="日期" value={b.paymentDate ? formatDisplayDate(b.paymentDate) : dash} />
          <Field label="支付方式" value={b.method || dash} />
          <Field label={b.type === 1 ? '付款账户' : '收款账户'} value={accountName(b.accountId)} />
          <div className="col-span-2">
            <span className="text-xs text-muted-foreground">核销明细</span>
            <AllocationLines items={b.allocations} />
          </div>
          <div className="col-span-2"><Field label="备注" value={b.remark || dash} /></div>
        </>
      )}
      {snap.kind === 'receipt_settle' && (
        <>
          <Field label="收付款单" value={snap.receiptId ? `#${snap.receiptId}` : dash} mono />
          <div className="col-span-2">
            <span className="text-xs text-muted-foreground">核销明细</span>
            <AllocationLines items={b.allocations} />
          </div>
        </>
      )}
      {snap.kind === 'supplier_refund' && (
        <>
          <Field label="供应商退款单" value={snap.frozen?.refundNo || (snap.refundId ? `#${snap.refundId}` : dash)} />
          <Field label="真实银行回款日" value={snap.frozen?.refundDate ? formatDisplayDate(snap.frozen.refundDate) : dash} />
          <Field label="退款金额（四位）" value={snap.frozen?.amount || dash} />
          <Field label="收入账户" value={accountName(snap.frozen?.incomeAccountId)} />
          <Field label="原采购退货" value={snap.frozen?.purchaseReturnId ? `#${snap.frozen.purchaseReturnId}` : dash} mono />
          <Field label="原采购单" value={snap.frozen?.purchaseOrderId ? `#${snap.frozen.purchaseOrderId}` : dash} mono />
          <RefundBusinessFields snap={snap} />
        </>
      )}
      {snap.kind === 'expense_pay' && (
        <>
          <Field label="付款账户" value={accountName(b.accountId)} />
          <Field label="报销单" value={snap.claimId ? `#${snap.claimId}` : dash} mono />
          <Field label="付款日期" value={b.happenedAt ? formatDisplayDate(b.happenedAt) : dash} />
          <div className="col-span-2"><Field label="备注" value={b.remark || dash} /></div>
        </>
      )}
      {snap.kind === 'refund' && (
        <>
          <Field label="退款账户" value={accountName(b.accountId)} />
          <Field label="退款金额" value={money(b.amount)} />
          <Field label="退款日期" value={b.refundDate ? formatDisplayDate(b.refundDate) : dash} />
          <Field label="客户" value={b.customerName || dash} />
          <Field label="原销售单" value={b.saleOrderNo || dash} mono />
          <Field label="退款单" value={snap.orderId ? `#${snap.orderId}` : dash} mono />
          <Field label="退款目标仓库" value={warehouseName(snap.warehouseIds)} />
        </>
      )}
    </div>
  )
}

function CountCard({ label, value, hint }: { label: string; value: number; hint: string }) {
  const active = value > 0
  return (
    <div className="card-base p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{label}</span>
        {active && <SoftStatusLabel label="待处理" tone="warning" />}
      </div>
      <div className={`mt-2 text-xl tabular-nums ${active ? 'text-warning' : 'text-muted-foreground'}`}>{value}</div>
      <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>
    </div>
  )
}

/**
 * 批准 / 驳回 / 撤回三种「要写一句话」的动作共用一个弹窗。
 * 备注必填与否不同（批准选填、驳回与撤回必填），由 required 决定。
 */
function RemarkDialog({
  open, title, description, label, placeholder, required, confirmText, destructive, loading,
  onClose, onSubmit, disabled = false, visible = true,
}: {
  open: boolean
  title: string
  description: ReactNode
  label: string
  placeholder: string
  required: boolean
  confirmText: string
  destructive?: boolean
  disabled?: boolean
  visible?: boolean
  loading: boolean
  onClose: () => void
  onSubmit: (remark: string) => void
}) {
  const [text, setText] = useState('')
  // 每次打开都清空：上一次的备注跟着弹窗留在输入框里，会被下一次误提交进审批留痕
  useEffect(() => { if (open) setText('') }, [open])
  const invalid = required && text.trim().length < 2
  return (
    <Dialog open={open && visible} onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
        <div className="space-y-3 py-1">
          <div className="text-sm text-muted-foreground">{description}</div>
          <div className="space-y-1.5">
            <Label>{label}{required ? ' *' : '（选填）'}</Label>
            <Input
              value={text}
              onChange={e => setText(e.target.value)}
              placeholder={placeholder}
              maxLength={300}
              disabled={loading || disabled}
              autoFocus
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={loading}>取消</Button>
          <Button
            variant={destructive ? 'destructive' : 'default'}
            onClick={() => onSubmit(text.trim())}
            disabled={loading || invalid || disabled}
          >
            {loading ? '处理中…' : confirmText}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default function BackfillsPage() {
  useSyncExternalStore(subscribeRefund, refundRevision)
  const [refundOwner] = useState(captureRefundOwner), active = useActiveWorkspaceTab(), activeRef = useRef({active,generation:0})
  if (activeRef.current.active !== active) activeRef.current.generation++
  activeRef.current.active = active
  const refundPageCurrent = () => activeRef.current.active && refundOwnerCurrent(refundOwner) && mayReadRefund()
  function captureRefundRead(): SupplierRefundBackfillContext {
    const activity = refundActivityEpoch(), generation = activeRef.current.generation
    const requestCurrent = () => activeRef.current.active && refundOwnerCurrent(refundOwner) && activeRef.current.generation === generation && refundActivityEpoch() === activity
    return { config: refundConfig(refundOwner), identity: [refundOwner.userId, refundOwner.baseURL, refundOwner.sessionGeneration, refundOwner.epoch, activity, generation], requestCurrent, current: () => requestCurrent() && mayReadRefund() }
  }
  function freezeTarget(row: BackfillApplication): BackfillTarget | null {
    if (row.bizType !== 'supplier_refund') return row
    const context = (row as BackfillTarget).refundContext
    // A click cannot give an old read a new owner or activity generation.
    return context?.current() ? { ...row, refundContext: context } : null
  }
  const targetCurrent = (row: BackfillTarget | null) => !!row && (row.bizType !== 'supplier_refund' || !!row.refundContext?.current())
  const [refundWriteError,setRefundWriteError] = useState('')
  function refundError(target: BackfillTarget | null, error: unknown) { if(target?.bizType === 'supplier_refund' && targetCurrent(target)) setRefundWriteError(error instanceof Error ? `原补录结果待核对：${error.message}；原输入保留，请主动读取原申请。` : '原补录结果待核对，原输入保留，请主动读取原申请。') }
  const targetOpen = (target: BackfillTarget | null) => !!target && (target.bizType !== 'supplier_refund' || active)
  const targetNo = (row: BackfillTarget | null) => row && !targetCurrent(row) ? '原退款上下文已变化' : row?.applicationNo ?? ''
  const { can } = usePermission()
  // 批准、驳回、作废他人的单子都要这一档权限；没有它的人进来只能看自己提交的申请
  // （后端按权限决定可见范围），并在待审批时撤回自己的单子。
  const canApprove = can(PERMISSIONS.FINANCE_PERIOD_BACKFILL_APPROVE)

  const [status, setStatus] = useState<number | ''>('')
  const [bizType, setBizType] = useState('')
  const [page, setPage] = useState(1)
  const query = useMemo(() => ({ status, bizType, page, pageSize: PAGE_SIZE }), [status, bizType, page])
  const { data, isLoading, isFetching, refetch } = useBackfills(query, captureRefundRead)
  const list = (data?.list ?? []).filter(row => row.bizType !== 'supplier_refund' || !!row.refundContext?.current())
  const summary = data?.summary
  const total = data?.pagination?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))

  // 筛选一改结果集就变了，还停在第 3 页多半直接空白 —— 一律回到第一页
  function changeFilter(apply: () => void) { apply(); setPage(1) }
  // 单子被批完/作废后总数变小，页码可能已越过末页：拉回最后一页，别停在空白页上
  useEffect(() => { if (page > pageCount) setPage(pageCount) }, [page, pageCount])

  // 快照里只存资金账户 id 与仓库 id，审批人要看见**名字**才能核对；
  // 账户若已停用就不在 active 列表里，那时退回显示 #id，不假装知道它是哪个
  const { data: accounts } = useQuery({ queryKey: ['finance-accounts-active'], queryFn: getActiveAccountsApi })
  const { data: warehouses } = useWarehousesActive()
  const accountName = (id: number | null | undefined) =>
    id == null ? '—' : ((accounts ?? []).find(a => a.id === id)?.name ?? `#${id}`)
  const warehouseName = (ids: number[] | null | undefined) => {
    if (!ids?.length) return '—'
    return ids.map(id => (warehouses ?? []).find(w => w.id === id)?.name ?? `#${id}`).join('、')
  }

  // 详情单独拉接口：requestSnapshot（审批要核对的原请求）只在详情里返回，列表没有
  const [detailRow, setDetailRow] = useState<BackfillTarget | null>(null)
  const { data: rawDetail, isLoading: detailLoading } = useBackfillDetail(detailRow?.id ?? null, detailRow?.refundContext)
  const detail = targetCurrent(detailRow) ? rawDetail : undefined
  const [approveTarget, setApproveTarget] = useState<BackfillTarget | null>(null)
  const [rejectTarget, setRejectTarget] = useState<BackfillTarget | null>(null)
  const [cancelTarget, setCancelTarget] = useState<BackfillTarget | null>(null)
  const [executeTarget, setExecuteTarget] = useState<BackfillTarget | null>(null)
  const [regenTarget, setRegenTarget] = useState<BackfillTarget | null>(null)

  const targets = useRef({ detail: detailRow, approve: approveTarget, reject: rejectTarget, cancel: cancelTarget, execute: executeTarget, regen: regenTarget })
  targets.current = { detail: detailRow, approve: approveTarget, reject: rejectTarget, cancel: cancelTarget, execute: executeTarget, regen: regenTarget }
  type TargetSlot = keyof typeof targets.current
  const slotCurrent = (slot: TargetSlot, target: BackfillTarget | null) => targetCurrent(target) && (target?.bizType !== 'supplier_refund' || targets.current[slot] === target)
  function clearTarget(slot: TargetSlot, target: BackfillTarget | null, set: (update: (current: BackfillTarget | null) => BackfillTarget | null) => void) {
    if (target?.bizType !== 'supplier_refund') { set(() => null); return }
    if (!slotCurrent(slot, target)) return
    set(current => current === target ? null : current)
  }
  const { mutate: approve, isPending: approving } = useApproveBackfill()
  const { mutate: reject, isPending: rejecting } = useRejectBackfill()
  const { mutate: cancel, isPending: cancelling } = useCancelBackfill()
  const { mutate: execute, isPending: executing } = useExecuteBackfill()
  const { mutate: regen, isPending: regenning } = useRegenerateBackfillVoucher()

  function doApprove(row: BackfillTarget, remark: string) {
    if (!slotCurrent('approve', row)) return
    approve({ id: row.id, remark: remark || undefined, refundContext: row.refundContext }, {
      onSuccess: (res) => {
        if (!slotCurrent('approve', row)) return
        // 批准与执行是同一次请求：执行成功但凭证没生成出来时，不能报「已批准并记账」了事——
        // 那会让人以为一切都完，而账上还差一张调整凭证。
        backfillResultToast(res, '已批准并记账')
        clearTarget('approve', row, setApproveTarget)
      },
      onError: error => { if (slotCurrent('approve', row)) refundError(row,error) },
    })
  }
  const columns: TableColumn<BackfillApplication>[] = [
    { key: 'applicationNo', title: '申请单号', width: 160, render: (_v, r) => (
      <div className="flex flex-col">
        <span className="font-mono text-doc-code-muted">{r.applicationNo}</span>
        <span className="text-xs text-muted-foreground">{formatDisplayDateTime(r.createdAt)}</span>
      </div>
    ) },
    { key: 'bizTypeName', title: '业务类型', width: 110, render: (_v, r) => <SoftStatusLabel label={r.bizTypeName} tone="info" /> },
    { key: 'bizNo', title: '业务单号', width: 150, render: (_v, r) => r.bizNo || '—' },
    { key: 'amount', title: '金额', width: 110, align: 'right', render: (_v, r) => (
      <span className="tabular-nums">{backfillMoney(r)}</span>
    ) },
    { key: 'period', title: '业务期间', width: 130, render: (_v, r) => (
      <div className="flex flex-col">
        <span className="font-mono">{r.period}</span>
        <span className="text-xs text-muted-foreground">{formatDisplayDate(r.businessDate)}</span>
      </div>
    ) },
    { key: 'reason', title: '申请原因', render: (_v, r) => (
      <span className="min-w-0 whitespace-normal [overflow-wrap:anywhere] text-muted-foreground">{r.reason}</span>
    ) },
    { key: 'status', title: '状态', width: 140, render: (_v, r) => {
      const s = statusOf(r)
      return (
        <span className="flex flex-wrap items-center gap-1">
          <SoftStatusLabel label={s.label} tone={s.tone} />
          {/* 已记账但调整凭证没生成：这是唯一需要再点一次的状态，必须显式标出来 */}
          {r.voucherPending && <SoftStatusLabel label="凭证待生成" tone="danger" />}
          {r.voucherNotRequired && <SoftStatusLabel label={r.bizType === 'supplier_refund' ? zeroProof : '不涉及凭证'} tone="draft" />}
        </span>
      )
    } },
    { key: 'applicantName', title: '申请人', width: 100, render: (_v, r) => r.applicantName || '—' },
    { key: 'postingPeriod', title: '凭证落期', width: 110, render: (_v, r) => (
      r.postingPeriod
        ? <span className="font-mono">{r.postingPeriod}</span>
        : <span className="text-muted-foreground">—</span>
    ) },
    { key: 'actions', title: '操作', width: 230, render: (_v, r) => (
      <div className="flex flex-wrap items-center gap-1">
        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setDetailRow(freezeTarget(r))}>详情</Button>
        {/* 待审批：审批人看到批准/驳回。没有审批权限的人只能看见自己提交的单子
            （后端按权限限定可见范围），所以「非审批人 + 待审批」必然是自己的单——撤回。 */}
        {r.status === 0 && canApprove && (
          <>
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-muted-foreground hover:text-success" onClick={() => setApproveTarget(freezeTarget(r))}>批准</Button>
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive" onClick={() => setRejectTarget(freezeTarget(r))}>驳回</Button>
          </>
        )}
        {r.status === 0 && !canApprove && (
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive" onClick={() => setCancelTarget(freezeTarget(r))}>撤回</Button>
        )}
        {/* 已批准但业务没写进去：可重试，或作废后重新申请 */}
        {r.pendingExecution && canApprove && (
          <>
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setExecuteTarget(freezeTarget(r))}>重试记账</Button>
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive" onClick={() => setCancelTarget(freezeTarget(r))}>作废</Button>
          </>
        )}
        {r.voucherPending && canApprove && (
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-muted-foreground hover:text-warning" onClick={() => setRegenTarget(freezeTarget(r))}>重试生成凭证</Button>
        )}
      </div>
    ) },
  ]

  return (
    <div>
      {!refundOwnerCurrent(refundOwner) && <p role="alert">供应商退款上下文已变化，请重新核对新上下文；原过滤与输入保留。</p>}
      {[approveTarget,rejectTarget,cancelTarget,executeTarget,regenTarget,detailRow].some(t=>t?.bizType==='supplier_refund'&&!targetCurrent(t)) && <p role="alert">原供应商退款上下文已变化，原输入保留，动作暂停。</p>}
      {refundWriteError && refundPageCurrent() && <p role="alert">{refundWriteError}</p>}
      <PageHeader
        title="跨期补录审批"
        description="已结账期间被拦下的付款/核销/退款在这里申请与审批：申请只留单不动账，批准后才真正记账，调整凭证落在补录当期"
        actions={
          <Button variant="outline" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`mr-1.5 h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />刷新
          </Button>
        }
      />

      {summary && (
        <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <CountCard label="待审批" value={summary.pending} hint="批准前一分钱都不动账" />
          <CountCard label="已批准 · 待记账" value={summary.pendingExecution} hint="批准了但还没记上，可重试" />
          <CountCard label="调整凭证待生成" value={summary.voucherPending} hint="业务已记账，账上还差一张凭证" />
        </div>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Select value={status === '' ? 'all' : String(status)} onValueChange={v => changeFilter(() => setStatus(v === 'all' ? '' : Number(v)))}>
          <SelectTrigger className="h-9 w-36"><SelectValue placeholder="状态" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部状态</SelectItem>
            {BACKFILL_STATUS_OPTIONS.map(o => <SelectItem key={o.value} value={String(o.value)}>{o.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={bizType || 'all'} onValueChange={v => changeFilter(() => setBizType(v === 'all' ? '' : v))}>
          <SelectTrigger className="h-9 w-40"><SelectValue placeholder="业务类型" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部业务</SelectItem>
            {BACKFILL_BIZ_TYPE_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
        <span>共 {total} 条{total > 0 && ` · 第 ${page} / ${pageCount} 页`}</span>
        {pageCount > 1 && (
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" className="h-8" disabled={page <= 1 || isFetching} onClick={() => setPage(p => Math.max(1, p - 1))}>
              <ChevronLeft className="mr-1 h-4 w-4" />上一页
            </Button>
            <Button variant="outline" size="sm" className="h-8" disabled={page >= pageCount || isFetching} onClick={() => setPage(p => Math.min(pageCount, p + 1))}>
              下一页<ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          </div>
        )}
      </div>

      <div className="card-base p-2">
        <DataTable columns={columns} data={list} loading={isLoading} emptyText="暂无补录申请" columnStorageKey="acct-backfills" />
      </div>

      <ListSummary total={total} />

      {/* ── 详情：审批人要据此核对原单号、金额、原因，以及原请求快照里钱怎么走 ── */}
      <Dialog open={targetOpen(detailRow)} onOpenChange={v => { if (!v) clearTarget('detail', detailRow, setDetailRow) }}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              补录申请 {targetNo(detailRow)}
              {detailRow && targetCurrent(detailRow) && <SoftStatusLabel label={statusOf(detailRow).label} tone={statusOf(detailRow).tone} />}
            </DialogTitle>
          </DialogHeader>
          {detailLoading && !detail && (
            <div className="py-6 text-center text-sm text-muted-foreground">加载详情…</div>
          )}
          {detail && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <Field label="业务类型" value={detail.bizTypeName} />
                <Field label="业务单号" value={detail.bizNo || '—'} mono />
                <Field label="补录金额" value={backfillMoney(detail)} />
                <Field label="业务期间" value={`${detail.period}（业务日期 ${formatDisplayDate(detail.businessDate)}）`} />
                <Field label="申请人" value={`${detail.applicantName || '—'}（${formatDisplayDateTime(detail.createdAt)}）`} />
                <Field label="凭证落期" value={detail.postingPeriod || '—'} mono />
                <div className="col-span-2"><Field label="申请原因" value={detail.reason} /></div>
                <Field label="审批人" value={detail.approverName ? `${detail.approverName}（${formatDisplayDateTime(detail.approvedAt)}）` : '—'} />
                <Field label="执行时间" value={detail.executedAt ? formatDisplayDateTime(detail.executedAt) : '—'} />
                {detail.approveRemark && <div className="col-span-2"><Field label="审批备注" value={detail.approveRemark} /></div>}
                {detail.voidReason && <div className="col-span-2"><Field label="作废/撤回原因" value={`${detail.voidReason}${detail.voidedByName ? `（${detail.voidedByName}）` : ''}`} /></div>}
              </div>

              {/* 批准是按这份快照原样重放一次业务，所以审批人必须先看见钱怎么走 */}
              <div>
                <div className="mb-1.5 text-xs font-medium text-muted-foreground">
                  申请时的原请求（批准即按它记账）
                </div>
                <SnapshotFields raw={detail.requestSnapshot} accountName={accountName} warehouseName={warehouseName} />
              </div>

              {detail.voucherPending && (
                <div className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">
                  这笔业务已经记账，但调整凭证没生成成功{detail.voucherGenerateError ? `：${detail.voucherGenerateError}` : ''}。
                  请关闭本窗口后在列表里点「重试生成凭证」——账上还差这一张。
                </div>
              )}
              {detail.voucherNotRequired && (
                <div className="rounded-md bg-muted/40 p-2 text-xs text-muted-foreground">
                  {detail.bizType === 'supplier_refund' ? `${zeroProof}；真实现金回款事实已保留。` : '本类补录（核销）不产生会计凭证：凭证在收付款单登记时就已生成，这里不再重复。'}
                </div>
              )}
              {detail.pendingExecution && (
                <div className="rounded-md border border-warning/40 bg-warning/5 p-2 text-xs text-warning">
                  这张单已批准，但业务没能执行成功（常见原因：业务单据已被改动或作废）。
                  可回列表重试记账；若业务本身已做不了，请作废它再按新情况重新申请。
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <RemarkDialog
        open={!!approveTarget}
        visible={approveTarget?.bizType !== 'supplier_refund' || active}
        title={`批准并记账「${targetNo(approveTarget) ?? ''}」`}
        description={
          <>
            <p>批准后<strong>立即</strong>按申请时记录的信息执行：业务单据与资金流水（钱从哪个账户走）一起保存，凭证记入「补录当期」——执行审批日所在的会计期间。</p>
            <p className="mt-1.5">
              随后系统再为这笔业务<strong>单独生成</strong>落在补录当期的调整凭证。这一步独立进行、<strong>可能失败</strong>：
              失败会停在「凭证待生成」，可在列表里重试，已经记上的业务不受影响。
            </p>
            <p className="mt-1.5">
              金额 {targetCurrent(approveTarget) && approveTarget ? backfillMoney(approveTarget) : '—'} · 业务单号 {targetCurrent(approveTarget) ? approveTarget?.bizNo || '—' : '—'}。
              批准人不能是申请人；批准后不能撤销，只有在业务没记上时才可作废。
            </p>
          </>
        }
        label="审批备注"
        placeholder="如：已核对原单，同意补录（选填）"
        required={false}
        confirmText="确认批准并记账"
        loading={approving}
        disabled={!!approveTarget && !slotCurrent('approve', approveTarget)}
        onClose={() => clearTarget('approve', approveTarget, setApproveTarget)}
        onSubmit={remark => approveTarget && doApprove(approveTarget, remark)}
      />

      <RemarkDialog
        open={!!rejectTarget}
        visible={rejectTarget?.bizType !== 'supplier_refund' || active}
        title={`驳回「${targetNo(rejectTarget) ?? ''}」`}
        description="驳回后申请人要能看到为什么被驳回，否则只能反复提交同一张单，所以原因必填。驳回不产生任何记账。"
        label="驳回原因"
        placeholder="如：该笔业务已由其他方式入账，无需补录"
        required
        destructive
        confirmText="确认驳回"
        loading={rejecting}
        disabled={!!rejectTarget && !slotCurrent('reject', rejectTarget)}
        onClose={() => clearTarget('reject', rejectTarget, setRejectTarget)}
        onSubmit={remark => rejectTarget && slotCurrent('reject', rejectTarget) && reject({ id: rejectTarget.id, remark, refundContext: rejectTarget.refundContext }, {
          onSuccess: () => { if (!slotCurrent('reject', rejectTarget)) return; toast.success('已驳回'); clearTarget('reject', rejectTarget, setRejectTarget) },
          onError: error => { if (slotCurrent('reject', rejectTarget)) refundError(rejectTarget,error) },
        })}
      />

      <RemarkDialog
        open={!!cancelTarget}
        visible={cancelTarget?.bizType !== 'supplier_refund' || active}
        title={cancelTarget?.status === 0 ? `撤回「${targetNo(cancelTarget) ?? ''}」` : `作废「${targetNo(cancelTarget) ?? ''}」`}
        description={
          cancelTarget?.status === 0
            ? '撤回后这张申请单不再进入审批，也没有任何记账发生。要再补录需要重新申请。'
            : '作废后这张单子不再重试，业务也没有记账。若这笔业务确实还需要补录，请按新情况重新申请。'
        }
        label={cancelTarget?.status === 0 ? '撤回原因' : '作废原因'}
        placeholder="如：业务已按新情况重新提交"
        required
        destructive
        confirmText={cancelTarget?.status === 0 ? '确认撤回' : '确认作废'}
        loading={cancelling}
        disabled={!!cancelTarget && !slotCurrent('cancel', cancelTarget)}
        onClose={() => clearTarget('cancel', cancelTarget, setCancelTarget)}
        onSubmit={reason => cancelTarget && slotCurrent('cancel', cancelTarget) && cancel({ id: cancelTarget.id, reason, refundContext: cancelTarget.refundContext }, {
          onSuccess: () => { if (!slotCurrent('cancel', cancelTarget)) return; toast.success(cancelTarget.status === 0 ? '已撤回' : '已作废'); clearTarget('cancel', cancelTarget, setCancelTarget) },
          onError: error => { if (slotCurrent('cancel', cancelTarget)) refundError(cancelTarget,error) },
        })}
      />

      <ConfirmDialog
        open={targetOpen(executeTarget)}
        title={`重试记账「${targetNo(executeTarget) ?? ''}」`}
        description="按申请时保存的业务信息重新执行一次这笔业务。若原业务已被改动或作废，会再次失败——那时请作废这张单子重新申请。"
        confirmText="确认重试"
        loading={executing}
        onConfirm={() => executeTarget && slotCurrent('execute', executeTarget) && execute({ id: executeTarget.id, refundContext: executeTarget.refundContext }, {
          onSuccess: (res) => {
            if (!slotCurrent('execute', executeTarget)) return
            backfillResultToast(res, '已记账')
            clearTarget('execute', executeTarget, setExecuteTarget)
          },
          onError: error => { if (slotCurrent('execute', executeTarget)) refundError(executeTarget,error) },
        })}
        onCancel={() => clearTarget('execute', executeTarget, setExecuteTarget)}
      />

      <ConfirmDialog
        open={targetOpen(regenTarget)}
        title={`重新生成调整凭证「${targetNo(regenTarget) ?? ''}」`}
        description="业务已经记过账了，这一步只补生成那张缺失的调整凭证，不会重复记账。"
        confirmText="确认生成"
        loading={regenning}
        onConfirm={() => regenTarget && slotCurrent('regen', regenTarget) && regen({ id: regenTarget.id, refundContext: regenTarget.refundContext }, {
          onSuccess: res => { if (!slotCurrent('regen', regenTarget)) return; backfillResultToast(res, '调整凭证已生成'); clearTarget('regen', regenTarget, setRegenTarget) },
          onError: error => { if (slotCurrent('regen', regenTarget)) refundError(regenTarget,error) },
        })}
        onCancel={() => clearTarget('regen', regenTarget, setRegenTarget)}
      />
    </div>
  )
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-col">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={`whitespace-normal [overflow-wrap:anywhere] ${mono ? 'font-mono' : ''}`}>{value}</span>
    </div>
  )
}
