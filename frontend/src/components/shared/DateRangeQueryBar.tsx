import { useId } from 'react'
import { Button } from '@/components/ui/button'
import { DatePicker } from '@/components/shared/DatePicker'
import { isReversedDateRange } from '@/lib/dateRange'

export interface DateRangePreset {
  label: string
  startDate: string
  endDate: string
}

interface DateRangeQueryBarProps {
  label?: string
  startDate: string
  endDate: string
  onStartDateChange: (value: string) => void
  onEndDateChange: (value: string) => void
  onApply: () => void
  onReset: () => void
  presets?: DateRangePreset[]
  onPresetSelect?: (preset: DateRangePreset) => void
  onRefresh?: () => void
  updatedAt?: string
}

export function DateRangeQueryBar({
  label = '日期',
  startDate,
  endDate,
  onStartDateChange,
  onEndDateChange,
  onApply,
  onReset,
  presets,
  onPresetSelect,
  onRefresh,
  updatedAt,
}: DateRangeQueryBarProps) {
  const rangeErrorId = useId()
  const rangeInvalid = isReversedDateRange(startDate, endDate)
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-4 py-3">
      <span className="text-sm font-medium text-muted-foreground">{label}：</span>
      {presets?.length ? (
        <div className="flex flex-wrap gap-2">
          {presets.map(preset => (
            <Button
              key={preset.label}
              size="sm"
              variant="outline"
              onClick={() => onPresetSelect?.(preset)}
            >
              {preset.label}
            </Button>
          ))}
        </div>
      ) : null}
      <DatePicker
        aria-label={`${label}（起）`}
        aria-invalid={rangeInvalid || undefined}
        aria-describedby={rangeInvalid ? rangeErrorId : undefined}
        value={startDate}
        onChange={onStartDateChange}
        max={endDate || undefined}
        className="h-9 w-40"
      />
      <span className="text-sm text-muted-foreground">至</span>
      <DatePicker
        aria-label={`${label}（止）`}
        aria-invalid={rangeInvalid || undefined}
        aria-describedby={rangeInvalid ? rangeErrorId : undefined}
        value={endDate}
        onChange={onEndDateChange}
        min={startDate || undefined}
        className="h-9 w-40"
      />
      <Button size="sm" onClick={onApply} disabled={rangeInvalid}>查询</Button>
      <Button size="sm" variant="ghost" onClick={onReset}>重置</Button>
      <div className="ml-auto flex flex-wrap items-center gap-2">
        {updatedAt && (
          <span className="text-xs text-muted-foreground">
            最后刷新：{updatedAt}
          </span>
        )}
        {onRefresh && (
          <Button size="sm" variant="outline" onClick={onRefresh}>立即刷新</Button>
        )}
      </div>
      {rangeInvalid && <p id={rangeErrorId} role="alert" className="basis-full text-sm text-destructive-ink">起始日期不能晚于结束日期。</p>}
    </div>
  )
}
