/**
 * 波次效率报表
 * 路由：/reports/wave-performance
 */
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getWavePerformanceApi } from '@/api/reports'
import PageHeader from '@/components/shared/PageHeader'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { WaveStats } from '@/api/reports'

const STATUS_COLOR: Record<number, string> = {
  1: 'bg-gray-100 text-gray-600',
  2: 'bg-blue-100 text-blue-700',
  3: 'bg-yellow-100 text-yellow-700',
  4: 'bg-green-100 text-green-700',
  5: 'bg-red-100 text-red-600',
}

function fmtDuration(min: number | null): string {
  if (min == null) return '—'
  if (min < 60) return `${min} 分钟`
  return `${Math.floor(min / 60)}h ${min % 60}m`
}

function SummaryCard({ label, value, sub, accent = false }: {
  label: string; value: string | number; sub?: string; accent?: boolean
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <p className="text-table-head">{label}</p>
      <p className={`mt-2 text-3xl font-bold tabular-nums ${
        accent ? 'text-primary' : 'text-foreground'
      }`}>{value}</p>
      {sub && <p className="mt-1 text-helper">{sub}</p>}
    </div>
  )
}

function EfficiencyBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-mono text-foreground w-16 text-right shrink-0">
        {value.toFixed(1)} 件/分
      </span>
    </div>
  )
}

export default function WavePerformancePage() {
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate]     = useState('')
  const [applied, setApplied]     = useState<{ startDate: string; endDate: string }>({ startDate: '', endDate: '' })
  const [sortField, setSortField] = useState<string>('createdAt')
  const [sortAsc, setSortAsc]     = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['wave-performance', applied],
    queryFn:  () => getWavePerformanceApi(applied).then(r => r.data.data!),
  })

  const apply = () => setApplied({ startDate, endDate })
  const reset = () => { setStartDate(''); setEndDate(''); setApplied({ startDate: '', endDate: '' }) }

  function toggleSort(field: string) {
    if (sortField === field) setSortAsc(a => !a)
    else { setSortField(field); setSortAsc(false) }
  }

  const waves: WaveStats[] = (data?.waves ?? []).slice().sort((a, b) => {
    const va = (a as Record<string, unknown>)[sortField]
    const vb = (b as Record<string, unknown>)[sortField]
    if (va == null && vb == null) return 0
    if (va == null) return sortAsc ? -1 : 1
    if (vb == null) return sortAsc ? 1 : -1
    const res = va < vb ? -1 : va > vb ? 1 : 0
    return sortAsc ? res : -res
  })

  const maxEfficiency = Math.max(...waves.map(w => w.efficiency ?? 0), 0.01)

  function SortTh({ field, children }: { field: string; children: React.ReactNode }) {
    const active = sortField === field
    return (
      <th
        className={`pb-2 text-right cursor-pointer select-none hover:text-foreground transition-colors ${
          active ? 'text-primary' : 'text-muted-foreground'
        }`}
        onClick={() => toggleSort(field)}
      >
        {children} {active ? (sortAsc ? '↑' : '↓') : ''}
      </th>
    )
  }

  return (
    <div className="space-y-6">
      {/* 页面标题 */}
      <PageHeader
        title="波次效率报表"
        description="波次拣货时长、SKU 分布与拣货效率分析，统一桌面端页头与字号。"
      />

      {/* 过滤器 */}
      <div className="flex gap-2 items-center flex-wrap">
        <span className="text-muted-body">创建日期：</span>
        <Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="w-40" />
        <span className="text-muted-body">至</span>
        <Input type="date" value={endDate}   onChange={e => setEndDate(e.target.value)}   className="w-40" />
        <Button onClick={apply}>查询</Button>
        <Button variant="outline" onClick={reset}>重置</Button>
      </div>

      {/* 汇总卡片 */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
        <SummaryCard
          label="总波次数"
          value={data?.summary.totalWaves ?? '-'}
          sub="近 30 天"
        />
        <SummaryCard
          label="已完成波次"
          value={data?.summary.completedWaves ?? '-'}
          sub={data ? `完成率 ${data.summary.totalWaves > 0 ? Math.round(data.summary.completedWaves / data.summary.totalWaves * 100) : 0}%` : undefined}
          accent
        />
        <SummaryCard
          label="平均拣货时长"
          value={data?.summary.avgDurationMinutes != null ? fmtDuration(Math.round(data.summary.avgDurationMinutes)) : '—'}
          sub="波次平均完成时间"
        />
        <SummaryCard
          label="平均 SKU 数"
          value={data?.summary.avgSkuCount ?? '—'}
          sub="每波次平均种类"
        />
        <SummaryCard
          label="累计拣货量"
          value={data?.summary.totalPickedQty.toFixed(0) ?? '-'}
          sub="件"
        />
      </div>

      {/* 波次明细表 */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <h2 className="font-semibold text-foreground">波次明细</h2>
          <span className="text-helper">点击列标题排序</span>
        </div>

        {isLoading && (
          <div className="flex h-40 items-center justify-center">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        )}

        {!isLoading && waves.length === 0 && (
          <p className="text-center text-muted-body py-12">暂无波次数据</p>
        )}

        {waves.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-table-head">
                  <th className="pb-3 px-5 text-left">波次号</th>
                  <th className="pb-3 text-left">状态</th>
                  <th className="pb-3 text-left">操作员</th>
                  <SortTh field="taskCount">任务数</SortTh>
                  <SortTh field="skuCount">SKU</SortTh>
                  <SortTh field="totalPickedQty">拣货量</SortTh>
                  <SortTh field="durationMinutes">时长</SortTh>
                  <th className="pb-3 pr-5 text-right">拣货效率</th>
                </tr>
              </thead>
              <tbody>
                {waves.map(w => (
                  <tr key={w.id} className="border-b border-border/60 last:border-0 hover:bg-muted/30 transition-colors">
                    <td className="py-3 px-5">
                      <p className="text-doc-code-strong">{w.waveNo}</p>
                      <p className="text-helper">{new Date(w.createdAt).toLocaleDateString('zh-CN')}</p>
                    </td>
                    <td className="py-3">
                      <Badge className={`${STATUS_COLOR[w.status]} text-xs border-0`}>{w.statusName}</Badge>
                    </td>
                    <td className="py-3 text-foreground">{w.operatorName}</td>
                    <td className="py-3 text-right text-foreground">{w.taskCount}</td>
                    <td className="py-3 text-right">
                      <span className="font-semibold text-foreground">{w.skuCount}</span>
                      <span className="text-muted-foreground text-xs ml-1">种</span>
                    </td>
                    <td className="py-3 text-right">
                      <span className="font-semibold text-primary">{w.totalPickedQty.toFixed(0)}</span>
                      <span className="text-muted-foreground text-xs ml-1">件</span>
                    </td>
                    <td className="py-3 text-right text-foreground">{fmtDuration(w.durationMinutes)}</td>
                    <td className="py-3 pr-5 min-w-[140px]">
                      {w.efficiency != null
                        ? <EfficiencyBar value={w.efficiency} max={maxEfficiency} />
                        : <span className="text-muted-foreground text-xs">—</span>
                      }
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
