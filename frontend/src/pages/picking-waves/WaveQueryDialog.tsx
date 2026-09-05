import { QueryFormLayout } from '@/components/shared/QueryFormLayout'
import { useEffect, useState } from 'react'
import { AppDialog } from '@/components/shared/AppDialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { DatePicker } from '@/components/shared/DatePicker'
import { WarehouseSelect } from '@/components/shared/WarehouseSelect'
import { WAVE_STATUS_LABEL, type WaveStatus } from '@/api/picking-waves'
import { todayYmd } from '@/lib/dateTime'

/** 批次查询弹窗对外的筛选值 */
export interface WaveQueryValues {
  keyword: string
  status: string
  warehouseId: number | null
  startDate: string
  endDate: string
}

const EMPTY: WaveQueryValues = {
  keyword: '', status: '', warehouseId: null, startDate: todayYmd(), endDate: '',
}

interface Props {
  open: boolean
  initial: WaveQueryValues
  onClose: () => void
  onApply: (values: WaveQueryValues) => void
}

export default function WaveQueryDialog({ open, initial, onClose, onApply }: Props) {
  const [draft, setDraft] = useState<WaveQueryValues>(EMPTY)

  useEffect(() => { if (open) setDraft(initial) }, [open, initial])

  function set<K extends keyof WaveQueryValues>(key: K, value: WaveQueryValues[K]) {
    setDraft(d => ({ ...d, [key]: value }))
  }

  return (
    <AppDialog
      open={open}
      onOpenChange={v => { if (!v) onClose() }}
      dialogId="wave-query"
      title="查询批次"
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
      <QueryFormLayout>
        <label className="flex flex-col gap-1 col-span-2">
          <span className="text-xs font-medium text-muted-foreground">批次单号</span>
          <Input
            placeholder="请输入批次号…"
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
              {([1, 2, 3, 4, 5] as WaveStatus[]).map(s => (
                <SelectItem key={s} value={String(s)}>{WAVE_STATUS_LABEL[s]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">仓库</span>
          <WarehouseSelect
            value={draft.warehouseId}
            onChange={id => set('warehouseId', id)}
            allowClear
            clearLabel="全部仓库"
            placeholder="全部仓库"
            className="h-9"
          />
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
