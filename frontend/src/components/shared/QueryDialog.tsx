import { useRef, type ReactNode } from 'react'
import { AppDialog } from './AppDialog'
import { Button } from '@/components/ui/button'

interface QueryDialogProps {
  open: boolean
  dialogId: string
  title: ReactNode
  description?: ReactNode
  width?: number
  children: ReactNode
  onClose: () => void
  onReset: () => void
  onApply: () => void
  resetLabel?: string
  onOpenAutoFocus?: (event: Event) => void
  onCloseAutoFocus?: (event: Event) => void
}

/** 查询只管理外壳：字段、草稿、默认口径和应用时机由原调用方负责。 */
export function QueryDialog({ open, dialogId, title, description, width = 520, children, onClose, onReset, onApply,
  resetLabel = '重置', onOpenAutoFocus, onCloseAutoFocus }: QueryDialogProps) {
  const bodyRef = useRef<HTMLDivElement>(null)
  function focusCondition(event: Event) {
    onOpenAutoFocus?.(event)
    if (event.defaultPrevented) return
    // 日期控件聚焦会自动展开日历；优先进入文本条件，其次进入安全的选择入口。
    const available = (field: HTMLElement) => !field.matches(':disabled,[readonly],[aria-disabled="true"]')
      && !field.closest('.fc-date-picker,[hidden],[inert],[aria-hidden="true"]')
    const input = Array.from(bodyRef.current?.querySelectorAll<HTMLInputElement>('input:not([type]),input[type="text"],input[type="search"]') ?? [])
      .find(available)
    const target = input ?? Array.from(bodyRef.current?.querySelectorAll<HTMLElement>('button,[role="combobox"]') ?? []).find(available)
    if (target) { event.preventDefault(); target.focus() }
  }
  return (
    <AppDialog open={open} dialogId={dialogId} title={title} defaultWidth={width}
      resizable={false} sizeToContent captureFocusOnOpen descriptionInHeader
      description={description ?? (typeof title === 'string' ? `设置${title.replace(/查询/g, '')}的筛选条件。` : '设置筛选条件，查询当前列表。')}
      onOpenChange={next => { if (!next) onClose() }}
      onOpenAutoFocus={focusCondition} onCloseAutoFocus={onCloseAutoFocus}
      footer={<div className="fc-query-dialog-actions flex flex-wrap items-center justify-between gap-2">
        <Button variant="ghost" onClick={onReset}>{resetLabel}</Button>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button onClick={onApply}>查询</Button>
        </div>
      </div>}
    >
      <div ref={bodyRef} className="fc-query-dialog-content min-w-0">{children}</div>
    </AppDialog>
  )
}
