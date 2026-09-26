import { useEffect, useMemo, useState, type ReactNode } from 'react'
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
import { usePermission } from '@/hooks/usePermission'
import { PERMISSIONS } from '@/lib/permission-codes'
import { getActiveAccountsApi } from '@/api/finance'
import { useWarehousesActive } from '@/hooks/useWarehouses'
import {
  useBackfills, useBackfillDetail, useApproveBackfill, useRejectBackfill, useCancelBackfill,
  useExecuteBackfill, useRegenerateBackfillVoucher,
} from '@/hooks/useBackfills'
import type { TableColumn } from '@/types'
import {
  BACKFILL_STATUS_OPTIONS, BACKFILL_BIZ_TYPE_OPTIONS,
  type BackfillApplication,
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
  // 退款专用：申请当时的出款账户/金额/日期/客户，执行时会拿它们核对单据有没有被改过
  refundDate?: string | null
  saleOrderNo?: string | null
  customerName?: string | null
}
interface Snapshot {
  kind: 'payment' | 'receipt' | 'receipt_settle' | 'refund'
  recordId?: number
  receiptId?: number
  orderId?: number
  warehouseIds?: number[] | null
  body?: SnapshotBody
}

function readSnapshot(raw: unknown): Snapshot | null {
  if (!raw || typeof raw !== 'object') return null
  const kind = (raw as { kind?: unknown }).kind
  return kind === 'payment' || kind === 'receipt' || kind === 'receipt_settle' || kind === 'refund'
    ? raw as Snapshot
    : null
}

