import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useCreateLocation, useUpdateLocation } from '@/hooks/useLocations'
import { useWarehousesActive } from '@/hooks/useWarehouses'
import { LOCATION_STATUS_OPTIONS, type Location } from '@/types/locations'

interface Props {
  open: boolean
  onClose: () => void
  editItem?: Location | null
}

const defaultForm = {
  warehouseId: 0,
  code: '', zone: '', aisle: '', rack: '', level: '', position: '',
  capacity: 0, status: 1, remark: '',
}

/**
 * 根据库区/巷道/货架/层/位自动生成库位编码
 * 规则：zone + aisle.padStart(2,'0') + '-' + rack.padStart(2,'0') + '-' + level.padStart(2,'0') + position.padStart(2,'0')
 * 例：A + 01 + - + 01 + - + 01 + 01  →  A01-01-0101
 * 任意字段为空时返回空字符串
 */
function buildCode(zone: string, aisle: string, rack: string, level: string, position: string): string {
  if (!zone.trim() || !aisle.trim() || !rack.trim() || !level.trim() || !position.trim()) return ''
  const pad = (v: string) => v.trim().padStart(2, '0')
  return `${zone.trim()}${pad(aisle)}-${pad(rack)}-${pad(level)}${pad(position)}`
}

export default function LocationFormDialog({ open, onClose, editItem }: Props) {
  const isEdit = !!editItem
  const [form, setForm] = useState(defaultForm)

  const { data: warehouses } = useWarehousesActive()
  const { mutate: create, isPending: creating, error: createError } = useCreateLocation()
  const { mutate: update, isPending: updating, error: updateError } = useUpdateLocation()
  const isPending = creating || updating
  const error = createError || updateError

  // 初始化表单
  useEffect(() => {
    if (editItem) {
      setForm({
        warehouseId: editItem.warehouseId,
        code: editItem.code,
        zone: editItem.zone ?? '',
        aisle: editItem.aisle ?? '',
        rack: editItem.rack ?? '',
        level: editItem.level ?? '',
        position: editItem.position ?? '',
        capacity: editItem.capacity,
        status: editItem.status,
        remark: editItem.remark ?? '',
      })
    } else {
      setForm(defaultForm)
    }
  }, [editItem, open])

  // 监听五字段变化，自动生成编码
  useEffect(() => {
    const code = buildCode(form.zone, form.aisle, form.rack, form.level, form.position)
    setForm(f => ({ ...f, code }))
  }, [form.zone, form.aisle, form.rack, form.level, form.position])

  function set(field: string, value: string | number) {
    setForm(f => ({ ...f, [field]: value }))
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (isEdit && editItem) {
      update({
        id: editItem.id,
        data: {
          code: form.code,
          zone: form.zone || undefined,
          aisle: form.aisle || undefined,
          rack: form.rack || undefined,
          level: form.level || undefined,
          position: form.position || undefined,
          capacity: form.capacity,
          status: form.status,
          remark: form.remark || undefined,
        },
      }, { onSuccess: onClose })
    } else {
      create({
        warehouseId: form.warehouseId,
        code: form.code,
        zone: form.zone || undefined,
        aisle: form.aisle || undefined,
        rack: form.rack || undefined,
        level: form.level || undefined,
        position: form.position || undefined,
        capacity: form.capacity,
        remark: form.remark || undefined,
      }, { onSuccess: onClose })
    }
  }

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? '编辑库位' : '新增库位'}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          {/* 仓库选择 */}
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

          {/* 五段编码字段 */}
          <div className="grid grid-cols-5 gap-3">
            <div className="space-y-2">
              <Label>库区 *</Label>
              <Input
                value={form.zone}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => set('zone', e.target.value)}
                placeholder="A"
                disabled={isPending}
                maxLength={20}
              />
            </div>
            <div className="space-y-2">
              <Label>巷道 *</Label>
              <Input
                value={form.aisle}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => set('aisle', e.target.value)}
                placeholder="01"
                disabled={isPending}
                maxLength={20}
              />
            </div>
            <div className="space-y-2">
              <Label>货架 *</Label>
              <Input
                value={form.rack}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => set('rack', e.target.value)}
                placeholder="01"
                disabled={isPending}
                maxLength={20}
              />
            </div>
            <div className="space-y-2">
              <Label>层 *</Label>
              <Input
                value={form.level}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => set('level', e.target.value)}
                placeholder="01"
                disabled={isPending}
                maxLength={20}
              />
            </div>
            <div className="space-y-2">
              <Label>位 *</Label>
              <Input
                value={form.position}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => set('position', e.target.value)}
                placeholder="01"
                disabled={isPending}
                maxLength={20}
              />
            </div>
          </div>

          {/* 自动生成的库位编码（只读展示） */}
          <div className="space-y-2">
            <Label>库位编码（自动生成）</Label>
            <Input
              value={form.code}
              readOnly
              className="bg-muted/50 font-mono text-sm cursor-default"
              placeholder="填写上方字段后自动生成"
            />
          </div>

          {/* 容量 + 状态 */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>容量（0 = 不限）</Label>
              <Input
                type="number"
                min={0}
                value={form.capacity}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => set('capacity', +e.target.value)}
                disabled={isPending}
              />
            </div>
            {isEdit && (
              <div className="space-y-2">
                <Label>状态</Label>
                <Select value={String(form.status)} onValueChange={v => set('status', +v)} disabled={isPending}>
                  <SelectTrigger className="h-9 w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LOCATION_STATUS_OPTIONS.map(o => (
                      <SelectItem key={o.value} value={String(o.value)}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          {/* 备注 */}
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
