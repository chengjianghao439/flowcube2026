import { Input } from '@/components/ui/input'
import { ListQueryDialog } from './ListQueryDialog'
import { QueryChips } from './QueryChips'

interface KeywordQueryDialogProps {
  open: boolean
  dialogId: string
  title: string
  label: string
  placeholder?: string
  maxLength?: number
  initial: string
  onClose: () => void
  onApply: (keyword: string) => void
}

export function KeywordQueryDialog({ open, dialogId, title, label, placeholder, maxLength, initial, onClose, onApply }: KeywordQueryDialogProps) {
  return (
    <ListQueryDialog open={open} dialogId={dialogId} title={title} initial={initial} empty="" onClose={onClose} onApply={onApply}>
      {(draft, setDraft) => (
        <label className="col-span-full flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">{label}</span>
          <Input className="h-9" name="keyword" autoComplete="off" placeholder={placeholder ?? label}
            maxLength={maxLength} value={draft} onChange={event => setDraft(event.target.value)} />
        </label>
      )}
    </ListQueryDialog>
  )
}

export function KeywordQueryChips({ keyword, onClear }: { keyword: string; onClear: () => void }) {
  return <QueryChips chips={keyword ? [{ key: 'keyword', text: `关键词：${keyword}`, onClear }] : []} onClearAll={onClear} />
}
