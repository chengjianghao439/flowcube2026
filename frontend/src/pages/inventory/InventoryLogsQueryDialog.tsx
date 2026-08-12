import { useEffect, useState } from 'react'
import { AppDialog } from '@/components/shared/AppDialog'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ProductFinder } from '@/components/finder'
import { QueryPickerField } from '@/components/shared/QueryPickerField'
import { WarehouseSelect } from '@/components/shared/WarehouseSelect'

/** 出入库记录查询弹窗对外的筛选值（与 URL 参数一一对应） */
export interface InventoryLogsQueryValues {
  type: number | null
  productId: number | null
  productCode: string
  productName: string
  warehouseId: number | null
  warehouseName: string
}

const EMPTY: InventoryLogsQueryValues = {
  type: null,
  productId: null, productCode: '', productName: '',
  warehouseId: null, warehouseName: '',
}

interface Props {
  open: boolean
  initial: InventoryLogsQueryValues
  onClose: () => void
  onApply: (values: InventoryLogsQueryValues) => void
}

export default function InventoryLogsQueryDialog({ open, initial, onClose, onApply }: Props) {
  const [draft, setDraft] = useState<InventoryLogsQueryValues>(EMPTY)
  const [productOpen, setProductOpen] = useState(false)

  useEffect(() => { if (open) setDraft(initial) }, [open, initial])

  return (
    <>
      <AppDialog
        open={open}
        onOpenChange={v => { if (!v) onClose() }}
        dialogId="inventory-logs-query"
        title="查询出入库记录"
        resizable={false}
        defaultWidth={520}
        defaultHeight={420}
        minWidth={420}
        minHeight={380}
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
            <span className="text-xs font-medium text-muted-foreground">类型</span>
            <Select value={draft.type == null ? '__all__' : String(draft.type)} onValueChange={v => setDraft(d => ({ ...d, type: v === '__all__' ? null : Number(v) }))}>
              <SelectTrigger className="h-9"><SelectValue placeholder="全部类型" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">全部类型</SelectItem>
                <SelectItem value="1">入库</SelectItem>
                <SelectItem value="2">出库</SelectItem>
                <SelectItem value="3">调整</SelectItem>
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
            label="商品"
            placeholder="选择商品"
            value={draft.productName ? `${draft.productName}${draft.productCode ? ` (${draft.productCode})` : ''}` : ''}
            onOpen={() => setProductOpen(true)}
            onClear={() => setDraft(d => ({ ...d, productId: null, productCode: '', productName: '' }))}
          />
        </div>
      </AppDialog>

      <ProductFinder
        open={productOpen}
        onClose={() => setProductOpen(false)}
        onConfirm={r => setDraft(d => ({ ...d, productId: r.id, productCode: r.code ?? '', productName: r.name }))}
      />
    </>
  )
}
