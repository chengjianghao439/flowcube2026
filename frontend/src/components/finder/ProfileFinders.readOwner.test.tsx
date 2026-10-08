// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, expect, test, vi } from 'vitest'
import { CategoryFinder } from './CategoryFinder'
import { SupplierFinder } from './SupplierFinder'
import type { ProductFinderReadContext } from '@/hooks/useProducts'

const api = vi.hoisted(() => ({ categories: vi.fn(), suppliers: vi.fn() }))
vi.mock('@/api/categories', () => ({ getCategoryTreeApi: api.categories }))
vi.mock('@/api/suppliers', () => ({ getSuppliersApi: api.suppliers }))
const categories = [{ id: 2, name: '分类甲', status: 1 }]
const suppliers = { list: [{ id: 3, name: '供应商甲', code: 'S3', isActive: true }], pagination: { total: 1 } }
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); vi.resetAllMocks(); api.categories.mockResolvedValue(categories); api.suppliers.mockResolvedValue(suppliers) })
const button = (label: string) => Array.from(document.querySelectorAll('button')).find(value => value.textContent === label)!
async function withFinder(kind: '分类' | '供应商', context: ProductFinderReadContext | undefined, run: (setContext: (next: ProductFinderReadContext) => Promise<void>, confirm: ReturnType<typeof vi.fn>) => Promise<void>) {
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host), client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } }), confirm = vi.fn()
  const render = async (next: ProductFinderReadContext | undefined) => {
    await act(async () => { root.render(<QueryClientProvider client={client}>{kind === '分类' ? <CategoryFinder open value={2} context={next} onClose={() => {}} onConfirm={confirm} /> : <SupplierFinder open context={next} onClose={() => {}} onConfirm={confirm} />}</QueryClientProvider>); await new Promise(resolve => setTimeout(resolve, 10)) })
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)) })
  }
  try { await render(context); await run(render, confirm) }
  finally { await act(async () => { root.unmount(); await new Promise(resolve => setTimeout(resolve, 0)) }); client.clear(); host.remove() }
}
const owned = (assertCurrent: () => void, enabled = true, epoch = 1): ProductFinderReadContext => ({ key: ['owned-a', epoch], enabled, config: { baseURL: '/original/api', _authSessionGeneration: 10, _erpApiFallbackTried: true, automaticReplay: false, skipGlobalError: true }, assertCurrent })
test.each(['分类', '供应商'] as const)('%s传递读取上下文，不可读时不请求/不显示缓存', async kind => {
  const fn = kind === '分类' ? api.categories : api.suppliers
  const assertCurrent = vi.fn()
  await withFinder(kind, owned(assertCurrent, false), async setContext => {
    expect(fn).not.toHaveBeenCalled()
    await setContext(owned(assertCurrent))
    const config = fn.mock.calls[0][kind === '分类' ? 0 : 1]
    expect(config).toMatchObject({ baseURL: '/original/api', _authSessionGeneration: 10, _erpApiFallbackTried: true, automaticReplay: false })
    expect(config.signal).toBeInstanceOf(AbortSignal); expect(assertCurrent.mock.calls.length).toBeGreaterThanOrEqual(2)
    await setContext(owned(assertCurrent, false))
    expect(document.body.textContent).not.toContain(kind === '分类' ? '分类甲' : '供应商甲')
  })
})
test.each(['分类', '供应商'] as const)('%s请求返回后再次核对来源，迟到旧身份不能展示', async kind => {
  const fn = kind === '分类' ? api.categories : api.suppliers
  let finish!: (value: unknown) => void, valid = true
  fn.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  await withFinder(kind, owned(() => { if (!valid) throw new Error('旧读取来源失效') }), async (_setContext, confirm) => {
    valid = false
    await act(async () => { finish(kind === '分类' ? categories : suppliers); await new Promise(resolve => setTimeout(resolve, 10)) })
    expect(document.body.textContent).not.toContain(kind === '分类' ? '分类甲' : '供应商甲')
    expect(confirm).not.toHaveBeenCalled()
  })
})
test.each(['分类', '供应商'] as const)('%s确认时再次核当前上下文，保留的旧节点不得回填', async kind => {
  let valid = true
  await withFinder(kind, owned(() => { if (!valid) throw new Error('已切换来源') }), async (_setContext, confirm) => {
    const target = kind === '分类' ? button('分类甲') : document.querySelector('[role="row"]')!
    expect(target).toBeTruthy(); valid = false
    await act(async () => { target.dispatchEvent(new MouseEvent(kind === '分类' ? 'click' : 'dblclick', { bubbles: true })) })
    expect(confirm).not.toHaveBeenCalled()
  })
})
test('分类上下文正在读取时禁止拿预选ID确认，默认调用仍兼容原行为', async () => {
  api.categories.mockImplementationOnce(() => new Promise(() => {}))
  await withFinder('分类', owned(() => {}), async (_setContext, confirm) => {
    expect(button('确认').disabled).toBe(true)
    await act(async () => { button('确认').click() }); expect(confirm).not.toHaveBeenCalled()
  })
  await withFinder('分类', undefined, async (_setContext, confirm) => {
    expect(api.categories.mock.calls.at(-1)).toEqual([])
    await act(async () => { button('分类甲').click() })
    expect(confirm).toHaveBeenCalledWith({ id: 2, name: '分类甲' })
  })
})
