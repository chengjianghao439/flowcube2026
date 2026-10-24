import { QueryFormLayout } from '@/components/shared/QueryFormLayout'
import { useEffect, useState } from 'react'
import { QueryDialog } from '@/components/shared/QueryDialog'
import { Input } from '@/components/ui/input'
import CategoryTreeSelect from '@/components/shared/CategoryTreeSelect'
import { WarehouseSelect } from '@/components/shared/WarehouseSelect'

/** 库存总览查询弹窗对外的筛选值（与 URL 参数一一对应） */
export interface InventoryOverviewQueryValues {
  keyword: string
  categoryId: number | null
  warehouseId: number | null
  warehouseName: string
}

const EMPTY: InventoryOverviewQueryValues = {
  keyword: '', categoryId: null,
  warehouseId: null, warehouseName: '',
}

interface Props {
  open: boolean
  initial: InventoryOverviewQueryValues
  onClose: () => void
  onApply: (values: InventoryOverviewQueryValues) => void
}

export default function InventoryOverviewQueryDialog({ open, initial, onClose, onApply }: Props) {
  const [draft, setDraft] = useState<InventoryOverviewQueryValues>(EMPTY)

  useEffect(() => { if (open) setDraft(initial) }, [open, initial])

  return (
    <QueryDialog
      open={open}
      dialogId="inventory-overview-query"
      title="查询库存总览"
      width={520}
      onClose={onClose}
      onReset={() => setDraft(EMPTY)}
      onApply={() => onApply(draft)}
    >
      <QueryFormLayout>
        <label className="flex flex-col gap-1 col-span-2">
          <span className="text-xs font-medium text-muted-foreground">商品编码 / 名称</span>
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

        <label className="flex flex-col gap-1 col-span-2">
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
      </QueryFormLayout>
    </QueryDialog>
  )
}
