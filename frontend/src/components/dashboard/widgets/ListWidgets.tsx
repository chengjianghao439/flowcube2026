import { useNavigate } from 'react-router-dom'
import {
  AlertTriangle, Truck, ScanLine, HandCoins, Wallet, ListTodo, Users, Building2, TriangleAlert, ChevronRight, ClipboardCheck,
} from 'lucide-react'
import { WidgetShell } from '../WidgetShell'
import { money, EMPTY_HINT } from '../chartTheme'
import { SoftStatusLabel } from '@/components/shared/StatusBadge'
import { formatDisplayDate } from '@/lib/dateTime'
import { useWorkspaceStore } from '@/store/workspaceStore'
import type { AgingParty } from '@/api/payments'
import {
  useLowStock, useIncomingPurchases, usePdaPerformance, useAging,
  useRoleWorkbench, useSaleStats, usePurchaseStats, usePdaAnomaly,
  usePendingApprovalsBrief,
} from '@/hooks/useDashboard'
import type { PendingApproval } from '@/types/approval'

// 固定卡高下，滚动交给 WidgetShell 的 scrollBody；列表本身只管排布
const scroll = 'space-y-1'

// —— 低库存预警（dashboard.view）——
export function ListLowStock() {
  const { data, isLoading, error, refetch } = useLowStock(10)
  return (
    <WidgetShell loading={isLoading} error={error} onRetry={() => void refetch()} title="低库存预警" icon={AlertTriangle} tone="danger" scrollBody
      action={data && data.length > 0 ? <SoftStatusLabel label={`本卡 ${data.length} 项`} tone="danger" /> : undefined}>
      {!data?.length ? <p className={EMPTY_HINT}>暂无低库存商品</p> : (
        <div className={scroll}>
          <p className="pb-2 text-xs leading-5 text-muted-foreground">实物库存 ≤ 10，最多展示 20 项；完整明细见“需要关注”。</p>
          {data.map((item, index) => (
            <div key={`${item.id}-${item.warehouseName}-${index}`} className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-1 py-3 text-sm">
              <div className="min-w-0 flex-1">
                <span className="font-medium text-foreground">{item.name}</span>
                <span className="mt-1 block text-xs text-muted-foreground">{item.code}</span>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <span className="text-xs text-muted-foreground">{item.warehouseName}</span>
                <SoftStatusLabel label={`${item.quantity} ${item.unit}`} tone="danger" />
              </div>
            </div>
          ))}
        </div>
      )}
    </WidgetShell>
  )
}

