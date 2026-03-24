import { useEffect, useRef } from 'react'
import { TrendingUp, TrendingDown, Minus, AlertTriangle, ScanLine, Package, User } from 'lucide-react'
import {
  LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import { useDashboardSummary, useLowStock, useTrend, useTopStock, usePdaPerformance } from '@/hooks/useDashboard'
import { Badge } from '@/components/ui/badge'

// ── StatCard ──────────────────────────────────────────────────────────────────

interface StatCardProps {
  label: string
  value: string | number
  sub?: string
  accent?: 'default' | 'primary' | 'warning' | 'success' | 'destructive'
  trend?: 'up' | 'down' | 'neutral'
}

function StatCard({ label, value, sub, accent = 'default', trend }: StatCardProps) {
  const valueClass = {
    default:     'text-foreground',
    primary:     'text-primary',
    warning:     'text-warning',
    success:     'text-success',
    destructive: 'text-destructive',
  }[accent]

  const TrendIcon = trend === 'up' ? TrendingUp : trend === 'down' ? TrendingDown : Minus
  const trendClass = trend === 'up' ? 'text-success' : trend === 'down' ? 'text-destructive' : 'text-muted-foreground'

  return (
    <div className="card-base p-5">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="mt-2 flex items-end justify-between">
        <p className={`text-3xl font-bold tabular-nums ${valueClass}`}>{value}</p>
        {trend && <TrendIcon className={`h-4 w-4 ${trendClass}`} />}
      </div>
      {sub && <p className="mt-1.5 text-xs text-muted-foreground">{sub}</p>}
    </div>
  )
}

// ── SectionCard ───────────────────────────────────────────────────────────────

function SectionCard({ title, badge, children }: {
  title: string
  badge?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="card-base p-5">
      <div className="mb-4 flex items-center gap-2">
        <h2 className="text-section-title">{title}</h2>
        {badge}
      </div>
      {children}
    </div>
  )
}

// ── DashboardPage ─────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { data: summary } = useDashboardSummary()
  const { data: lowStock } = useLowStock(10)
  const { data: trend } = useTrend(7)
  const { data: topStock } = useTopStock()
  const { data: pda } = usePdaPerformance()
  const notified = useRef(false)

  useEffect(() => {
    if (!lowStock?.length || notified.current) return
    notified.current = true
    if (!('Notification' in window)) return
    const send = () => new Notification('FlowCube 低库存预警', {
      body: `${lowStock.length} 种商品库存不足，请及时补货`,
      icon: '/favicon.ico',
    })
    if (Notification.permission === 'granted') send()
    else if (Notification.permission !== 'denied')
      Notification.requestPermission().then(p => { if (p === 'granted') send() })
  }, [lowStock])

  const trendData = trend?.map(d => ({
    date: d.date.slice(5),
    入库: d.inbound,
    出库: d.outbound,
  })) || []

  const topData = topStock?.slice(0, 10).map(d => ({
    name: d.name.length > 8 ? d.name.slice(0, 8) + '…' : d.name,
    价值: Math.round(d.value),
  })) || []

  const hasPendingPurchase = Boolean(summary?.pendingPurchaseOrders)
  const hasPendingSale = Boolean(summary?.pendingSaleOrders)

  return (
    <div className="space-y-6">
      {/* 页面标题 */}
      <div>
        <h1 className="text-page-title">仪表盘</h1>
        <p className="text-muted-body mt-1">FlowCube ERP · 数据总览</p>
      </div>

      {/* 统计卡片行 */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
        <StatCard
          label="在库 SKU 数"
          value={summary?.totalSkus ?? '-'}
          sub="种商品有库存"
        />
        <StatCard
          label="库存总数量"
          value={summary?.totalQty?.toFixed(0) ?? '-'}
          sub="各仓库汇总"
        />
        <StatCard
          label="库存总价值"
          value={summary ? `¥${(summary.totalValue / 10000).toFixed(2)}万` : '-'}
          sub="按成本价估算"
          accent="primary"
        />
        <StatCard
          label="待处理采购"
          value={summary?.pendingPurchaseOrders ?? '-'}
          sub="草稿+已确认"
          accent={hasPendingPurchase ? 'warning' : 'default'}
          trend={hasPendingPurchase ? 'up' : 'neutral'}
        />
        <StatCard
          label="待处理销售"
          value={summary?.pendingSaleOrders ?? '-'}
          sub="草稿+已确认"
          accent={hasPendingSale ? 'warning' : 'default'}
          trend={hasPendingSale ? 'up' : 'neutral'}
        />
      </div>

      {/* 图表区域 */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* 近7天出入库趋势 */}
        <SectionCard title="近 7 天出入库趋势">
          {trendData.length === 0 ? (
            <p className="text-muted-body py-8 text-center">暂无数据</p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={trendData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="date" tick={{ fontSize: 12 }} className="text-muted-foreground" />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip
                  contentStyle={{ borderRadius: '8px', border: '1px solid hsl(var(--border))', fontSize: 12 }}
                />
                <Legend />
                <Line type="monotone" dataKey="入库" stroke="hsl(var(--success))" strokeWidth={2} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="出库" stroke="hsl(var(--destructive))" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </SectionCard>

        {/* 低库存预警 */}
        <SectionCard
          title="低库存预警"
          badge={
            lowStock && lowStock.length > 0 ? (
              <Badge variant="destructive" className="gap-1">
                <AlertTriangle className="h-3 w-3" />
                {lowStock.length}
              </Badge>
            ) : undefined
          }
        >
          {!lowStock?.length ? (
            <p className="text-muted-body py-8 text-center">暂无低库存商品</p>
          ) : (
            <div className="max-h-52 space-y-1 overflow-y-auto">
              {lowStock.map(item => (
                <div
                  key={`${item.id}-${item.warehouseName}`}
                  className="flex items-center justify-between rounded-lg px-2 py-1.5 text-sm hover:bg-muted/50 transition-colors"
                >
                  <div className="min-w-0">
                    <span className="font-medium text-foreground">{item.name}</span>
                    <span className="ml-2 text-xs text-muted-foreground">{item.code}</span>
                  </div>
                  <div className="ml-3 flex shrink-0 items-center gap-2">
                    <span className="text-xs text-muted-foreground">{item.warehouseName}</span>
                    <Badge variant="destructive" className="text-xs">
                      {item.quantity} {item.unit}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      </div>

      {/* PDA 操作统计 */}
      <SectionCard title="今日 PDA 作业统计">
        <div className="space-y-4">
          {/* 今日汇总卡片 */}
          <div className="grid grid-cols-3 gap-4">
            <div className="flex flex-col gap-1 rounded-xl border border-border bg-muted/20 p-4">
              <div className="flex items-center gap-2 text-muted-foreground">
                <ScanLine className="h-4 w-4" />
                <span className="text-xs font-medium uppercase tracking-wide">今日扫码量</span>
              </div>
              <p className="text-3xl font-bold tabular-nums text-primary">{pda?.today.scanCount ?? '-'}</p>
              <p className="text-xs text-muted-foreground">次扫描操作</p>
            </div>
            <div className="flex flex-col gap-1 rounded-xl border border-border bg-muted/20 p-4">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Package className="h-4 w-4" />
                <span className="text-xs font-medium uppercase tracking-wide">今日拣货量</span>
              </div>
              <p className="text-3xl font-bold tabular-nums text-foreground">{pda?.today.pickQty.toFixed(0) ?? '-'}</p>
              <p className="text-xs text-muted-foreground">件商品已拣货</p>
            </div>
            <div className="flex flex-col gap-1 rounded-xl border border-border bg-muted/20 p-4">
              <div className="flex items-center gap-2 text-muted-foreground">
                <User className="h-4 w-4" />
                <span className="text-xs font-medium uppercase tracking-wide">TOP 操作员</span>
              </div>
              <p className="text-lg font-bold text-foreground truncate">
                {pda?.topOperator?.operatorName ?? '暂无'}
              </p>
              <p className="text-xs text-muted-foreground">
                {pda?.topOperator ? `${pda.topOperator.scanCount} 次 · ${pda.topOperator.pickQty.toFixed(0)} 件` : '今日无记录'}
              </p>
            </div>
          </div>

          {/* 操作员排行 */}
          {pda?.operators && pda.operators.length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2">今日操作员排行</p>
              <div className="space-y-1">
                {pda.operators.slice(0, 5).map((op, i) => (
                  <div key={op.operatorId}
                    className="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-muted/40 transition-colors">
                    <span className={`w-5 text-center text-xs font-bold ${
                      i === 0 ? 'text-yellow-500' : i === 1 ? 'text-slate-400' : i === 2 ? 'text-orange-400' : 'text-muted-foreground'
                    }`}>{i + 1}</span>
                    <p className="flex-1 text-sm font-medium text-foreground">{op.operatorName}</p>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span><span className="font-semibold text-foreground">{op.scanCount}</span> 次</span>
                      <span><span className="font-semibold text-foreground">{op.pickQty.toFixed(0)}</span> 件</span>
                      {op.avgMinutes !== null && (
                        <Badge variant="outline" className="text-xs">{op.avgMinutes} 分钟</Badge>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {(!pda || pda.today.scanCount === 0) && (
            <p className="text-center text-sm text-muted-foreground py-4">今日暂无 PDA 扫码记录</p>
          )}
        </div>
      </SectionCard>

      {/* 库存价值 Top10 */}
      <SectionCard title="库存价值 Top 10">
        {topData.length === 0 ? (
          <p className="text-muted-body py-8 text-center">暂无数据</p>
        ) : (
          <div className="flex gap-6">
            <div className="flex-1">
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={topData} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis
                    tick={{ fontSize: 11 }}
                    tickFormatter={v => v >= 10000 ? `${(v / 10000).toFixed(1)}万` : String(v)}
                  />
                  <Tooltip
                    formatter={(v) => [`¥${Number(v).toLocaleString()}`, '库存价值']}
                    contentStyle={{ borderRadius: '8px', border: '1px solid hsl(var(--border))', fontSize: 12 }}
                  />
                  <Bar dataKey="价值" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="w-56 shrink-0 overflow-y-auto" style={{ maxHeight: 240 }}>
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="pb-2 text-left font-medium">#</th>
                    <th className="pb-2 text-left font-medium">名称</th>
                    <th className="pb-2 text-right font-medium">价值</th>
                  </tr>
                </thead>
                <tbody>
                  {topStock?.map((item, i) => (
                    <tr key={item.code} className="border-b last:border-0">
                      <td className="py-1.5 text-muted-foreground">{i + 1}</td>
                      <td className="max-w-20 truncate py-1.5">{item.name}</td>
                      <td className="py-1.5 text-right font-medium text-primary">
                        ¥{item.value.toFixed(0)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </SectionCard>
    </div>
  )
}
