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
function button(host: HTMLElement, text: string) {
  return Array.from(host.querySelectorAll('button')).find(b => b.textContent?.trim() === text)
}
test('缺少接口配置时明确显示待开通；仓库表单不采集密钥、技术引用、重量或短信验证码', async () => {
  const h = await render()
  try {
    expect(h.host.textContent).toContain('快递接口未开通')
    expect(h.host.querySelectorAll('[role="status"]')).toHaveLength(1)
    expect(h.host.textContent).not.toMatch(/下一步|开通条件|部署维护人员|不是登录手机号|默认 1 kg/)
    // 默认态是只读查看：字段以文本展示，不出现可输入控件
    expect(h.host.textContent).toContain('月结账号')
    expect(h.host.textContent).not.toMatch(/密钥|凭据|重量|验证码|产品编码/)
    expect(h.host.querySelector('input')).toBeNull()
    expect(button(h.host, '编辑')).toBeDefined()
    expect(button(h.host, '启用自动下单')?.disabled).toBe(true)
  } finally { h.cleanup() }
})
test('保存账号与启用是两个动作，保存资料不会自动下单', async () => {
  const h = await render({ ...base, monthlyAccount: 'M001' })
  try {
    expect(h.host.querySelector('input')).toBeNull()
    await act(async () => { button(h.host, '编辑')!.click() })
    expect(h.host.querySelector<HTMLInputElement>('#binding-monthly')!.value).toBe('M001')
    await act(async () => { button(h.host, '保存修改')!.click() })
    expect(h.save).toHaveBeenCalledOnce()
    expect(h.save.mock.calls[0][0]).toMatchObject({ monthlyAccount: 'M001', enabled: false, revision: base.revision })
    expect(h.save.mock.calls[0][0]).not.toHaveProperty('credentialRef')
    // 保存成功后自动回到只读默认态（页面状态变化本身就是反馈）
    expect(h.host.querySelector('input')).toBeNull()
    expect(button(h.host, '编辑')).toBeDefined()
  } finally { h.cleanup() }
})
test('默认只读；编辑态可改且显示未保存；取消编辑丢弃改动', async () => {
  const h = await render({ ...base, monthlyAccount: 'M001' })
  try {
    expect(h.host.querySelector('input')).toBeNull()
    await act(async () => { button(h.host, '编辑')!.click() })
    expect(h.host.textContent).toContain('编辑中')
    const input = h.host.querySelector<HTMLInputElement>('#binding-monthly')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'NEW-ACCOUNT')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(h.host.textContent).toContain('未保存')
    await act(async () => { button(h.host, '取消编辑')!.click() })
    expect(h.host.querySelector('input')).toBeNull()
    expect(h.host.textContent).toContain('M001')
    expect(h.save).not.toHaveBeenCalled()
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
test('只有查看权限不能修改；已启用账号须先暂停再编辑', async () => {
  const readonly = await render(base, false)
  try {
    expect(readonly.host.querySelector('input')).toBeNull()
    expect(readonly.host.querySelector('button[type="submit"]')).toBeNull()
    expect(button(readonly.host, '编辑')).toBeUndefined()
    expect(readonly.host.textContent).toContain('查看权限')
  } finally { readonly.cleanup() }
  const h = await render({ ...base, monthlyAccount: 'M001', enabled: true })
  try {
    expect(button(h.host, '编辑')).toBeUndefined()
    const pause = button(h.host, '暂停自动下单')!
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
