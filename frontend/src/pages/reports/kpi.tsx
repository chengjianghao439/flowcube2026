import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Wallet, BarChart3, ShoppingCart, HandCoins, ReceiptText } from 'lucide-react'
import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts'
import PageHeader from '@/components/shared/PageHeader'
import { Button } from '@/components/ui/button'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { StatTile } from '@/components/dashboard/StatTile'
import { ReportPanel } from '@/components/shared/ReportPanel'
import { QueryErrorState } from '@/components/shared/QueryErrorState'
import DataTable from '@/components/shared/DataTable'
import { getKpiApi, type KpiMetric, type KpiByWarehouseRow } from '@/api/reports'
import { chartTooltip, axisTick, money, wan } from '@/components/dashboard/chartTheme'
import type { TableColumn } from '@/types'

/**
 * 经营 KPI 仪表盘（P2-10）：GMV / 毛利 / 订单数 / 回款 / 平均客单 + 上期环比，
 * 近 12 个月趋势（GMV/毛利折线 + 回款柱状）与当月分仓明细。
 * 数据来自后端 /reports/kpi（profitAnalysis 同口径，毛利 = 销售 - 成本快照）。
 */

/** 生成最近 12 个月的「YYYY-MM」选项（当前月在前） */
function monthOptions(): string[] {
  const now = new Date()
  const out: string[] = []
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  return out
}

const METRIC_ICON: Record<string, typeof Wallet> = {
  gmv: Wallet,
  grossProfit: BarChart3,
  orderCount: ShoppingCart,
  received: HandCoins,
  avgOrderValue: ReceiptText,
}

function MetricCard({ metric, isMoney, loading }: { metric: KpiMetric; isMoney: boolean; loading?: boolean }) {
  const pct = metric.changePct
  const pctLabel = pct === null ? undefined : `${pct > 0 ? '+' : ''}${pct}%`
  const value = isMoney ? money(metric.current) : Number(metric.current).toLocaleString('zh-CN')
  return (
    <StatTile
      label={metric.label}
      value={value}
      icon={METRIC_ICON[metric.key] ?? Wallet}
      trendValue={pctLabel}
      hint={loading ? '…' : `上期 ${isMoney ? money(metric.previous) : Number(metric.previous).toLocaleString('zh-CN')}`}
      loading={loading}
    />
  )
}

export default function KpiPage() {
  const options = useMemo(monthOptions, [])
  const [period, setPeriod] = useState(options[0] ?? '')

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['reports-kpi', period],
    queryFn: () => getKpiApi({ period }),
  })

  const trendRows = data?.trend ?? []
  const chartRows = trendRows.map(r => ({ month: r.month, GMV: r.gmv, 毛利: r.grossProfit, 回款: r.received }))
  const maxGmv = Math.max(...(data?.byWarehouse ?? []).map(w => w.gmv), 1)

  const warehouseColumns: TableColumn<KpiByWarehouseRow>[] = [
    { key: 'warehouseName', title: '仓库', width: 160, render: v => <span className="font-medium">{String(v)}</span> },
    { key: 'gmv', title: 'GMV', width: 120, align: 'right', render: v => <span className="tabular-nums">{money(Number(v))}</span> },
    { key: 'grossProfit', title: '毛利', width: 120, align: 'right', render: v => <span className="tabular-nums text-success">{money(Number(v))}</span> },
    { key: 'orderCount', title: '订单数', width: 100, align: 'right', render: v => <span className="tabular-nums">{Number(v).toLocaleString('zh-CN')}</span> },
    { key: 'avgOrderValue', title: '平均客单', width: 120, align: 'right', render: v => <span className="tabular-nums">{money(Number(v))}</span> },
    { key: 'share', title: 'GMV 占比', width: 140, render: (_, r) => <span className="tabular-nums text-muted-foreground">{((r.gmv / maxGmv) * 100).toFixed(1)}%</span> },
  ]

  return (
    <div className="space-y-4">
      <PageHeader
        title="经营 KPI"
        description={`核心经营指标与 ${data?.prevPeriod ? '上期(' + data.prevPeriod + ')' : '上期'} 环比`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Select value={period} onValueChange={setPeriod}>
              <SelectTrigger className="h-9 w-36">
                <SelectValue placeholder="选择月份" />
              </SelectTrigger>
              <SelectContent>
                {options.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={() => refetch()}>立即刷新</Button>
          </div>
        }
      />

      {isError && !data ? (
        <QueryErrorState error={error} onRetry={() => void refetch()} title="经营 KPI 加载失败" description="当前 KPI 数据暂时无法加载，请重试或稍后再试。" compact />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {(data?.metrics ?? Array.from({ length: 5 }, (_, i) => ({
            key: ['gmv', 'grossProfit', 'orderCount', 'received', 'avgOrderValue'][i],
            label: ['GMV', '毛利', '订单数', '回款', '平均客单'][i],
            current: 0, previous: 0, changePct: null,
          }))).map((m) => (
            <MetricCard key={m.key} metric={m} isMoney={['gmv', 'grossProfit', 'received', 'avgOrderValue'].includes(m.key)} loading={isLoading} />
          ))}
        </div>
      )}

      {isLoading && <div className="flex h-32 items-center justify-center"><div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" /></div>}

      {!isLoading && !isError && (
        <>
          <ReportPanel
            title="近 12 个月经营趋势"
            description="GMV / 毛利折线 + 回款柱状，口径与上方卡片一致"
            empty={chartRows.length === 0}
            emptyTitle="暂无趋势数据"
            emptyDescription="当前期间范围内没有销售或回款记录"
          >
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartRows} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="month" tick={axisTick} />
                  <YAxis tick={axisTick} width={48} tickFormatter={wan} />
                  <Tooltip formatter={(v) => money(Number(v ?? 0))} contentStyle={chartTooltip} cursor={{ stroke: 'hsl(var(--border))' }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="回款" fill="hsl(var(--success))" radius={[4, 4, 0, 0]} maxBarSize={24} />
                  <Line type="monotone" dataKey="GMV" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 3 }} />
                  <Line type="monotone" dataKey="毛利" stroke="hsl(var(--warning))" strokeWidth={2} dot={{ r: 3 }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </ReportPanel>

          <ReportPanel
            title="当月分仓表现"
            description={`${data?.period ?? ''} 各仓库 GMV / 毛利 / 订单数 / 客单`}
            empty={!data?.byWarehouse?.length}
            emptyTitle="该月暂无分仓数据"
            emptyDescription="当前期间内没有已出库销售单"
          >
            <DataTable
              columns={warehouseColumns}
              data={data?.byWarehouse ?? []}
              rowKey="warehouseId"
              emptyText="暂无分仓数据"
            />
          </ReportPanel>
        </>
      )}
    </div>
  )
}
