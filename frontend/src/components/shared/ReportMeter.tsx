import { CHART_TONES } from '@/components/dashboard/chartTheme'

/** 有界比例使用原生meter，精确值仍由调用方显示；不为零值补造最小色条。 */
export function ReportMeter({ value, max, label, valueText, color = CHART_TONES.primary }: {
  value: number
  max: number
  label: string
  valueText: string
  color?: string
}) {
  return <meter className="fc-report-meter min-w-0 flex-1" min={0} max={max} value={value} aria-label={label} aria-valuetext={valueText} style={{ color }}>{valueText}</meter>
}
