import { QueryFormLayout } from '@/components/shared/QueryFormLayout'
import { useEffect, useState } from 'react'
import { QueryDialog } from '@/components/shared/QueryDialog'
import { Input } from '@/components/ui/input'
import { WarehouseSelect } from '@/components/shared/WarehouseSelect'

/** 货架查询弹窗对外的筛选值 */
export interface RackQueryValues {
  keyword: string
  warehouseId: number | null
  warehouseName: string
  zone: string
}

const EMPTY: RackQueryValues = {
  keyword: '', warehouseId: null, warehouseName: '', zone: '',
}

interface Props {
  open: boolean
  initial: RackQueryValues
  onClose: () => void
  onApply: (values: RackQueryValues) => void
}

export default function RackQueryDialog({ open, initial, onClose, onApply }: Props) {
  const [draft, setDraft] = useState<RackQueryValues>(EMPTY)

  useEffect(() => { if (open) setDraft(initial) }, [open, initial])

  function set<K extends keyof RackQueryValues>(key: K, value: RackQueryValues[K]) {
    setDraft(d => ({ ...d, [key]: value }))
  }

  return (
    <QueryDialog
      open={open}
      dialogId="rack-query"
      title="查询货架"
      width={520}
      onClose={onClose}
      onReset={() => setDraft(EMPTY)}
      onApply={() => onApply(draft)}
    >
      <QueryFormLayout>
        <label className="flex flex-col gap-1 col-span-2">
          <span className="text-xs font-medium text-muted-foreground">编码 / 名称 / 库区</span>
          <Input
            placeholder="请输入关键字…"
            value={draft.keyword}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => set('keyword', e.target.value)}
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
          <span className="text-xs font-medium text-muted-foreground">区域</span>
          <Input
            placeholder="按库区（如 A/B/C）查询…"
            value={draft.zone}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => set('zone', e.target.value)}
            onKeyDown={(e: React.KeyboardEvent) => { if (e.key === 'Enter') onApply(draft) }}
            className="h-9"
          />
        </label>
      </QueryFormLayout>
    </QueryDialog>
  )
}
