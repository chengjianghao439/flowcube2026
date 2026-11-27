import { useState } from 'react'
import { QueryDialog } from '@/components/shared/QueryDialog'
import { QueryFormLayout } from '@/components/shared/QueryFormLayout'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { BACKFILL_BIZ_TYPE_OPTIONS, BACKFILL_STATUS_OPTIONS } from '@/types/accounting'

interface BackfillQuery { status: number | ''; bizType: string }

export default function BackfillQueryDialog({ open, initial, onClose, onApply }: {
  open: boolean
  initial: BackfillQuery
  onClose: () => void
  onApply: (query: BackfillQuery) => void
}) {
  const [draft, setDraft] = useState(initial)
  return <QueryDialog open={open} dialogId="backfills-query" title="查询跨期补录审批" width={520}
    resetLabel="清空" onReset={() => setDraft({ status: '', bizType: '' })} onApply={() => onApply(draft)} onClose={onClose}>
    <QueryFormLayout>
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-muted-foreground">状态</span>
        <Select value={String(draft.status) || '__all__'} onValueChange={v => setDraft(d => ({ ...d, status: v === '__all__' ? '' : Number(v) }))}>
          <SelectTrigger aria-label="状态" className="h-9"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">全部状态</SelectItem>
            {BACKFILL_STATUS_OPTIONS.map(o => <SelectItem key={o.value} value={String(o.value)}>{o.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-muted-foreground">业务类型</span>
        <Select value={draft.bizType || '__all__'} onValueChange={v => setDraft(d => ({ ...d, bizType: v === '__all__' ? '' : v }))}>
          <SelectTrigger aria-label="业务类型" className="h-9"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">全部业务</SelectItem>
            {BACKFILL_BIZ_TYPE_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </label>
    </QueryFormLayout>
  </QueryDialog>
}
