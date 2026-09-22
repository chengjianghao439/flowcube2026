/**
 * PickerField — 「从弹窗里挑一条记录」的统一字段。
 *
 * 2026-09-19 合并自两个组件：表单用 `FinderTrigger`（做成输入框样、无清除按钮），
 * 查询弹窗用 `QueryPickerField`（做成按钮样、有清除按钮）。同一个动作两种长相，
 * 用户在销售单表头与销售查询弹窗里看到的东西不一样，会问「这里到底能不能打字」。
 *
 * 统一为：**输入框样式（点击弹出查找器）+ 已选时的清除 X**。
 * 高度交给调用方：查询弹窗传 `className="h-9"`（与同排的 Select / Input 一致），
 * 表单沿用默认 `h-10`；两边的视觉与合并前保持一致，改的只是「长得像不像同一个东西」。
 */
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export function PickerField({ id, label, value, placeholder, onOpen, onClear, onDoubleClick, disabled, className }: {
  id?: string
  /** 给了就渲染内置 label（查询弹窗用）；表单场景通常外部已有 Label，不传 */
  label?: string
  value: string
  placeholder: string
  onOpen: () => void
  /** 给了才显示清除按钮 */
  onClear?: () => void
  onDoubleClick?: () => void
  disabled?: boolean
  className?: string
}) {
  const field = (
    <div className="flex items-center gap-1">
      <button
        id={id}
        type="button"
        onClick={onOpen}
        onDoubleClick={onDoubleClick}
        disabled={disabled}
        className={cn(
          'h-10 w-full truncate rounded-md border border-input bg-background px-3 py-2',
          'text-left text-sm transition-colors',
          'hover:border-primary hover:bg-muted/30',
          'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
          'disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
      >
        {value
          ? <span className="truncate text-foreground">{value}</span>
          : <span className="text-muted-foreground">{placeholder}</span>}
      </button>
      {value && onClear ? (
        <Button type="button" variant="ghost" size="icon" className="shrink-0" onClick={onClear} disabled={disabled} aria-label={`清除${label ?? '选择'}`}>
          <X className="h-4 w-4" />
        </Button>
      ) : null}
    </div>
  )
  if (!label) return field
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {field}
    </label>
  )
}
