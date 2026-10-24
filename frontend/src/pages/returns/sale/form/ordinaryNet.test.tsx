// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, expect, test, vi } from 'vitest'
import SaleReturnFormPage from './index'
import { TabPathContext } from '@/components/layout/TabPathContext'
import { useAuthStore } from '@/store/authStore'
import { toast } from '@/lib/toast'

const api = vi.hoisted(() => ({ source: vi.fn(), create: vi.fn(), detail: vi.fn(), defaults: { baseURL: '/a' } }))
vi.mock('@/api/client', () => ({ default: { defaults: api.defaults } }))
vi.mock('@/api/returns', () => ({ getSaleReturnSourceOrderApi: api.source, createSaleReturnApi: api.create, getSaleReturnDetailApi: api.detail, confirmSaleReturnApi: vi.fn(), cancelSaleReturnApi: vi.fn() }))
vi.mock('@/components/finder', () => ({ CustomerFinder: () => null, ProductFinder: () => null }))
vi.mock('@/components/shared/WarehouseSelect', () => ({ WarehouseSelect: () => <span>仓一</span> }))
// No event-history component is mounted by these independent form/detail tests.
vi.mock('@/components/shared/OrderDetailSections', () => ({ OrderDetailSections: ({ children }: { children: React.ReactNode }) => <>{children}</> }))
vi.mock('@/hooks/useProductQtyPolicies', () => ({ useProductQtyPolicies: () => (id: number) => id !== 2 }))
vi.mock('@/hooks/useDirtyGuard', () => ({ useDirtyGuard: () => {} }))
vi.mock('@/hooks/useWorkspaceTabTitle', () => ({ useWorkspaceTabTitle: () => {} }))
vi.mock('@/lib/toast', () => ({ toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() } }))

