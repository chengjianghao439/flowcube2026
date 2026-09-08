// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, useNavigate } from 'react-router-dom'
import { expect, test, vi } from 'vitest'
import CarrierAccountsPage from './index'
const api = vi.hoisted(() => ({ getCarriersApi: vi.fn(), getCarrierAccountBindingApi: vi.fn(), saveCarrierAccountBindingApi: vi.fn(), createCarrierAccountApi: vi.fn(), deleteCarrierApi: vi.fn(), can: vi.fn(() => true) }))
vi.mock('@/api/carriers', () => api)
vi.mock('@/hooks/usePermission', () => ({ usePermission: () => ({ can: api.can }) }))
vi.mock('@/components/shared/PageHeader', () => ({ default: ({ title, actions }: { title: string; actions: React.ReactNode }) => <header>{title}{actions}</header> }))
vi.mock('@/lib/toast', () => ({ toast: { success: vi.fn() } }))

function AccountLinks() {
  const navigate = useNavigate()
  return <><button onClick={() => navigate('/carrier-accounts?carrierId=7')}>打开账号7</button><button onClick={() => navigate('/carrier-accounts?carrierId=8')}>打开账号8</button><CarrierAccountsPage /></>
}

test('单页支持新增和选择账号，拥有删除权限也不显示删除入口', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  api.getCarriersApi.mockResolvedValue({ list: [{ id: 7, name: '测试顺丰', code: 'CAR000007', isActive: true, platformCode: 'sf', monthlyAccount: null, waybillEnabled: false }], pagination: { page: 1, pageSize: 100, total: 1 } })
  api.getCarrierAccountBindingApi.mockResolvedValue({ carrierId: 7, carrierName: '测试顺丰', platformCode: 'sf', monthlyAccount: '', revision: 'a'.repeat(64), products: [], shippingProduct: '', shippingDeliveryType: '', enabled: false, active: true })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host)
  const draw = () => root.render(<MemoryRouter><QueryClientProvider client={client}><CarrierAccountsPage /></QueryClientProvider></MemoryRouter>)
  try {
    await act(async () => draw())
    await act(async () => { await new Promise(r => setTimeout(r, 20)) })
    expect(host.textContent).toContain('新增承运商账号')
    await act(async () => { Array.from(host.querySelectorAll('button')).find(b => b.textContent?.includes('测试顺丰'))!.click(); await new Promise(r => setTimeout(r, 20)) })
    expect(host.textContent).not.toContain('删除承运商')
    expect(host.textContent).not.toContain('删除仅适用于')
    expect(api.deleteCarrierApi).not.toHaveBeenCalled()
    await act(async () => Array.from(host.querySelectorAll('button')).find(b => b.textContent === '新增承运商账号')!.click())
    expect(host.querySelector('#new-account-name')).not.toBeNull()
    api.can.mockReturnValue(false)
    await act(async () => draw())
    expect(Array.from(host.querySelectorAll('button')).some(b => b.textContent === '新增承运商账号')).toBe(false)
    expect(host.querySelector('#new-account-name')).toBeNull()
  } finally { await act(async () => root.unmount()); host.remove(); client.clear(); api.can.mockReturnValue(true) }
})

