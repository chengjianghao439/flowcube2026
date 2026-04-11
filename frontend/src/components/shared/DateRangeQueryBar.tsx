import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

interface DateRangeQueryBarProps {
  label?: string
  startDate: string
  endDate: string
  onStartDateChange: (value: string) => void
  onEndDateChange: (value: string) => void
  onApply: () => void
  onReset: () => void
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
  onRefresh,
  updatedAt,
}: DateRangeQueryBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-card px-4 py-3 shadow-sm">
      <span className="text-sm font-medium text-muted-foreground">{label}：</span>
      <Input
        type="date"
        value={startDate}
        onChange={e => onStartDateChange(e.target.value)}
        className="h-9 w-40"
      />
      <span className="text-sm text-muted-foreground">至</span>
      <Input
        type="date"
        value={endDate}
        onChange={e => onEndDateChange(e.target.value)}
        className="h-9 w-40"
      />
      <Button size="sm" onClick={onApply}>查询</Button>
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
    </div>
  )
}
