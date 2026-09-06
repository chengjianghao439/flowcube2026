import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { useEffect, useState } from 'react'
import { CheckCircle2, Circle, ExternalLink } from 'lucide-react'
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
  const steps = [
    { title: '填写月结资料', done: !!data.monthlyAccount, description: data.monthlyAccount ? '已保存月结账号，运费沿用月结合同结算。' : '在月结账单或快递公司后台查找账号，也可向客户经理索取。' },
    { title: '开通系统连接', done: data.connectionReady && data.mode === 'production', description: !data.connectionReady ? '等待管理员开通，无需仓库人员填写接口密钥。' : data.mode === 'sandbox' ? '当前为测试环境，正式连接待管理员开通。' : '正式接口配置已准备。' },
    { title: '确认账号可用', done: data.accountVerified, description: data.accountVerified ? '管理员已登记该月结账号的平台验收结果。' : '等待管理员与快递公司完成该月结账号授权和下单联调。' },
    { title: '启用自动下单', done: data.enabled, description: data.enabled ? '本承运商打包完成后将自动下单。' : '资料和开通检查完成后，再点击启用。' },
  ]
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
  return <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.8fr)]">
    <form className="min-w-0 space-y-5" onSubmit={e => { e.preventDefault(); void submit(false) }}>
      <div><h2 className="text-base font-semibold">{company}月结资料</h2><p className="mt-1 text-sm text-muted-foreground">用于「{data.carrierName}」的自动寄件。保存资料不会立即产生快递订单。</p></div>
      {!data.active && <p role="status" className="rounded-md border p-3 text-sm">该承运商已停用，请联系管理员恢复后再启用自动下单。</p>}
      <div className="space-y-2"><Label htmlFor="binding-monthly">月结账号</Label><Input id="binding-monthly" value={monthlyAccount} onChange={e => setMonthly(e.target.value)} disabled={locked} maxLength={data.platformCode === 'sf' ? 20 : 32} autoComplete="off" placeholder="填写快递公司提供的月结账号" /><p className="text-sm text-muted-foreground">这是运费结算账号，不是登录手机号。</p></div>
      <div className="space-y-2"><Label htmlFor="binding-product">常用发货服务</Label>
        <Select value={shippingProduct || '__empty__'} onValueChange={v => setProduct(v === '__empty__' ? '' : v)} disabled={locked || !data.products.length}>
          <SelectTrigger id="binding-product"><SelectValue placeholder="选择常用服务" /></SelectTrigger>
          <SelectContent><SelectItem value="__empty__">请选择常用服务</SelectItem>{data.products.map(p => <SelectItem key={p.code} value={p.code}>{p.label}</SelectItem>)}{shippingProduct && !data.products.some(p => p.code === shippingProduct) && <SelectItem value={shippingProduct}>已保存的服务（待管理员确认名称）</SelectItem>}</SelectContent>
        </Select>
        <p className="text-sm text-muted-foreground">{data.products.length ? '销售订单可按实际情况选择其他已开通服务。' : '等待管理员设置合同服务名称。你可以先保存月结账号。'}</p>
      </div>
      {data.platformCode === 'deppon' && <div className="space-y-2"><Label htmlFor="binding-delivery">送货方式</Label><Select value={shippingDeliveryType || '__empty__'} onValueChange={v => setDelivery(v === '__empty__' ? '' : v)} disabled={locked}><SelectTrigger id="binding-delivery"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="__empty__">请选择送货方式</SelectItem><SelectItem value="1">自提</SelectItem><SelectItem value="3">送货不上楼</SelectItem><SelectItem value="4">送货上楼</SelectItem></SelectContent></Select></div>}
      <p className="text-sm text-muted-foreground">件数按实际打包箱数自动填写，重量默认 1 kg，最终以快递员称重为准。</p>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {canEdit ? <div className="flex flex-wrap gap-3">
        {data.enabled ? <Button type="button" variant="outline" disabled={saving} onClick={() => void submit(false)}>暂停自动下单</Button> : <>
          <Button type="submit" disabled={saving}>{saving ? '正在保存…' : '保存月结资料'}</Button>
          {data.monthlyAccount && <Button type="button" variant="ghost" disabled={saving || dirty} onClick={() => setConfirmUnbind(true)}>解绑账号</Button>}
          <Button type="button" variant="outline" disabled={saving || dirty || !data.canEnable} onClick={() => void submit(true)}>启用自动下单</Button>
        </>}
      </div> : <p className="text-sm text-muted-foreground">你有查看权限；修改绑定资料请联系拥有承运商编辑权限的同事。</p>}
      {data.enabled && <p className="text-sm text-muted-foreground">更换账号或服务前请先暂停。更换账号还需处理完现有待处理运单。</p>}
      {dirty && <p role="status" className="text-sm text-muted-foreground">资料尚未保存，保存后将重新检查开通状态。</p>}
    </form>
    <ConfirmDialog open={confirmUnbind} title="解绑月结账号" description={`将清除「${data.carrierName}」在本系统保存的月结账号和常用服务，保留承运商及历史订单。不会解除快递官网授权。有待处理运单时无法解绑。`} confirmText="确认解绑" variant="destructive" loading={saving} onConfirm={() => void unbind()} onCancel={() => setConfirmUnbind(false)} />
    <aside className="min-w-0 border-t pt-6 lg:border-t-0 lg:pt-0" aria-label="账号开通进度">
      <h2 className="text-base font-semibold">开通进度</h2>
      <ol className="mt-5 space-y-5">{steps.map(step => <li key={step.title} className="flex items-start gap-3">{step.done ? <CheckCircle2 aria-label="已完成" className="mt-0.5 size-5 shrink-0 text-primary" /> : <Circle aria-label="待完成" className="mt-0.5 size-5 shrink-0 text-muted-foreground" />}<div><p className="text-sm font-medium">{step.title}</p><p className="mt-1 text-sm leading-6 text-muted-foreground">{step.description}</p></div></li>)}</ol>
      <div className="mt-6 border-t pt-4 text-sm leading-6 text-muted-foreground"><p>此处显示系统准备状态。官网短信登录和月结账号授权由快递公司办理；保存账号不代表官方授权成功。</p><a className="mt-2 inline-flex items-center gap-1 font-medium text-primary underline-offset-4 hover:underline" href={data.platformCode === 'sf' ? 'https://qiao.sf-express.com/' : 'https://dop.deppon.com/'} target="_blank" rel="noopener noreferrer">打开{company}官方平台<ExternalLink className="size-4" /></a></div>
    </aside>
  </div>
}
