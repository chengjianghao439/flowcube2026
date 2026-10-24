// @vitest-environment jsdom
import { act } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { useAuthStore } from '@/store/authStore'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AxiosError, CanceledError, type AxiosAdapter } from 'axios'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import client, { ApiClientError } from '@/api/client'
import ReserveAllocationDialog from './ReserveAllocationDialog'
import type { ReservePreview } from '@/types/sale'

vi.mock('@/hooks/useProductQtyPolicies', () => ({ useProductQtyPolicies: () => () => true }))
vi.mock('@/components/shared/WarehouseSelect', () => ({ WarehouseSelect: (props: { id?: string; value: number; disabled?: boolean; onChange: (id: number, name: string) => void }) => <select id={props.id} disabled={props.disabled} value={props.value} onChange={e => props.onChange(Number(e.target.value), '合成仓库')}><option value={1}>合成仓库</option><option value={2}>第二仓库</option></select> }))
const preview: ReservePreview = { orderId: 7, warehouseId: 1, warehouseName: '合成仓库', items: [{ itemId: 17, productId: 27, productCode: 'SYNTHETIC-P', productName: '合成商品', unit: '个', quantity: 2, reservedQty: 0, remainToReserve: 2, currentWarehouseId: 1, currentWarehouseName: '合成仓库', warehouses: [{ warehouseId: 1, warehouseName: '合成仓库', available: 2 }, { warehouseId: 2, warehouseName: '第二仓库', available: 2 }] }] }
let oldAuth:ReturnType<typeof useAuthStore.getState>
let host: HTMLDivElement, root: Root, qc: QueryClient, originalAdapter: typeof client.defaults.adapter, reads: string[]
let releasePendingRead: (() => void) | undefined

let holdHealth: boolean, disposed: boolean
let healthCalls: string[], unexpectedFetches: string[]
let pendingHealth: Set<() => void>
let originalFetch: typeof fetch, originalBaseURL: typeof client.defaults.baseURL
let originalOrigins: Array<[string, string | null]>
function installHealthTransport() {
  holdHealth = false; disposed = false; healthCalls = []; unexpectedFetches = []; pendingHealth = new Set()
  originalFetch = globalThis.fetch; originalBaseURL = client.defaults.baseURL
  originalOrigins = ['API_BASE_URL', 'flowcube:apiOrigin'].map(key => [key, localStorage.getItem(key)])
  for (const [key] of originalOrigins) localStorage.removeItem(key)
  // Ensure real fallback has a distinct failed origin even when CI has no production origin.
  client.defaults.baseURL = 'https://failed.invalid/api'
  vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const target = String(input)
    let allowed = false
    try { const url = new URL(target); allowed = url.pathname === '/api/health' && !url.search && init?.method === 'GET' && init.cache === 'no-store' && init.headers == null && init.body == null } catch { /* Report invalid input below; the real probe catches transport errors. */ }
    if (!allowed) unexpectedFetches.push(target)
    healthCalls.push(target)
    return new Promise<Response>(resolve => {
      const release = () => { pendingHealth.delete(release); resolve({ ok: false } as Response) }
      pendingHealth.add(release)
      if (!holdHealth) release()
    })
  }))
}
function releaseHealthProbes() { holdHealth = false; for (const release of pendingHealth) release() }
async function until(assertion: () => void) {
  await vi.waitFor(async () => {
    // Yield one notification turn; the assertion, rather than a fixed sleep, decides readiness.
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
    assertion()
  }, { timeout: 1000, interval: 10 })
}

beforeEach(() => {
  installHealthTransport(); releasePendingRead = undefined
  oldAuth=useAuthStore.getState();useAuthStore.getState().login('synthetic',null,{id:9,username:'synthetic',realName:'合成操作员',roleId:1,roleName:'测试'})
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); reads = []; originalAdapter = client.defaults.adapter
  qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
async function cleanupFixture() {
  if (disposed) return
  const readsInFlight = qc.getQueryCache().getAll().map(query => query.promise)
  try {
    await act(async () => {
      root.unmount()
      releaseHealthProbes()
      releasePendingRead?.()
    })
    await Promise.allSettled(readsInFlight)
    await act(async () => qc.clear())
    expect(pendingHealth.size).toBe(0)
    expect(unexpectedFetches).toEqual([])
  } finally {
    disposed = true; host.remove(); client.defaults.adapter = originalAdapter
    client.defaults.baseURL = originalBaseURL
    for (const [key, value] of originalOrigins) { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value) }
    vi.unstubAllGlobals()
    useAuthStore.setState(oldAuth)
  }
}
afterEach(cleanupFixture)

