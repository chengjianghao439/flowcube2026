import type { DefaultLegendContentProps, DefaultTooltipContentProps } from 'recharts'
import type { ReactNode } from 'react'

/** Recharts 保留数据、定位与键盘导航；这里仅统一提示内容与图例。 */
export function ChartTooltipContent({ active, payload, label, labelFormatter, formatter }: DefaultTooltipContentProps & { active?: boolean }) {
  const entries = payload?.filter(entry => !entry.hide && entry.type !== 'none' && entry.value != null) ?? []
  if (!active || !entries.length) return null
  const heading = labelFormatter ? labelFormatter(label, entries) : label
  return (
    <div className="fc-chart-tooltip" role="status">
      {heading != null && heading !== '' && <p className="fc-chart-tooltip-heading">{heading}</p>}
      <div className="fc-chart-tooltip-items">
        {entries.map((entry, index) => {
          const format = entry.formatter ?? formatter
          const formatted = format?.(entry.value!, entry.name ?? '', entry, index, entries)
          if (format && formatted == null) return null
          const [value, name] = Array.isArray(formatted)
            ? formatted
            : [formatted ?? (Array.isArray(entry.value) ? entry.value.join(' – ') : entry.value), entry.name]
          return (
            <div className="fc-chart-tooltip-row" key={`${String(entry.dataKey ?? entry.name)}-${index}`}>
              <span className="fc-chart-key" style={{ backgroundColor: entry.color ?? entry.fill ?? entry.stroke }} aria-hidden />
              <span className="fc-chart-tooltip-name">{name}</span>
              <span className="fc-chart-tooltip-value">{value}{entry.unit}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function ChartLegendContent({ payload, formatter }: DefaultLegendContentProps) {
  const entries = payload?.filter(entry => entry.type !== 'none') ?? []
  if (!entries.length) return null
  return (
    <ul className="fc-chart-legend" aria-label="图表图例">
      {entries.map((entry, index) => (
        <li key={`${String(entry.dataKey ?? entry.value)}-${index}`}>
          <span className="fc-chart-key" data-line={entry.type === 'line' || entry.type === 'plainline' || undefined} style={{ backgroundColor: entry.color }} aria-hidden />
          <span>{(entry.formatter ?? formatter)?.(entry.value, entry, index) ?? entry.value}</span>
        </li>
      ))}
    </ul>
  )
}

/** 独立于 SVG 的数值图例：长名称自然换行，不挤压环图绘图区。 */
export function ChartValueLegend({ entries }: { entries: { key: string | number; label: string; value: ReactNode; color: string }[] }) {
  return <ul className="fc-chart-value-legend" aria-label="账户余额明细">
    {entries.map(entry => <li key={entry.key}>
      <span className="fc-chart-key" style={{ backgroundColor: entry.color }} aria-hidden />
      <span>{entry.label}</span>
      <span className="fc-chart-value">{entry.value}</span>
    </li>)}
  </ul>
}
