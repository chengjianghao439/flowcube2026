import { ChartContainer } from '@/components/shared/ChartContainer'
import { BarChart, Bar, CartesianGrid, LabelList, Tooltip, XAxis, YAxis } from 'recharts'
import { axisTick, chartBarCursor, chartGrid, money, wan } from '@/components/dashboard/chartTheme'
import { ChartTooltipContent } from './ChartPresentation'

/** 每月的金额与单数始终可读；多月沿图内滚动，不截断业务月份。 */
export function MonthlyAmountChart({ rows, label }: {
  rows: { month: string; totalAmount: number; orderCount: number }[]
  label: string
}) {
  const data = rows.map(row => ({ ...row, annotation: `${money(row.totalAmount)} · ${row.orderCount} 单` }))
  return <div className="max-h-80 overflow-auto">
    <div className="min-w-[460px]" style={{ height: Math.max(180, rows.length * 42 + 36) }}>
      <ChartContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 164, left: 0, bottom: 0 }}>
          <CartesianGrid {...chartGrid} vertical horizontal={false} />
          <XAxis type="number" axisLine={false} tickLine={false} tick={axisTick} tickFormatter={wan} />
          <YAxis type="category" dataKey="month" width={66} axisLine={false} tickLine={false} tick={axisTick} interval={0} />
          <Tooltip content={<ChartTooltipContent />} cursor={chartBarCursor}
            formatter={(value, _name, entry) => [`${money(Number(value ?? 0))} · ${entry.payload.orderCount} 单`, label]} />
          <Bar dataKey="totalAmount" name={label} fill="hsl(var(--primary))" maxBarSize={14} radius={[0, 4, 4, 0]} isAnimationActive={false}>
            <LabelList dataKey="annotation" position="right" offset={10} fontSize={11} fill="hsl(var(--foreground))" />
          </Bar>
        </BarChart>
      </ChartContainer>
    </div>
  </div>
}