async function mount() { await act(async () => root.render(<MemoryRouter><QueryClientProvider client={qc}><ReserveAllocationDialog open orderId={7} onClose={vi.fn()} onShortage={vi.fn()} /></QueryClientProvider></MemoryRouter>)) }
const button = (name: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.trim() === name)!
function validateRead(config: Parameters<AxiosAdapter>[0]) { expect(config.method).toBe('get'); expect(config.url).toBe('/sale/7/reserve-preview'); reads.push(String(config.url)) }
function success(config: Parameters<AxiosAdapter>[0], data = preview) { return { status: 200, statusText: 'OK', headers: {}, config, data: { success: true, data } } }

test('预览失败显示真实错误/重试，不冒充空表与0量，不提供可写来源；重试走原GET', async () => {
  let fail = true; holdHealth = true
  client.defaults.adapter = (async config => { validateRead(config); if (fail) throw new AxiosError('本批占库预览读取中断', 'ERR_NETWORK', config); return success(config) }) satisfies AxiosAdapter
  await mount()
  await until(() => expect(healthCalls.length).toBeGreaterThan(0))
  expect(pendingHealth.size).toBeGreaterThan(0)
  expect(document.querySelector('.fc-dialog-caption')?.textContent).toContain('加载商品与库存信息')
  expect(document.body.textContent?.split('加载商品与库存信息')).toHaveLength(2)
  expect(document.body.textContent).not.toContain('核对商品身份，按明细选择发货仓库和本次占库数量')
  expect(document.body.textContent).not.toContain('加载失败')
  expect(button('确认占用（0 项）').disabled).toBe(true)
  await act(async () => releaseHealthProbes())
  await until(() => expect(document.body.textContent).toContain('加载失败'))
  expect(document.body.textContent).toContain('加载失败')
  // 真实 API client 将 ERR_NETWORK 统一为现行员工可读错误。
  expect(document.body.textContent).toContain('无法连接服务器')
  expect(document.body.textContent).not.toContain('没有可占用库存的商品明细')
  expect(document.body.textContent).not.toContain('0 行')
  expect(document.querySelector('[role="dialog"] table')).toBeNull()
  expect(button('确认占用（0 项）').disabled).toBe(true)
  fail = false; await act(async () => button('重试').click())
  await until(() => expect(document.querySelector<HTMLInputElement>('input[type="number"]')?.value).toBe('2'))
  expect(reads).toEqual(['/sale/7/reserve-preview', '/sale/7/reserve-preview'])
  expect(document.body.textContent).not.toContain('加载失败')
  expect(document.querySelector<HTMLInputElement>('input[type="number"]')?.value).toBe('2')
  expect(button('确认占用（1 项）').disabled).toBe(false)
})

