import { useLayoutEffect, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react'
import { QueryDialog } from './QueryDialog'
import { QueryFormLayout } from './QueryFormLayout'

interface ListQueryDialogProps<T> {
  open: boolean
  dialogId: string
  title: string
  initial: T
  empty: T
  onApply: (value: T) => void
  onClose: () => void
  validate?: (value: T) => string | undefined
  children: (draft: T, setDraft: Dispatch<SetStateAction<T>>) => ReactNode
}

export function ListQueryDialog<T>({ open, dialogId, title, initial, empty, onApply, onClose, validate, children }: ListQueryDialogProps<T>) {
  const [draft, setDraft] = useState(initial)
  const wasOpen = useRef(false)
  useLayoutEffect(() => {
    if (open && !wasOpen.current) setDraft(initial)
    wasOpen.current = open
  }, [open, initial])
  const error = validate?.(draft)
  function apply() {
    if (error) return
    onApply(draft)
    onClose()
  }
  return (
    <QueryDialog open={open} dialogId={dialogId} title={title} onClose={onClose}
      resetLabel="清空" onReset={() => setDraft(empty)} onApply={apply} applyDisabled={!!error}>
      <div onKeyDown={event => {
        const field = event.target
        if (event.key !== 'Enter' || event.nativeEvent.isComposing || event.defaultPrevented ||
          !(field instanceof HTMLInputElement) || !['text', 'search', 'number'].includes(field.type) ||
          !event.currentTarget.contains(field) || field.closest('.fc-date-picker,[role="combobox"]')) return
        event.preventDefault()
        apply()
      }}>
        <QueryFormLayout>
          {children(draft, setDraft)}
          {error && <p role="alert" className="col-span-full text-xs text-destructive-ink">{error}</p>}
        </QueryFormLayout>
      </div>
    </QueryDialog>
  )
}
