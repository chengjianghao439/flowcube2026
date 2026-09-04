import { useEffect, useState } from 'react'
import { Star, Pencil, Trash2, Plus, MapPin } from 'lucide-react'
import { AppDialog } from '@/components/shared/AppDialog'
import { Button } from '@/components/ui/button'
import { LimitedInput } from '@/components/shared/LimitedInput'
import { LimitedTextarea } from '@/components/shared/LimitedTextarea'
import { toast } from '@/lib/toast'
import { confirmAction } from '@/lib/confirm'
import { cn } from '@/lib/utils'
import { usePermission } from '@/hooks/usePermission'
import { PERMISSIONS } from '@/lib/permission-codes'
import {
  useCustomerAddresses,
  useCreateCustomerAddress,
  useUpdateCustomerAddress,
  useSetDefaultCustomerAddress,
  useDeleteCustomerAddress,
} from '@/hooks/useCustomerAddresses'
import { parseAddressText } from '@/utils/parseAddress'
import type { CustomerAddress } from '@/types/customers'

const PHONE_RE = /^[0-9+()\-\s]{3,30}$/
const emptyForm = { receiverName: '', receiverPhone: '', receiverAddress: '' }

/** 挑选出的地址落进销售单收货字段的最小形状 */
export interface PickedAddress {
  receiverName?: string | null
  receiverPhone?: string | null
  receiverAddress: string
}

interface Props {
  open: boolean
  onOpenChange: (v: boolean) => void
  customerId: number
  customerName?: string
  onSelect: (addr: PickedAddress) => void
}

