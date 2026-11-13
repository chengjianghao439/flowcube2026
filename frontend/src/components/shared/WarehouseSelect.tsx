import type { KitReadOwner } from '@/api/kits'
import { assertKitReadOwner } from '@/hooks/useKits'
import { toast } from '@/lib/toast'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useWarehousesActive } from '@/hooks/useWarehouses'
import { cn } from '@/lib/utils'

interface WarehouseSelectProps {
  readOwner?: KitReadOwner
  id?: string
  value: number | null
  onChange: (id: number | null, name: string) => void
  placeholder?: string
  /** 是否展示"全部仓库"这类清除选项（查询筛选场景用；表单必选场景不用） */
  allowClear?: boolean
  clearLabel?: string
  className?: string
  disabled?: boolean
  showReadStatus?: boolean
}

/** 统一仓库下拉选择：仓库数量有限，下拉比弹窗式 Finder 更快捷 */
export function WarehouseSelect({
  id,
  readOwner,
  value,
  onChange,
  placeholder = '选择仓库',
  allowClear = false,
  clearLabel = '全部仓库',
  className,
  disabled,
  showReadStatus = false,
}: WarehouseSelectProps) {
  const { data: warehouses, isLoading, isError, isPaused, refetch } = useWarehousesActive(readOwner)
  const loadFailed = showReadStatus && (isError || isPaused)
  const loading = showReadStatus && isLoading
  const prompt = loadFailed ? '仓库加载失败' : loading ? '正在加载仓库…'
    : showReadStatus && warehouses?.length === 0 ? '暂无可用仓库' : placeholder

  return (
    <>
      <Select
        value={value != null ? String(value) : allowClear ? '__all__' : ''}
        onValueChange={v => {
          if (disabled) return
          if (readOwner) {
            try { assertKitReadOwner(readOwner) }
            catch (error) { toast.error(error instanceof Error ? error.message : '读取来源已变化'); return }
          }
          if (v === '__all__') { onChange(null, ''); return }
          const id = Number(v)
          const name = warehouses?.find(w => w.id === id)?.name || ''
          onChange(id, name)
        }}
        disabled={disabled || (!warehouses?.length && (loadFailed || loading))}
      >
        <SelectTrigger id={id} className={cn('h-10 w-full', className)}>
          <SelectValue placeholder={prompt} />
        </SelectTrigger>
        <SelectContent>
          {allowClear && <SelectItem value="__all__">{clearLabel}</SelectItem>}
          {warehouses?.map(w => (
            <SelectItem key={w.id} value={String(w.id)}>{w.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      {loadFailed && !disabled && (
        <div className="flex items-center gap-2 text-xs">
          {value != null && <span role="status">仓库加载失败</span>}
          <button type="button" aria-label="重试加载仓库" className="font-medium text-primary hover:underline" onClick={() => {
            if (readOwner) {
              try { assertKitReadOwner(readOwner) }
              catch (error) { toast.error(error instanceof Error ? error.message : '读取来源已变化'); return }
            }
            void refetch()
          }}>重试</button>
        </div>
      )}
    </>
  )
}
