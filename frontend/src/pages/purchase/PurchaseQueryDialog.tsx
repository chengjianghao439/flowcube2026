import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { AppDialog } from '@/components/shared/AppDialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { SupplierFinder, WarehouseFinder, ProductFinder } from '@/components/finder'

/** 采购查询弹窗对外的筛选值（与 URL 参数一一对应） */
export interface PurchaseQueryValues {
  keyword: string
  remark: string
  operator: string
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

const EMPTY: PurchaseQueryValues = {
  keyword: '', remark: '', operator: '', status: '',
  productId: null, productCode: '', productName: '',
  supplierId: null, supplierName: '',
  warehouseId: null, warehouseName: '',
  startDate: '', endDate: '',
}

interface Props {
  open: boolean
  initial: PurchaseQueryValues
  onClose: () => void
  onApply: (values: PurchaseQueryValues) => void
}

/** 一行「弹窗选择器」：显示已选项 + 清除，点击打开对应 Finder */
function PickerField({ label, value, placeholder, onOpen, onClear }: {
  label: string
  value: string
  placeholder: string
  onOpen: () => void
  onClear: () => void
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <div className="flex items-center gap-1">
        <Button type="button" variant="outline" className="h-9 flex-1 justify-start font-normal" onClick={onOpen}>
          {value || <span className="text-muted-foreground">{placeholder}</span>}
        </Button>
        {value ? (
          <Button type="button" variant="ghost" size="icon" className="h-9 w-9 shrink-0" onClick={onClear} aria-label={`清除${label}`}>
            <X className="h-4 w-4" />
          </Button>
        ) : null}
      </div>
    </label>
  )
}

export default function PurchaseQueryDialog({ open, initial, onClose, onApply }: Props) {
  const [draft, setDraft] = useState<PurchaseQueryValues>(EMPTY)
  const [supplierOpen, setSupplierOpen] = useState(false)
  const [warehouseOpen, setWarehouseOpen] = useState(false)
  const [productOpen, setProductOpen] = useState(false)

  useEffect(() => { if (open) setDraft(initial) }, [open, initial])

  function set<K extends keyof PurchaseQueryValues>(key: K, value: PurchaseQueryValues[K]) {
    setDraft(d => ({ ...d, [key]: value }))
  }

  return (
    <>
      <AppDialog
        open={open}
        onOpenChange={v => { if (!v) onClose() }}
        dialogId="purchase-query"
        title="查询采购单"
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
              placeholder="采购单号..."
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
                <SelectItem value="2">已提交</SelectItem>
                <SelectItem value="3">已完成</SelectItem>
                <SelectItem value="4">已取消</SelectItem>
              </SelectContent>
            </Select>
          </label>

          <PickerField
            label="供应商"
            placeholder="选择供应商"
            value={draft.supplierName ? `${draft.supplierName}` : ''}
            onOpen={() => setSupplierOpen(true)}
            onClear={() => setDraft(d => ({ ...d, supplierId: null, supplierName: '' }))}
          />

          <PickerField
            label="仓库"
            placeholder="选择仓库"
            value={draft.warehouseName}
            onOpen={() => setWarehouseOpen(true)}
            onClear={() => setDraft(d => ({ ...d, warehouseId: null, warehouseName: '' }))}
          />

          <PickerField
            label="产品"
            placeholder="选择产品"
            value={draft.productName ? `${draft.productName}${draft.productCode ? ` (${draft.productCode})` : ''}` : ''}
            onOpen={() => setProductOpen(true)}
            onClear={() => setDraft(d => ({ ...d, productId: null, productCode: '', productName: '' }))}
          />

          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">经办人</span>
            <Input
              placeholder="按经办人姓名查询..."
              value={draft.operator}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => set('operator', e.target.value)}
              onKeyDown={(e: React.KeyboardEvent) => { if (e.key === 'Enter') onApply(draft) }}
              className="h-9"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">创建日期（起）</span>
            <Input type="date" value={draft.startDate} max={draft.endDate || undefined}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => set('startDate', e.target.value)} className="h-9" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">创建日期（止）</span>
            <Input type="date" value={draft.endDate} min={draft.startDate || undefined}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => set('endDate', e.target.value)} className="h-9" />
          </label>

          <label className="flex flex-col gap-1 col-span-2">
            <span className="text-xs font-medium text-muted-foreground">备注</span>
            <Input
              placeholder="按订单备注内容查询..."
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
      <WarehouseFinder
        open={warehouseOpen}
        onClose={() => setWarehouseOpen(false)}
        onConfirm={r => setDraft(d => ({ ...d, warehouseId: r.id, warehouseName: r.name }))}
      />
      <ProductFinder
        open={productOpen}
        onClose={() => setProductOpen(false)}
        onConfirm={r => setDraft(d => ({ ...d, productId: r.id, productCode: r.code ?? '', productName: r.name }))}
      />
    </>
  )
}
