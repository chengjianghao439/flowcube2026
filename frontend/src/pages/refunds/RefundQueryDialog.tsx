import { REFUND_STATUS_OPTIONS } from './constants'
import { QueryFormLayout } from '@/components/shared/QueryFormLayout'
import { useEffect, useId, useState } from 'react'
import { QueryDialog } from '@/components/shared/QueryDialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { isReversedDateRange } from '@/lib/dateRange'
import { DatePicker } from '@/components/shared/DatePicker'
import { todayYmd } from '@/lib/dateTime'

/** 退款单查询弹窗对外的筛选值 */
export interface RefundQueryValues {
  keyword: string
  status: string
  startDate: string
  endDate: string
}

const EMPTY: RefundQueryValues = {
  keyword: '', status: '', startDate: todayYmd(), endDate: '',
}

interface Props {
  open: boolean
  initial: RefundQueryValues
  /** 「重置」回到的值；页面用它把日期重置回该页面的默认窗口（不传则用弹窗空值） */
  resetValues?: Partial<RefundQueryValues>
  onClose: () => void
  onApply: (values: RefundQueryValues) => void
}

export default function RefundQueryDialog({ open, initial, resetValues, onClose, onApply }: Props) {
  const [draft, setDraft] = useState<RefundQueryValues>(EMPTY)
  const dateErrorId = useId()
  const dateInvalid = isReversedDateRange(draft.startDate, draft.endDate)
  const apply = () => { if (!dateInvalid) onApply(draft) }
  const resetDraft = () => ({ ...EMPTY, ...resetValues })

  useEffect(() => { if (open) setDraft(initial) }, [open, initial])

  function set<K extends keyof RefundQueryValues>(key: K, value: RefundQueryValues[K]) {
    setDraft(d => ({ ...d, [key]: value }))
  }

  return (
    <QueryDialog
      open={open}
      dialogId="refund-query"
      title="查询退款单"
      width={520}
      onClose={onClose}
      onReset={() => setDraft(resetDraft())}
      applyDisabled={dateInvalid}
      onApply={apply}
    >
      <QueryFormLayout>
        <label className="flex flex-col gap-1 col-span-2">
          <span className="text-xs font-medium text-muted-foreground">退款单号 / 销售单号 / 客户</span>
          <Input
            placeholder="请输入关键字…"
            value={draft.keyword}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => set('keyword', e.target.value)}
            onKeyDown={(e: React.KeyboardEvent) => { if (e.key === 'Enter') apply() }}
            className="h-9"
          />
        </label>

        <label className="flex flex-col gap-1 col-span-2">
          <span className="text-xs font-medium text-muted-foreground">状态</span>
          <Select value={draft.status || '__all__'} onValueChange={v => set('status', v === '__all__' ? '' : v)}>
            <SelectTrigger className="h-9"><SelectValue placeholder="全部状态" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">全部状态</SelectItem>
              {REFUND_STATUS_OPTIONS.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </label>

        <label className="fc-query-date-start flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">创建日期（起）</span>
          <DatePicker aria-label="创建日期（起）" value={draft.startDate} max={draft.endDate || undefined}
            aria-invalid={dateInvalid} aria-describedby={dateInvalid ? dateErrorId : undefined}
            onChange={v => set('startDate', v)} className="h-9" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">创建日期（止）</span>
          <DatePicker aria-label="创建日期（止）" value={draft.endDate} min={draft.startDate || undefined}
            aria-invalid={dateInvalid} aria-describedby={dateInvalid ? dateErrorId : undefined}
            onChange={v => set('endDate', v)} className="h-9" />
        </label>
        {dateInvalid && <p id={dateErrorId} role="alert" className="col-span-full text-xs text-destructive-ink">
          创建日期的起始日期不能晚于结束日期。
        </p>}
      </QueryFormLayout>
    </QueryDialog>
  )
}
