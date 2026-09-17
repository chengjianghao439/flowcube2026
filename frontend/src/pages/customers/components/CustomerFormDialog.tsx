import { useEffect, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { EditModeBadge, UnsavedBadge } from '@/components/shared/EditModeBadge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { LimitedInput } from '@/components/shared/LimitedInput'
import { SettlementTypeField } from '@/components/shared/SettlementTypeField'
import { useCreateCustomer, useUpdateCustomer } from '@/hooks/useCustomers'
import { toast } from '@/lib/toast'
import { SETTLEMENT_TYPE, type SettlementType } from '@/generated/status'
import type { Customer } from '@/types/customers'

interface Props { open: boolean; onClose: () => void; customer?: Customer | null }

const empty = {
  name:'', contact:'', phone:'', email:'', address:'', remark:'',
  settlementType: SETTLEMENT_TYPE.MONTHLY as SettlementType,
  paymentTermsDays: 30,
  creditEnabled: false,
  creditLimit: '' as string,
  isActive: true,
}
const PHONE_RE = /^1\d{10}$/

export default function CustomerFormDialog({ open, onClose, customer }: Props) {
  const isEdit = !!customer
  const create = useCreateCustomer()
  const update = useUpdateCustomer()
  const [f, setF] = useState(empty)
  // 基线：编辑=加载到的记录值，新增=默认值。改动后与默认态明显区分（「未保存」标识）
  const [baseline, setBaseline] = useState(empty)
  const set = (k: keyof typeof empty) => (e: React.ChangeEvent<HTMLInputElement>) => setF(p=>({...p,[k]:e.target.value}))

  useEffect(() => {
    if (!open) return
    if (customer) {
      const next = {
        name:customer.name, contact:customer.contact||'', phone:customer.phone||'', email:customer.email||'',
        address:customer.address||'', remark:customer.remark||'',
        settlementType: customer.settlementType ?? SETTLEMENT_TYPE.MONTHLY,
        paymentTermsDays: customer.paymentTermsDays ?? 30,
        creditEnabled: customer.creditLimit != null,
        creditLimit: customer.creditLimit != null ? String(customer.creditLimit) : '',
        isActive: customer.isActive,
      }
      setF(next)
      setBaseline(next)
    } else {
      setF(empty)
      setBaseline(empty)
    }
  }, [customer, open])

  const isDirty = JSON.stringify(f) !== JSON.stringify(baseline)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (f.phone && !PHONE_RE.test(f.phone)) { toast.error('请输入正确的手机号'); return }
    const { creditEnabled, creditLimit: cl, isActive, ...rest } = f
    const payload = { ...rest, creditLimit: creditEnabled ? (cl === '' ? 0 : Number(cl)) : null }
    try {
      if (isEdit && customer) {
        await update.mutateAsync({ id:customer.id, data:{ ...payload, isActive } })
      } else {
        await create.mutateAsync(payload)
      }
      onClose()
    } catch {
      // Toast 已在 hooks 的 onError 中处理
    }
  }

  const loading = create.isPending || update.isPending

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        {/* 编辑态与默认（新增）态必须一眼可分：带「编辑中」标识 + 编辑对象 + 未保存提示 */}
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            {isEdit ? '编辑客户' : '新增客户'}
            {isEdit && <EditModeBadge />}
            <UnsavedBadge show={isDirty} />
          </DialogTitle>
          {isEdit && customer && (
            <p className="text-helper mt-1">
              正在编辑：<span className="font-medium text-foreground">{customer.code} · {customer.name}</span>
            </p>
          )}
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-5 py-2">
          <h3 className="text-sm font-medium">客户与联系方式</h3>
          <div className="grid grid-cols-2 gap-x-6 gap-y-3">
            {isEdit && (
              <div className="space-y-1">
                <Label htmlFor="customer-code">客户编码</Label>
                <Input id="customer-code" value={customer?.code ?? ''} disabled className="bg-muted/50 font-mono text-sm" />
              </div>
            )}
            <div className="space-y-1">
              <Label htmlFor="customer-name">客户名称 *</Label>
              <LimitedInput maxLength={20} id="customer-name" value={f.name} onChange={set('name')} placeholder="公司/个人名称" required />
            </div>
            <div className="space-y-1">
              <Label htmlFor="customer-contact">联系人</Label>
              <LimitedInput maxLength={5} id="customer-contact" value={f.contact} onChange={set('contact')} placeholder="联系人姓名" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="customer-phone">联系电话</Label>
              <LimitedInput maxLength={11} id="customer-phone" value={f.phone} onChange={set('phone')} placeholder="11位手机号" inputMode="numeric" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="customer-email">邮箱</Label>
              <Input id="customer-email" value={f.email} onChange={set('email')} placeholder="example@email.com" type="email" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="customer-address">地址</Label>
              <LimitedInput maxLength={30} id="customer-address" value={f.address} onChange={set('address')} placeholder="详细地址" />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="customer-remark">备注</Label>
            <LimitedInput maxLength={30} id="customer-remark" value={f.remark} onChange={set('remark')} placeholder="备注信息" />
          </div>
          <h3 className="border-t pt-4 text-sm font-medium">结算与授信</h3>
          <SettlementTypeField
            side="receivable"
            settlementType={f.settlementType}
            paymentTermsDays={f.paymentTermsDays}
            onChange={next => setF(p => ({ ...p, ...next }))}
            disabled={loading}
          />
          <div className="space-y-3 rounded-md bg-muted/40 p-4">
            <label className="flex items-center gap-2 text-sm font-medium">
              <input type="checkbox" className="h-4 w-4" checked={f.creditEnabled}
                onChange={e => setF(p => ({ ...p, creditEnabled: e.target.checked }))} disabled={loading} />
              启用授信信控
            </label>
            {f.creditEnabled ? (
              <div className="space-y-1">
                <Label htmlFor="customer-creditLimit">授信额度</Label>
                <Input type="number" min="0" step="0.01" id="customer-creditLimit" value={f.creditLimit} onChange={set('creditLimit')} disabled={loading}
                  placeholder="输入授信额度，0 表示不允许赊欠" />
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">未启用时，不对该客户执行授信额度校验。</p>
            )}
          </div>
          {isEdit && (
            <div className="flex items-center gap-2 border-t pt-4">
              <input type="checkbox" id="customer-active" checked={f.isActive}
                onChange={e => setF(p => ({ ...p, isActive: e.target.checked }))}
                disabled={loading} className="accent-primary" />
              <Label htmlFor="customer-active" className="cursor-pointer">启用</Label>
              <span className="text-xs text-muted-foreground">停用后不能用于新建业务，历史单据保留。</span>
            </div>
          )}
          <DialogFooter className="border-t pt-4">
            <Button type="button" variant="outline" onClick={onClose}>取消</Button>
            <Button type="submit" disabled={loading}>{loading ? '保存中…' : (isEdit ? '保存修改' : '保存')}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
