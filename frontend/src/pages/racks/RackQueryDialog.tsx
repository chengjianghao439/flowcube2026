import { useEffect, useState } from 'react'
import { AppDialog } from '@/components/shared/AppDialog'
import { Button } from '@/components/ui/button'
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
    <AppDialog
      open={open}
      onOpenChange={v => { if (!v) onClose() }}
      dialogId="rack-query"
      title="查询货架"
      resizable={false}
      defaultWidth={520}
      defaultHeight={420}
      minWidth={420}
      minHeight={360}
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
      </div>
    </AppDialog>
  )
}
