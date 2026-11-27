import { ListQueryDialog } from './ListQueryDialog'
import { OrderStatusFilter } from './OrderStatusFilter'
import { QueryChips } from './QueryChips'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

import { EMPTY_KEYWORD_STATUS, type KeywordStatusFilterValue } from './keywordStatusFilterDefaults'

type Filters = KeywordStatusFilterValue

interface Props {
  title: string
  dialogId: string
  placeholder: string
  options: { value: string; label: string }[]
  value: Filters
  onChange: (next: Filters) => void
  open: boolean
  onClose: () => void
}

export function KeywordStatusFilters({ title, dialogId, placeholder, options, value, onChange, open, onClose }: Props) {
  const chips = [
    ...(value.keyword ? [{ key: 'keyword', text: `关键字：${value.keyword}`, onClear: () => onChange({ ...value, keyword: '' }) }] : []),
    ...(value.status ? [{ key: 'status', text: `状态：${options.find(o => o.value === value.status)?.label}`, onClear: () => onChange({ ...value, status: '' }) }] : []),
  ]
  return <>
    <div className="fc-filter-bar">
      <OrderStatusFilter label={`${title}状态分类`} value={value.status} options={options}
        onChange={status => onChange({ ...value, status })} />
      {chips.length > 0 && (
        <div className="fc-filter-bar-filters">
          <QueryChips chips={chips} onClearAll={() => onChange(EMPTY_KEYWORD_STATUS)} />
        </div>
      )}
    </div>
    <ListQueryDialog dialogId={dialogId} title={`查询${title}`} initial={value} empty={EMPTY_KEYWORD_STATUS}
      open={open} onClose={onClose} onApply={onChange}>
      {(draft, setDraft) => <>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">关键字</span>
          <Input value={draft.keyword} placeholder={placeholder} className="h-9"
            onChange={event => setDraft({ ...draft, keyword: event.target.value })} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">状态</span>
          <Select value={draft.status || '__all__'} onValueChange={status => setDraft({ ...draft, status: status === '__all__' ? '' : status })}>
            <SelectTrigger className="h-9" aria-label="状态"><SelectValue /></SelectTrigger>
            <SelectContent>{options.map(option => <SelectItem key={option.value} value={option.value || '__all__'}>{option.label}</SelectItem>)}</SelectContent>
          </Select>
        </label>
      </>}
    </ListQueryDialog>
  </>
}
