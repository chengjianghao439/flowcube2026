import { QueryFormLayout } from '@/components/shared/QueryFormLayout'
import { useEffect, useState } from 'react'
import { AppDialog } from '@/components/shared/AppDialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import CategoryTreeSelect from '@/components/shared/CategoryTreeSelect'
import { WarehouseSelect } from '@/components/shared/WarehouseSelect'

/** 补货建议查询弹窗对外的筛选值 */
export interface ReplenishmentQueryValues {
  keyword: string
  warehouseId: number | null
  warehouseName: string
  categoryId: number | null
}

const EMPTY: ReplenishmentQueryValues = {
  keyword: '', warehouseId: null, warehouseName: '', categoryId: null,
}

interface Props {
  open: boolean
  initial: ReplenishmentQueryValues
  onClose: () => void
  onApply: (values: ReplenishmentQueryValues) => void
}

export default function ReplenishmentQueryDialog({ open, initial, onClose, onApply }: Props) {
  const [draft, setDraft] = useState<ReplenishmentQueryValues>(EMPTY)

  useEffect(() => { if (open) setDraft(initial) }, [open, initial])

  return (
    <AppDialog
      open={open}
      onOpenChange={v => { if (!v) onClose() }}
      dialogId="replenishment-query"
      title="查询补货建议"
      resizable={false}
      defaultWidth={520}
      defaultHeight={360}
      minWidth={420}
      minHeight={340}
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

        <label className="flex flex-col gap-1 col-span-2">
          <span className="text-xs font-medium text-muted-foreground">分类（可选）</span>
          <CategoryTreeSelect
            value={draft.categoryId}
            onChange={(v: number | null) => setDraft(d => ({ ...d, categoryId: v }))}
            emptyLabel="全部分类"
            leafOnly
            className="h-9 w-full"
          />
        </label>
      </QueryFormLayout>
    </AppDialog>
  )
}
