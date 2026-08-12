import { useEffect, useState } from 'react'
import { AppDialog } from '@/components/shared/AppDialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { DatePicker } from '@/components/shared/DatePicker'

/** 超额放行查询弹窗对外的筛选值（与 URL 参数一一对应） */
export interface CreditOverrideQueryValues {
  keyword: string
  status: string
  startDate: string
  endDate: string
}

const EMPTY: CreditOverrideQueryValues = {
  keyword: '', status: '', startDate: '', endDate: '',
}

const STATUS_OPTIONS = [['1', '草稿'], ['2', '待审批'], ['3', '已批准'], ['4', '已驳回'], ['5', '已取消']] as const

interface Props {
  open: boolean
  initial: CreditOverrideQueryValues
  onClose: () => void
  onApply: (values: CreditOverrideQueryValues) => void
}

export default function CreditOverrideQueryDialog({ open, initial, onClose, onApply }: Props) {
  const [draft, setDraft] = useState<CreditOverrideQueryValues>(EMPTY)

  useEffect(() => { if (open) setDraft(initial) }, [open, initial])

  function set<K extends keyof CreditOverrideQueryValues>(key: K, value: CreditOverrideQueryValues[K]) {
    setDraft(d => ({ ...d, [key]: value }))
  }

  return (
    <AppDialog
      open={open}
      onOpenChange={v => { if (!v) onClose() }}
      dialogId="credit-override-query"
      title="查询超额放行申请"
      resizable={false}
      defaultWidth={520}
      defaultHeight={460}
      minWidth={420}
      minHeight={400}
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
      <div className="grid h-full grid-cols-2 gap-4 overflow-y-auto px-5 py-4">
        <label className="flex flex-col gap-1 col-span-2">
          <span className="text-xs font-medium text-muted-foreground">申请单号 / 销售单号 / 客户</span>
          <Input
            placeholder="请输入关键字..."
            value={draft.keyword}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => set('keyword', e.target.value)}
            onKeyDown={(e: React.KeyboardEvent) => { if (e.key === 'Enter') onApply(draft) }}
            className="h-9"
          />
        </label>

        <label className="flex flex-col gap-1 col-span-2">
          <span className="text-xs font-medium text-muted-foreground">状态</span>
          <Select value={draft.status || '__all__'} onValueChange={v => set('status', v === '__all__' ? '' : v)}>
            <SelectTrigger className="h-9"><SelectValue placeholder="全部状态" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">全部状态</SelectItem>
              {STATUS_OPTIONS.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
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
      </div>
    </AppDialog>
  )
}
