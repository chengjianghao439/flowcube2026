import { useState } from 'react'
import { QueryErrorState } from '@/components/shared/QueryErrorState'
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar, ComposedChart, Line,
  PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts'
import {
  Activity, BarChart3, Warehouse, TrendingUp, ShoppingBag, CalendarClock, Coins,
  PieChart as PieChartIcon,
} from 'lucide-react'
import { WidgetShell } from '../WidgetShell'
import { chartTooltip, axisTick, CHART_COLORS, money, wan, pct, EMPTY_HINT } from '../chartTheme'
import {
  useTrend, useTopStock, useInventoryStats, useSaleStats, usePurchaseStats,
  useAging, useFinanceDashboard,
} from '@/hooks/useDashboard'

// —— 出入库趋势（dashboard.view）——
export function ChartIoTrend() {
  const { data } = useTrend(7)
  const rows = (data ?? []).map(d => ({ date: String(d.date).slice(5), 入库: d.inbound, 出库: d.outbound }))
  return (
    <WidgetShell title="近 7 天出入库趋势" icon={Activity} tone="info">
      {rows.length === 0 ? <p className={EMPTY_HINT}>暂无出入库流水</p> : (
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
            <defs>
              <linearGradient id="dash-grad-in" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="hsl(var(--success))" stopOpacity={0.35} />
                <stop offset="95%" stopColor="hsl(var(--success))" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="dash-grad-out" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="hsl(var(--destructive))" stopOpacity={0.3} />
                <stop offset="95%" stopColor="hsl(var(--destructive))" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis dataKey="date" tick={axisTick} />
            <YAxis tick={axisTick} width={36} />
            <Tooltip contentStyle={chartTooltip} cursor={{ stroke: 'hsl(var(--border))' }} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Area type="monotone" dataKey="入库" stroke="hsl(var(--success))" strokeWidth={2} fill="url(#dash-grad-in)" />
            <Area type="monotone" dataKey="出库" stroke="hsl(var(--destructive))" strokeWidth={2} fill="url(#dash-grad-out)" />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </WidgetShell>
  )
}

// —— 库存价值 Top 10（dashboard.view）——
export function ChartTopStock() {
  const { data } = useTopStock()
  const rows = (data ?? []).slice(0, 10).map(d => ({
    name: d.name.length > 8 ? d.name.slice(0, 8) + '…' : d.name,
    价值: Math.round(d.value),
  }))
  return (
    <WidgetShell title="库存价值 Top 10" icon={BarChart3} tone="primary">
      {rows.length === 0 ? <p className={EMPTY_HINT}>暂无库存数据</p> : (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis dataKey="name" tick={{ ...axisTick, fontSize: 10 }} interval={0} angle={-30} textAnchor="end" height={54} />
            <YAxis tick={axisTick} width={44} tickFormatter={wan} />
            <Tooltip formatter={(v) => [money(Number(v ?? 0)), '库存价值']} contentStyle={chartTooltip} cursor={{ fill: 'hsl(var(--muted))', opacity: 0.4 }} />
            <Bar dataKey="价值" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} maxBarSize={36} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </WidgetShell>
  )
}

// —— 各仓库存分布（report.view）——
export function ChartWarehouseStock() {
  const { data } = useInventoryStats()
  const rows = (data?.byWarehouse ?? []).map(w => ({ name: w.warehouseName, 价值: Math.round(w.totalValue) }))
  return (
    <WidgetShell title="各仓库存价值分布" icon={Warehouse} tone="info">
      {rows.length === 0 ? <p className={EMPTY_HINT}>暂无仓库库存数据</p> : (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 16, left: 4, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
            <XAxis type="number" tick={axisTick} tickFormatter={wan} />
            <YAxis type="category" dataKey="name" tick={axisTick} width={72} />
            <Tooltip formatter={(v) => [money(Number(v ?? 0)), '库存价值']} contentStyle={chartTooltip} cursor={{ fill: 'hsl(var(--muted))', opacity: 0.4 }} />
            <Bar dataKey="价值" fill="hsl(var(--info))" radius={[0, 4, 4, 0]} maxBarSize={22} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </WidgetShell>
  )
}

// —— 月度销售趋势（report.view）——
export function ChartSaleTrend() {
  const { data, isLoading, error, refetch } = useSaleStats()
  const [metric, setMetric] = useState<'totalAmount' | 'shippedAmount' | 'orderCount'>('totalAmount')
  const choices = [{key:'totalAmount',label:'订单金额'}, {key:'shippedAmount',label:'已出库订单金额'}, {key:'orderCount',label:'订单数'}] as const
  const count = metric === 'orderCount'
  const label = choices.find(c=>c.key===metric)!.label
  return <WidgetShell title="月度销售趋势" icon={TrendingUp} bodyClassName="flex flex-col" action={<select aria-label="销售趋势指标" value={metric} onChange={e=>setMetric(e.target.value as typeof metric)} className="max-w-40 rounded border bg-background p-1 text-xs">{choices.map(c=><option key={c.key} value={c.key}>{c.label}</option>)}</select>}>
    <p className="mb-2 text-xs text-muted-foreground">按订单创建月份归集 · {count ? '单位：单' : '单位：元，沿用报表订单金额'}{metric === 'shippedAmount' && ' · 仅统计已出库状态订单'}</p>
    {error ? <QueryErrorState error={error} onRetry={()=>void refetch()} compact/> : isLoading ? <div className="h-40 animate-pulse bg-muted"/> : !data?.byMonth.length ? <p className={EMPTY_HINT}>该区间内暂无销售</p> : <div className="min-h-0 flex-1"><ResponsiveContainer width="100%" height="100%">
      <BarChart data={data.byMonth} margin={{top:8,right:12,left:4,bottom:4}}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))"/>
        <XAxis dataKey="month" tick={axisTick}/><YAxis tick={axisTick} width={52} allowDecimals={!count} tickFormatter={count ? v=>String(v) : wan}/>
        <Tooltip formatter={v=>[count ? `${Number(v)} 单` : money(Number(v)),label]} contentStyle={chartTooltip}/>
        <Bar dataKey={metric} name={label} fill="hsl(var(--primary))" radius={[4,4,0,0]} maxBarSize={32} isAnimationActive={false}/>
      </BarChart>
    </ResponsiveContainer></div>}
  </WidgetShell>
}

// —— 月度采购趋势（report.view）——
export function ChartPurchaseTrend() {
  const { data } = usePurchaseStats()
  const rows = (data?.byMonth ?? []).map(m => ({ month: m.month, 采购额: m.totalAmount, 已收货: m.receivedAmount }))
  return (
    <WidgetShell title="月度采购趋势" icon={ShoppingBag} tone="warning">
      {rows.length === 0 ? <p className={EMPTY_HINT}>该区间内暂无采购</p> : (
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis dataKey="month" tick={axisTick} />
            <YAxis tick={axisTick} width={44} tickFormatter={wan} />
            <Tooltip formatter={(v) => money(Number(v ?? 0))} contentStyle={chartTooltip} cursor={{ fill: 'hsl(var(--muted))', opacity: 0.4 }} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="采购额" fill="hsl(var(--warning))" radius={[4, 4, 0, 0]} maxBarSize={28} />
            <Line type="monotone" dataKey="已收货" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 3 }} />
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </WidgetShell>
  )
}

// —— 应收 / 应付账龄分布（payment.view）——
const BUCKET_SHORT: Record<string, string> = { current: '未到期', d1_30: '1–30', d31_60: '31–60', d61_90: '61–90', d90p: '90天+' }
export function ChartAging() {
  const { data } = useAging()
  const rows = data
    ? data.receivable.buckets.map((b, i) => ({
      label: BUCKET_SHORT[b.key] ?? b.label,
      应收: b.amount,
      应付: data.payable.buckets[i]?.amount ?? 0,
    }))
    : []
  const empty = rows.every(r => r.应收 === 0 && r.应付 === 0)
  return (
    <WidgetShell title="应收 / 应付账龄" icon={CalendarClock} tone="info">
      {empty ? <p className={EMPTY_HINT}>当前没有未结清账款</p> : (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis dataKey="label" tick={axisTick} />
            <YAxis tick={axisTick} width={44} tickFormatter={wan} />
            <Tooltip formatter={(v) => money(Number(v ?? 0))} contentStyle={chartTooltip} cursor={{ fill: 'hsl(var(--muted))', opacity: 0.4 }} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="应收" fill="hsl(var(--info))" radius={[4, 4, 0, 0]} maxBarSize={24} />
            <Bar dataKey="应付" fill="hsl(var(--warning))" radius={[4, 4, 0, 0]} maxBarSize={24} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </WidgetShell>
  )
}

// —— 月度现金流（finance.account.view）——
export function ChartCashflow() {
  const { data } = useFinanceDashboard()
  const rows = (data?.monthly ?? []).map(m => ({ month: m.month, 收入: m.inAmount, 支出: m.outAmount, 净额: m.netAmount }))
  return (
    <WidgetShell title="月度现金流" icon={Coins} tone="primary">
      {rows.length === 0 ? <p className={EMPTY_HINT}>该区间内没有资金流水</p> : (
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis dataKey="month" tick={axisTick} />
            <YAxis tick={axisTick} width={44} tickFormatter={wan} />
            <Tooltip formatter={(v) => money(Number(v ?? 0))} contentStyle={chartTooltip} cursor={{ fill: 'hsl(var(--muted))', opacity: 0.4 }} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="收入" fill="hsl(var(--success))" radius={[4, 4, 0, 0]} maxBarSize={24} />
            <Bar dataKey="支出" fill="hsl(var(--destructive))" radius={[4, 4, 0, 0]} maxBarSize={24} />
            <Line type="monotone" dataKey="净额" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 3 }} />
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </WidgetShell>
  )
}

// —— 账户余额分布（finance.account.view）——
export function ChartAccountBalance() {
  const { data } = useFinanceDashboard()
  const accounts = data?.accounts ?? []
  return (
    <WidgetShell
      title="账户余额分布" icon={PieChartIcon} tone="primary"
      action={data ? <span className="text-xs tabular-nums text-muted-foreground">合计 {money(data.summary.totalBalance)}</span> : undefined}
    >
      {accounts.length === 0 ? <p className={EMPTY_HINT}>还没有启用的资金账户</p> : (
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={accounts} dataKey="balance" nameKey="name" cx="50%" cy="50%" innerRadius={48} outerRadius={84} paddingAngle={2}>
              {accounts.map((a, i) => <Cell key={a.id} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
            </Pie>
            <Tooltip formatter={(v, _n, p) => [`${money(Number(v ?? 0))} · ${pct((p?.payload?.share as number) ?? 0)}`, p?.payload?.name as string]} contentStyle={chartTooltip} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
          </PieChart>
        </ResponsiveContainer>
      )}
    </WidgetShell>
  )
}
