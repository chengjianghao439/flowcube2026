import { useEffect, useState } from 'react'
import { AppDialog } from '@/components/shared/AppDialog'
import OperatorSelectField from '@/components/shared/OperatorSelectField'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ProductFinder, SupplierFinder } from '@/components/finder'
import { DatePicker } from '@/components/shared/DatePicker'
import { QueryPickerField } from '@/components/shared/QueryPickerField'
import { WarehouseSelect } from '@/components/shared/WarehouseSelect'
import { INBOUND_STATUS_LABEL, type InboundTaskStatus } from '@/types/inbound-tasks'

/** 收货订单查询弹窗对外的筛选值（与 URL 参数一一对应） */
export interface InboundTaskQueryValues {
  keyword: string
  remark: string
  operatorId: number | null
  operatorName: string
  status: string
  productId: number | null
  productCode: string
  productName: string
  supplierId: number | null
  supplierName: string
  warehouseId: number | null
  warehouseName: string
  startDate: string
  endDate: string
}

const EMPTY: InboundTaskQueryValues = {
  keyword: '', remark: '', operatorId: null, operatorName: '', status: '',
  productId: null, productCode: '', productName: '',
  supplierId: null, supplierName: '',
  warehouseId: null, warehouseName: '',
  startDate: '', endDate: '',
}

interface Props {
  open: boolean
  initial: InboundTaskQueryValues
  onClose: () => void
  onApply: (values: InboundTaskQueryValues) => void
}

export default function InboundTaskQueryDialog({ open, initial, onClose, onApply }: Props) {
  const [draft, setDraft] = useState<InboundTaskQueryValues>(EMPTY)
  const [productOpen, setProductOpen] = useState(false)
  const [supplierOpen, setSupplierOpen] = useState(false)



  useEffect(() => { if (open) setDraft(initial) }, [open, initial])

  function set<K extends keyof InboundTaskQueryValues>(key: K, value: InboundTaskQueryValues[K]) {
    setDraft(d => ({ ...d, [key]: value }))
  }

  return (
    <>
      <AppDialog
        open={open}
        onOpenChange={v => { if (!v) onClose() }}
        dialogId="inbound-task-query"
        title="查询收货订单"
        resizable={false}
        defaultWidth={520}
        defaultHeight={480}
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
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">单号</span>
            <Input
              placeholder="任务单号 / 采购单号..."
              value={draft.keyword}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => set('keyword', e.target.value)}
              onKeyDown={(e: React.KeyboardEvent) => { if (e.key === 'Enter') onApply(draft) }}
              className="h-9"
            />
          </label>

          <QueryPickerField
            label="供应商"
            placeholder="选择供应商"
            value={draft.supplierName ? `${draft.supplierName}` : ''}
            onOpen={() => setSupplierOpen(true)}
            onClear={() => setDraft(d => ({ ...d, supplierId: null, supplierName: '' }))}
          />

          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">状态</span>
            <Select value={draft.status || '__all__'} onValueChange={v => set('status', v === '__all__' ? '' : v)}>
              <SelectTrigger className="h-9"><SelectValue placeholder="全部状态" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">全部状态</SelectItem>
                {([1, 2, 3, 4, 5] as InboundTaskStatus[]).map(s => (
                  <SelectItem key={s} value={String(s)}>{INBOUND_STATUS_LABEL[s]}</SelectItem>
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

          <QueryPickerField
            label="产品"
            placeholder="选择产品"
            value={draft.productName ? `${draft.productName}${draft.productCode ? ` (${draft.productCode})` : ''}` : ''}
            onOpen={() => setProductOpen(true)}
            onClear={() => setDraft(d => ({ ...d, productId: null, productCode: '', productName: '' }))}
          />

          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">经办人</span>
            <OperatorSelectField
              value={draft.operatorId}
              onChange={id => set('operatorId', id)}
              onChangeName={name => set('operatorName', name)}
              enabled={open}
              placeholder="全部经办人"
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

          <label className="flex flex-col gap-1 col-span-2">
            <span className="text-xs font-medium text-muted-foreground">备注</span>
            <Input
              placeholder="按收货订单备注内容查询..."
              value={draft.remark}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => set('remark', e.target.value)}
              onKeyDown={(e: React.KeyboardEvent) => { if (e.key === 'Enter') onApply(draft) }}
              className="h-9"
            />
          </label>
        </div>
      </AppDialog>

      <SupplierFinder
        open={supplierOpen}
        onClose={() => setSupplierOpen(false)}
        onConfirm={r => setDraft(d => ({ ...d, supplierId: r.id, supplierName: r.name }))}
      />
      <ProductFinder
        open={productOpen}
        onClose={() => setProductOpen(false)}
        onConfirm={r => setDraft(d => ({ ...d, productId: r.id, productCode: r.code ?? '', productName: r.name }))}
      />
    </>
  )
}
