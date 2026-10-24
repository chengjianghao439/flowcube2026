import { Bar, BarChart, CartesianGrid, Tooltip, XAxis, YAxis } from 'recharts'
import { axisTick, chartBarCursor, chartGrid, CHART_TONES } from '@/components/dashboard/chartTheme'
import { ChartContainer } from './ChartContainer'
import { ChartTooltipContent } from './ChartPresentation'

/** 次数趋势保留真实标签与零值；与其他电脑端图表共用查看、提示和可见性协议。 */
export function CompactColumnChart({ rows, label, color = CHART_TONES.primary }: {
  rows: { label: string; value: number }[]
  label: string
  color?: string
}) {
  return <div className="fc-compact-column-chart" role="group" aria-label={label}>
    <ChartContainer width="100%" height={160}>
      <BarChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
        <CartesianGrid {...chartGrid} />
        <XAxis dataKey="label" axisLine={false} tickLine={false} tick={axisTick} minTickGap={20} interval="preserveStartEnd" />
        <YAxis width={32} axisLine={false} tickLine={false} tick={axisTick} allowDecimals={false} />
        <Tooltip content={<ChartTooltipContent />} cursor={chartBarCursor} />
        <Bar dataKey="value" name={label} unit=" 次" fill={color} maxBarSize={26} radius={[3, 3, 0, 0]} isAnimationActive={false} />
      </BarChart>
    </ChartContainer>
    <table className="sr-only">
      <caption>{label}明细</caption>
      <thead><tr><th>时段</th><th>{label}（次）</th></tr></thead>
      <tbody>{rows.map(row => <tr key={row.label}><th scope="row">{row.label}</th><td>{row.value}</td></tr>)}</tbody>
    </table>
  </div>
}
