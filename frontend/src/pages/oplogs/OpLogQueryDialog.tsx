import { useEffect, useState } from 'react'
import { AppDialog } from '@/components/shared/AppDialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { DatePicker } from '@/components/shared/DatePicker'
import { OPERATION_LOG_MODULE_OPTIONS } from '@/utils/operationLogFormatters'

/** 操作日志查询弹窗对外的筛选值（与 URL 参数一一对应） */
export interface OpLogQueryValues {
  keyword: string
  module: string
  startDate: string
  endDate: string
}

const EMPTY: OpLogQueryValues = {
  keyword: '', module: '', startDate: '', endDate: '',
}

interface Props {
  open: boolean
  initial: OpLogQueryValues
  onClose: () => void
  onApply: (values: OpLogQueryValues) => void
}

export default function OpLogQueryDialog({ open, initial, onClose, onApply }: Props) {
  const [draft, setDraft] = useState<OpLogQueryValues>(EMPTY)

  useEffect(() => { if (open) setDraft(initial) }, [open, initial])

  function set<K extends keyof OpLogQueryValues>(key: K, value: OpLogQueryValues[K]) {
    setDraft(d => ({ ...d, [key]: value }))
  }

  return (
    <AppDialog
      open={open}
      onOpenChange={v => { if (!v) onClose() }}
      dialogId="oplog-query"
      title="查询操作日志"
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
          <span className="text-xs font-medium text-muted-foreground">用户 / 路径</span>
          <Input
            placeholder="请输入关键字..."
            value={draft.keyword}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => set('keyword', e.target.value)}
            onKeyDown={(e: React.KeyboardEvent) => { if (e.key === 'Enter') onApply(draft) }}
            className="h-9"
          />
        </label>

        <label className="flex flex-col gap-1 col-span-2">
          <span className="text-xs font-medium text-muted-foreground">业务模块</span>
          <Select value={draft.module || '__all__'} onValueChange={v => set('module', v === '__all__' ? '' : v)}>
            <SelectTrigger className="h-9"><SelectValue placeholder="全部模块" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">全部模块</SelectItem>
              {OPERATION_LOG_MODULE_OPTIONS.map(item => (
                <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">操作日期（起）</span>
          <DatePicker value={draft.startDate} max={draft.endDate || undefined}
            onChange={v => set('startDate', v)} className="h-9" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">操作日期（止）</span>
          <DatePicker value={draft.endDate} min={draft.startDate || undefined}
            onChange={v => set('endDate', v)} className="h-9" />
        </label>
      </div>
    </AppDialog>
  )
}
