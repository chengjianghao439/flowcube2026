import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'

export interface QueryChip {
  key: string
  text: string
  onClear: () => void
}

/**
 * 已生效筛选条件的小标签行。
 *
 * 查询条件全部收在右上角的「查询」弹窗里，页面上不再平铺第二套筛选控件；但条件必须在页面上
 * 看得见、可逐个移除，否则用户看着一屏筛过的数据却不知道筛了什么。无生效条件时整行不渲染
 * （面板保持干净），因此各页面可以无条件地放这一行。
 */
export function QueryChips({ chips, onClearAll }: { chips: QueryChip[]; onClearAll: () => void }) {
  if (!chips.length) return null
  return (
    <div className="flex flex-wrap items-center gap-2">
      {chips.map(c => (
        <span
          key={c.key}
          className="inline-flex items-center gap-1 rounded-sm border border-primary/20 bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary"
        >
          {c.text}
          <button type="button" onClick={c.onClear} className="hover:opacity-70" aria-label={`移除 ${c.text}`}>
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      <Button size="sm" variant="ghost" onClick={onClearAll}>清空</Button>
    </div>
  )
}
