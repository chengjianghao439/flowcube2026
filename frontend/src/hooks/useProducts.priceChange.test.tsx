// @vitest-environment jsdom
//
// 改价审批完成后的商品页面新鲜度（§18 可见性修复的必要配套）。
//
// 这是**行为测试**（不是扫源码文本）：用一个与生产相同 staleTime 的真实 QueryClient 渲染
// `useProduct(id)`，先取到旧的 labelSalePrice，再让「审批完成」发生——断言页面**真的**重新取到
// 新价。若失效逻辑被摘掉，由于 staleTime 未过，页面会继续显示旧值，第一条用例即变红。
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { useProduct, invalidateAfterPriceChange } from './useProducts'
import { getProductApi } from '@/api/products'

vi.mock('@/api/products', () => ({ getProductApi: vi.fn() }))

let host: HTMLDivElement, root: Root, client: QueryClient
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  host = document.createElement('div'); root = createRoot(host)
  // 与生产同口径：staleTime 5min —— 不主动失效就会继续用旧缓存
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 1000 * 60 * 5 } } })
  vi.mocked(getProductApi).mockReset()
})
afterEach(() => { act(() => root.unmount()); client.clear() })

function Probe({ id }: { id: number }) {
  const { data } = useProduct(id)
  return <span>{data ? `${data.salePrice} / ${data.labelSalePrice}` : '-'}</span>
}
async function render(id: number) {
  await act(async () => {
    root.render(<QueryClientProvider client={client}><Probe id={id} /></QueryClientProvider>)
  })
  await vi.waitFor(() => expect(host.textContent).not.toBe('-'))
}

test('★ 审批完成（finished）后，商品页面取到新的 labelSalePrice，而不是 5min 内的旧缓存', async () => {
  vi.mocked(getProductApi).mockResolvedValue({ id: 9, salePrice: 110, labelSalePrice: 110 } as never)
  await render(9)
  expect(host.textContent).toBe('110 / 110')

  // 审批改价已在服务端生效：标签销售价 200、价格A 仍 110
  vi.mocked(getProductApi).mockResolvedValue({ id: 9, salePrice: 110, labelSalePrice: 200 } as never)
  await act(async () => { invalidateAfterPriceChange(client, { finished: true }) })
  await vi.waitFor(() => expect(host.textContent).toBe('110 / 200'))
})

test('多级审批的中间步骤（finished=false）不改价格，也不刷新商品缓存', async () => {
  vi.mocked(getProductApi).mockResolvedValue({ id: 9, salePrice: 110, labelSalePrice: 110 } as never)
  await render(9)
  const callsAfterRender = vi.mocked(getProductApi).mock.calls.length

  vi.mocked(getProductApi).mockResolvedValue({ id: 9, salePrice: 110, labelSalePrice: 200 } as never)
  await act(async () => { invalidateAfterPriceChange(client, { finished: false }) })
  // 本条要证明「**没有**发生刷新」，所以不能用 waitFor 等状态变化（那会立刻通过、毫无意义）；
  // 改为断言**未被再次取数**，并留一个短窗口让可能的（错误）刷新有机会暴露。
  await act(async () => { await new Promise(r => setTimeout(r, 20)) })
  expect(vi.mocked(getProductApi).mock.calls.length).toBe(callsAfterRender)
  expect(host.textContent).toBe('110 / 110')
})
