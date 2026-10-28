/**
 * PDA 异常数据分析页
 * 路由：/reports/pda-anomaly（挂入现有报表中心）
 */
import { useState } from 'react'
import { AlertTriangle, Undo2, ScanLine, Percent } from 'lucide-react'
import { getPdaAnomalyApi } from '@/api/reports'
import PageHeader from '@/components/shared/PageHeader'
import { QueryErrorState } from '@/components/shared/QueryErrorState'
import { DateRangeQueryBar } from '@/components/shared/DateRangeQueryBar'
import { ReportPanel } from '@/components/shared/ReportPanel'
import { StatTile } from '@/components/dashboard/StatTile'
import { getMonthDateRange, getRelativeDateRange } from '@/lib/dateRange'
import { usePollingReport } from '@/hooks/usePollingReport'
import { formatDisplayDateTime } from '@/lib/dateTime'
import { CompactColumnChart } from '@/components/shared/CompactColumnChart'
import { ReportMeter } from '@/components/shared/ReportMeter'
import { CHART_TONES } from '@/components/dashboard/chartTheme'

function BarRow({ label, value, max, color = CHART_TONES.destructive }: { label: string; value: number; max: number; color?: string }) {
  return (
    <div className="fc-report-bar-row flex items-center gap-3">
      <p className="w-44 shrink-0 break-words text-sm leading-5 text-foreground">{label}</p>
      <ReportMeter value={value} max={max} label={label} valueText={`${value} 次`} color={color} />
      <p className="w-14 text-right tabular-nums text-sm font-semibold text-foreground">{value}</p>
    </div>
  )
}

export default function PdaAnomalyPage() {
  const recent7d = getRelativeDateRange(7)
  const recent30d = getRelativeDateRange(30)
  const monthRange = getMonthDateRange()
  const [startDate, setStartDate] = useState(recent7d.startDate)
  const [endDate,   setEndDate]   = useState(recent7d.endDate)
  const [applied, setApplied]     = useState<{ startDate?: string; endDate?: string }>({
    startDate: recent7d.startDate,
    endDate: recent7d.endDate,
  })

  const pdaAnomalyQ = usePollingReport({
    queryKey: ['pda-anomaly', applied],
    queryFn: () => getPdaAnomalyApi(applied),
    intervalMs: 60_000,
  })

  const { data, isLoading, isError, error, dataUpdatedAt, refetch } = pdaAnomalyQ

  const apply = () => setApplied({ startDate: startDate || undefined, endDate: endDate || undefined })
  const presetItems = [
    { label: '近 7 天', ...recent7d },
    { label: '近 30 天', ...recent30d },
    { label: '本月', ...monthRange },
  ]

  const s = data?.summary
  const maxErr   = Math.max(...(data?.byOperator     ?? []).map(r => r.errorCount), 1)
  const maxUndo  = Math.max(...(data?.undoByOperator ?? []).map(r => r.undoCount),  1)
  const maxRsn   = Math.max(...(data?.byReason       ?? []).map(r => r.count),       1)
  const maxBc    = Math.max(...(data?.byBarcode       ?? []).map(r => r.count),       1)

  return (
    <div className="space-y-6">
      <PageHeader
        title="PDA 异常分析"
        description="核对扫码错误、撤销与异常趋势。"
      />

      {isError && (
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
        onReset={() => {
          setStartDate(recent7d.startDate)
          setEndDate(recent7d.endDate)
          setApplied({ startDate: recent7d.startDate, endDate: recent7d.endDate })
        }}
        presets={presetItems}
        onPresetSelect={(preset) => {
          setStartDate(preset.startDate)
          setEndDate(preset.endDate)
          setApplied({ startDate: preset.startDate, endDate: preset.endDate })
        }}
        onRefresh={() => refetch()}
        updatedAt={dataUpdatedAt ? formatDisplayDateTime(new Date(dataUpdatedAt)) : undefined}
      />

      {isLoading && <div className="flex h-40 items-center justify-center"><div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" /></div>}

      {!isLoading && data && !isError && (<>

        {/* 汇总 */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatTile icon={ScanLine} label="总扫码次数" value={s?.totalScans ?? 0} />
          <StatTile icon={AlertTriangle} label="错误次数" value={s?.totalErrors ?? 0} tone={(s?.totalErrors ?? 0) > 0 ? 'danger' : 'primary'} accent={(s?.totalErrors ?? 0) > 0} />
          <StatTile icon={Undo2} label="撤销次数" value={s?.totalUndos ?? 0} tone={(s?.totalUndos ?? 0) > 0 ? 'warning' : 'primary'} accent={(s?.totalUndos ?? 0) > 0} />
          <StatTile icon={Percent} label="错误率" value={s?.errorRate ?? '0%'} tone={parseFloat(s?.errorRate ?? '0') > 5 ? 'danger' : 'primary'} accent={parseFloat(s?.errorRate ?? '0') > 5} hint="错误次数 / 总扫码" />
        </div>

        <div className="grid grid-cols-1 items-start md:grid-cols-2 gap-4">
          <ReportPanel
            title="每日错误趋势"
            description="最近时间范围内的错误变化"
            helper="用于快速判断异常是否在增多"
            empty={data.dailyTrend.length === 0}
            emptyTitle="暂无每日趋势"
            emptyDescription="当前筛选范围内暂无统计数据"
          >
            <CompactColumnChart rows={data.dailyTrend.map(row => ({ label: row.date, value: row.errorCount }))} label="错误次数" color={CHART_TONES.destructive} />
          </ReportPanel>

          <ReportPanel
            title="按操作员 — 错误次数"
            description="找出最容易出错的操作员"
            helper="聚焦培训和流程修正"
            empty={data.byOperator.length === 0}
            emptyTitle="暂无操作员错误数据"
            emptyDescription="当前筛选范围内暂无统计数据"
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
            emptyDescription="当前筛选范围内暂无统计数据"
          >
            <div className="space-y-2">
              {data.undoByOperator.map(r => (
                <BarRow key={r.operatorId} label={r.operatorName} value={r.undoCount} max={maxUndo} color={CHART_TONES.warning} />
              ))}
            </div>
          </ReportPanel>

          <ReportPanel
            title="错误原因分布"
            description="错误主要集中在哪些原因"
            helper="查看流程或设备问题"
            empty={data.byReason.length === 0}
            emptyTitle="暂无错误原因数据"
            emptyDescription="当前筛选范围内暂无统计数据"
          >
            <div className="space-y-2">
              {data.byReason.map(r => (
                <BarRow key={r.reason} label={r.reason} value={r.count} max={maxRsn} color={CHART_TONES.warning} />
              ))}
            </div>
          </ReportPanel>

          <ReportPanel
            title="问题最多的条码 Top 10"
            description="最容易出错的条码集中在哪些"
            helper="方便定位并修正问题"
            empty={data.byBarcode.length === 0}
            emptyTitle="暂无条码异常数据"
            emptyDescription="当前筛选范围内暂无统计数据"
          >
            <div className="space-y-2">
              {data.byBarcode.map(r => (
                <BarRow key={r.barcode} label={r.barcode} value={r.count} max={maxBc} color={CHART_TONES.info} />
              ))}
            </div>
          </ReportPanel>
        </div>
      </>)}
    </div>
  )
}
