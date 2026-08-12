import { useEffect, useState } from 'react'
import { AppDialog } from '@/components/shared/AppDialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { WarehouseSelect } from '@/components/shared/WarehouseSelect'

/** 分拣格查询弹窗对外的筛选值 */
export interface SortingBinQueryValues {
  keyword: string
  status: string
  warehouseId: number | null
  warehouseName: string
}

const EMPTY: SortingBinQueryValues = {
  keyword: '', status: '', warehouseId: null, warehouseName: '',
}

interface Props {
  open: boolean
  initial: SortingBinQueryValues
  onClose: () => void
  onApply: (values: SortingBinQueryValues) => void
}

export default function SortingBinQueryDialog({ open, initial, onClose, onApply }: Props) {
  const [draft, setDraft] = useState<SortingBinQueryValues>(EMPTY)

  useEffect(() => { if (open) setDraft(initial) }, [open, initial])

  function set<K extends keyof SortingBinQueryValues>(key: K, value: SortingBinQueryValues[K]) {
    setDraft(d => ({ ...d, [key]: value }))
  }

  return (
    <AppDialog
      open={open}
      onOpenChange={v => { if (!v) onClose() }}
      dialogId="sorting-bin-query"
      title="查询分拣格"
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
          <span className="text-xs font-medium text-muted-foreground">编号 / 仓库 / 客户</span>
          <Input
            placeholder="请输入关键字..."
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
              <SelectItem value="1">空闲</SelectItem>
              <SelectItem value="2">占用</SelectItem>
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
      </div>
    </AppDialog>
  )
}
