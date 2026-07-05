import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useWarehousesActive } from '@/hooks/useWarehouses'
import { cn } from '@/lib/utils'

interface WarehouseSelectProps {
  id?: string
  value: number | null
  onChange: (id: number | null, name: string) => void
  placeholder?: string
  /** 是否展示"全部仓库"这类清除选项（查询筛选场景用；表单必选场景不用） */
  allowClear?: boolean
  clearLabel?: string
  className?: string
  disabled?: boolean
}

/** 统一仓库下拉选择：仓库数量有限，下拉比弹窗式 Finder 更快捷 */
export function WarehouseSelect({
  id,
  value,
  onChange,
  placeholder = '选择仓库',
  allowClear = false,
  clearLabel = '全部仓库',
  className,
  disabled,
}: WarehouseSelectProps) {
  const { data: warehouses } = useWarehousesActive()

  return (
    <Select
      value={value != null ? String(value) : '__all__'}
      onValueChange={v => {
        if (v === '__all__') { onChange(null, ''); return }
        const id = Number(v)
        const name = warehouses?.find(w => w.id === id)?.name || ''
        onChange(id, name)
      }}
      disabled={disabled}
    >
      <SelectTrigger id={id} className={cn('h-10 w-full', className)}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {allowClear && <SelectItem value="__all__">{clearLabel}</SelectItem>}
        {warehouses?.map(w => (
          <SelectItem key={w.id} value={String(w.id)}>{w.name}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
