import { useEffect, useState } from 'react'
import { AppDialog } from '@/components/shared/AppDialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import CategoryTreeSelect from '@/components/shared/CategoryTreeSelect'
import { SupplierFinder } from '@/components/finder'
import { QueryPickerField } from '@/components/shared/QueryPickerField'

/** 商品查询弹窗对外的筛选值（与 URL 参数一一对应） */
export interface ProductQueryValues {
  keyword: string
  categoryId: number | null
  status: string        // '' 全部 | '1' 启用 | '0' 停用
  supplierId: number | null
  supplierName: string
  minPrice: string
  maxPrice: string
}

const EMPTY: ProductQueryValues = {
  keyword: '', categoryId: null, status: '',
  supplierId: null, supplierName: '',
  minPrice: '', maxPrice: '',
}

interface Props {
  open: boolean
  initial: ProductQueryValues
  onClose: () => void
  onApply: (values: ProductQueryValues) => void
}

export default function ProductQueryDialog({ open, initial, onClose, onApply }: Props) {
  const [draft, setDraft] = useState<ProductQueryValues>(EMPTY)
  const [supplierOpen, setSupplierOpen] = useState(false)

  useEffect(() => { if (open) setDraft(initial) }, [open, initial])

  return (
    <>
      <AppDialog
        open={open}
        onOpenChange={v => { if (!v) onClose() }}
        dialogId="product-query"
        title="查询商品"
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
            <span className="text-xs font-medium text-muted-foreground">编码 / 名称 / 条码</span>
            <Input
              placeholder="请输入关键字…"
              value={draft.keyword}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDraft(d => ({ ...d, keyword: e.target.value }))}
              onKeyDown={(e: React.KeyboardEvent) => { if (e.key === 'Enter') onApply(draft) }}
              className="h-9"
            />
          </label>

          <label className="flex flex-col gap-1 col-span-2">
            <span className="text-xs font-medium text-muted-foreground">分类</span>
            <CategoryTreeSelect
              value={draft.categoryId}
              onChange={(v: number | null) => setDraft(d => ({ ...d, categoryId: v }))}
              emptyLabel="全部分类"
              leafOnly
              className="h-9 w-full"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">状态</span>
            <Select value={draft.status || '__all__'} onValueChange={v => setDraft(d => ({ ...d, status: v === '__all__' ? '' : v }))}>
              <SelectTrigger className="h-9"><SelectValue placeholder="全部状态" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">全部状态</SelectItem>
                <SelectItem value="1">启用</SelectItem>
                <SelectItem value="0">停用</SelectItem>
              </SelectContent>
            </Select>
          </label>

          <QueryPickerField
            label="供应商"
            placeholder="选择供应商"
            value={draft.supplierName ? `${draft.supplierName}` : ''}
            onOpen={() => setSupplierOpen(true)}
            onClear={() => setDraft(d => ({ ...d, supplierId: null, supplierName: '' }))}
          />

          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">售价最低（元）</span>
            <Input
              type="number" min="0" step="0.01"
              placeholder="不限"
              value={draft.minPrice}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDraft(d => ({ ...d, minPrice: e.target.value }))}
              className="h-9"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">售价最高（元）</span>
            <Input
              type="number" min="0" step="0.01"
              placeholder="不限"
              value={draft.maxPrice}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDraft(d => ({ ...d, maxPrice: e.target.value }))}
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
    </>
  )
}
