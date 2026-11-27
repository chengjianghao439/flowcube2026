import { X } from 'lucide-react'

interface AppliedDateRangeProps {
  startDate?: string
  endDate?: string
  label?: string
  onClear?: () => void
}

export function AppliedDateRange({ startDate, endDate, label = '日期', onClear }: AppliedDateRangeProps) {
  const hasRange = Boolean(startDate || endDate)
  const range = startDate && endDate
    ? (startDate === endDate ? startDate : `${startDate} 至 ${endDate}`)
    : startDate ? `自 ${startDate} 起` : endDate ? `截至 ${endDate}` : '未限日期'

  return (
    <span className={hasRange ? 'fc-query-chip flex-wrap' : 'inline-flex items-center gap-1.5 text-xs text-muted-foreground'}>
      <span>{label}</span>
      <span className={hasRange ? 'whitespace-nowrap font-medium tabular-nums' : 'whitespace-nowrap font-medium text-foreground/80 tabular-nums'}>{range}</span>
      {hasRange && onClear && (
        <button type="button" className="inline-flex size-5 shrink-0 items-center justify-center rounded hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="清除日期限制" onClick={onClear}>
          <X aria-hidden className="size-3.5" />
        </button>
      )}
    </span>
  )
}
