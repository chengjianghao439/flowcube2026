import { QueryFormLayout } from '@/components/shared/QueryFormLayout'
import { useEffect, useRef, useState } from 'react'
import { QueryDialog } from '@/components/shared/QueryDialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { DatePicker } from '@/components/shared/DatePicker'
import { OPERATION_LOG_MODULE_OPTIONS } from '@/utils/operationLogFormatters'
import { todayYmd } from '@/lib/dateTime'

/** 操作日志查询弹窗对外的筛选值（与 URL 参数一一对应） */
export interface OpLogQueryValues {
  keyword: string
  module: string
  startDate: string
  endDate: string
}

const EMPTY: OpLogQueryValues = {
  keyword: '', module: '', startDate: todayYmd(), endDate: '',
}

interface Props {
  open: boolean
  initial: OpLogQueryValues
  /** 「重置」回到的值；页面用它把日期重置回该页面的默认窗口（不传则用弹窗空值） */
  resetValues?: Partial<OpLogQueryValues>
  onClose: () => void
  onApply: (values: OpLogQueryValues) => void
}

export default function OpLogQueryDialog({ open, initial, resetValues, onClose, onApply }: Props) {
  const [draft, setDraft] = useState<OpLogQueryValues>(EMPTY)
  const resetDraft = () => ({ ...EMPTY, ...resetValues })

  const wasOpen = useRef(false)
  useEffect(() => {
    if (open && !wasOpen.current) setDraft({ ...initial })
    wasOpen.current = open
  }, [open, initial])

  function set<K extends keyof OpLogQueryValues>(key: K, value: OpLogQueryValues[K]) {
    setDraft(d => ({ ...d, [key]: value }))
  }

  return (
    <QueryDialog
      open={open}
      dialogId="oplog-query"
      title="查询操作日志"
      width={520}
      onClose={onClose}
      onReset={() => setDraft(resetDraft())}
      onApply={() => onApply(draft)}
    >
      <QueryFormLayout>
        <label className="flex flex-col gap-1 col-span-2">
          <span className="text-xs font-medium text-muted-foreground">用户 / 路径</span>
          <Input
            placeholder="请输入关键字…"
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

        <label className="fc-query-date-start flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">操作日期（起）</span>
          <DatePicker aria-label="操作日期（起）" value={draft.startDate} max={draft.endDate || undefined}
            onChange={v => set('startDate', v)} className="h-9" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">操作日期（止）</span>
          <DatePicker aria-label="操作日期（止）" value={draft.endDate} min={draft.startDate || undefined}
            onChange={v => set('endDate', v)} className="h-9" />
        </label>
      </QueryFormLayout>
    </QueryDialog>
  )
}