// —— 到货看板（dashboard.view）——
export function BoardIncoming() {
  const { data, isLoading, error, refetch } = useIncomingPurchases()
  const total = data ? data.dueToday.length + data.dueThisWeek.length + data.overdue.length : 0
  const cols = ([
    { key: 'overdue' as const, label: '已逾期未到货', tone: 'text-destructive' },
    { key: 'dueToday' as const, label: '今日待到货', tone: 'text-warning' },
    { key: 'dueThisWeek' as const, label: '本周待到货', tone: 'text-foreground' },
  ])
  return (
    <WidgetShell loading={isLoading} error={error} onRetry={() => void refetch()} title="到货看板" icon={Truck} tone="warning" scrollBody
      action={data && data.overdue.length > 0 ? <SoftStatusLabel label={`${data.overdue.length} 逾期`} tone="danger" /> : undefined}>
      {total === 0 ? <p className={EMPTY_HINT}>近期无待到货采购单</p> : (
        <div className="dashboard-incoming-grid grid grid-cols-1 gap-4">
          {cols.map(col => (
            <div key={col.key}>
              <p className={`mb-2 text-xs font-medium ${col.tone}`}>{col.label}（{data?.[col.key].length ?? 0}）</p>
              {!data?.[col.key].length ? <p className="text-xs text-muted-foreground">无</p> : (
                <div className="space-y-1">
                  {data[col.key].map(po => (
                    <div key={po.id} className="border-b border-border py-2.5 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate font-medium text-foreground">{po.orderNo}</span>
                        <span className="shrink-0 text-muted-foreground">{formatDisplayDate(po.expectedDate)}</span>
                      </div>
                      <p className="truncate text-muted-foreground">{po.supplierName}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </WidgetShell>
  )
}

// —— 今日 PDA 作业（report.view）——
export function ListPdaPerf() {
  const { data, isLoading, error, refetch } = usePdaPerformance()
  const ops = data?.operators ?? []
  return (
    <WidgetShell loading={isLoading} error={error} onRetry={() => void refetch()} title="今日 PDA 作业" icon={ScanLine} tone="info" scrollBody>
      <div className="grid grid-cols-2 divide-x divide-border border-b border-border pb-3">
        <div className="min-w-0 px-2 py-2">
          <p className="text-xs text-muted-foreground">今日扫码量</p>
          <p className="mt-0.5 text-2xl font-semibold tabular-nums text-primary">{data?.today.scanCount ?? '—'}</p>
        </div>
        <div className="min-w-0 px-2 py-2">
          <p className="text-xs text-muted-foreground">今日拣货量</p>
          <p className="mt-0.5 text-2xl font-semibold tabular-nums text-foreground">{data ? data.today.pickQty.toFixed(0) : '—'}</p>
        </div>
      </div>
      {ops.length > 0 ? (
        <div className="mt-3 space-y-1">
          <p className="mb-1 text-xs font-medium text-muted-foreground">操作员排行</p>
          {ops.slice(0, 5).map((op, i) => (
            <div key={op.operatorId} className="flex items-center gap-3 rounded-lg px-2 py-1.5 transition-colors hover:bg-muted/40">
              <span className={`w-4 text-center text-xs font-bold ${i === 0 ? 'text-warning' : i === 1 ? 'text-muted-foreground' : i === 2 ? 'text-orange-400' : 'text-muted-foreground'}`}>{i + 1}</span>
              <p className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{op.operatorName}</p>
              <span className="text-xs text-muted-foreground"><span className="font-semibold text-foreground">{op.scanCount}</span> 次 · <span className="font-semibold text-foreground">{op.pickQty.toFixed(0)}</span> 件</span>
            </div>
          ))}
        </div>
      ) : <p className="mt-4 text-center text-sm text-muted-foreground">今日暂无 PDA 扫码记录</p>}
    </WidgetShell>
  )
}

// —— 催收 / 催付 Top（payment.view）——
function PartyTable({ parties, empty }: { parties: AgingParty[]; empty: string }) {
  if (parties.length === 0) return <p className={EMPTY_HINT}>{empty}</p>
  return (
    <div className="divide-y divide-border">
      {parties.map(p => <div key={p.partyName} className="py-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="min-w-0 flex-1 truncate text-sm font-medium" title={p.partyName}>{p.partyName}</p>
          <strong className="text-sm tabular-nums">{money(p.amount)}</strong>
        </div>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>逾期金额 <span className={p.overdueAmount > 0 ? 'font-medium text-destructive' : ''}>{money(p.overdueAmount)}</span></span>
          {p.maxOverdueDays > 0 ? <SoftStatusLabel label={`最长逾期 ${p.maxOverdueDays} 天`} tone={p.maxOverdueDays > 90 ? 'danger' : 'warning'} /> : <span>未到期</span>}
        </div>
      </div>)}
    </div>
  )
}
export function ListCollectTop() {
  const { data, isLoading, error, refetch } = useAging()
  return (
    <WidgetShell loading={isLoading} error={error} onRetry={() => void refetch()} title="催收 Top（应收敞口）" icon={HandCoins} tone="info" scrollBody>
      <PartyTable parties={data?.receivable.topParties ?? []} empty="暂无应收敞口" />
    </WidgetShell>
  )
}
export function ListPayTop() {
  const { data, isLoading, error, refetch } = useAging()
  return (
    <WidgetShell loading={isLoading} error={error} onRetry={() => void refetch()} title="催付 Top（应付敞口）" icon={Wallet} tone="warning" scrollBody>
      <PartyTable parties={data?.payable.topParties ?? []} empty="暂无应付敞口" />
    </WidgetShell>
  )
}

// —— 角色工作台（report.view）——
export function BoardWorkbench() {
  const { data, isLoading, error, refetch } = useRoleWorkbench()
  const navigate = useNavigate()
  const addTab = useWorkspaceStore(s => s.addTab)
  const cards = (data?.sections ?? []).flatMap(s => s.cards).filter(c => c.count > 0).sort((a, b) => b.priorityRank - a.priorityRank).slice(0, 6)
  function go(path: string, title: string) { addTab({ key: path, title, path }); navigate(path) }
  return (
    <WidgetShell loading={isLoading} error={error} onRetry={() => void refetch()} title="我的工作台" icon={ListTodo} tone="primary" scrollBody
      action={data && data.summary.totalAlerts > 0 ? <SoftStatusLabel label={`${data.summary.totalAlerts} 待办`} tone="warning" /> : undefined}>
      {cards.length === 0 ? <p className={EMPTY_HINT}>暂无待处理事项，一切就绪</p> : (
        <div className="space-y-1">
          {cards.map(c => (
            <button key={c.key} type="button" onClick={() => go(c.path, c.title)}
              className="flex w-full items-center gap-3 dashboard-row-action border-b border-border px-2 py-3 text-left">
              <SoftStatusLabel label={String(c.count)} tone={c.accent === 'rose' ? 'danger' : c.accent === 'amber' ? 'warning' : c.accent === 'emerald' ? 'success' : 'info'} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">{c.title}</p>
                <p className="truncate text-xs text-muted-foreground">{c.description}</p>
              </div>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            </button>
          ))}
        </div>
      )}
    </WidgetShell>
  )
}

// —— Top 客户 / 供应商（report.view）——
export function ListTopCustomer() {
  const { data, isLoading, error, refetch } = useSaleStats()
  const rows = (data?.byCustomer ?? []).slice(0, 8)
  return (
    <WidgetShell loading={isLoading} error={error} onRetry={() => void refetch()} title="Top 客户（销售额）" icon={Users} tone="success" scrollBody>
      {rows.length === 0 ? <p className={EMPTY_HINT}>该区间内暂无销售</p> : (
        <div className={scroll}>
          {rows.map((c, i) => (
            <div key={c.customerName} className="flex items-center gap-3 border-b border-border px-1 py-3 text-sm">
              <span className="w-4 text-center text-xs font-bold text-muted-foreground">{i + 1}</span>
              <p className="min-w-0 flex-1 truncate font-medium text-foreground" title={c.customerName}>{c.customerName}</p>
              <span className="shrink-0 text-xs text-muted-foreground">{c.orderCount} 单</span>
              <span className="shrink-0 text-right tabular-nums font-semibold text-foreground">{money(c.totalAmount)}</span>
            </div>
          ))}
        </div>
      )}
    </WidgetShell>
  )
}
export function ListTopSupplier() {
  const { data, isLoading, error, refetch } = usePurchaseStats()
  const rows = (data?.bySupplier ?? []).slice(0, 8)
  return (
    <WidgetShell loading={isLoading} error={error} onRetry={() => void refetch()} title="Top 供应商（采购额）" icon={Building2} tone="warning" scrollBody>
      {rows.length === 0 ? <p className={EMPTY_HINT}>该区间内暂无采购</p> : (
        <div className={scroll}>
          {rows.map((s, i) => (
            <div key={s.supplierName} className="flex items-center gap-3 border-b border-border px-1 py-3 text-sm">
              <span className="w-4 text-center text-xs font-bold text-muted-foreground">{i + 1}</span>
              <p className="min-w-0 flex-1 truncate font-medium text-foreground" title={s.supplierName}>{s.supplierName}</p>
              <span className="shrink-0 text-xs text-muted-foreground">{s.orderCount} 单</span>
              <span className="shrink-0 text-right tabular-nums font-semibold text-foreground">{money(s.totalAmount)}</span>
            </div>
          ))}
        </div>
      )}
    </WidgetShell>
  )
}

// —— 待我审批（approval.task.view）——
const BIZ_LABEL: Record<string, string> = {
  purchase_requisition: '采购申请单',
  expense_claim: '费用报销',
  purchase_order: '采购单',
  inventory_disposal: '滞销处理单',
  sale_credit_override: '超额放行',
  product_price: '商品改价',
}

function approvalDetailPath(item: PendingApproval): string {
  switch (item.bizType) {
    case 'purchase_requisition': return `/purchase-requisitions/${item.bizId}`
    case 'expense_claim': return `/finance/expenses`
    case 'inventory_disposal': return `/disposals/${item.bizId}`
    case 'sale_credit_override': return `/credit-overrides/${item.bizId}`
    case 'purchase_order': return `/purchase/${item.bizId}`
    case 'product_price': return `/products`
    default: return `/approvals/pending`
  }
}

export function ListPendingApprovals() {
  const { data, isLoading, error, refetch } = usePendingApprovalsBrief()
  const navigate = useNavigate()
  const addTab = useWorkspaceStore(s => s.addTab)
  const list = data?.list ?? []
  const total = data?.pagination.total ?? 0
  function go(path: string, title: string) { addTab({ key: path, title, path }); navigate(path) }
  return (
    <WidgetShell loading={isLoading} error={error} onRetry={() => void refetch()} title="待我审批" icon={ClipboardCheck} tone="warning" scrollBody
      action={total > 0 ? <SoftStatusLabel label={`${total} 件待办`} tone="warning" /> : undefined}>
      {list.length === 0 ? <p className={EMPTY_HINT}>暂无待你审批的单据</p> : (
        <div className="space-y-1">
          {list.slice(0, 5).map(item => (
            <button
              key={item.instanceId}
              type="button"
              onClick={() => go(approvalDetailPath(item), `待审批 · ${BIZ_LABEL[item.bizType] ?? item.bizType}`)}
              className="flex w-full items-center gap-3 dashboard-row-action border-b border-border px-2 py-3 text-left"
            >
              <SoftStatusLabel label={BIZ_LABEL[item.bizType] ?? '审批'} tone="info" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">{item.no || `#${item.bizId}`}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {item.title || '—'} · {item.applicantName} · ¥{item.amount.toFixed(2)}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-xs text-muted-foreground">第 {item.currentStep} 级</p>
                <p className="text-xs text-muted-foreground">{formatDisplayDate(item.createdAt)}</p>
              </div>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            </button>
          ))}
        </div>
      )}
    </WidgetShell>
  )
}

// —— 异常扫码分析（scan.log.view）——
export function ListAnomaly() {  const { data, isLoading, error, refetch } = usePdaAnomaly()
  const reasons = data?.byReason ?? []
  return (
    <WidgetShell loading={isLoading} error={error} onRetry={() => void refetch()} title="异常扫码分析（近 30 天）" icon={TriangleAlert} tone="danger" scrollBody>
      <div className="grid grid-cols-3 divide-x divide-border border-b border-border pb-3">
        <div className="min-w-0 px-2 py-2">
          <p className="text-xs text-muted-foreground">扫码总数</p>
          <p className="mt-0.5 text-xl font-semibold tabular-nums text-foreground">{data?.summary.totalScans ?? '—'}</p>
        </div>
        <div className="min-w-0 px-2 py-2">
          <p className="text-xs text-muted-foreground">异常数</p>
          <p className="mt-0.5 text-xl font-semibold tabular-nums text-destructive">{data?.summary.totalErrors ?? '—'}</p>
        </div>
        <div className="min-w-0 px-2 py-2">
          <p className="text-xs text-muted-foreground">异常率</p>
          <p className="mt-0.5 text-xl font-semibold tabular-nums text-warning">{data?.summary.errorRate ?? '—'}</p>
        </div>
      </div>
      {reasons.length > 0 ? (
        <div className="mt-3 space-y-1">
          <p className="mb-1 text-xs font-medium text-muted-foreground">异常原因分布</p>
          {reasons.slice(0, 5).map(r => (
            <div key={r.reason} className="flex items-center justify-between rounded-lg px-2 py-1 text-sm">
              <span className="truncate text-foreground">{r.reason}</span>
              <SoftStatusLabel label={`${r.count} 次`} tone="danger" />
            </div>
          ))}
        </div>
      ) : <p className="mt-4 text-center text-sm text-muted-foreground">近 30 天无异常扫码记录</p>}
    </WidgetShell>
  )
}