export default function AddressBookDialog({ open, onOpenChange, customerId, customerName, onSelect }: Props) {
  const { can } = usePermission()
  const canWrite = can(PERMISSIONS.CUSTOMER_UPDATE)

  const { data: addresses = [], isLoading } = useCustomerAddresses(customerId, open)
  const create = useCreateCustomerAddress(customerId)
  const update = useUpdateCustomerAddress(customerId)
  const setDefault = useSetDefaultCustomerAddress(customerId)
  const remove = useDeleteCustomerAddress(customerId)

  const [paste, setPaste] = useState('')
  const [form, setForm] = useState(emptyForm)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [adding, setAdding] = useState(false)   // 录入区是否展开；默认收起，让地址列表占满弹窗

  // 每次打开或切换客户，重置录入区，避免残留上一单/上一客户的内容
  useEffect(() => {
    if (open) { setPaste(''); setForm(emptyForm); setEditingId(null); setAdding(false) }
  }, [open, customerId])

  const startAdd = () => { setForm(emptyForm); setEditingId(null); setPaste(''); setAdding(true) }
  const closeForm = () => { setForm(emptyForm); setEditingId(null); setPaste(''); setAdding(false) }

  const handleRecognize = () => {
    const p = parseAddressText(paste)
    if (!p.name && !p.phone && !p.address) { toast.warning('未能识别，请手动填写或调整格式'); return }
    setForm(f => ({
      receiverName: p.name ?? f.receiverName,
      receiverPhone: p.phone ?? f.receiverPhone,
      receiverAddress: p.address ?? f.receiverAddress,
    }))
    toast.success('已识别，请核对后填入或保存')
  }

  const validateForm = () => {
    if (!form.receiverAddress.trim()) { toast.warning('请填写收货地址'); return false }
    if (form.receiverPhone && !PHONE_RE.test(form.receiverPhone)) { toast.warning('请输入正确的联系电话'); return false }
    return true
  }

  const handleFillOrder = () => {
    if (!validateForm()) return
    onSelect({ receiverName: form.receiverName, receiverPhone: form.receiverPhone, receiverAddress: form.receiverAddress.trim() })
    onOpenChange(false)
  }

  const handleSave = async () => {
    if (!validateForm()) return
    const payload = {
      receiverName: form.receiverName || undefined,
      receiverPhone: form.receiverPhone || undefined,
      receiverAddress: form.receiverAddress.trim(),
    }
    try {
      if (editingId) await update.mutateAsync({ id: editingId, data: payload })
      else await create.mutateAsync({ customerId, ...payload })
      closeForm()
    } catch { /* toast 已在 hook onError 处理 */ }
  }

  const handlePick = (a: CustomerAddress) => {
    onSelect({ receiverName: a.receiverName, receiverPhone: a.receiverPhone, receiverAddress: a.receiverAddress })
    onOpenChange(false)
  }

  const handleEdit = (a: CustomerAddress) => {
    setEditingId(a.id)
    setForm({ receiverName: a.receiverName ?? '', receiverPhone: a.receiverPhone ?? '', receiverAddress: a.receiverAddress })
    setPaste('')
    setAdding(true)
  }

  const handleDelete = (a: CustomerAddress) => {
    confirmAction({
      title: '删除常用地址',
      description: `确认删除「${a.receiverName || '未填收货人'} · ${a.receiverAddress}」？`,
      confirmText: '删除',
      onConfirm: () => remove.mutate(a.id, { onSuccess: () => { if (editingId === a.id) closeForm() } }),
    })
  }

  const saving = create.isPending || update.isPending

  return (
    <AppDialog
      open={open}
      onOpenChange={onOpenChange}
      dialogId="customer-address-book"
      title={`常用地址${customerName ? ` · ${customerName}` : ''}`}
      defaultWidth={640}
      defaultHeight={560}
      minWidth={360}
      minHeight={460}
    >
      <div className="flex h-full flex-col gap-3 overflow-hidden px-5 py-4">
        {/* 顶部：仅在已有地址时显示计数与新增入口；空状态用居中 CTA，避免重复 */}
        {addresses.length > 0 && (
          <div className="flex shrink-0 items-center justify-between">
            <p className="text-sm text-muted-foreground">共 <span className="font-medium text-foreground">{addresses.length}</span> 个地址 · 双击填入订单</p>
            {canWrite && !adding && (
              <Button size="sm" className="gap-1.5" onClick={startAdd}>
                <Plus className="h-4 w-4" />新增地址
              </Button>
            )}
          </div>
        )}

        {/* 录入区：按需展开，分隔线分区、不再套卡片 */}
        {canWrite && adding && (
          <div className="shrink-0 space-y-2.5 border-b pb-3.5 duration-200 animate-in fade-in-0 slide-in-from-top-1">
            <p className="text-sm font-medium">{editingId ? '编辑地址' : '新增地址'}</p>
            {/* 智能识别：粘贴整段自动拆分 */}
            <div className="flex items-center gap-2">
              <div className="flex-1">
                <LimitedTextarea
                  maxLength={120}
                  value={paste}
                  onChange={e => setPaste(e.target.value)}
                  placeholder="粘贴整段地址，自动识别收货人 / 电话 / 地址…"
                  rows={2}
                />
              </div>
              <Button type="button" variant="outline" className="shrink-0 px-4" onClick={handleRecognize} disabled={!paste.trim()}>
                识别
              </Button>
            </div>
            {/* 收货人 / 电话 / 地址 —— 占位即标签，保持紧凑 */}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-[7rem_9.5rem_1fr]">
              <LimitedInput maxLength={30} value={form.receiverName} onChange={e => setForm(f => ({ ...f, receiverName: e.target.value }))} placeholder="收货人或部门" />
              <LimitedInput maxLength={30} value={form.receiverPhone} onChange={e => setForm(f => ({ ...f, receiverPhone: e.target.value }))} placeholder="联系电话" inputMode="tel" />
              <LimitedTextarea maxLength={200} value={form.receiverAddress} onChange={e => setForm(f => ({ ...f, receiverAddress: e.target.value }))} placeholder="详细收货地址" rows={1} className="h-10 min-h-0 py-2" singleLine />
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="ghost" onClick={closeForm}>取消</Button>
              <Button variant="outline" onClick={handleFillOrder}>仅填入订单</Button>
              <Button onClick={handleSave} disabled={saving}>{saving ? '保存中…' : editingId ? '保存修改' : '保存地址'}</Button>
            </div>
          </div>
        )}

        {!canWrite && (
          <p className="shrink-0 text-xs text-muted-foreground">当前账号无维护权限，可双击地址填入订单。</p>
        )}

        {/* 地址列表：扁平行 + 分隔线，占满剩余高度 */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {isLoading ? (
            <ul className="divide-y">
              {[0, 1, 2].map(i => (
                <li key={i} className="flex items-center gap-3 py-3">
                  <div className="h-9 w-9 shrink-0 animate-pulse rounded-full bg-muted" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3.5 w-28 animate-pulse rounded bg-muted" />
                    <div className="h-3 w-48 animate-pulse rounded bg-muted" />
                  </div>
                </li>
              ))}
            </ul>
          ) : addresses.length === 0 ? (
            adding ? (
              // 录入区已展开时，无需再劝一遍——居中一句轻提示说明这块空白是做什么的
              <div className="flex h-full items-center justify-center">
                <p className="text-center text-xs text-muted-foreground">保存后，常用地址会显示在这里。</p>
              </div>
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-3 py-8 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                  <MapPin className="h-5 w-5 text-muted-foreground" />
                </div>
                <p className="text-sm text-muted-foreground">
                  {canWrite ? '还没有常用地址，新增或粘贴一段地址即可' : '该客户还没有常用地址'}
                </p>
                {canWrite && (
                  <Button size="sm" className="gap-1.5" onClick={startAdd}><Plus className="h-4 w-4" />新增地址</Button>
                )}
              </div>
            )
          ) : (
            <ul className="divide-y">
              {addresses.map(a => (
                <li
                  key={a.id}
                  onDoubleClick={() => handlePick(a)}
                  className={cn(
                    'group flex cursor-pointer items-center gap-3 rounded-md px-2 py-2.5 transition-colors hover:bg-accent',
                    editingId === a.id && 'bg-accent',
                  )}
                  title="双击填入订单"
                >
                  <div className={cn(
                    'flex h-9 w-9 shrink-0 items-center justify-center rounded-full',
                    a.isDefault ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground',
                  )}>
                    {a.isDefault ? <Star className="h-4 w-4 fill-current" /> : <MapPin className="h-4 w-4" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium">{a.receiverName || '未填收货人'}</span>
                      <span className="shrink-0 text-sm tabular-nums text-muted-foreground">{a.receiverPhone || '—'}</span>
                      {a.isDefault && <span className="shrink-0 text-xs font-medium text-primary">默认</span>}
                    </div>
                    <p className="truncate text-sm text-muted-foreground">{a.receiverAddress}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-0.5 opacity-100 transition-opacity sm:opacity-0 sm:focus-within:opacity-100 sm:group-hover:opacity-100">
                    <Button variant="ghost" size="sm" className="h-8 px-2.5" onClick={() => handlePick(a)}>选用</Button>
                    {canWrite && (
                      <>
                        {!a.isDefault && (
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground" title="设为默认" onClick={() => setDefault.mutate(a.id)}>
                            <Star className="h-4 w-4" />
                          </Button>
                        )}
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground" title="编辑" onClick={() => handleEdit(a)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" title="删除" onClick={() => handleDelete(a)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </AppDialog>
  )
}
