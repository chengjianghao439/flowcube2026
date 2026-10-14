// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { TabPathContext } from '@/components/layout/TabPathContext'
import ProductFormPage from './form'
const state = vi.hoisted(() => ({ allowed: false, update: vi.fn(), create: vi.fn(), permission: true }))
vi.mock('@/hooks/useGlobalPolicyWriteCapability', () => ({ useGlobalPolicyWriteCapability: () => ({ allowed: state.allowed, isAllowed: () => state.allowed, isError: false }) }))
vi.mock('@/hooks/usePermission', () => ({ usePermission: () => ({ can: () => state.permission }) }))
vi.mock('@/hooks/useProducts', () => ({ useProduct: () => ({ data: { id: 7, name: '合成商品', categoryId: 1, categoryName: '类', supplierId: 1, supplierName: '商', unit: '个', spec: '型', color: '黑', costPrice: 1, salePriceA: 1.1, salePriceB: 1.2, salePriceC: 1.3, salePriceD: 1.4, batchManaged: false, allowDecimalQty: false, safetyStock: 5, reorderPoint: 7, revision: 3, units: [], isActive: true }, isError: false, isFetchedAfterMount: true }), useCreateProduct: () => ({ mutateAsync: state.create }), useUpdateProduct: () => ({ mutateAsync: state.update }) }))
vi.mock('@/api/settings', () => ({ getSettingsApi: async () => ({ map: {} }) }))
vi.mock('@/hooks/useDirtyGuard', () => ({ useDirtyGuard: vi.fn() }))
vi.mock('./ProductPriceHistory', () => ({ ProductPriceHistory: () => null }))
vi.mock('@/components/finder', () => ({ CategoryFinder: ({ open, onConfirm }: { open: boolean; onConfirm: (v: object) => void }) => open ? <button onClick={() => onConfirm({ id: 1, name: '合成分类' })}>选分类</button> : null, SupplierFinder: ({ open, onConfirm }: { open: boolean; onConfirm: (v: object) => void }) => open ? <button onClick={() => onConfirm({ id: 1, name: '合成供应商' })}>选供应商</button> : null }))
vi.mock('@/lib/toast', () => ({ toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() } }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let root: ReturnType<typeof createRoot>, host: HTMLDivElement, client: QueryClient
function input(label: string) { return [...host.querySelectorAll('label')].find(l => l.textContent === label)!.parentElement!.querySelector<HTMLInputElement>('input')! }
async function render(path = '/products/7') { await act(async () => root.render(<QueryClientProvider client={client}><MemoryRouter><TabPathContext.Provider value={path}><ProductFormPage key={path} /></TabPathContext.Provider></MemoryRouter></QueryClientProvider>)); await act(async () => { await new Promise(r => setTimeout(r, 5)) }) }
async function save() { const b = [...host.querySelectorAll('button')].find(x => x.textContent?.includes('保存'))!; await act(async () => b.click()); await act(async () => { await new Promise(r => setTimeout(r, 5)) }) }
beforeEach(async () => { state.allowed = false; state.permission = true; state.update.mockReset(); state.create.mockReset(); state.update.mockResolvedValue(undefined); host = document.createElement('div'); document.body.append(host); root = createRoot(host); client = new QueryClient(); await render() })
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove() })
test('limited/unknown scope shows existing global values read-only and omits both keys on ordinary edit', async () => {
  expect(input('安全库存').value).toBe('5'); expect(input('补货点').value).toBe('7')
  expect(input('安全库存').disabled || input('安全库存').readOnly).toBe(true)
  await save()
  expect(state.update).toHaveBeenCalledTimes(1)
  const body = state.update.mock.calls[0][0].data
  expect(Object.hasOwn(body, 'safetyStock')).toBe(false); expect(Object.hasOwn(body, 'reorderPoint')).toBe(false)
  expect(body.revision).toBe(3); expect(body.name).toBe('合成商品')
})
test('explicit global capability and original product permission retain policy save contract', async () => {
  state.allowed = true; await render()
  expect(input('安全库存').disabled).toBe(false)
  await save()
  expect(state.update.mock.calls[0][0].data).toMatchObject({ safetyStock: 5, reorderPoint: 7, revision: 3 })
})

test('new ordinary product remains creatable without writing either global default key', async () => {
  await render('/products/new')
  const click = async (text: string) => { await act(async () => [...host.querySelectorAll('button')].find(b => b.textContent?.includes(text))!.click()) }
  await click('点击选择分类'); await click('选分类')
  await click('点击选择供应商'); await click('选供应商')
  for (const [label, value] of [['名称 *', '新合成商品'], ['单位 *', '个'], ['型号 *', '型'], ['颜色 *', '黑'], ['进价 *', '2']]) {
    const el = input(label)
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })) })
  }
  await save()
  expect(state.create).toHaveBeenCalledTimes(1)
  expect(Object.hasOwn(state.create.mock.calls[0][0], 'safetyStock')).toBe(false)
  expect(Object.hasOwn(state.create.mock.calls[0][0], 'reorderPoint')).toBe(false)
})
