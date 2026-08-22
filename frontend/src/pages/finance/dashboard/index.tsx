import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  PieChart, Pie, Cell, BarChart,
} from 'recharts'
import { Wallet, ArrowDownLeft, ArrowUpRight, ArrowUpDown } from 'lucide-react'
import PageHeader from '@/components/shared/PageHeader'
import { FilterCard } from '@/components/shared/FilterCard'
import { Button } from '@/components/ui/button'
import { DatePicker } from '@/components/shared/DatePicker'
import { SoftStatusLabel } from '@/components/shared/StatusBadge'
import { QueryErrorState } from '@/components/shared/QueryErrorState'
import { useWorkspaceStore } from '@/store/workspaceStore'
import { usePermission } from '@/hooks/usePermission'
import { PERMISSIONS } from '@/lib/permission-codes'
import { getFinanceDashboardApi } from '@/api/finance'
import { getAgingApi } from '@/api/payments'
import type { AgingSide } from '@/api/payments'
import { getMonthDateRange, getRelativeDateRange } from '@/lib/dateRange'
import { StatTile } from '@/components/dashboard/StatTile'
import { downloadExport } from '@/lib/exportDownload'
import { toast } from '@/lib/toast'

const money = (n: number) => `¥${Number(n).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const wan = (n: number) => Math.abs(n) >= 10000 ? `${(n / 10000).toFixed(n >= 1e6 ? 0 : 1)}万` : String(Math.round(n))
const pct = (n: number) => `${(n * 100).toFixed(1)}%`

// 主题感知的 Tooltip 样式：深色模式下也用卡片底色，避免 recharts 默认白底在暗色主题里刺眼
const chartTooltip = {
  borderRadius: 8,
  border: '1px solid hsl(var(--border))',
  background: 'hsl(var(--card))',
  color: 'hsl(var(--foreground))',
  fontSize: 12,
} as const
const axisTick = { fontSize: 11, fill: 'hsl(var(--muted-foreground))' } as const

// 账户余额饼图配色：语义色打头，其余用几个协调的固定色轮转
const PIE_COLORS = [
  'hsl(var(--primary))', 'hsl(var(--success))', 'hsl(var(--warning))', 'hsl(var(--info))',
  '#8b5cf6', '#0ea5e9', '#f97316', 'hsl(var(--destructive))',
]

// 账龄桶的短标签（X 轴用）与严重度配色
const BUCKET_SHORT: Record<string, string> = {
  current: '未到期', d1_30: '1–30', d31_60: '31–60', d61_90: '61–90', d90p: '90天+',
}

/** 占比条：费用构成用，不引图表库，用宽度表达构成 */
function ShareBar({ label, amount, share, tone = 'primary' }: {
  label: string; amount: number; share: number; tone?: 'primary' | 'destructive'
}) {
  const barClass = tone === 'destructive' ? 'bg-destructive/70' : 'bg-primary/70'
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between text-sm">
        <span className="truncate text-foreground">{label}</span>
        <span className="shrink-0 pl-2 tabular-nums text-muted-foreground">{money(amount)} · {pct(share)}</span>
      </div>
      <div className="h-2 overflow-hidden rounded bg-muted">
        <div className={`h-full rounded ${barClass}`} style={{ width: `${Math.min(100, share * 100)}%` }} />
      </div>
    </div>
  )
}

/** 敞口概览小卡：总敞口 + 逾期额（红字）+ 笔数 */
function ExposureTile({ title, side, tone }: { title: string; side: AgingSide; tone: 'info' | 'warning' }) {
  const ring = tone === 'warning' ? 'border-warning/30' : 'border-info/30'
  return (
    <div className={`card-base ${ring} p-4`}>
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-foreground">{title}</span>
        <SoftStatusLabel label={`${side.totalCount} 笔未清`} tone={tone === 'warning' ? 'warning' : 'info'} />
      </div>
      <p className="mt-1 tabular-nums text-2xl font-bold text-foreground" title={money(side.total)}>{money(side.total)}</p>
      <p className="mt-1 text-xs">
        {side.overdueAmount > 0
          ? <span className="text-destructive">其中逾期 {money(side.overdueAmount)}（{side.overdueCount} 笔）</span>
          : <span className="text-success">暂无逾期</span>}
      </p>
    </div>
  )
}

/** 催收 / 催付 Top 名单 */
function PartyList({ title, parties, emptyText }: {
  title: string; parties: AgingSide['topParties']; emptyText: string
}) {
  return (
    <div className="card-base p-4">
      <h3 className="text-card-title">{title}</h3>
      {parties.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">{emptyText}</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr>
                <th className="py-1.5 text-left font-medium">往来方</th>
                <th className="py-1.5 text-right font-medium">敞口</th>
                <th className="py-1.5 text-right font-medium">逾期</th>
                <th className="py-1.5 text-right font-medium">账龄</th>
              </tr>
            </thead>
            <tbody>
              {parties.map(p => (
                <tr key={p.partyName} className="border-t border-border">
                  <td className="max-w-[10rem] truncate py-1.5" title={p.partyName}>{p.partyName}</td>
                  <td className="py-1.5 text-right tabular-nums">{money(p.amount)}</td>
                  <td className="py-1.5 text-right tabular-nums">
                    {p.overdueAmount > 0
                      ? <span className="font-medium text-destructive">{money(p.overdueAmount)}</span>
                      : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="py-1.5 text-right">
                    {p.maxOverdueDays > 0
                      ? <SoftStatusLabel label={`${p.maxOverdueDays}天`} tone={p.maxOverdueDays > 90 ? 'danger' : 'warning'} />
                      : <span className="text-xs text-success">未到期</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export default function FinanceDashboardPage() {
  const navigate = useNavigate()
  const addTab = useWorkspaceStore(s => s.addTab)
  const { can } = usePermission()
  const canViewAging = can(PERMISSIONS.PAYMENT_VIEW)
  const recent6m = { startDate: getRelativeDateRange(180).startDate, endDate: getRelativeDateRange(0).endDate }
  const [startDate, setStartDate] = useState(recent6m.startDate)
  const [endDate, setEndDate] = useState(recent6m.endDate)
  const [applied, setApplied] = useState(recent6m)

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['finance-dashboard', applied],
    queryFn: () => getFinanceDashboardApi(applied),
  })
  // 账龄是 as-of 今天、与区间无关；仅在有账款查看权限时拉取（看板路由只要求账户查看权限）
  const { data: aging } = useQuery({
    queryKey: ['finance-dashboard', 'aging'],
    queryFn: () => getAgingApi(6),
    enabled: canViewAging,
  })

  function openPath(path: string, title: string) {
    addTab({ key: path, title, path })
    navigate(path)
  }

  const monthlyData = (data?.monthly ?? []).map(m => ({
    month: m.month, 收入: m.inAmount, 支出: m.outAmount, 净额: m.netAmount,
  }))
  const agingChart = aging
    ? aging.receivable.buckets.map((b, i) => ({
      label: BUCKET_SHORT[b.key] ?? b.label,
      应收: b.amount,
      应付: aging.payable.buckets[i]?.amount ?? 0,
    }))
    : []

  return (
    <div className="space-y-5">
      <PageHeader
        title="资金看板"
        description="账户余额、区间现金流、应收应付账龄一屏总览。数据实时取自账户流水与账款，不做统计缓存。"
        actions={(
          <div className="flex gap-2">
            <Button variant="outline"
              onClick={() => downloadExport('/export/aging').catch(e => toast.error((e as Error).message))}>
              导出账龄 Excel
            </Button>
            <Button variant="outline" onClick={() => openPath('/finance/accounts', '账户管理')}>账户管理</Button>
            <Button variant="outline" onClick={() => openPath('/finance/expenses', '费用报销')}>费用报销</Button>
          </div>
        )}
      />

      <FilterCard>
        <div className="flex flex-wrap gap-2">
          {([
            ['近 90 天', () => getRelativeDateRange(90)],
            ['近 180 天', () => getRelativeDateRange(180)],
            ['本月', () => getMonthDateRange()],
          ] as const).map(([label, range]) => (
            <Button key={label} size="sm" variant="outline" onClick={() => {
              const r = range()
              setStartDate(r.startDate); setEndDate(r.endDate); setApplied({ startDate: r.startDate, endDate: r.endDate })
            }}>{label}</Button>
          ))}
        </div>
        <DatePicker value={startDate} onChange={setStartDate} max={endDate} className="h-9 w-40" />
        <span className="text-muted-foreground">至</span>
        <DatePicker value={endDate} onChange={setEndDate} min={startDate} className="h-9 w-40" />
        <Button size="sm" onClick={() => setApplied({ startDate, endDate })}>查询</Button>
      </FilterCard>

      {isError && <QueryErrorState error={error} onRetry={() => void refetch()} title="资金数据加载失败" compact />}
      {isLoading && <p className="py-10 text-center text-sm text-muted-foreground">加载中…</p>}

      {data && !isError && (
        <>
          {/* 顶部 KPI */}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <StatTile icon={Wallet} label="账户余额合计" value={money(data.summary.totalBalance)} hint={`${data.summary.accountCount} 个启用账户`} />
            <StatTile icon={ArrowDownLeft} label="区间收入" value={money(data.summary.inAmount)} tone="success" hint="收款 + 余额调整入账" />
            <StatTile icon={ArrowUpRight} label="区间支出" value={money(data.summary.outAmount)} tone="danger" hint="付款 + 费用报销" />
            <StatTile
              icon={ArrowUpDown}
              label="区间净现金流"
              value={money(data.summary.netAmount)}
              tone={data.summary.netAmount >= 0 ? 'success' : 'danger'}
              hint="收入 − 支出"
            />
          </div>

          {/* 报销待办 */}
          {(data.pending.approveCount > 0 || data.pending.payCount > 0) && (
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-warning/20 bg-warning/10 px-4 py-3">
              <span className="text-sm font-medium text-foreground">报销待办</span>
              {data.pending.approveCount > 0 && (
                <SoftStatusLabel label={`待审批 ${data.pending.approveCount} 笔 · ${money(data.pending.approveAmount)}`} tone="warning" />
              )}
              {data.pending.payCount > 0 && (
                <SoftStatusLabel label={`待付款 ${data.pending.payCount} 笔 · ${money(data.pending.payAmount)}`} tone="active" />
              )}
              <Button size="sm" variant="outline" className="ml-auto" onClick={() => openPath('/finance/expenses', '费用报销')}>
                去处理
              </Button>
            </div>
          )}

          {/* 应收 / 应付账龄 */}
          {canViewAging && aging && (
            <section className="space-y-4">
              <div className="flex items-baseline justify-between">
                <h2 className="text-section-title">应收 / 应付账龄</h2>
                <span className="text-xs text-muted-foreground">截至 {aging.asOf} · 全量未结清敞口</span>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <ExposureTile title="应收账款（待收回）" side={aging.receivable} tone="info" />
                <ExposureTile title="应付账款（待支付）" side={aging.payable} tone="warning" />
              </div>

              <div className="card-base p-4">
                <h3 className="text-card-title">账龄分布</h3>
                {agingChart.every(d => d.应收 === 0 && d.应付 === 0) ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">当前没有未结清账款</p>
                ) : (
                  <ResponsiveContainer width="100%" height={240}>
                    <BarChart data={agingChart} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="label" tick={axisTick} />
                      <YAxis tick={axisTick} tickFormatter={wan} width={48} />
                      <Tooltip formatter={(v) => money(Number(v ?? 0))} contentStyle={chartTooltip} cursor={{ fill: 'hsl(var(--muted))', opacity: 0.4 }} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Bar dataKey="应收" fill="hsl(var(--info))" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="应付" fill="hsl(var(--warning))" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <PartyList title="催收 Top（应收敞口）" parties={aging.receivable.topParties} emptyText="暂无应收敞口" />
                <PartyList title="催付 Top（应付敞口）" parties={aging.payable.topParties} emptyText="暂无应付敞口" />
              </div>
            </section>
          )}

          {/* 月度收支 + 账户余额分布 */}
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="card-base p-4">
              <h3 className="text-card-title">月度收支</h3>
              {monthlyData.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">该区间内没有资金流水</p>
              ) : (
                <ResponsiveContainer width="100%" height={260}>
                  <ComposedChart data={monthlyData} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="month" tick={axisTick} />
                    <YAxis tick={axisTick} tickFormatter={wan} width={48} />
                    <Tooltip formatter={(v) => money(Number(v ?? 0))} contentStyle={chartTooltip} cursor={{ fill: 'hsl(var(--muted))', opacity: 0.4 }} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="收入" fill="hsl(var(--success))" radius={[4, 4, 0, 0]} maxBarSize={28} />
                    <Bar dataKey="支出" fill="hsl(var(--destructive))" radius={[4, 4, 0, 0]} maxBarSize={28} />
                    <Line type="monotone" dataKey="净额" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 3 }} />
                  </ComposedChart>
                </ResponsiveContainer>
              )}
            </div>

            <div className="card-base p-4">
              <div className="flex items-baseline justify-between">
                <h3 className="text-card-title">账户余额分布</h3>
                <span className="tabular-nums text-xs text-muted-foreground">合计 {money(data.summary.totalBalance)}</span>
              </div>
              {data.accounts.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">还没有启用的资金账户</p>
              ) : (
                <ResponsiveContainer width="100%" height={260}>
                  <PieChart>
                    <Pie
                      data={data.accounts} dataKey="balance" nameKey="name"
                      cx="50%" cy="50%" innerRadius={55} outerRadius={95} paddingAngle={2}
                    >
                      {data.accounts.map((a, i) => <Cell key={a.id} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                    </Pie>
                    <Tooltip formatter={(v, _n, p) => [`${money(Number(v ?? 0))} · ${pct((p?.payload?.share as number) ?? 0)}`, p?.payload?.name as string]} contentStyle={chartTooltip} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {/* 费用构成 + 业务类型 */}
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="card-base p-4">
              <h3 className="text-card-title">费用构成（已付款）</h3>
              <div className="mt-3 space-y-3">
                {data.expenseByCategory.map(c => (
                  <ShareBar key={c.categoryName} label={`${c.categoryName}（${c.claimCount} 单）`} amount={c.amount} share={c.share} tone="destructive" />
                ))}
                {!data.expenseByCategory.length && (
                  <p className="py-6 text-center text-sm text-muted-foreground">该区间内没有已付款的报销</p>
                )}
              </div>
            </div>

            <div className="card-base p-4">
              <h3 className="text-card-title">资金流水按业务类型</h3>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs text-muted-foreground">
                    <tr>
                      <th className="py-1.5 text-left font-medium">业务类型</th>
                      <th className="py-1.5 text-right font-medium">笔数</th>
                      <th className="py-1.5 text-right font-medium">收入</th>
                      <th className="py-1.5 text-right font-medium">支出</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.byBizType.map(b => (
                      <tr key={b.bizType} className="border-t border-border">
                        <td className="py-1.5"><SoftStatusLabel label={b.bizTypeName} tone={b.bizType === 4 ? 'warning' : 'info'} /></td>
                        <td className="py-1.5 text-right tabular-nums text-muted-foreground">{b.txCount}</td>
                        <td className="py-1.5 text-right tabular-nums text-success">{b.inAmount > 0 ? money(b.inAmount) : '—'}</td>
                        <td className="py-1.5 text-right tabular-nums text-destructive">{b.outAmount > 0 ? money(b.outAmount) : '—'}</td>
                      </tr>
                    ))}
                    {!data.byBizType.length && (
                      <tr><td colSpan={4} className="py-6 text-center text-muted-foreground">该区间内没有资金流水</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
