import { splitChartLabel, LINE_HEIGHT } from './chartLabelLayout'

export function WrappedCategoryTick({ x = 0, y = 0, payload }: {
  x?: number | string
  y?: number | string
  payload?: { value: string | number }
}) {
  const value = String(payload?.value ?? '')
  const lines = splitChartLabel(value)
  return (
    <text x={Number(x) - 4} y={Number(y)} fill="hsl(var(--muted-foreground))" fontSize={12} textAnchor="end">
      <title>{value}</title>
      {lines.map((line, index) => (
        <tspan key={index} x={Number(x) - 4} dy={index === 0 ? 4 - (lines.length - 1) * LINE_HEIGHT / 2 : LINE_HEIGHT}>
          {line}
        </tspan>
      ))}
    </text>
  )
}
