import { QueryFormLayout } from '@/components/shared/QueryFormLayout'
import { useEffect, useState } from 'react'
import { QueryDialog } from '@/components/shared/QueryDialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { VOUCHER_STATUS_LABELS, VOUCHER_SOURCE_OPTIONS } from '@/types/accounting'

/** 记账凭证查询弹窗对外的筛选值 */
export interface VoucherQueryValues {
  period: string
  sourceType: string
  status: string
  keyword: string
}

const EMPTY: VoucherQueryValues = {
  period: '', sourceType: '', status: '', keyword: '',
}

interface Props {
  open: boolean
  initial: VoucherQueryValues
  onClose: () => void
  onApply: (values: VoucherQueryValues) => void
}

export default function VoucherQueryDialog({ open, initial, onClose, onApply }: Props) {
  const [draft, setDraft] = useState<VoucherQueryValues>(EMPTY)

  useEffect(() => { if (open) setDraft(initial) }, [open, initial])

  function set<K extends keyof VoucherQueryValues>(key: K, value: VoucherQueryValues[K]) {
    setDraft(d => ({ ...d, [key]: value }))
  }

  return (
    <QueryDialog
      open={open}
      dialogId="voucher-query"
      title="查询记账凭证"
      width={520}
      onClose={onClose}
      onReset={() => setDraft(EMPTY)}
      onApply={() => onApply(draft)}
    >
      <QueryFormLayout>
        <label className="flex flex-col gap-1 col-span-2">
          <span className="text-xs font-medium text-muted-foreground">会计期间（YYYYMM）</span>
          <Input
            placeholder="如 202608"
            value={draft.period}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => set('period', e.target.value.replace(/\D/g, '').slice(0, 6))}
            onKeyDown={(e: React.KeyboardEvent) => { if (e.key === 'Enter') onApply(draft) }}
            className="h-9 font-mono"
          />
        </label>

        <label className="flex flex-col gap-1 col-span-2">
          <span className="text-xs font-medium text-muted-foreground">来源类型</span>
          <Select value={draft.sourceType || '__all__'} onValueChange={v => set('sourceType', v === '__all__' ? '' : v)}>
            <SelectTrigger className="h-9"><SelectValue placeholder="全部来源" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">全部来源</SelectItem>
              {VOUCHER_SOURCE_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">状态</span>
          <Select value={draft.status || '__all__'} onValueChange={v => set('status', v === '__all__' ? '' : v)}>
            <SelectTrigger className="h-9"><SelectValue placeholder="全部状态" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">全部状态</SelectItem>
              <SelectItem value="1">{VOUCHER_STATUS_LABELS[1]}</SelectItem>
              <SelectItem value="2">{VOUCHER_STATUS_LABELS[2]}</SelectItem>
              <SelectItem value="3">{VOUCHER_STATUS_LABELS[3]}</SelectItem>
            </SelectContent>
          </Select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">关键字</span>
          <Input
            placeholder="凭证号 / 单号 / 摘要"
            value={draft.keyword}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => set('keyword', e.target.value)}
            onKeyDown={(e: React.KeyboardEvent) => { if (e.key === 'Enter') onApply(draft) }}
            className="h-9"
          />
        </label>
      </QueryFormLayout>
    </QueryDialog>
  )
}
