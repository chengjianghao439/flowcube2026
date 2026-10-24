import { QueryFormLayout } from '@/components/shared/QueryFormLayout'
import { useEffect, useState } from 'react'
import { QueryDialog } from '@/components/shared/QueryDialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { DatePicker } from '@/components/shared/DatePicker'
import { WarehouseSelect } from '@/components/shared/WarehouseSelect'
import { WAVE_STATUS_LABEL, type WaveStatus } from '@/api/picking-waves'

/** 批次查询弹窗对外的筛选值 */
export interface WaveQueryValues {
  keyword: string
  status: string
  warehouseId: number | null
  warehouseName?: string
  startDate: string
  endDate: string
}

const EMPTY: WaveQueryValues = {
  keyword: '', status: '', warehouseId: null, warehouseName: '', startDate: '', endDate: '',
}

interface Props {
  open: boolean
  initial: WaveQueryValues
  /** 「重置」回到的值；页面用它把日期重置回该页面的默认窗口（不传则用弹窗空值） */
  resetValues?: Partial<WaveQueryValues>
  onClose: () => void
  onApply: (values: WaveQueryValues) => void
}

export default function WaveQueryDialog({ open, initial, resetValues, onClose, onApply }: Props) {
  const [draft, setDraft] = useState<WaveQueryValues>(EMPTY)
  const resetDraft = () => ({ ...EMPTY, ...resetValues })

  useEffect(() => { if (open) setDraft(initial) }, [open, initial])

  function set<K extends keyof WaveQueryValues>(key: K, value: WaveQueryValues[K]) {
    setDraft(d => ({ ...d, [key]: value }))
  }

  return (
    <QueryDialog
      open={open}
      dialogId="wave-query"
      title="查询批次"
      width={520}
      onClose={onClose}
      onReset={() => setDraft(resetDraft())}
      onApply={() => onApply(draft)}
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
            onChange={(id, name) => setDraft(d => ({ ...d, warehouseId: id, warehouseName: name }))}
            allowClear
            clearLabel="全部仓库"
            placeholder="全部仓库"
            className="h-9"
          />
        </label>

        <label htmlFor="wave-query-start" className="fc-query-date-start flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">创建日期（起）</span>
          <DatePicker aria-label="创建日期（起）" id="wave-query-start" value={draft.startDate} max={draft.endDate || undefined}
            onChange={v => set('startDate', v)} className="h-9" />
        </label>
        <label htmlFor="wave-query-end" className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">创建日期（止）</span>
          <DatePicker aria-label="创建日期（止）" id="wave-query-end" value={draft.endDate} min={draft.startDate || undefined}
            onChange={v => set('endDate', v)} className="h-9" />
        </label>
      </QueryFormLayout>
    </QueryDialog>
  )
}
