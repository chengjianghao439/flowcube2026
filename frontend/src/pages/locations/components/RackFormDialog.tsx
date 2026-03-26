import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useMutation } from '@tanstack/react-query'
import { useCreateRack, useUpdateRack } from '@/hooks/useRacks'
import { useWarehousesActive } from '@/hooks/useWarehouses'
import { printRackLabelApi } from '@/api/racks'
import { toast } from '@/lib/toast'
import { RACK_STATUS_OPTIONS, type Rack } from '@/types/racks'

interface Props {
  open: boolean
  onClose: () => void
  editItem?: Rack | null
}

const defaultForm = {
  warehouseId: 0, zone: '', code: '', name: '',
  maxLevels: 5, maxPositions: 10, status: 1, remark: '',
}

export default function RackFormDialog({ open, onClose, editItem }: Props) {
  const isEdit = !!editItem
  const [form, setForm] = useState(defaultForm)

  const { data: warehouses } = useWarehousesActive()
  const { mutate: create, isPending: creating, error: createError } = useCreateRack()
  const { mutate: update, isPending: updating, error: updateError } = useUpdateRack()
  const printMut = useMutation({
    mutationFn: () => {
      if (!editItem) throw new Error('未选择货架')
      return printRackLabelApi(editItem.id)
    },
    onSuccess: (d) => {
      if (!d) return
      if (d.queued) toast.success('已加入打印队列')
      else toast.warning('未配置标签机，未创建打印任务')
    },
    onError: (e: unknown) =>
      toast.error((e as { message?: string })?.message ?? '打印失败'),
  })
  const isPending = creating || updating
  const error = createError || updateError

  useEffect(() => {
    if (editItem) {
      setForm({
        warehouseId:  editItem.warehouseId,
        zone:         editItem.zone ?? '',
        code:         editItem.code,
        name:         editItem.name ?? '',
        maxLevels:    editItem.maxLevels,
        maxPositions: editItem.maxPositions,
        status:       editItem.status,
        remark:       editItem.remark ?? '',
      })
    } else {
      setForm(defaultForm)
    }
  }, [editItem, open])

  function set(field: string, value: string | number) {
    setForm(f => ({ ...f, [field]: value }))
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (isEdit && editItem) {
      update({
        id: editItem.id,
        data: {
          zone:         form.zone         || undefined,
          code:         form.code         || undefined,
          name:         form.name         || undefined,
          maxLevels:    form.maxLevels,
          maxPositions: form.maxPositions,
          status:       form.status,
          remark:       form.remark       || undefined,
        },
      }, { onSuccess: onClose })
    } else {
      create({
        warehouseId:  form.warehouseId,
        zone:         form.zone         || undefined,
        code:         form.code,
        name:         form.name         || undefined,
        maxLevels:    form.maxLevels,
        maxPositions: form.maxPositions,
        remark:       form.remark       || undefined,
      }, { onSuccess: onClose })
    }
  }

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? '编辑货架' : '新增货架'}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>所属仓库 *</Label>
            {isEdit ? (
              <Input value={editItem?.warehouseName ?? ''} disabled className="bg-muted/50 text-sm" />
            ) : (
              <Select
                value={form.warehouseId ? String(form.warehouseId) : '__none__'}
                onValueChange={v => set('warehouseId', v === '__none__' ? 0 : +v)}
                disabled={isPending}
              >
                <SelectTrigger className="h-9 w-full">
                  <SelectValue placeholder="请选择仓库" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">请选择仓库</SelectItem>
                  {warehouses?.map(w => (
                    <SelectItem key={w.id} value={String(w.id)}>{w.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {isEdit && editItem?.barcode && (
            <div className="flex flex-wrap items-end justify-between gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">货架条码</Label>
                <p className="font-mono text-sm font-semibold tracking-tight">{editItem.barcode}</p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={printMut.isPending}
                onClick={() => printMut.mutate()}
              >
                打印货架标
              </Button>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>库区</Label>
              <Input
                value={form.zone}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => set('zone', e.target.value)}
                placeholder="A"
                disabled={isPending}
                maxLength={20}
              />
            </div>
            <div className="space-y-2">
              <Label>货架编码 *</Label>
              <Input
                value={form.code}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => set('code', e.target.value)}
                placeholder="A01"
                disabled={isPending}
                maxLength={50}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>货架名称</Label>
            <Input
              value={form.name}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => set('name', e.target.value)}
              placeholder="货架名称（选填）"
              disabled={isPending}
              maxLength={100}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>最大层数</Label>
              <Input
                type="number" min={1} max={99}
                value={form.maxLevels}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => set('maxLevels', +e.target.value)}
                disabled={isPending}
              />
            </div>
            <div className="space-y-2">
              <Label>每层位数</Label>
              <Input
                type="number" min={1} max={99}
                value={form.maxPositions}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => set('maxPositions', +e.target.value)}
                disabled={isPending}
              />
            </div>
          </div>

          {isEdit && (
            <div className="space-y-2">
              <Label>状态</Label>
              <Select value={String(form.status)} onValueChange={v => set('status', +v)} disabled={isPending}>
                <SelectTrigger className="h-9 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RACK_STATUS_OPTIONS.map(o => (
                    <SelectItem key={o.value} value={String(o.value)}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-2">
            <Label>备注</Label>
            <Input
              value={form.remark}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => set('remark', e.target.value)}
              placeholder="备注信息"
              disabled={isPending}
            />
          </div>

          {error && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {(error as Error).message}
            </p>
          )}

          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={isPending}>
              取消
            </Button>
            <Button
              type="submit"
              disabled={isPending || !form.code || (!isEdit && !form.warehouseId)}
            >
              {isPending ? '保存中...' : '保存'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
