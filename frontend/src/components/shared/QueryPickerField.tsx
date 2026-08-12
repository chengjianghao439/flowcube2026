/**
 * QueryPickerField — 查询弹窗里的「弹窗选择器」行
 *
 * 显示已选项 + 清除按钮，点击打开对应 Finder / 选择器。
 * 由各查询弹窗（PurchaseQueryDialog / SaleQueryDialog / …）复用，
 * 避免每个 QueryDialog 各自复制一份。
 */
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function QueryPickerField({ label, value, placeholder, onOpen, onClear }: {
  label: string
  value: string
  placeholder: string
  onOpen: () => void
  onClear: () => void
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <div className="flex items-center gap-1">
        <Button type="button" variant="outline" className="h-9 flex-1 justify-start font-normal" onClick={onOpen}>
          {value || <span className="text-muted-foreground">{placeholder}</span>}
        </Button>
        {value ? (
          <Button type="button" variant="ghost" size="icon" className="h-9 w-9 shrink-0" onClick={onClear} aria-label={`清除${label}`}>
            <X className="h-4 w-4" />
          </Button>
        ) : null}
      </div>
    </label>
  )
}
