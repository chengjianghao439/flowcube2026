import { useEffect, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { LimitedInput } from '@/components/shared/LimitedInput'
import { useCreateCustomer, useUpdateCustomer } from '@/hooks/useCustomers'
import { toast } from '@/lib/toast'
import type { Customer } from '@/types/customers'

interface Props { open: boolean; onClose: () => void; customer?: Customer | null }

const empty = { name:'', contact:'', phone:'', email:'', address:'', remark:'' }
const PHONE_RE = /^1\d{10}$/

export default function CustomerFormDialog({ open, onClose, customer }: Props) {
  const isEdit = !!customer
  const create = useCreateCustomer()
  const update = useUpdateCustomer()
  const [f, setF] = useState(empty)
  const set = (k: keyof typeof empty) => (e: React.ChangeEvent<HTMLInputElement>) => setF(p=>({...p,[k]:e.target.value}))

  useEffect(() => {
    if (!open) return
    if (customer) {
      setF({ name:customer.name, contact:customer.contact||'', phone:customer.phone||'', email:customer.email||'', address:customer.address||'', remark:customer.remark||'' })
    } else {
      setF(empty)
    }
  }, [customer, open])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (f.phone && !PHONE_RE.test(f.phone)) { toast.error('请输入正确的手机号'); return }
    if (isEdit && customer) {
      await update.mutateAsync({ id:customer.id, data:{ ...f, isActive:customer.isActive } })
    } else {
      await create.mutateAsync(f)
    }
    onClose()
  }

  const loading = create.isPending || update.isPending

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{isEdit ? '编辑客户' : '新增客户'}</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-4">
            {isEdit && (
              <div className="space-y-1">
                <Label>客户编码</Label>
                <Input value={customer?.code ?? ''} disabled className="bg-muted/50 font-mono text-sm" />
              </div>
            )}
            <div className="space-y-1">
              <Label>客户名称 *</Label>
              <LimitedInput maxLength={20} value={f.name} onChange={set('name')} placeholder="公司/个人名称" required />
            </div>
            <div className="space-y-1">
              <Label>联系人</Label>
              <LimitedInput maxLength={5} value={f.contact} onChange={set('contact')} placeholder="联系人姓名" />
            </div>
            <div className="space-y-1">
              <Label>联系电话</Label>
              <LimitedInput maxLength={11} value={f.phone} onChange={set('phone')} placeholder="11位手机号" inputMode="numeric" />
            </div>
            <div className="space-y-1">
              <Label>邮箱</Label>
              <Input value={f.email} onChange={set('email')} placeholder="example@email.com" type="email" />
            </div>
            <div className="space-y-1">
              <Label>地址</Label>
              <LimitedInput maxLength={30} value={f.address} onChange={set('address')} placeholder="详细地址" />
            </div>
          </div>
          <div className="space-y-1">
            <Label>备注</Label>
            <LimitedInput maxLength={30} value={f.remark} onChange={set('remark')} placeholder="备注信息" />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>取消</Button>
            <Button type="submit" disabled={loading}>{loading ? '保存中...' : '保存'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
