import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'

interface OrderStatusFilterProps {
  label: string
  value: string
  options: readonly { value: string; label: string; count?: number | string }[]
  onChange: (value: string) => void
}

/** 状态是列表筛选；Radix 管理组内焦点，确认后沿用原查询。 */
export function OrderStatusFilter({ label, value, options, onChange }: OrderStatusFilterProps) {
  // Radix 用空字符串表示未选择；编码后，“全部订单”的原空值仍是一项有效选择。
  const itemValue = (status: string) => JSON.stringify(status)
  return <ToggleGroup type="single" aria-label={label} value={itemValue(value)}
    onValueChange={next => {
      const option = options.find(option => itemValue(option.value) === next)
      if (option) onChange(option.value)
    }}
    className="desktop-status-filter flex flex-wrap rounded-none bg-transparent p-0">
    {options.map(option => <ToggleGroupItem key={option.value} value={itemValue(option.value)}
      onClick={() => { if (value === option.value) onChange(option.value) }}
      className="min-h-10 border-b-2 border-transparent px-3 text-sm shadow-none data-[state=on]:border-primary data-[state=on]:bg-transparent data-[state=on]:shadow-none">
      {option.label}{option.count != null && <span className="ml-1.5 text-xs tabular-nums">{option.count}</span>}
    </ToggleGroupItem>)}
  </ToggleGroup>
}
