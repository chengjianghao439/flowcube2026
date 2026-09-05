import { QueryFormLayout } from '@/components/shared/QueryFormLayout'
import { useEffect, useState } from 'react'
import { AppDialog } from '@/components/shared/AppDialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
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
  onClose: () => void
  onApply: (values: RefundQueryValues) => void
}

export default function RefundQueryDialog({ open, initial, onClose, onApply }: Props) {
  const [draft, setDraft] = useState<RefundQueryValues>(EMPTY)

  useEffect(() => { if (open) setDraft(initial) }, [open, initial])

  function set<K extends keyof RefundQueryValues>(key: K, value: RefundQueryValues[K]) {
    setDraft(d => ({ ...d, [key]: value }))
  }

  return (
    <AppDialog
      open={open}
      onOpenChange={v => { if (!v) onClose() }}
      dialogId="refund-query"
      title="查询退款单"
      resizable={false}
      defaultWidth={520}
      defaultHeight={500}
      minWidth={420}
      minHeight={420}
      footer={
        <div className="flex justify-between gap-2">
          <Button variant="ghost" onClick={() => setDraft(EMPTY)}>重置</Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>取消</Button>
            <Button onClick={() => onApply(draft)}>查询</Button>
          </div>
        </div>
      }
    >
      <QueryFormLayout>
        <label className="flex flex-col gap-1 col-span-2">
          <span className="text-xs font-medium text-muted-foreground">退款单号 / 销售单号 / 客户</span>
          <Input
            placeholder="请输入关键字…"
            value={draft.keyword}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => set('keyword', e.target.value)}
            onKeyDown={(e: React.KeyboardEvent) => { if (e.key === 'Enter') onApply(draft) }}
            className="h-9"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">状态</span>
          <Select value={draft.status || '__all__'} onValueChange={v => set('status', v === '__all__' ? '' : v)}>
            <SelectTrigger className="h-9"><SelectValue placeholder="全部状态" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">全部状态</SelectItem>
              <SelectItem value="1">草稿</SelectItem>
              <SelectItem value="2">已确认</SelectItem>
              <SelectItem value="3">已完成</SelectItem>
              <SelectItem value="4">已取消</SelectItem>
            </SelectContent>
          </Select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">创建日期（起）</span>
          <DatePicker value={draft.startDate} max={draft.endDate || undefined}
            onChange={v => set('startDate', v)} className="h-9" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">创建日期（止）</span>
          <DatePicker value={draft.endDate} min={draft.startDate || undefined}
            onChange={v => set('endDate', v)} className="h-9" />
        </label>
      </QueryFormLayout>
    </AppDialog>
  )
}
