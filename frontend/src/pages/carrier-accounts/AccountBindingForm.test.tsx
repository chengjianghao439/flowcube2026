// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, test, vi } from 'vitest'
import { AccountBindingForm } from './AccountBindingForm'
import type { CarrierAccountBinding } from '@/types/carriers'
const base: CarrierAccountBinding = { carrierId: 7, carrierName: '顺丰', platformCode: 'sf', monthlyAccount: '', shippingProduct: '', shippingDeliveryType: '', enabled: false, active: true, revision: 'a'.repeat(64), connectionReady: false, mode: 'sandbox', accountVerified: false, products: [], productReady: false, canEnable: false }
async function render(data = base, canEdit = true) {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host); const save = vi.fn().mockResolvedValue(undefined)
  await act(async () => root.render(<AccountBindingForm data={data} canEdit={canEdit} onSave={save} saving={false} />))
  return { host, save, cleanup: () => { act(() => root.unmount()); host.remove() } }
}
test('缺少接口配置时明确显示待开通；仓库表单不采集密钥、技术引用、重量或短信验证码', async () => {
  const h = await render()
  try {
    expect(h.host.textContent).toContain('等待管理员开通')
    const labels = Array.from(h.host.querySelectorAll('label')).map(e => e.textContent).join(' ')
    expect(labels).toContain('月结账号')
    expect(labels).not.toMatch(/密钥|凭据|重量|验证码|产品编码/)
    expect(Array.from(h.host.querySelectorAll('button')).find(b => b.textContent === '启用自动下单')?.disabled).toBe(true)
  } finally { h.cleanup() }
})
test('保存账号与启用是两个动作，保存资料不会自动下单', async () => {
  const h = await render({ ...base, monthlyAccount: 'M001' })
  try {
    const saveButton = Array.from(h.host.querySelectorAll('button')).find(b => b.textContent === '保存月结资料')!
    await act(async () => { saveButton.click() })
    expect(h.save).toHaveBeenCalledOnce()
    expect(h.save.mock.calls[0][0]).toMatchObject({ monthlyAccount: 'M001', enabled: false, revision: base.revision })
    expect(h.save.mock.calls[0][0]).not.toHaveProperty('credentialRef')
  } finally { h.cleanup() }
})
test('通过准备检查后可启用，服务显示中文名称', async () => {
  const h = await render({ ...base, monthlyAccount: 'M001', shippingProduct: '2', connectionReady: true, mode: 'production', accountVerified: true, products: [{ code: '2', label: '日常普快' }], productReady: true, canEnable: true })
  try {
    expect(h.host.textContent).toContain('日常普快')
    const enable = Array.from(h.host.querySelectorAll('button')).find(b => b.textContent === '启用自动下单')!
    expect(enable.disabled).toBe(false)
    await act(async () => { enable.click() })
    expect(h.save.mock.calls[0][0].enabled).toBe(true)
  } finally { h.cleanup() }
})
test('只有查看权限不能修改或启用，已启用账号须先暂停再编辑', async () => {
  const readonly = await render(base, false)
  try { expect(readonly.host.querySelector('input')?.disabled).toBe(true); expect(readonly.host.querySelector('button[type="submit"]')).toBeNull() } finally { readonly.cleanup() }
  const h = await render({ ...base, enabled: true })
  try {
    expect(h.host.querySelector('input')?.disabled).toBe(true)
    const pause = Array.from(h.host.querySelectorAll('button')).find(b => b.textContent === '暂停自动下单')!
    await act(async () => { pause.click() }); expect(h.save.mock.calls[0][0]).toEqual({ action: 'pause', revision: base.revision })
  } finally { h.cleanup() }
})

test('解绑需确认且保留仅本系统解绑的说明；取消不提交', async () => {
  const h = await render({ ...base, monthlyAccount: 'M001' })
  try {
    const unbind = Array.from(h.host.querySelectorAll('button')).find(b => b.textContent === '解绑账号')
    expect(unbind).toBeDefined()
    await act(async () => unbind!.click())
    expect(document.body.textContent).toContain('不会解除快递官网授权')
    const cancel = Array.from(document.querySelectorAll('button')).find(b => b.textContent === '取消')!
    await act(async () => cancel.click())
    expect(h.save).not.toHaveBeenCalled()
    await act(async () => unbind!.click())
    const confirm = Array.from(document.querySelectorAll('button')).find(b => b.textContent === '确认解绑')!
    await act(async () => confirm.click())
    expect(h.save).toHaveBeenCalledWith({ action: 'unbind', revision: base.revision })
  } finally { h.cleanup() }
})