const source = {
  id: 80, orderNo: 'SO80', customerId: 1, customerName: '原客户', warehouseId: 1, warehouseName: '仓一',
  moneyModel: 'ordinary-net-v1', netAmountStatus: 'save_to_determine',
  items: [
    { sourceItemId: 30, productId: 1, productCode: 'P1', productName: '铰链', unit: '个', quantity: 10, returnedQty: 2, remainingQty: 8, unitPrice: 10.1234, amount: 101.234 },
    { sourceItemId: 31, productId: 2, productCode: 'P2', productName: '拉手', unit: '个', quantity: 4, returnedQty: 0, remainingQty: 4, unitPrice: 5, amount: 20 },
  ],
}
const path = '/returns/sale/new?sourceId=80&sourceNo=SO80'
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  sessionStorage.clear(); vi.resetAllMocks(); api.defaults.baseURL = '/a'
  api.source.mockResolvedValue(source)
  useAuthStore.getState().login('fixture', null, { id: 5, roleId: 1, permissions: ['*'] } as never)
})
async function flush() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 15)) }) }
async function mounted(route: string, run: (host: HTMLElement) => Promise<void>) {
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host), cache = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  try {
    await act(async () => root.render(<QueryClientProvider client={cache}><MemoryRouter initialEntries={[route]}><TabPathContext.Provider value={route}><SaleReturnFormPage /></TabPathContext.Provider></MemoryRouter></QueryClientProvider>)); await flush()
    await run(host)
  } finally { await act(async () => root.unmount()); cache.clear(); host.remove() }
}
async function set(input: HTMLInputElement, value: string) {
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })) })
}
async function click(host: HTMLElement, name: string) {
  const button = [...host.querySelectorAll('button')].find(button => button.textContent === name)!
  expect(button, name).toBeTruthy(); await act(async () => button.click()); await flush()
}
test('ordinary source permits partial quantity and omission without guessing discounted net amount', async () => {
  api.create.mockRejectedValue({ status: 409, code: 'SALE_RETURN_NET_BASIS_REQUIRED', message: '来源需核对' })
  await mounted(path, async host => {
    expect(host.querySelector('.desktop-page-description')?.textContent).toContain('已关联原单')
    expect(host.querySelector('.desktop-page-description')?.textContent).toContain('净冲减金额提交后核定')
    expect(host.textContent?.match(/已关联原单/g)).toHaveLength(1)
    const qty = host.querySelectorAll<HTMLInputElement>('[aria-label="退货数量"]')
    expect(qty[0].disabled).toBe(false); expect(qty[0].max).toBe('8')
    await set(qty[0], '3.25')
    await act(async () => host.querySelectorAll<HTMLButtonElement>('[aria-label="删除退货商品行"]')[1].click())
    expect(host.textContent).not.toContain('拉手')
    expect(host.textContent).toContain('原单价参考'); expect(host.textContent).toContain('提交后核定')
    expect(host.textContent).not.toContain('¥32.90')
    await click(host, '创建退货单'); await click(host, '创建退货单')
    expect(api.create).toHaveBeenCalledTimes(2)
    const [body, key, config] = api.create.mock.calls[0]
    expect(body).toMatchObject({ saleOrderId: 80, saleOrderNo: 'SO80', items: [{ sourceItemId: 30, quantity: 3.25, unitPrice: 10.1234 }] })
    expect(body.items).toHaveLength(1); expect(body.items[0]).not.toHaveProperty('amount')
    expect(api.create.mock.calls[1][1]).toBe(key); expect(key).toBeTruthy()
    expect(config).toMatchObject({ baseURL: '/a', _erpApiFallbackTried: true })
    expect((host.querySelector('[aria-label="退货数量"]') as HTMLInputElement).value).toBe('3.25')
    expect((host.querySelector('input[placeholder="输入原单号"]') as HTMLInputElement).value).toBe('SO80')
  })
})
test('ordinary partial quantity cannot exceed source remaining', async () => {
  await mounted(path, async host => {
    await set(host.querySelector('[aria-label="退货数量"]')!, '8.01'); await click(host, '创建退货单')
    expect(api.create).not.toHaveBeenCalled(); expect(host.textContent).toContain('数量最多两位小数')
  })
})
test('actual quantity input rejects a third decimal without replacing the accepted draft', async () => {
  await mounted(path, async host => {
    const input = host.querySelector<HTMLInputElement>('[aria-label="退货数量"]')!
    await set(input, '1.001')
    expect(input.value).toBe('8'); expect(toast.error).toHaveBeenCalledWith('数量最多保留两位小数')
    expect(api.create).not.toHaveBeenCalled()
  })
})
test('integer product remains integer when source quantity becomes editable', async () => {
  await mounted(path, async host => {
    const input = host.querySelectorAll<HTMLInputElement>('[aria-label="退货数量"]')[1]
    await set(input, '1.5')
    expect(input.value).toBe('4'); expect(toast.error).toHaveBeenCalledWith('该商品数量只能是整数')
    expect(api.create).not.toHaveBeenCalled()
  })
})
test.each([
  { status: 1, basis: 'estimated_net', label: '预计净冲减' },
  { status: 2, basis: 'estimated_net', label: '预计净冲减' },
  { status: 3, basis: 'executed_net', label: '实际净冲减' },
  { status: 4, basis: 'estimated_net', label: '原预计净冲减（未入账）' },
])('ordinary status $status displays authoritative cent $basis rather than gross price', async ({ status, basis, label }) => {
  api.detail.mockResolvedValue({ id: 90, returnNo: 'SR90', customerName: '原客户', warehouseName: '仓一', status, totalAmount: 0.01, moneyModel: 'ordinary-net-v1', moneyPrecision: 2, cashPolicy: 'cash-cents-v1', amountBasis: basis, createdAt: '2026-10-01', items: [{ id: 1, ...source.items[0], quantity: 1, entryUnit: '箱', entryQty: 1, conversionRate: 10, amount: 0.01 }] })
  await mounted('/returns/sale/90', async host => {
    expect(host.textContent).toContain(label); expect(host.textContent).toContain('¥0.01'); expect(host.textContent).not.toContain('¥0.0100')
    expect(host.textContent).toContain('原单价参考'); expect(host.textContent).toContain('¥10.1234/个')
    expect(host.textContent).not.toContain('¥0.00/箱')
  })
})
test.each([{}, { moneyModel: 'ordinary-net-v1' }, { amountBasis: 'executed_net' }])('historical or incomplete marker %j retains historical amount labels', async marker => {
  api.detail.mockResolvedValue({ id: 90, returnNo: 'SR90', status: 3, totalAmount: 10, createdAt: '2026-10-01', items: [{ id: 1, ...source.items[0], quantity: 1, amount: 10 }], ...marker })
  await mounted('/returns/sale/90', async host => { expect(host.textContent).toContain('合计金额'); expect(host.textContent).not.toContain('实际净冲减') })
})

test('cash total stays two places while the authoritative original unit price retains eight places', async()=>{
 api.detail.mockResolvedValue({id:90,returnNo:'SR90',status:3,totalAmount:.01,moneyModel:'ordinary-net-v1',moneyPrecision:2,cashPolicy:'cash-cents-v1',amountBasis:'executed_net',createdAt:'2026-10-01',items:[{id:1,...source.items[0],quantity:1,unitPrice:10.12345678,amount:.01}]})
 await mounted('/returns/sale/90',async host=>{expect(host.textContent).toContain('¥10.12345678/个');expect(host.textContent).toContain('实际净冲减');expect(host.textContent).toContain('¥0.01');expect(host.textContent).not.toContain('¥0.0100')})
})

test.each([{}, { moneyPrecision: 2 }, { cashPolicy: 'cash-cents-v1' }])('legacy refund without both cash proof fields retains exact subcent amount: %j', async proof => {
  api.detail.mockResolvedValue({ id: 90, returnNo: 'SR90', customerName: '原客户', warehouseName: '仓一', status: 3, totalAmount: 0.0067, moneyModel: 'ordinary-net-v1', amountBasis: 'executed_net', ...proof, createdAt: '2026-10-01', items: [{ id: 1, ...source.items[0], quantity: 1, amount: 0.0067 }] })
  await mounted('/returns/sale/90', async host => {
    expect(host.textContent).toContain('¥0.0067（待核）'); expect(host.textContent).not.toContain('¥0.01')
    expect(host.textContent).toContain('¥10.1234/个')
  })
})