const dash = '—'
const money = (v: number | null | undefined) => (v == null ? dash : amount(Number(v)))

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
  onClose, onSubmit,
}: {
  open: boolean
  title: string
  description: ReactNode
  label: string
  placeholder: string
  required: boolean
  confirmText: string
  destructive?: boolean
  loading: boolean
  onClose: () => void
  onSubmit: (remark: string) => void
}) {
  const [text, setText] = useState('')
  // 每次打开都清空：上一次的备注跟着弹窗留在输入框里，会被下一次误提交进审批留痕
  useEffect(() => { if (open) setText('') }, [open])
  const invalid = required && text.trim().length < 2
  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose() }}>
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
              disabled={loading}
              autoFocus
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={loading}>取消</Button>
          <Button
            variant={destructive ? 'destructive' : 'default'}
            onClick={() => onSubmit(text.trim())}
            disabled={loading || invalid}
          >
            {loading ? '处理中…' : confirmText}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default function BackfillsPage() {
  const { can } = usePermission()
  // 批准、驳回、作废他人的单子都要这一档权限；没有它的人进来只能看自己提交的申请
  // （后端按权限决定可见范围），并在待审批时撤回自己的单子。
  const canApprove = can(PERMISSIONS.FINANCE_PERIOD_BACKFILL_APPROVE)

  const [status, setStatus] = useState<number | ''>('')
  const [bizType, setBizType] = useState('')
  const [page, setPage] = useState(1)
  const query = useMemo(() => ({ status, bizType, page, pageSize: PAGE_SIZE }), [status, bizType, page])
  const { data, isLoading, isFetching, refetch } = useBackfills(query)
  const list = data?.list ?? []
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
  const [detailRow, setDetailRow] = useState<BackfillApplication | null>(null)
  const { data: detail, isLoading: detailLoading } = useBackfillDetail(detailRow?.id ?? null)
  const [approveTarget, setApproveTarget] = useState<BackfillApplication | null>(null)
  const [rejectTarget, setRejectTarget] = useState<BackfillApplication | null>(null)
  const [cancelTarget, setCancelTarget] = useState<BackfillApplication | null>(null)
  const [executeTarget, setExecuteTarget] = useState<BackfillApplication | null>(null)
  const [regenTarget, setRegenTarget] = useState<BackfillApplication | null>(null)

  const { mutate: approve, isPending: approving } = useApproveBackfill()
  const { mutate: reject, isPending: rejecting } = useRejectBackfill()
  const { mutate: cancel, isPending: cancelling } = useCancelBackfill()
  const { mutate: execute, isPending: executing } = useExecuteBackfill()
  const { mutate: regen, isPending: regenning } = useRegenerateBackfillVoucher()

  function doApprove(row: BackfillApplication, remark: string) {
    approve({ id: row.id, remark: remark || undefined }, {
      onSuccess: (res) => {
        // 批准与执行是同一次请求：执行成功但凭证没生成出来时，不能报「已批准并记账」了事——
        // 那会让人以为一切都完，而账上还差一张调整凭证。
        if (res?.voucherError) toast.warning('已批准并记账，但调整凭证未生成成功，请在列表里重试生成')
        else toast.success('已批准并记账')
        setApproveTarget(null)
      },
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
      <span className="tabular-nums">{r.amount == null ? '—' : amount(r.amount)}</span>
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
          {r.voucherNotRequired && <SoftStatusLabel label="不涉及凭证" tone="draft" />}
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
        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setDetailRow(r)}>详情</Button>
        {/* 待审批：审批人看到批准/驳回。没有审批权限的人只能看见自己提交的单子
            （后端按权限限定可见范围），所以「非审批人 + 待审批」必然是自己的单——撤回。 */}
        {r.status === 0 && canApprove && (
          <>
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-muted-foreground hover:text-success" onClick={() => setApproveTarget(r)}>批准</Button>
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive" onClick={() => setRejectTarget(r)}>驳回</Button>
          </>
        )}
        {r.status === 0 && !canApprove && (
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive" onClick={() => setCancelTarget(r)}>撤回</Button>
        )}
        {/* 已批准但业务没写进去：可重试，或作废后重新申请 */}
        {r.pendingExecution && canApprove && (
          <>
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setExecuteTarget(r)}>重试记账</Button>
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive" onClick={() => setCancelTarget(r)}>作废</Button>
          </>
        )}
        {r.voucherPending && canApprove && (
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-muted-foreground hover:text-warning" onClick={() => setRegenTarget(r)}>重试生成凭证</Button>
        )}
      </div>
    ) },
  ]

  return (
    <div>
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
      <Dialog open={!!detailRow} onOpenChange={v => { if (!v) setDetailRow(null) }}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              补录申请 {detailRow?.applicationNo}
              {detailRow && <SoftStatusLabel label={statusOf(detailRow).label} tone={statusOf(detailRow).tone} />}
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
                <Field label="补录金额" value={detail.amount == null ? '—' : amount(detail.amount)} />
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
                  本类补录（核销）不产生会计凭证：凭证在收付款单登记时就已生成，这里不再重复。
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
        title={`批准并记账「${approveTarget?.applicationNo ?? ''}」`}
        description={
          <>
            <p>批准后<strong>立即</strong>按申请时记录的信息执行：业务单据与资金流水（钱从哪个账户走）一起保存，凭证记入「补录当期」——执行审批日所在的会计期间。</p>
            <p className="mt-1.5">
              随后系统再为这笔业务<strong>单独生成</strong>落在补录当期的调整凭证。这一步独立进行、<strong>可能失败</strong>：
              失败会停在「凭证待生成」，可在列表里重试，已经记上的业务不受影响。
            </p>
            <p className="mt-1.5">
              金额 {approveTarget?.amount == null ? '—' : amount(approveTarget.amount)} · 业务单号 {approveTarget?.bizNo || '—'}。
              批准人不能是申请人；批准后不能撤销，只有在业务没记上时才可作废。
            </p>
          </>
        }
        label="审批备注"
        placeholder="如：已核对原单，同意补录（选填）"
        required={false}
        confirmText="确认批准并记账"
        loading={approving}
        onClose={() => setApproveTarget(null)}
        onSubmit={remark => approveTarget && doApprove(approveTarget, remark)}
      />

      <RemarkDialog
        open={!!rejectTarget}
        title={`驳回「${rejectTarget?.applicationNo ?? ''}」`}
        description="驳回后申请人要能看到为什么被驳回，否则只能反复提交同一张单，所以原因必填。驳回不产生任何记账。"
        label="驳回原因"
        placeholder="如：该笔业务已由其他方式入账，无需补录"
        required
        destructive
        confirmText="确认驳回"
        loading={rejecting}
        onClose={() => setRejectTarget(null)}
        onSubmit={remark => rejectTarget && reject({ id: rejectTarget.id, remark }, {
          onSuccess: () => { toast.success('已驳回'); setRejectTarget(null) },
        })}
      />

      <RemarkDialog
        open={!!cancelTarget}
        title={cancelTarget?.status === 0 ? `撤回「${cancelTarget?.applicationNo ?? ''}」` : `作废「${cancelTarget?.applicationNo ?? ''}」`}
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
        onClose={() => setCancelTarget(null)}
        onSubmit={reason => cancelTarget && cancel({ id: cancelTarget.id, reason }, {
          onSuccess: () => { toast.success(cancelTarget.status === 0 ? '已撤回' : '已作废'); setCancelTarget(null) },
        })}
      />

      <ConfirmDialog
        open={!!executeTarget}
        title={`重试记账「${executeTarget?.applicationNo ?? ''}」`}
        description="按申请时保存的业务信息重新执行一次这笔业务。若原业务已被改动或作废，会再次失败——那时请作废这张单子重新申请。"
        confirmText="确认重试"
        loading={executing}
        onConfirm={() => executeTarget && execute(executeTarget.id, {
          onSuccess: (res) => {
            if (res?.voucherError) toast.warning('已记账，但调整凭证未生成成功，请在列表里重试生成')
            else toast.success('已记账')
            setExecuteTarget(null)
          },
        })}
        onCancel={() => setExecuteTarget(null)}
      />

      <ConfirmDialog
        open={!!regenTarget}
        title={`重新生成调整凭证「${regenTarget?.applicationNo ?? ''}」`}
        description="业务已经记过账了，这一步只补生成那张缺失的调整凭证，不会重复记账。"
        confirmText="确认生成"
        loading={regenning}
        onConfirm={() => regenTarget && regen(regenTarget.id, {
          onSuccess: () => { toast.success('调整凭证已生成'); setRegenTarget(null) },
        })}
        onCancel={() => setRegenTarget(null)}
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
