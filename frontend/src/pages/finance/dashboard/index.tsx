import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import PageHeader from '@/components/shared/PageHeader'
import { FilterCard } from '@/components/shared/FilterCard'
import { Button } from '@/components/ui/button'
import { DatePicker } from '@/components/shared/DatePicker'
import { SoftStatusLabel } from '@/components/shared/StatusBadge'
import { QueryErrorState } from '@/components/shared/QueryErrorState'
import { useWorkspaceStore } from '@/store/workspaceStore'
import { getFinanceDashboardApi } from '@/api/finance'
import { getMonthDateRange, getRelativeDateRange } from '@/lib/dateRange'

const money = (n: number) => `¥${Number(n).toFixed(2)}`
const pct = (n: number) => `${(n * 100).toFixed(1)}%`

function StatCard({ label, value, hint, tone }: {
  label: string; value: string; hint?: string; tone?: 'default' | 'success' | 'danger' | 'warning'
}) {
  const valueClass =
    tone === 'success' ? 'text-success' :
    tone === 'danger' ? 'text-destructive' :
    tone === 'warning' ? 'text-warning' : 'text-foreground'
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className={`mt-1 tabular-nums text-2xl font-bold ${valueClass}`}>{value}</p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

/** 占比条：不引图表库，用宽度表达构成即可，够读且零依赖 */
function ShareBar({ label, amount, share, tone = 'primary' }: {
  label: string; amount: number; share: number; tone?: 'primary' | 'destructive'
}) {
  const barClass = tone === 'destructive' ? 'bg-destructive/70' : 'bg-primary/70'
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between text-sm">
        <span className="text-foreground">{label}</span>
        <span className="tabular-nums text-muted-foreground">{money(amount)} · {pct(share)}</span>
      </div>
      <div className="h-2 overflow-hidden rounded bg-muted">
        <div className={`h-full rounded ${barClass}`} style={{ width: `${Math.min(100, share * 100)}%` }} />
      </div>
    </div>
  )
}

export default function FinanceDashboardPage() {
  const navigate = useNavigate()
  const addTab = useWorkspaceStore(s => s.addTab)
  const recent6m = { startDate: getRelativeDateRange(180).startDate, endDate: getRelativeDateRange(0).endDate }
  const [startDate, setStartDate] = useState(recent6m.startDate)
  const [endDate, setEndDate] = useState(recent6m.endDate)
  const [applied, setApplied] = useState(recent6m)

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['finance-dashboard', applied],
    queryFn: () => getFinanceDashboardApi(applied),
  })

  function openPath(path: string, title: string) {
    addTab({ key: path, title, path })
    navigate(path)
  }

  const maxMonthly = Math.max(1, ...(data?.monthly ?? []).flatMap(m => [m.inAmount, m.outAmount]))

  return (
    <div className="space-y-5">
      <PageHeader
        title="资金看板"
        description="账户余额分布、区间收支趋势与费用构成。数据实时取自账户流水，不做统计缓存。"
        actions={(
          <div className="flex gap-2">
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
          <div className="grid gap-4 md:grid-cols-4">
            <StatCard label="账户余额合计" value={money(data.summary.totalBalance)} hint={`${data.summary.accountCount} 个启用账户`} />
            <StatCard label="区间收入" value={money(data.summary.inAmount)} tone="success" hint="收款 + 余额调整入账" />
            <StatCard label="区间支出" value={money(data.summary.outAmount)} tone="danger" hint="付款 + 费用报销" />
            <StatCard
              label="区间净额"
              value={money(data.summary.netAmount)}
              tone={data.summary.netAmount >= 0 ? 'success' : 'danger'}
              hint="收入 − 支出"
            />
          </div>

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

          <div className="grid gap-4 lg:grid-cols-2">
            {/* 账户余额分布 */}
            <div className="rounded-lg border border-border bg-card p-4">
              <h3 className="text-card-title">账户余额分布</h3>
              <div className="mt-3 space-y-3">
                {data.accounts.map(a => (
                  <ShareBar key={a.id} label={`${a.name}（${a.typeName}）`} amount={a.balance} share={a.share} />
                ))}
                {!data.accounts.length && <p className="py-6 text-center text-sm text-muted-foreground">还没有启用的资金账户</p>}
              </div>
            </div>

            {/* 费用构成 */}
            <div className="rounded-lg border border-border bg-card p-4">
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
          </div>

          {/* 月度收支 */}
          <div className="rounded-lg border border-border bg-card p-4">
            <h3 className="text-card-title">月度收支</h3>
            <div className="mt-3 space-y-2">
              {data.monthly.map(m => (
                <div key={m.month} className="flex items-center gap-3">
                  <span className="w-20 shrink-0 text-sm text-muted-foreground">{m.month}</span>
                  <div className="flex flex-1 items-center gap-1">
                    <div className="h-4 rounded-l bg-success/70" style={{ width: `${(m.inAmount / maxMonthly) * 50}%` }} title={`收入 ${money(m.inAmount)}`} />
                    <div className="h-4 rounded-r bg-destructive/70" style={{ width: `${(m.outAmount / maxMonthly) * 50}%` }} title={`支出 ${money(m.outAmount)}`} />
                  </div>
                  <span className="w-32 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                    <span className="text-success">+{money(m.inAmount)}</span>
                    {' / '}
                    <span className="text-destructive">−{money(m.outAmount)}</span>
                  </span>
                </div>
              ))}
              {!data.monthly.length && <p className="py-6 text-center text-sm text-muted-foreground">该区间内没有资金流水</p>}
            </div>
          </div>

          {/* 业务构成 */}
          <div className="rounded-lg border border-border bg-card p-4">
            <h3 className="text-card-title">资金流水按业务类型</h3>
            <table className="mt-3 w-full text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr>
                  <th className="py-1.5 text-left">业务类型</th>
                  <th className="py-1.5 text-right">笔数</th>
                  <th className="py-1.5 text-right">收入</th>
                  <th className="py-1.5 text-right">支出</th>
                </tr>
              </thead>
              <tbody>
                {data.byBizType.map(b => (
                  <tr key={b.bizType} className="border-t">
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
        </>
      )}
    </div>
  )
}
