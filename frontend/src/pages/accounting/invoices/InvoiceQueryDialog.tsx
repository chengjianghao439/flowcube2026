import { useEffect, useState } from 'react'
import { QueryDialog } from '@/components/shared/QueryDialog'
import { QueryFormLayout } from '@/components/shared/QueryFormLayout'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { INVOICE_STATUS_LABELS } from '@/types/accounting'

export interface InvoiceQueryValues {
  keyword: string
  status: string
}

interface Props {
  open: boolean
  invoiceType: number
  initial: InvoiceQueryValues
  onClose: () => void
  onApply: (values: InvoiceQueryValues) => void
}

const EMPTY: InvoiceQueryValues = { keyword: '', status: '' }

export default function InvoiceQueryDialog({ open, invoiceType, initial, onClose, onApply }: Props) {
  const [draft, setDraft] = useState<InvoiceQueryValues>(EMPTY)
  useEffect(() => { if (open) setDraft(initial) }, [open, invoiceType, initial])

  return <QueryDialog open={open} dialogId="invoice-query" title="查询发票" width={520}
    onClose={onClose} onReset={() => setDraft(EMPTY)} onApply={() => onApply(draft)}>
    <QueryFormLayout>
      <label className="flex flex-col gap-1 col-span-2">
        <span className="text-xs font-medium text-muted-foreground">关键词</span>
        <Input className="h-9" placeholder="发票号 / 单位 / 单号" value={draft.keyword}
          onChange={event => setDraft(value => ({ ...value, keyword: event.target.value }))}
          onKeyDown={event => { if (event.key === 'Enter') onApply(draft) }} />
      </label>
      <label className="flex flex-col gap-1 col-span-2">
        <span className="text-xs font-medium text-muted-foreground">状态</span>
        <Select value={draft.status || '__all__'} onValueChange={value => setDraft(current => ({ ...current, status: value === '__all__' ? '' : value }))}>
          <SelectTrigger className="h-9" aria-label="发票状态"><SelectValue placeholder="全部状态" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">全部状态</SelectItem>
            {Object.entries(INVOICE_STATUS_LABELS[invoiceType]).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
          </SelectContent>
        </Select>
      </label>
    </QueryFormLayout>
  </QueryDialog>
}
