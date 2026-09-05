interface OrderStatusFilterProps {
  label: string
  value: string
  options: readonly { value: string; label: string; count?: number | string }[]
  onChange: (value: string) => void
}

/** 状态是列表筛选，不是独立页面；用按钮组保留键盘和读屏语义。 */
export function OrderStatusFilter({ label, value, options, onChange }: OrderStatusFilterProps) {
  return <div role="group" aria-label={label} className="flex min-w-0 flex-wrap items-center gap-1 border-b border-border">
    {options.map(option => <button key={option.value || 'all'} type="button" aria-pressed={value === option.value}
      onClick={() => onChange(option.value)}
      className={`min-h-10 border-b-2 px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${value === option.value ? 'border-primary font-medium text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>
      {option.label}{option.count != null && <span className="ml-1.5 text-xs tabular-nums">{option.count}</span>}
    </button>)}
  </div>
}
