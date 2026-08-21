import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AppDialog } from '@/components/shared/AppDialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { DatePicker } from '@/components/shared/DatePicker'
import { getCarriersActiveApi } from '@/api/carriers'

/** 物流运单查询弹窗对外的筛选值 */
export interface WaybillQueryValues {
  keyword: string
  status: string
  carrierId: number | null
  startDate: string
  endDate: string
}

import { WAYBILL_STATUS_OPTIONS } from './constants'
import { todayYmd } from '@/lib/dateTime'

const EMPTY: WaybillQueryValues = {
  keyword: '', status: '', carrierId: null, startDate: todayYmd(), endDate: '',
}

interface Props {
  open: boolean
  initial: WaybillQueryValues
  onClose: () => void
  onApply: (values: WaybillQueryValues) => void
}

export default function WaybillQueryDialog({ open, initial, onClose, onApply }: Props) {
  const [draft, setDraft] = useState<WaybillQueryValues>(EMPTY)

  const { data: carriers } = useQuery({
    queryKey: ['carriers-active'],
    queryFn: getCarriersActiveApi,
    enabled: open,
  })

  useEffect(() => { if (open) setDraft(initial) }, [open, initial])

  function set<K extends keyof WaybillQueryValues>(key: K, value: WaybillQueryValues[K]) {
    setDraft(d => ({ ...d, [key]: value }))
  }

  return (
    <AppDialog
      open={open}
      onOpenChange={v => { if (!v) onClose() }}
      dialogId="waybill-query"
      title="查询物流运单"
      resizable={false}
      defaultWidth={520}
      defaultHeight={520}
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
      <div className="grid h-full grid-cols-2 gap-4 overflow-y-auto px-5 py-4">
        <label className="flex flex-col gap-1 col-span-2">
          <span className="text-xs font-medium text-muted-foreground">运单号 / 快递单号 / 销售单 / 收件人</span>
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
              {WAYBILL_STATUS_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">承运商</span>
          <Select value={draft.carrierId ? String(draft.carrierId) : '__all__'} onValueChange={v => set('carrierId', v === '__all__' ? null : Number(v))}>
            <SelectTrigger className="h-9"><SelectValue placeholder="全部承运商" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">全部承运商</SelectItem>
              {(carriers ?? []).map((c: { id: number; name: string }) => (
                <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
              ))}
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
