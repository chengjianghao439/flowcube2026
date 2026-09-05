import { lazy, Suspense, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getLowStockPageApi } from '@/api/dashboard'
import PrioritySales from './PrioritySales'
const RiskDetails = lazy(()=>import('./RiskDetails'))
import {
  ArrowUpRight,
  ChevronRight,
  ClipboardList,
  Truck,
  ShieldAlert,
  CalendarClock,
  ClipboardCheck,
  Plus,
  Boxes,
  HandCoins,
  Gauge,
  type LucideIcon,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import {
  useDashboardSummary,
  useAging,
  usePendingApprovalsBrief,
  useCreditWarning,

} from '@/hooks/useDashboard'
import { usePermission } from '@/hooks/usePermission'
import { useWorkspaceStore } from '@/store/workspaceStore'
import { PERMISSIONS } from '@/lib/permission-codes'
import { Button } from '@/components/ui/button'
import { QueryErrorState } from '@/components/shared/QueryErrorState'
import { SoftStatusLabel } from '@/components/shared/StatusBadge'
import { WidgetShell } from '../WidgetShell'
import { StatTile } from '../StatTile'
import { money } from '../chartTheme'
import { cn } from '@/lib/utils'

function useOpenPage() {
  const navigate = useNavigate()
  const addTab = useWorkspaceStore((s) => s.addTab)
  return (path: string, title: string) => {
    addTab({ key: path, path, title })
    navigate(path)
  }
}
export function KpiApprovalCount() {
  const { data, isLoading, error, refetch } = usePendingApprovalsBrief()
  return (
    <StatTile
      label="待我审批"
      value={data?.pagination?.total ?? '—'}
      hint="流转至当前审批节点"
      icon={ClipboardCheck}
      loading={isLoading} error={error} onRetry={() => void refetch()}
    />
  )
}
export function BoardSalesActions() {
  const [priority,setPriority]=useState(true)
  const { data, isLoading, error, refetch } = useDashboardSummary()
  const { can } = usePermission()
  const open = useOpenPage()
  const rows = [
    {
      label: '销售待占库',
      hint: '订单已创建，等待分配可承诺库存',
      count: data ? (data.saleStatusCounts?.['1'] ?? 0) : undefined,
      path: '/sale?status=1&range=all',
      permission: PERMISSIONS.SALE_ORDER_VIEW,
    },
    {
      label: '部分占库待补齐',
      hint: '查看未占量与可承诺库存',
      count: data ? (data.saleStatusCounts?.['6'] ?? 0) : undefined,
      path: '/sale?status=6&range=all',
      permission: PERMISSIONS.SALE_ORDER_VIEW,
    },
    {
      label: '已占库待发货',
      hint: '已完成占用，可以创建出库任务',
      count: data ? (data.saleStatusCounts?.['2'] ?? 0) : undefined,
      path: '/sale?status=2&range=all',
      permission: PERMISSIONS.SALE_ORDER_VIEW,
    },
    {
      label: '仓库执行中',
      hint: '跟进拣货、分拣、复核、打包与出库',
      count: data ? (data.saleStatusCounts?.['3'] ?? 0) : undefined,
      path: '/sale?status=3&range=all',
      permission: PERMISSIONS.SALE_ORDER_VIEW,
    },
    {
      label: '待处理采购',
      hint: '草稿与已提交的采购订单',
      count: data?.pendingPurchaseOrders,
      path: '/purchase',
      permission: PERMISSIONS.PURCHASE_ORDER_VIEW,
    },
  ].filter((row) => can(row.permission))
  return (
    <WidgetShell
      title="今天要推进的业务"
      icon={ClipboardList}
      scrollBody
      action={<Button variant="outline" size="sm" className="h-8 px-2.5 text-xs" onClick={()=>setPriority(v=>!v)}>{priority?'状态总览':'优先处理'}</Button>}
    >
      {priority ? <PrioritySales/> : error ? (
        <QueryErrorState error={error} onRetry={() => void refetch()} compact />
      ) : (
        rows.map((row) => (
          <button
            key={row.label}
            onClick={() => open(row.path, row.label)}
            className="dashboard-row-action flex w-full items-center gap-3 border-b border-border px-2 py-2.5 text-left disabled:opacity-60"
            disabled={isLoading}
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted text-muted-foreground">
              <Truck className="h-4 w-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">{row.label}</span>
              <span className="mt-1 block text-xs text-muted-foreground">
                {row.hint}
              </span>
            </span>
            <strong className="shrink-0 text-lg font-semibold tabular-nums">
              {row.count ?? '—'}
            </strong>
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          </button>
        ))
      )}
      {!rows.length && (
        <p className="p-4 text-sm text-muted-foreground">
          暂无可访问的业务待办。
        </p>
      )}
    </WidgetShell>
  )
}
function RiskRow({ label, hint, count, unit, icon: Icon, error, onClick }: {
  label: string
  hint: string
  count: number | undefined
  unit: string
  icon: LucideIcon
  error: boolean
  onClick: () => void
}) {
  return (
    <button onClick={onClick} className="dashboard-row-action flex w-full items-center gap-3 border-b border-border px-2 py-2.5 text-left">
      <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', count && count > 0 ? 'bg-warning/10 text-foreground' : 'bg-muted text-muted-foreground')}>
        <Icon className="h-4 w-4" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{error ? `${label}加载失败` : label}</span>
        <span className="mt-1 block text-xs leading-5 text-muted-foreground">{hint}</span>
      </span>
      <span className="shrink-0 text-right">
        <strong className="block text-xl font-semibold leading-6 tabular-nums">{error ? '—' : count?.toLocaleString('zh-CN') ?? '—'}</strong>
        <span className="text-xs text-muted-foreground">{unit}</span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
    </button>
  )
}
function ReceivableRisk() {
  const { data, error } = useAging()
  const overdue = data?.receivable.dueDistribution?.find(b => b.key === 'overdue')
  const open = useOpenPage()
  return (
    <RiskRow label="逾期应收" count={overdue?.count} unit="笔" icon={HandCoins} error={!!error}
      onClick={() => open('/payments/receivable', '应收账款')}
      hint={overdue ? `合计 ${money(overdue.amount)} · 按明确到期日统计` : '点击查看账款'} />
  )
}
function CreditRisk({onOpen}:{onOpen:()=>void}) {
  const { data, error } = useCreditWarning()
  return (
    <RiskRow label="客户授信超限" count={data?.overCount} unit="家" icon={Gauge} error={!!error}
      onClick={onOpen} hint="核对额度与当前使用情况" />
  )
}
function StockRisk({onOpen}:{onOpen:()=>void}) {
  const {data,error} = useQuery({queryKey:['dashboard-low-stock-page',1],queryFn:()=>getLowStockPageApi(1)})
  return (
    <RiskRow label="低库存预警" count={data?.pagination.total} unit="项" icon={Boxes} error={!!error}
      onClick={onOpen} hint="实物库存 ≤ 10 · 查看全部明细" />
  )
}
export function BoardBusinessRisk() {
  const [risk,setRisk]=useState<'stock'|'credit'|null>(null)
  const { can } = usePermission()
  const open = useOpenPage()
  return (
    <WidgetShell title="需要关注" icon={ShieldAlert} scrollBody>
      {risk && <Suspense fallback={null}><RiskDetails key={risk} kind={risk} onClose={()=>setRisk(null)}/></Suspense>}
      {can(PERMISSIONS.PAYMENT_VIEW) && <ReceivableRisk />}
      {can(PERMISSIONS.SALE_CREDIT_VIEW) && <CreditRisk onOpen={()=>setRisk('credit')}/>}
      {can(PERMISSIONS.DASHBOARD_VIEW) && <StockRisk onOpen={()=>setRisk('stock')}/>}
      <div className="px-2 pt-3">
        <p className="mb-2 text-xs font-medium text-muted-foreground">快捷发起</p>
        <div className="flex flex-wrap gap-2">
          {can(PERMISSIONS.SALE_ORDER_CREATE) && (
            <Button size="sm" onClick={() => open('/sale/new', '新建销售单')}>
              <Plus className="h-3.5 w-3.5" />
              新建销售单
            </Button>
          )}
          {can(PERMISSIONS.PURCHASE_ORDER_CREATE) && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => open('/purchase/new', '新建采购单')}
            >
              新建采购单
            </Button>
          )}
        </div>
      </div>
    </WidgetShell>
  )
}
const bucketClass: Record<string, string> = {
  overdue: 'bg-destructive/65',
  today: 'bg-warning/65',
  next7: 'bg-primary/65',
  later: 'bg-primary/25',
  unknown: 'bg-muted-foreground/40',
}
export function ReceivableDueDistribution() {
  const { data, error, isLoading, refetch } = useAging()
  const open = useOpenPage()
  const buckets = data?.receivable.dueDistribution ?? []
  const total = buckets.reduce((n, b) => n + b.amount, 0)
  return (
    <WidgetShell
      title="应收到期分布"
      icon={CalendarClock}
      scrollBody
      action={
        <Button variant="ghost" size="sm"
          className="h-8 px-2 text-xs text-primary"
          onClick={() => open('/payments/receivable', '应收账款')}
        >
          查看账款 <ArrowUpRight aria-hidden />
        </Button>
      }
    >
      {error ? (
        <QueryErrorState error={error} onRetry={() => void refetch()} compact />
      ) : isLoading ? (
        <div className="h-36 motion-safe:animate-pulse rounded bg-muted" />
      ) : !buckets.length ? (
        <p className="text-sm text-muted-foreground">
          到期分布暂不可用，请刷新后重试。
        </p>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            按未收余额汇总，优先跟进逾期与临近到期账款。
          </p>
          <div
            className="my-4 flex h-2 overflow-hidden rounded bg-muted"
            aria-hidden
          >
            {buckets.map((b) => (
              <div
                key={b.key}
                className={bucketClass[b.key]}
                style={{ width: `${total ? (b.amount / total) * 100 : 0}%` }}
              />
            ))}
          </div>
          {buckets
            .filter((b) => b.key !== 'unknown' || b.count > 0)
            .map((b) => (
              <div
                key={b.key}
                className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-border px-1 py-2.5 text-xs"
              >
                <span className="flex items-center gap-2">
                  <i
                    className={`h-2 w-2 shrink-0 rounded-full ${bucketClass[b.key]}`}
                  />
                  {b.label}
                  <span className="text-muted-foreground">{b.count} 笔</span>
                </span>
                <strong className="ml-auto text-sm font-semibold tabular-nums">
                  {money(b.amount)}
                </strong>
              </div>
            ))}
          <p className="mt-3 text-xs text-muted-foreground">
            今日到期不算逾期；未设置到期日的账款单独列示。
          </p>
          {total === 0 && (
            <SoftStatusLabel label="暂无未清应收" tone="success" />
          )}
        </>
      )}
    </WidgetShell>
  )
}
