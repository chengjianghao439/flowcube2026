// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { expect, test, vi } from 'vitest'
import CarrierAccountsPage from './index'
const api = vi.hoisted(() => ({ getCarriersApi: vi.fn(), getCarrierAccountBindingApi: vi.fn(), saveCarrierAccountBindingApi: vi.fn(), createCarrierAccountApi: vi.fn(), deleteCarrierApi: vi.fn(), can: vi.fn(() => true) }))
vi.mock('@/api/carriers', () => api)
vi.mock('@/hooks/usePermission', () => ({ usePermission: () => ({ can: api.can }) }))
vi.mock('@/components/shared/PageHeader', () => ({ default: ({ title, actions }: { title: string; actions: React.ReactNode }) => <header>{title}{actions}</header> }))
vi.mock('@/lib/toast', () => ({ toast: { success: vi.fn() } }))

test('单页提供新增、选择现有账号、删除入口，并按权限隐藏新增删除', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  api.getCarriersApi.mockResolvedValue({ list: [{ id: 7, name: '测试顺丰', code: 'CAR000007', isActive: true, platformCode: 'sf', monthlyAccount: null, waybillEnabled: false }], pagination: { page: 1, pageSize: 100, total: 1 } })
  api.getCarrierAccountBindingApi.mockResolvedValue({ carrierId: 7, carrierName: '测试顺丰', platformCode: 'sf', monthlyAccount: '', revision: 'a'.repeat(64), products: [], shippingProduct: '', shippingDeliveryType: '', enabled: false, active: true })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host)
  const draw = () => root.render(<MemoryRouter><QueryClientProvider client={client}><CarrierAccountsPage /></QueryClientProvider></MemoryRouter>)
  try {
    await act(async () => draw())
    await act(async () => { await new Promise(r => setTimeout(r, 20)) })
    expect(host.textContent).toContain('新增账号')
    await act(async () => { Array.from(host.querySelectorAll('button')).find(b => b.textContent?.includes('测试顺丰'))!.click(); await new Promise(r => setTimeout(r, 20)) })
    expect(host.textContent).toContain('删除承运商')
    await act(async () => Array.from(host.querySelectorAll('button')).find(b => b.textContent === '新增账号')!.click())
    expect(host.querySelector('#new-account-name')).not.toBeNull()
    api.can.mockReturnValue(false)
    await act(async () => draw())
    expect(Array.from(host.querySelectorAll('button')).some(b => b.textContent === '新增账号')).toBe(false)
    expect(host.querySelector('#new-account-name')).toBeNull()
  } finally { await act(async () => root.unmount()); host.remove(); client.clear(); api.can.mockReturnValue(true) }
})