test('缓存读取失败封住表格，重试成功后保留原数量/仓库选择并按新来源校验', async () => {
  qc.setQueryData(['sale-reserve-preview', 7], preview)
  let reject!: (e: Error) => void, retry = false
  client.defaults.adapter = (async config => { validateRead(config); if (!retry) return await new Promise((_resolve, fail) => { reject = fail; releasePendingRead = () => fail(new CanceledError('synthetic fixture cleanup')) }); return success(config, { ...preview, items: preview.items.map(i => ({ ...i, warehouses: i.warehouses.map(w => ({ ...w, available: 1 })) })) }) }) satisfies AxiosAdapter
  await mount()
  await act(async () => {
    const qty = document.querySelector<HTMLInputElement>('input[type="number"]')!
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(qty, '1.25'); qty.dispatchEvent(new Event('input', { bubbles: true }))
    const warehouse = document.querySelector<HTMLSelectElement>('select')!; warehouse.value = '2'; warehouse.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await act(async () => reject(new AxiosError('本批刷新失败', 'ERR_NETWORK')))
  await until(() => expect(document.body.textContent).toContain('加载失败'))
  expect(document.body.textContent).toContain('加载失败')
  expect(document.querySelector('[role="dialog"] table')).toBeNull()
  retry = true; await act(async () => button('重试').click())
  await until(() => expect(document.querySelector<HTMLInputElement>('input[type="number"]')?.value).toBe('1.25'))
  expect(document.querySelector<HTMLInputElement>('input[type="number"]')!.value).toBe('1.25')
  expect(document.querySelector<HTMLSelectElement>('select')!.value).toBe('2')
  expect(button('确认占用（1 项）').disabled).toBe(true)
  expect(document.body.textContent).toContain('库存不足')
})

test('占库仓库标签关联这一商品行的真实选择控件', async () => {
  client.defaults.adapter = (async config => { validateRead(config); return success(config, { ...preview, credit: { customerId: 1, creditLimit: 100, used: 90, thisOrder: 30, willExceed: true, overAmount: 20 } }) }) satisfies AxiosAdapter
  await mount()
  await until(() => expect(document.querySelector('select')).not.toBeNull())
  const caption = document.querySelector('.fc-dialog-caption')!
  expect(caption.textContent).toContain('额度 ¥100.00，已用 ¥90.00，本单 ¥30.00，超出约 ¥20.00')
  expect(caption.textContent).toContain('超额占库须先取得有效批准；原批准失效时可重新发起')
  expect(caption.querySelector('a')?.getAttribute('href')).toBe('#/credit-overrides')
  expect(document.body.textContent?.split('客户授信将超额')).toHaveLength(2)
  expect(document.body.textContent).not.toContain('核对商品身份，按明细选择发货仓库和本次占库数量')
  const label = [...document.querySelectorAll('label')].find(label => label.textContent?.includes('选择库存所在仓库'))
  expect(label).toBeTruthy(); expect(label!.htmlFor).not.toBe('')
  expect(document.getElementById(label!.htmlFor)).toBe(document.querySelector('select'))
})

test('首次正在读取不展示0量/空分配表', async () => {
  client.defaults.adapter = (async config => { validateRead(config); return await new Promise((_resolve, reject) => { releasePendingRead = () => reject(new CanceledError('synthetic fixture cleanup')) }) }) satisfies AxiosAdapter
  await mount()
  expect(document.querySelector('.fc-dialog-caption')?.textContent).toContain('加载商品与库存信息')
  expect(document.body.textContent?.split('加载商品与库存信息')).toHaveLength(2)
  expect(document.body.textContent).not.toContain('核对商品身份，按明细选择发货仓库和本次占库数量')
  expect(document.body.textContent).not.toContain('0 行')
  expect(document.querySelector('[role="dialog"] table')).toBeNull()
})


test('占库弹窗卸载时等待真实错误链结算后恢复原会话', async () => {
  holdHealth = true
  client.defaults.adapter = (async config => { validateRead(config); throw new AxiosError('synthetic offline preview', 'ERR_NETWORK', config) }) satisfies AxiosAdapter
  let reached = false, released = false, cleaned = false
  let release!: () => void
  const settled = new Promise<void>(resolve => { release = () => { released = true; resolve() } })
  // Retain the real normalization/health chain, then hold this test's final settlement.
  const interceptor = client.interceptors.response.use(undefined, async (error: unknown) => {
    expect(error).toBeInstanceOf(ApiClientError)
    expect((error as ApiClientError).code).toBe('NETWORK_ERROR')
    reached = true; await settled; throw error
  })
  let cleanup: Promise<void> | undefined
  try {
    await mount()
    await until(() => expect(pendingHealth.size).toBeGreaterThan(0))
    cleanup = cleanupFixture().then(() => { cleaned = true })
    await vi.waitFor(() => expect(reached).toBe(true))
    expect(pendingHealth.size).toBe(0); expect(released).toBe(false)
    expect(cleaned).toBe(false); expect(disposed).toBe(false)
    expect(globalThis.fetch).not.toBe(originalFetch)
    release(); await cleanup
    expect(cleaned).toBe(true); expect(pendingHealth.size).toBe(0)
    expect(host.isConnected).toBe(false); expect(qc.getQueryCache().getAll()).toEqual([])
    expect(globalThis.fetch).toBe(originalFetch); expect(client.defaults.adapter).toBe(originalAdapter)
    expect(client.defaults.baseURL).toBe(originalBaseURL)
    expect(useAuthStore.getState().user).toEqual(oldAuth.user)
    for (const [key, value] of originalOrigins) expect(localStorage.getItem(key)).toBe(value)
  } finally {
    release()
    try { await cleanup } finally { client.interceptors.response.eject(interceptor) }
  }
})
