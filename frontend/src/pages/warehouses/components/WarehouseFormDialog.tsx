import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { useCreateWarehouse, useUpdateWarehouse } from '@/hooks/useWarehouses'
import { WAREHOUSE_TYPES, type Warehouse } from '@/types/warehouses'

interface WarehouseFormDialogProps {
  open: boolean
  onClose: () => void
  editItem?: Warehouse | null
}

const defaultForm = {
  name: '', type: 1,
  manager: '', phone: '', address: '', remark: '', isActive: true,
}

export default function WarehouseFormDialog({ open, onClose, editItem }: WarehouseFormDialogProps) {
  const isEdit = !!editItem
  const [form, setForm] = useState(defaultForm)

  const { mutate: create, isPending: creating, error: createError } = useCreateWarehouse()
  const { mutate: update, isPending: updating, error: updateError } = useUpdateWarehouse()
  const isPending = creating || updating
  const error = createError || updateError

  useEffect(() => {
    if (editItem) {
      setForm({
        name: editItem.name,
        type: editItem.type,
        manager: editItem.manager ?? '',
        phone: editItem.phone ?? '',
        address: editItem.address ?? '',
        remark: editItem.remark ?? '',
        isActive: editItem.isActive,
      })
    } else {
      setForm(defaultForm)
    }
  }, [editItem, open])

  function set(field: string, value: string | number | boolean) {
    setForm((f) => ({ ...f, [field]: value }))
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const payload = {
      name: form.name, type: form.type,
      manager: form.manager || undefined,
      phone: form.phone || undefined,
      address: form.address || undefined,
      remark: form.remark || undefined,
    }
    if (isEdit && editItem) {
      update({ id: editItem.id, data: { ...payload, isActive: form.isActive } }, { onSuccess: onClose })
    } else {
      create(payload, { onSuccess: onClose })
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? '编辑仓库' : '新增仓库'}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-4">
            {isEdit && (
              <div className="space-y-2">
                <Label>仓库编码</Label>
                <Input value={editItem?.code ?? ''} disabled className="bg-muted/50 font-mono text-sm" />
              </div>
            )}
            <div className="space-y-2">
              <Label>仓库名称 *</Label>
              <Input value={form.name} onChange={(e: React.ChangeEvent<HTMLInputElement>) => set('name', e.target.value)}
                placeholder="仓库名称" disabled={isPending} />
            </div>
          </div>

          <div className="space-y-2">
            <Label>仓库类型 *</Label>
            <div className="flex flex-wrap gap-4">
              {WAREHOUSE_TYPES.map((t) => (
                <label key={t.value} className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" name="type" value={t.value}
                    checked={form.type === t.value}
                    onChange={() => set('type', t.value)}
                    disabled={isPending} className="accent-primary" />
                  <span className="text-sm">{t.label}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>负责人</Label>
              <Input value={form.manager} onChange={(e: React.ChangeEvent<HTMLInputElement>) => set('manager', e.target.value)}
                placeholder="负责人姓名" disabled={isPending} />
            </div>
            <div className="space-y-2">
              <Label>联系电话</Label>
              <Input value={form.phone} onChange={(e: React.ChangeEvent<HTMLInputElement>) => set('phone', e.target.value)}
                placeholder="联系电话" disabled={isPending} />
            </div>
          </div>

          <div className="space-y-2">
            <Label>仓库地址</Label>
            <Input value={form.address} onChange={(e: React.ChangeEvent<HTMLInputElement>) => set('address', e.target.value)}
              placeholder="详细地址" disabled={isPending} />
          </div>

          <div className="space-y-2">
            <Label>备注</Label>
            <Input value={form.remark} onChange={(e: React.ChangeEvent<HTMLInputElement>) => set('remark', e.target.value)}
              placeholder="备注信息" disabled={isPending} />
          </div>

          {isEdit && (
            <div className="flex items-center gap-2">
              <input type="checkbox" id="wh-active" checked={form.isActive}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => set('isActive', e.target.checked)}
                disabled={isPending} className="accent-primary" />
              <Label htmlFor="wh-active" className="cursor-pointer">启用仓库</Label>
            </div>
          )}

          {error && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error.message}
            </p>
          )}

          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={isPending}>取消</Button>
            <Button type="submit" disabled={isPending || !form.name}>
              {isPending ? '保存中...' : '保存'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
