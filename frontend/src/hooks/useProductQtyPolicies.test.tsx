// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { useProductQtyPolicies } from './useProductQtyPolicies'
import { getProductQtyPoliciesApi } from '@/api/products'
vi.mock('@/api/products', () => ({ getProductQtyPoliciesApi: vi.fn() }))
let host: HTMLDivElement, root: Root, client: QueryClient
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); host = document.createElement('div'); root = createRoot(host); client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); vi.mocked(getProductQtyPoliciesApi).mockReset().mockImplementation(async ids => ids.map(id => ({ id, allowDecimal: false }))) })
afterEach(() => { act(() => root.unmount()); client.clear() })
function Probe({ ids }: { ids: Array<number | null | undefined> }) { const allowed = useProductQtyPolicies(ids); return <span>{String(allowed(2))}</span> }
async function render(ids: Array<number | null | undefined>) { await act(async () => { root.render(<QueryClientProvider client={client}><Probe ids={ids} /></QueryClientProvider>); await new Promise(r => setTimeout(r, 20)) }); await act(async () => { await new Promise(r => setTimeout(r, 20)) }) }

test('空商品列表不查询，混合列表去掉 null、零、负数与重复 ID', async () => {
  await render([null, undefined, 0, -1, NaN])
  expect(getProductQtyPoliciesApi).not.toHaveBeenCalled()
  await render([2, null, 0, 2, 3])
  expect(getProductQtyPoliciesApi).toHaveBeenCalledWith([2, 3])
})
test('商品保存失效 products 缓存时同步刷新数量策略', async () => {
  await render([2])
  expect(host.textContent).toBe('false')
  vi.mocked(getProductQtyPoliciesApi).mockResolvedValue([{ id: 2, allowDecimal: true }])
  await act(async () => { await client.invalidateQueries({ queryKey: ['products'] }); await new Promise(r => setTimeout(r, 20)) })
  expect(host.textContent).toBe('true')
})
test('超过服务端500条上限时分批取齐，末尾商品仍有精度策略', async () => {
  await render(Array.from({ length: 501 }, (_, i) => i + 1))
  expect(vi.mocked(getProductQtyPoliciesApi).mock.calls.map(([ids]) => ids.length)).toEqual([500, 1])
})
