import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Wallet, BarChart3 } from 'lucide-react'
import PageHeader from '@/components/shared/PageHeader'
import { Button } from '@/components/ui/button'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { StatTile } from '@/components/dashboard/StatTile'
import { getKpiApi, type KpiMetric } from '@/api/reports'

/**
 * 经营 KPI 仪表盘（P2-10）：GMV / 毛利 / 订单数 / 回款 / 平均客单 + 上期环比。
 * 数据来自后端 /reports/kpi（profitAnalysis 同口径，毛利 = 销售 - 成本快照）。
 */

const fmtMoney = (n: number) => `¥${Math.round(Number(n) || 0).toLocaleString()}`
const fmtCount = (n: number) => Number(n || 0).toLocaleString()

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

function MetricCard({ metric, isMoney }: { metric: KpiMetric; isMoney: boolean }) {
  const pct = metric.changePct
  const pctLabel = pct === null ? undefined : `${pct > 0 ? '+' : ''}${pct}%`
  const value = isMoney ? fmtMoney(metric.current) : fmtCount(metric.current)
  return (
    <StatTile
      label={metric.label}
      value={value}
      icon={isMoney ? Wallet : BarChart3}
      trendValue={pctLabel}
      hint={`上期 ${isMoney ? fmtMoney(metric.previous) : fmtCount(metric.previous)}`}
    />
  )
}

export default function KpiPage() {
  const options = useMemo(monthOptions, [])
  const [period, setPeriod] = useState(options[0] ?? '')

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['reports-kpi', period],
    queryFn: () => getKpiApi({ period }),
  })

  const moneyKeys = new Set(['gmv', 'grossProfit', 'received', 'avgOrderValue'])

  return (
    <div className="space-y-4">
      <PageHeader
        title="经营 KPI"
        description={`核心经营指标与 ${data?.prevPeriod ? '上期(' + data.prevPeriod + ')' : '上期'} 环比`}
        actions={
          <Select value={period} onValueChange={setPeriod}>
            <SelectTrigger className="h-9 w-36">
              <SelectValue placeholder="选择月份" />
            </SelectTrigger>
            <SelectContent>
              {options.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
            </SelectContent>
          </Select>
        }
      />

      {isError ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
          <span>KPI 数据加载失败</span>
          <Button variant="outline" size="sm" onClick={() => refetch()}>重试</Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {(data?.metrics ?? Array.from({ length: 5 }, (_, i) => ({
            key: String(i), label: isLoading ? '…' : '', current: 0, previous: 0, changePct: null,
          }))).map((m) => (
            <MetricCard key={m.key} metric={m} isMoney={moneyKeys.has(m.key)} />
          ))}
        </div>
      )}

      {isLoading && <p className="text-sm text-muted-foreground">加载中…</p>}
    </div>
  )
}