test('承运商修改后绑定资料同步刷新，已有草稿保留并沿用原版本校验', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const row = { id: 7, name: '测试顺丰', code: 'CAR000007', isActive: true, platformCode: 'sf', monthlyAccount: 'M001', waybillEnabled: false }
  let detail = { carrierId: 7, carrierName: row.name, platformCode: 'sf', monthlyAccount: 'M001', revision: 'a'.repeat(64), products: [], shippingProduct: '', shippingDeliveryType: '', enabled: false, active: true }
  api.getCarriersApi.mockImplementation(async () => ({ list: [row], pagination: { page: 1, pageSize: 100, total: 1 } }))
  api.getCarrierAccountBindingApi.mockImplementation(async () => detail)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host)
  const settle = () => new Promise(r => setTimeout(r, 25))
  try {
    await act(async () => root.render(<MemoryRouter initialEntries={['/carrier-accounts?carrierId=7']}><QueryClientProvider client={client}><CarrierAccountsPage /></QueryClientProvider></MemoryRouter>))
    await act(settle)
    await act(settle)
    expect(host.querySelector('#binding-company')).toBeNull()
    expect(host.textContent).toContain('承运商资料已带入')
    detail = { ...detail, monthlyAccount: 'M002', revision: 'b'.repeat(64) }; row.monthlyAccount = 'M002'
    await act(async () => { await client.invalidateQueries({ queryKey: ['carriers'] }); await settle() })
    expect(host.querySelector<HTMLInputElement>('#binding-monthly')!.value).toBe('M002')
    await act(async () => { const el = host.querySelector<HTMLInputElement>('#binding-monthly')!; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, 'MY-DRAFT'); el.dispatchEvent(new Event('input', { bubbles: true })) })
    detail = { ...detail, monthlyAccount: 'M003', revision: 'c'.repeat(64) }; row.monthlyAccount = 'M003'
    await act(async () => { await client.invalidateQueries({ queryKey: ['carriers'] }); await settle() })
    expect(host.querySelector<HTMLInputElement>('#binding-monthly')!.value).toBe('MY-DRAFT')
    api.saveCarrierAccountBindingApi.mockRejectedValueOnce(new Error('资料已变更'))
    await act(async () => [...host.querySelectorAll('button')].find(b => b.textContent === '保存月结资料')!.click())
    expect(api.saveCarrierAccountBindingApi).toHaveBeenLastCalledWith(7, expect.objectContaining({ monthlyAccount: 'MY-DRAFT', revision: 'b'.repeat(64) }))
  } finally { await act(async () => root.unmount()); host.remove(); client.clear() }
})

test('已打开的账号页响应承运商跳转，有草稿时可取消或确认切换', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const rows = [7, 8].map(id => ({ id, name: `测试顺丰${id}`, code: `CAR${id}`, isActive: true, platformCode: 'sf', monthlyAccount: `M${id}`, waybillEnabled: false }))
  api.getCarriersApi.mockResolvedValue({ list: rows, pagination: { page: 1, pageSize: 100, total: 2 } })
  api.getCarrierAccountBindingApi.mockImplementation(async (id: number) => ({ carrierId: id, carrierName: `测试顺丰${id}`, platformCode: 'sf', monthlyAccount: `M${id}`, revision: String(id).repeat(64), products: [], shippingProduct: '', shippingDeliveryType: '', enabled: false, active: true }))
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host)
  const settle = () => new Promise(r => setTimeout(r, 25))
  const click = async (label: string) => {
    await act(async () => { [...document.querySelectorAll('button')].find(b => b.textContent === label)!.click(); await settle() })
    await act(settle)
  }
  try {
    await act(async () => root.render(<MemoryRouter initialEntries={['/carrier-accounts?carrierId=7']}><QueryClientProvider client={client}><AccountLinks /></QueryClientProvider></MemoryRouter>))
    await act(settle); await act(settle)
    await click('打开账号8')
    expect(host.querySelector<HTMLInputElement>('#binding-monthly')!.value).toBe('M8')
    await act(async () => { const el = host.querySelector<HTMLInputElement>('#binding-monthly')!; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, 'DRAFT8'); el.dispatchEvent(new Event('input', { bubbles: true })) })
    await click('打开账号7')
    expect(document.body.textContent).toContain('放弃尚未保存的资料？')
    await click('取消')
    expect(host.querySelector<HTMLInputElement>('#binding-monthly')!.value).toBe('DRAFT8')
    await click('打开账号7')
    await click('放弃并继续')
    expect(host.querySelector<HTMLInputElement>('#binding-monthly')!.value).toBe('M7')
  } finally { await act(async () => root.unmount()); host.remove(); client.clear() }
})
