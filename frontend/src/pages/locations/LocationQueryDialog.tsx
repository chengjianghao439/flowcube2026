import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AppDialog } from '@/components/shared/AppDialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { getWarehousesActiveApi } from '@/api/warehouses'

/** 库位查询弹窗对外的筛选值 */
export interface LocationQueryValues {
  keyword: string
  warehouseId: number | null
  status: string
  zone: string
}

const EMPTY: LocationQueryValues = {
  keyword: '', warehouseId: null, status: '', zone: '',
}

interface Props {
  open: boolean
  initial: LocationQueryValues
  onClose: () => void
  onApply: (values: LocationQueryValues) => void
}

export default function LocationQueryDialog({ open, initial, onClose, onApply }: Props) {
  const [draft, setDraft] = useState<LocationQueryValues>(EMPTY)

  const { data: whData } = useQuery({
    queryKey: ['warehouses-simple'],
    queryFn: () => getWarehousesActiveApi().then(r => r ?? []),
    enabled: open,
  })

  useEffect(() => { if (open) setDraft(initial) }, [open, initial])

  function set<K extends keyof LocationQueryValues>(key: K, value: LocationQueryValues[K]) {
    setDraft(d => ({ ...d, [key]: value }))
  }

  return (
    <AppDialog
      open={open}
      onOpenChange={v => { if (!v) onClose() }}
      dialogId="location-query"
      title="查询库位"
      resizable={false}
      defaultWidth={520}
      defaultHeight={480}
      minWidth={420}
      minHeight={400}
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
          <span className="text-xs font-medium text-muted-foreground">库位编号 / 名称</span>
          <Input
            placeholder="请输入关键字..."
            value={draft.keyword}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => set('keyword', e.target.value)}
            onKeyDown={(e: React.KeyboardEvent) => { if (e.key === 'Enter') onApply(draft) }}
            className="h-9"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">仓库</span>
          <Select value={draft.warehouseId ? String(draft.warehouseId) : '__all__'} onValueChange={v => set('warehouseId', v === '__all__' ? null : Number(v))}>
            <SelectTrigger className="h-9"><SelectValue placeholder="全部仓库" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">全部仓库</SelectItem>
              {(whData ?? []).map((w: { id: number; name: string }) => (
                <SelectItem key={w.id} value={String(w.id)}>{w.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">状态</span>
          <Select value={draft.status || '__all__'} onValueChange={v => set('status', v === '__all__' ? '' : v)}>
            <SelectTrigger className="h-9"><SelectValue placeholder="全部状态" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">全部状态</SelectItem>
              <SelectItem value="1">启用</SelectItem>
              <SelectItem value="2">停用</SelectItem>
            </SelectContent>
          </Select>
        </label>

        <label className="flex flex-col gap-1 col-span-2">
          <span className="text-xs font-medium text-muted-foreground">区域</span>
          <Input
            placeholder="按库区（如 A/B/C）查询..."
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
