import { useEffect, useState } from 'react'
import { AppDialog } from '@/components/shared/AppDialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { DatePicker } from '@/components/shared/DatePicker'
import { WarehouseSelect } from '@/components/shared/WarehouseSelect'
import OperatorSelectField from '@/components/shared/OperatorSelectField'
import { todayYmd } from '@/lib/dateTime'

/** 请购查询弹窗对外的筛选值（与 URL 参数一一对应） */
export interface RequisitionQueryValues {
  keyword: string
  status: string
  warehouseId: number | null
  warehouseName: string
  applicantId: number | null
  applicantName: string
  startDate: string
  endDate: string
}

const EMPTY: RequisitionQueryValues = {
  keyword: '', status: '',
  warehouseId: null, warehouseName: '',
  applicantId: null, applicantName: '',
  startDate: todayYmd(), endDate: '',
}

interface Props {
  open: boolean
  initial: RequisitionQueryValues
  onClose: () => void
  onApply: (values: RequisitionQueryValues) => void
}

export default function RequisitionQueryDialog({ open, initial, onClose, onApply }: Props) {
  const [draft, setDraft] = useState<RequisitionQueryValues>(EMPTY)

  useEffect(() => { if (open) setDraft(initial) }, [open, initial])

  function set<K extends keyof RequisitionQueryValues>(key: K, value: RequisitionQueryValues[K]) {
    setDraft(d => ({ ...d, [key]: value }))
  }

  return (
    <>
      <AppDialog
        open={open}
        onOpenChange={v => { if (!v) onClose() }}
        dialogId="requisition-query"
        title="查询请购单"
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
            <span className="text-xs font-medium text-muted-foreground">单号 / 事由 / 申请人</span>
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
                <SelectItem value="2">待审批</SelectItem>
                <SelectItem value="3">已批准</SelectItem>
                <SelectItem value="4">已驳回</SelectItem>
                <SelectItem value="5">已取消</SelectItem>
                <SelectItem value="6">已转采购</SelectItem>
              </SelectContent>
            </Select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">期望入库仓</span>
            <WarehouseSelect
              value={draft.warehouseId}
              onChange={(id, name) => setDraft(d => ({ ...d, warehouseId: id, warehouseName: name }))}
              allowClear
              clearLabel="全部仓库"
              placeholder="全部仓库"
              className="h-9"
            />
          </label>

          <label className="flex flex-col gap-1 col-span-2">
            <span className="text-xs font-medium text-muted-foreground">申请人</span>
            <OperatorSelectField
              value={draft.applicantId}
              onChange={id => set('applicantId', id)}
              onChangeName={name => set('applicantName', name)}
              enabled={open}
              placeholder="全部申请人"
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
        </div>
      </AppDialog>
    </>
  )
}
