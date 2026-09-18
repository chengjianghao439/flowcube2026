// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { expect, test, vi } from 'vitest'
import CarriersPage from './index'
import type { Carrier } from '@/types/carriers'
const api = vi.hoisted(() => ({ createCarrierApi: vi.fn().mockResolvedValue({ id: 7 }), updateCarrierApi: vi.fn(), getCarriersApi: vi.fn(), deleteCarrierApi: vi.fn() }))
vi.mock('@/api/carriers', () => api)
vi.mock('@/components/shared/BaseCrudPage', () => ({ default: (props: { onOpen: (row: Carrier | null) => void; renderForm: (row: Carrier | null) => React.ReactNode; submitForm: (row: Carrier | null) => Promise<unknown> }) => <div><button onClick={() => props.onOpen(null)}>新建</button>{props.renderForm(null)}<button onClick={() => void props.submitForm(null)}>提交</button></div> }))
// Select 用一个真实 <select> 代替：选项直接来自 SelectItem 的 value，
// 这样「把下拉置成某个值」是在驱动真实受控选项，而不是设一个不存在的 value（那样 select.value 会变空）。
vi.mock('@/components/ui/select', () => ({
  Select: ({ children, value, onValueChange }: { children: React.ReactNode; value: string; onValueChange: (v: string) => void }) =>
    <div><select aria-label="选择平台" value={value} onChange={e => onValueChange(e.target.value)}>{children}</select></div>,
  SelectTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ children, value }: { children: React.ReactNode; value: string }) => <option value={value}>{children}</option>,
}))

async function render() {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host)
  const client = new QueryClient()
  await act(async () => root.render(<MemoryRouter><QueryClientProvider client={client}><CarriersPage /></QueryClientProvider></MemoryRouter>))
  const selects = [...host.querySelectorAll('select')]
  return {
    host,
    // 平台下拉 /「电子面单取号」下拉都通过所在行的文案定位，避免依赖 DOM 顺序
    pick: (label: string) => selects.find(s => s.parentElement?.parentElement?.textContent?.includes(label))!,
    submit: async () => act(async () => [...host.querySelectorAll('button')].find(b => b.textContent === '提交')!.click()),
    close: async () => { await act(async () => root.unmount()); host.remove(); client.clear() },
  }
}

test('顺丰/德邦只提交「选了哪家快递公司」，账号资料交给绑定页', async () => {
  const h = await render()
  try {
    expect(h.host.textContent).toContain('快递公司 / 对接平台')
    await act(async () => { const p = h.pick('快递公司 / 对接平台'); p.value = 'sf'; p.dispatchEvent(new Event('change', { bubbles: true })) })
    // 直连平台的账号资料改为只读 + 跳转，不再提供可编辑输入
    expect(h.host.textContent).toContain('去管理月结账号')
    expect(h.host.textContent).toContain('在「快递账号绑定」页维护')
    await h.submit()
    const [payload] = api.createCarrierApi.mock.calls.at(-1)!
    expect(payload).toMatchObject({ platformCode: 'sf' })
    // 这几个字段在承运商管理页提交会被后端 400（CARRIER_ACCOUNT_FIELDS_MOVED），前端不得再发
    for (const key of ['waybillEnabled', 'monthlyAccount', 'credentialRef', 'netSiteCode', 'shippingProduct', 'shippingDeliveryType']) {
      expect(payload).not.toHaveProperty(key)
    }
  } finally { await h.close() }
})

test('非直连平台仍保留高级入口：快递鸟可在此填写凭据引用与取号开关', async () => {
  const h = await render()
  try {
    await act(async () => { const p = h.pick('快递公司 / 对接平台'); p.value = 'kdniao'; p.dispatchEvent(new Event('change', { bubbles: true })) })
    expect(h.host.textContent).not.toContain('去管理月结账号')
    await act(async () => { const t = h.pick('电子面单取号'); t.value = '1'; t.dispatchEvent(new Event('change', { bubbles: true })) })
    await h.submit()
    const [payload] = api.createCarrierApi.mock.calls.at(-1)!
    expect(payload).toMatchObject({ platformCode: 'kdniao', waybillEnabled: true })
    expect(payload).toHaveProperty('credentialRef')
  } finally { await h.close() }
})
