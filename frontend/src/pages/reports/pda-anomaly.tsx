/**
 * PDA 异常数据分析页
 * 路由：/reports/pda-anomaly（挂入现有报表中心）
 */
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getPdaAnomalyApi } from '@/api/reports'
import PageHeader from '@/components/shared/PageHeader'
import { QueryErrorState } from '@/components/shared/QueryErrorState'
import { DateRangeQueryBar } from '@/components/shared/DateRangeQueryBar'
import { ReportPanel } from '@/components/shared/ReportPanel'
import { Button } from '@/components/ui/button'

function StatCard({ label, value, sub, accent }: { label: string; value: string | number; sub?: string; accent?: boolean }) {
  return (
    <div className={`rounded-xl border p-4 ${accent ? 'border-red-200 bg-red-50' : 'border-border bg-card'}`}>
      <p className="text-helper">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${accent ? 'text-red-600' : 'text-foreground'}`}>{value}</p>
      {sub && <p className="text-helper mt-0.5">{sub}</p>}
    </div>
  )
}

function BarRow({ label, value, max, color = 'bg-red-400' }: { label: string; value: number; max: number; color?: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0
  return (
    <div className="flex items-center gap-3">
      <p className="w-32 shrink-0 text-sm text-foreground truncate">{label}</p>
      <div className="flex-1 h-2.5 rounded-full bg-muted overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <p className="w-10 text-right text-sm font-semibold text-foreground">{value}</p>
    </div>
  )
}

function MiniChart({ data }: { data: { date: string; errorCount: number }[] }) {
  const max = Math.max(...data.map(d => d.errorCount), 1)
  return (
    <div className="flex items-end gap-1 h-16">
      {data.map(d => (
        <div key={d.date} className="flex-1 flex flex-col items-center gap-1 group relative">
          <div
            className="w-full rounded-t bg-red-400 hover:bg-red-500 transition-all"
            style={{ height: `${Math.max(4, (d.errorCount / max) * 56)}px` }}
          />
          <span className="text-[9px] text-muted-foreground rotate-45 origin-left hidden group-hover:block absolute -bottom-4 left-0">{d.date.slice(5)}</span>
        </div>
      ))}
    </div>
  )
}

export default function PdaAnomalyPage() {
  const [startDate, setStartDate] = useState('')
  const [endDate,   setEndDate]   = useState('')
  const [applied, setApplied]     = useState<{ startDate?: string; endDate?: string }>({})

  const pdaAnomalyQ = useQuery({
    queryKey: ['pda-anomaly', applied],
    queryFn: () => getPdaAnomalyApi(applied).then(r => r.data.data!),
    refetchInterval: 60_000,
  })

  const { data, isLoading, isError, error, dataUpdatedAt, refetch } = pdaAnomalyQ

  const apply = () => setApplied({ startDate: startDate || undefined, endDate: endDate || undefined })

  const s = data?.summary
  const maxErr   = Math.max(...(data?.byOperator     ?? []).map(r => r.errorCount), 1)
  const maxUndo  = Math.max(...(data?.undoByOperator ?? []).map(r => r.undoCount),  1)
  const maxRsn   = Math.max(...(data?.byReason       ?? []).map(r => r.count),       1)
  const maxBc    = Math.max(...(data?.byBarcode       ?? []).map(r => r.count),       1)

  return (
    <div className="space-y-6">
      <PageHeader
        title="PDA 异常分析"
        description="扫码错误、撤销操作、异常趋势统一用桌面端页头规格展示。"
        actions={(
          <Button variant="outline" onClick={() => refetch()}>立即刷新</Button>
        )}
      />

      {isError && !data && (
        <QueryErrorState
          error={error}
          onRetry={() => void refetch()}
          title="PDA 异常分析加载失败"
          description="当前异常分析数据暂时无法加载，请点击重试或稍后再试"
          compact
        />
      )}

      <DateRangeQueryBar
        label="异常日期"
        startDate={startDate}
        endDate={endDate}
        onStartDateChange={setStartDate}
        onEndDateChange={setEndDate}
        onApply={apply}
        onReset={() => { setStartDate(''); setEndDate(''); setApplied({}) }}
        onRefresh={() => refetch()}
        updatedAt={dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : undefined}
      />

      {isLoading && <div className="flex h-40 items-center justify-center"><div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" /></div>}

      {!isLoading && data && !isError && (<>

        {/* 汇总 */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard label="总扫码次数" value={s?.totalScans ?? 0} />
          <StatCard label="错误次数"   value={s?.totalErrors ?? 0} accent={(s?.totalErrors ?? 0) > 0} />
          <StatCard label="撤销次数"   value={s?.totalUndos ?? 0} accent={(s?.totalUndos ?? 0) > 0} />
          <StatCard label="错误率"     value={s?.errorRate ?? '0%'} accent={parseFloat(s?.errorRate ?? '0') > 5} sub="错误次数 / 总扫码" />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <ReportPanel
            title="每日错误趋势"
            description="最近时间范围内的错误变化"
            helper="用于快速判断异常是否在增多"
            empty={data.dailyTrend.length === 0}
            emptyTitle="暂无每日趋势"
            emptyDescription="当前筛选条件下没有错误趋势数据"
          >
            <>
              <MiniChart data={data.dailyTrend} />
              <div className="flex justify-between mt-1">
                <span className="text-helper">{data.dailyTrend[0]?.date}</span>
                <span className="text-helper">{data.dailyTrend[data.dailyTrend.length-1]?.date}</span>
              </div>
            </>
          </ReportPanel>

          <ReportPanel
            title="按操作员 — 错误次数"
            description="找出最容易出错的操作员"
            helper="聚焦培训和流程修正"
            empty={data.byOperator.length === 0}
            emptyTitle="暂无操作员错误数据"
            emptyDescription="当前没有可展示的操作员错误记录"
          >
            <div className="space-y-2">
              {data.byOperator.map(r => (
                <BarRow key={r.operatorId} label={r.operatorName} value={r.errorCount} max={maxErr} />
              ))}
            </div>
          </ReportPanel>

          <ReportPanel
            title="按操作员 — 撤销次数"
            description="查看谁最常撤销操作"
            helper="用于排查误扫或流程不熟"
            empty={data.undoByOperator.length === 0}
            emptyTitle="暂无撤销数据"
            emptyDescription="当前没有可展示的撤销统计"
          >
            <div className="space-y-2">
              {data.undoByOperator.map(r => (
                <BarRow key={r.operatorId} label={r.operatorName} value={r.undoCount} max={maxUndo} color="bg-orange-400" />
              ))}
            </div>
          </ReportPanel>

          <ReportPanel
            title="错误原因分布"
            description="错误主要集中在哪些原因"
            helper="查看流程或设备问题"
            empty={data.byReason.length === 0}
            emptyTitle="暂无错误原因数据"
            emptyDescription="当前没有可展示的错误原因分布"
          >
            <div className="space-y-2">
              {data.byReason.map(r => (
                <BarRow key={r.reason} label={r.reason} value={r.count} max={maxRsn} color="bg-yellow-400" />
              ))}
            </div>
          </ReportPanel>

          <ReportPanel
            title="问题最多的条码 Top 10"
            description="最容易出错的条码集中在哪些"
            helper="便于针对性修正"
            empty={data.byBarcode.length === 0}
            emptyTitle="暂无条码异常数据"
            emptyDescription="当前没有可展示的条码问题记录"
          >
            <div className="space-y-2">
              {data.byBarcode.map(r => (
                <BarRow key={r.barcode} label={r.barcode} value={r.count} max={maxBc} color="bg-purple-400" />
              ))}
            </div>
          </ReportPanel>
        </div>
      </>)}
    </div>
  )
}
