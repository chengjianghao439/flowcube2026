import { useEffect, useState } from 'react'
import { AppDialog } from '@/components/shared/AppDialog'
import OperatorSelectField from '@/components/shared/OperatorSelectField'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { CustomerFinder, ProductFinder } from '@/components/finder'
import { DatePicker } from '@/components/shared/DatePicker'
import { QueryPickerField } from '@/components/shared/QueryPickerField'
import { WarehouseSelect } from '@/components/shared/WarehouseSelect'
import { todayYmd } from '@/lib/dateTime'

/** 销售查询弹窗对外的筛选值（与 URL 参数一一对应） */
export interface SaleQueryValues {
  keyword: string
  remark: string
  operatorId: number | null
  operatorName: string
  status: string
  productId: number | null
  productCode: string
  productName: string
  customerId: number | null
  customerName: string
  warehouseId: number | null
  warehouseName: string
  startDate: string
  endDate: string
}

const EMPTY: SaleQueryValues = {
  keyword: '', remark: '', operatorId: null, operatorName: '', status: '',
  productId: null, productCode: '', productName: '',
  customerId: null, customerName: '',
  warehouseId: null, warehouseName: '',
  startDate: todayYmd(), endDate: '',
}

interface Props {
  open: boolean
  initial: SaleQueryValues
  onClose: () => void
  onApply: (values: SaleQueryValues) => void
}

export default function SaleQueryDialog({ open, initial, onClose, onApply }: Props) {
  const [draft, setDraft] = useState<SaleQueryValues>(EMPTY)
  const [customerOpen, setCustomerOpen] = useState(false)
  const [productOpen, setProductOpen] = useState(false)



  useEffect(() => { if (open) setDraft(initial) }, [open, initial])

  function set<K extends keyof SaleQueryValues>(key: K, value: SaleQueryValues[K]) {
    setDraft(d => ({ ...d, [key]: value }))
  }

  return (
    <>
      <AppDialog
        open={open}
        onOpenChange={v => { if (!v) onClose() }}
        dialogId="sale-query"
        title="查询销售单"
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
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">单号</span>
            <Input
              placeholder="销售单号…"
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
                <SelectItem value="2">已占库</SelectItem>
                <SelectItem value="3">拣货中</SelectItem>
                <SelectItem value="4">已出库</SelectItem>
                <SelectItem value="5">已取消</SelectItem>
              </SelectContent>
            </Select>
          </label>

          <QueryPickerField
            label="客户"
            placeholder="选择客户"
            value={draft.customerName ? `${draft.customerName}` : ''}
            onOpen={() => setCustomerOpen(true)}
            onClear={() => setDraft(d => ({ ...d, customerId: null, customerName: '' }))}
          />

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
            label="商品"
            placeholder="选择商品"
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
              placeholder="按订单备注内容查询…"
              value={draft.remark}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => set('remark', e.target.value)}
              onKeyDown={(e: React.KeyboardEvent) => { if (e.key === 'Enter') onApply(draft) }}
              className="h-9"
            />
          </label>
        </div>
      </AppDialog>

      <CustomerFinder
        open={customerOpen}
        onClose={() => setCustomerOpen(false)}
        onConfirm={r => setDraft(d => ({ ...d, customerId: r.id, customerName: r.name }))}
      />
      <ProductFinder
        open={productOpen}
        onClose={() => setProductOpen(false)}
        onConfirm={r => setDraft(d => ({ ...d, productId: r.id, productCode: r.code ?? '', productName: r.name }))}
      />
    </>
  )
}
