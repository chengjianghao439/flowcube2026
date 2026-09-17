import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { EditModeBadge, UnsavedBadge } from '@/components/shared/EditModeBadge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { CarrierAccountBinding, SaveCarrierAccountBinding, PauseCarrierAccountBinding } from '@/types/carriers'

/** 德邦送货方式编码 → 中文（只读展示用，与编辑态下拉选项一致） */
const DELIVERY_LABELS: Record<string, string> = { '1': '自提', '3': '送货不上楼', '4': '送货上楼' }

export function AccountBindingForm({ data, onSave, canEdit, saving, onDirtyChange }: {
  onDirtyChange?: (dirty: boolean) => void
  data: CarrierAccountBinding; onSave: (input: SaveCarrierAccountBinding | PauseCarrierAccountBinding) => Promise<unknown>; canEdit: boolean; saving: boolean
}) {
  const [monthlyAccount, setMonthly] = useState(data.monthlyAccount)
  const [shippingProduct, setProduct] = useState(data.shippingProduct)
  const [shippingDeliveryType, setDelivery] = useState(data.shippingDeliveryType)
  const [error, setError] = useState('')
  const [confirmUnbind, setConfirmUnbind] = useState(false)
  /** 默认态=只读查看已有绑定；点「编辑」才可改，保存成功后自动回到默认态 */
  const [editing, setEditing] = useState(false)
  /** 最新输入（保存回执判断用）：与提交内容一致才回到默认态 */
  const latestRef = useRef({ monthlyAccount, shippingProduct, shippingDeliveryType })
  latestRef.current = { monthlyAccount, shippingProduct, shippingDeliveryType }
  const dirty = monthlyAccount.trim() !== data.monthlyAccount || shippingProduct !== data.shippingProduct || shippingDeliveryType !== data.shippingDeliveryType
  useEffect(() => { onDirtyChange?.(dirty) }, [dirty, onDirtyChange])
  // 编辑态下仍按原规则锁定：无编辑权限、保存中、或自动下单已启用（需先暂停）
  const locked = !canEdit || saving || data.enabled || !editing
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
    const submitted = { monthlyAccount: monthlyAccount.trim(), shippingProduct, shippingDeliveryType }
    try {
      await onSave(data.enabled && !enabled ? { action: 'pause', revision: data.revision } : { platformCode: data.platformCode, ...submitted, enabled, revision: data.revision })
      // 保存成功后回到默认（只读）态——页面状态变化本身就是「已保存」的反馈；
      // 保存期间又有新输入时留在编辑态，避免把后续草稿当成已保存。
      const now = latestRef.current
      if (now.monthlyAccount.trim() === submitted.monthlyAccount
        && now.shippingProduct === submitted.shippingProduct
        && now.shippingDeliveryType === submitted.shippingDeliveryType) setEditing(false)
    } catch (e) { setError(e instanceof Error ? e.message : '保存失败，请刷新状态后重试') }
  }
  /** 取消编辑：丢弃改动，回到默认（只读）态并显示已保存的值 */
  function cancelEdit() {
    setMonthly(data.monthlyAccount); setProduct(data.shippingProduct); setDelivery(data.shippingDeliveryType); setError(''); setEditing(false)
  }
  async function unbind() {
    setError('')
    try { await onSave({ action: 'unbind', revision: data.revision }); setConfirmUnbind(false) }
    catch (e) { setError(e instanceof Error ? e.message : '解绑失败，请刷新后重试'); setConfirmUnbind(false) }
  }
  const savedProductLabel = data.products.find(p => p.code === data.shippingProduct)?.label
    || (data.shippingProduct ? '已保存的服务（待管理员确认名称）' : '')
  return <div className="max-w-2xl">
    <form className="min-w-0 space-y-5" onSubmit={e => { e.preventDefault(); void submit(false) }}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="inline-flex flex-wrap items-center gap-2">
          <h2 className="text-base font-semibold">{company}月结资料</h2>
          {editing && <EditModeBadge />}
          <UnsavedBadge show={dirty} />
        </span>
        <p role="status" className="text-sm text-muted-foreground">{status}</p>
      </div>
      {editing ? (
        <>
          <div className="space-y-2"><Label htmlFor="binding-monthly">月结账号</Label><Input id="binding-monthly" value={monthlyAccount} onChange={e => setMonthly(e.target.value)} disabled={locked} maxLength={data.platformCode === 'sf' ? 20 : 32} autoComplete="off" placeholder="填写快递公司提供的月结账号" /></div>
          <div className="space-y-2"><Label htmlFor="binding-product">常用发货服务</Label>
            <Select value={shippingProduct || '__empty__'} onValueChange={v => setProduct(v === '__empty__' ? '' : v)} disabled={locked || !data.products.length}>
              <SelectTrigger id="binding-product"><SelectValue placeholder="选择常用服务" /></SelectTrigger>
              <SelectContent><SelectItem value="__empty__">请选择常用服务</SelectItem>{data.products.map(p => <SelectItem key={p.code} value={p.code}>{p.label}</SelectItem>)}{shippingProduct && !data.products.some(p => p.code === shippingProduct) && <SelectItem value={shippingProduct}>已保存的服务（待管理员确认名称）</SelectItem>}</SelectContent>
            </Select>
            {!data.products.length && <p className="text-sm text-muted-foreground">暂无可选服务</p>}
          </div>
          {data.platformCode === 'deppon' && <div className="space-y-2"><Label htmlFor="binding-delivery">送货方式</Label><Select value={shippingDeliveryType || '__empty__'} onValueChange={v => setDelivery(v === '__empty__' ? '' : v)} disabled={locked}><SelectTrigger id="binding-delivery"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="__empty__">请选择送货方式</SelectItem><SelectItem value="1">自提</SelectItem><SelectItem value="3">送货不上楼</SelectItem><SelectItem value="4">送货上楼</SelectItem></SelectContent></Select></div>}
        </>
      ) : (
        /* 默认态：只读展示已保存的绑定资料，与编辑态（可输入表单）明显不同 */
        <dl className="space-y-4 text-sm">
          <div>
            <dt className="text-helper">月结账号</dt>
            <dd className="mt-0.5 font-medium">{data.monthlyAccount || <span className="font-normal text-muted-foreground">未绑定</span>}</dd>
          </div>
          <div>
            <dt className="text-helper">常用发货服务</dt>
            <dd className="mt-0.5 font-medium">{savedProductLabel || <span className="font-normal text-muted-foreground">未选择</span>}</dd>
          </div>
          {data.platformCode === 'deppon' && (
            <div>
              <dt className="text-helper">送货方式</dt>
              <dd className="mt-0.5 font-medium">{DELIVERY_LABELS[data.shippingDeliveryType] || <span className="font-normal text-muted-foreground">未选择</span>}</dd>
            </div>
          )}
        </dl>
      )}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {canEdit ? <div className="flex flex-wrap gap-3">
        {data.enabled ? (
          <Button type="button" variant="outline" disabled={saving} onClick={() => void submit(false)}>暂停自动下单</Button>
        ) : editing ? (
          <>
            <Button type="submit" disabled={saving}>{saving ? '正在保存…' : '保存修改'}</Button>
            <Button type="button" variant="outline" disabled={saving} onClick={cancelEdit}>取消编辑</Button>
          </>
        ) : (
          <>
            <Button type="button" variant="outline" disabled={saving} onClick={() => setEditing(true)}>编辑</Button>
            {data.monthlyAccount && <Button type="button" variant="ghost" disabled={saving} onClick={() => setConfirmUnbind(true)}>解绑账号</Button>}
            <Button type="button" variant="outline" disabled={saving || !data.canEnable} onClick={() => void submit(true)}>启用自动下单</Button>
          </>
        )}
      </div> : <p className="text-sm text-muted-foreground">你有查看权限；修改绑定资料请联系拥有承运商编辑权限的同事。</p>}
      {dirty && <p role="status" className="text-sm text-muted-foreground">有未保存的修改</p>}
    </form>
    <ConfirmDialog open={confirmUnbind} title="解绑月结账号" description={`将清除「${data.carrierName}」在本系统保存的月结账号和常用服务，保留承运商及历史订单。不会解除快递官网授权。有待处理运单时无法解绑。`} confirmText="确认解绑" variant="destructive" loading={saving} onConfirm={() => void unbind()} onCancel={() => setConfirmUnbind(false)} />

  </div>
}
