import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { CarrierAccountBinding, SaveCarrierAccountBinding, PauseCarrierAccountBinding } from '@/types/carriers'

export function AccountBindingForm({ data, onSave, canEdit, saving, onDirtyChange }: {
  onDirtyChange?: (dirty: boolean) => void
  data: CarrierAccountBinding; onSave: (input: SaveCarrierAccountBinding | PauseCarrierAccountBinding) => Promise<unknown>; canEdit: boolean; saving: boolean
}) {
  const [monthlyAccount, setMonthly] = useState(data.monthlyAccount)
  const [shippingProduct, setProduct] = useState(data.shippingProduct)
  const [shippingDeliveryType, setDelivery] = useState(data.shippingDeliveryType)
  const [error, setError] = useState('')
  const [confirmUnbind, setConfirmUnbind] = useState(false)
  const dirty = monthlyAccount.trim() !== data.monthlyAccount || shippingProduct !== data.shippingProduct || shippingDeliveryType !== data.shippingDeliveryType
  useEffect(() => { onDirtyChange?.(dirty) }, [dirty, onDirtyChange])
  const locked = !canEdit || saving || data.enabled
  const company = data.platformCode === 'sf' ? '顺丰' : '德邦'
  const status = data.enabled ? '自动下单已启用'
    : !data.active ? '承运商已停用'
      : !data.connectionReady || data.mode !== 'production' ? '快递接口未开通，可先保存资料。'
        : !data.monthlyAccount ? '请填写月结账号'
          : !data.accountVerified ? '月结账号待完成正式开通'
            : !data.productReady ? '请选择合同服务并保存'
              : '资料已就绪，可启用自动下单'
  async function submit(enabled: boolean) {
    setError('')
    try {
      await onSave(data.enabled && !enabled ? { action: 'pause', revision: data.revision } : { platformCode: data.platformCode, monthlyAccount: monthlyAccount.trim(), shippingProduct, shippingDeliveryType, enabled, revision: data.revision })
    } catch (e) { setError(e instanceof Error ? e.message : '保存失败，请刷新状态后重试') }
  }
  async function unbind() {
    setError('')
    try { await onSave({ action: 'unbind', revision: data.revision }); setConfirmUnbind(false) }
    catch (e) { setError(e instanceof Error ? e.message : '解绑失败，请刷新后重试'); setConfirmUnbind(false) }
  }
  return <div className="max-w-2xl">
    <form className="min-w-0 space-y-5" onSubmit={e => { e.preventDefault(); void submit(false) }}>
      <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-base font-semibold">{company}月结资料</h2><p role="status" className="text-sm text-muted-foreground">{status}</p></div>
      <div className="space-y-2"><Label htmlFor="binding-monthly">月结账号</Label><Input id="binding-monthly" value={monthlyAccount} onChange={e => setMonthly(e.target.value)} disabled={locked} maxLength={data.platformCode === 'sf' ? 20 : 32} autoComplete="off" placeholder="填写快递公司提供的月结账号" /></div>
      <div className="space-y-2"><Label htmlFor="binding-product">常用发货服务</Label>
        <Select value={shippingProduct || '__empty__'} onValueChange={v => setProduct(v === '__empty__' ? '' : v)} disabled={locked || !data.products.length}>
          <SelectTrigger id="binding-product"><SelectValue placeholder="选择常用服务" /></SelectTrigger>
          <SelectContent><SelectItem value="__empty__">请选择常用服务</SelectItem>{data.products.map(p => <SelectItem key={p.code} value={p.code}>{p.label}</SelectItem>)}{shippingProduct && !data.products.some(p => p.code === shippingProduct) && <SelectItem value={shippingProduct}>已保存的服务（待管理员确认名称）</SelectItem>}</SelectContent>
        </Select>
        {!data.products.length && <p className="text-sm text-muted-foreground">暂无可选服务</p>}
      </div>
      {data.platformCode === 'deppon' && <div className="space-y-2"><Label htmlFor="binding-delivery">送货方式</Label><Select value={shippingDeliveryType || '__empty__'} onValueChange={v => setDelivery(v === '__empty__' ? '' : v)} disabled={locked}><SelectTrigger id="binding-delivery"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="__empty__">请选择送货方式</SelectItem><SelectItem value="1">自提</SelectItem><SelectItem value="3">送货不上楼</SelectItem><SelectItem value="4">送货上楼</SelectItem></SelectContent></Select></div>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {canEdit ? <div className="flex flex-wrap gap-3">
        {data.enabled ? <Button type="button" variant="outline" disabled={saving} onClick={() => void submit(false)}>暂停自动下单</Button> : <>
          <Button type="submit" disabled={saving}>{saving ? '正在保存…' : '保存月结资料'}</Button>
          {data.monthlyAccount && <Button type="button" variant="ghost" disabled={saving || dirty} onClick={() => setConfirmUnbind(true)}>解绑账号</Button>}
          <Button type="button" variant="outline" disabled={saving || dirty || !data.canEnable} onClick={() => void submit(true)}>启用自动下单</Button>
        </>}
      </div> : <p className="text-sm text-muted-foreground">你有查看权限；修改绑定资料请联系拥有承运商编辑权限的同事。</p>}
      {dirty && <p role="status" className="text-sm text-muted-foreground">有未保存的修改</p>}
    </form>
    <ConfirmDialog open={confirmUnbind} title="解绑月结账号" description={`将清除「${data.carrierName}」在本系统保存的月结账号和常用服务，保留承运商及历史订单。不会解除快递官网授权。有待处理运单时无法解绑。`} confirmText="确认解绑" variant="destructive" loading={saving} onConfirm={() => void unbind()} onCancel={() => setConfirmUnbind(false)} />

  </div>
}
