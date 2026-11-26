// @vitest-environment jsdom
import { webcrypto } from 'node:crypto'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, getByRole } from '@testing-library/dom'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { InternalAxiosRequestConfig } from 'axios'
import Page from './sale-return-receive'
import PutawayPage from './sale-return-putaway'
import api, { setApiClientBaseURL } from '@/api/client'
import { useAuthStore } from '@/store/authStore'
import { captureInboundEditOwner } from '@/hooks/useInboundTaskEditRecovery'
import { readOwnedCriticalPending } from '@/lib/pendingRequestStorage'
import type { User } from '@/types'

vi.mock('@/hooks/useNetworkStatus', () => ({ useNetworkStatus: () => 'online' }))
vi.mock('@/hooks/useProductQtyPolicies', () => ({ useProductQtyPolicies: () => () => true }))
const row = { id: 1, productId: 7, productCode: 'SKU7', productName: '铰链', unit: '件', expectedQty: 6, receivedQty: 1, checkedQty: 0, rejectedQty: 0, putawayQty: 0 }
const order = (status: number) => ({ id: 31, taskNo: 'RT31', warehouseId: 2, status, submittedAt: '2026-09-04', items: [row, { ...row, id: 2, expectedQty: 3, receivedQty: 2 }] })
let root: Root, host: HTMLDivElement, cache: QueryClient, status: number, detailFailed: boolean
let requests: InternalAxiosRequestConfig[], receipt: object
const original = { adapter: api.defaults.adapter, baseURL: api.defaults.baseURL }
const posts = () => requests.filter(r => r.method === 'post')
const queries = () => requests.filter(r => r.url?.startsWith('/system/request-status/'))
const pause = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) })

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.stubGlobal('crypto', webcrypto)
  Object.defineProperty(navigator, 'locks', { configurable: true, value: { request: async (_: string, options: unknown, run?: (lock: object) => unknown) => (typeof options === 'function' ? options : run!)({}) } })
  localStorage.clear(); sessionStorage.clear()
  useAuthStore.getState().login('local-fixture', null, { id: 1, roleId: 1 } as User)
  setApiClientBaseURL('/api')
  requests = []; status = 2; detailFailed = false; receipt = { status: 'not_found', data: null, message: '' }
  api.defaults.adapter = async config => {
    requests.push(config)
    if (config.method === 'post' || (config.url === '/return-tasks/31' && detailFailed)) throw Error('模拟连接中断')
    let data: object = receipt
    if (config.url === '/return-tasks/31') data = order(status)
    if (config.url === '/return-tasks/31/putaway-container') data = { taskId: 31, warehouseId: 2, status: 4, containerId: 17, barcode: 'I000017' }
    if (config.url === '/return-tasks/31/putaway-location') data = { warehouseId: 2, status: 1, id: 8, code: 'R000008' }
    return { config, data: { success: true, data }, status: 200, statusText: 'OK', headers: {} }
  }
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
})
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); cache.clear()
  useAuthStore.getState().logout()
  api.defaults.adapter = original.adapter; api.defaults.baseURL = original.baseURL
  vi.unstubAllGlobals()
})
async function mount(PageComponent = Page) {
  await act(async () => root.render(<QueryClientProvider client={cache}><MemoryRouter initialEntries={['/receive/31']}><Routes><Route path="/receive/:id" element={<PageComponent />} /></Routes></MemoryRouter></QueryClientProvider>))
  await pause()
}
async function click(name: string | RegExp) {
  const button = getByRole(host, 'button', { name })
  await act(async () => button.click()); await pause()
}
function qty(name: string, value: string) {
  act(() => fireEvent.change(getByRole(host, 'spinbutton', { name }), { target: { value } }))
}
async function refetch() {
  await act(async () => { await cache.refetchQueries({ queryKey: ['pda-return-task', 31] }) }); await pause()
}

test('同一商品两条退货明细按两箱提交，保留原键和正文；终态和读取失败仍可核对且不会重复写入', async () => {
  await mount(); await click(/SKU7/)
  qty('箱1数量', '2'); await click('添加一箱'); qty('箱2数量', '3')
  await click('确认收货 5 件')
  expect(posts()).toHaveLength(1)
  const post = posts()[0]
  expect(post.url).toBe('/return-tasks/31/receive')
  expect(post.headers.get('X-Client')).toBe('pda')
  const body = { productId: 7, packages: [{ qty: 2 }, { qty: 3 }] }
  expect(JSON.parse(post.data)).toEqual(body)
  const key = post.headers.get('X-Request-Key')
  expect(readOwnedCriticalPending(1)).toEqual([expect.objectContaining({ requestKey: key, metadata: expect.objectContaining({ taskId: 31, requestBody: body }) })])
  expect(host.textContent).toContain('每箱数量 2、3')
  expect(host.textContent).not.toContain('清除记录')
  expect((getByRole(host, 'spinbutton', { name: '箱1数量' }) as HTMLInputElement).disabled).toBe(true)
  status = 4; await refetch()
  await click('确认上次结果')
  detailFailed = true; await refetch()
  await click('确认上次结果')
  expect(queries().length).toBeGreaterThan(1)
  expect(queries().every(r => r.url?.endsWith('/' + key))).toBe(true)
  expect(readOwnedCriticalPending(1)).toHaveLength(1)
  receipt = { status: 'success', resourceType: 'return_task', resourceId: 31, data: { taskId: 31, status: 3, containers: [{ containerId: 42, barcode: 'I000042', qty: 2, status: 5 }] } }
  await click('确认上次结果')
  expect(readOwnedCriticalPending(1)).toHaveLength(0)
  detailFailed = false; await refetch()
  expect(host.textContent).toContain('I000042')
  expect(posts()).toHaveLength(1)
})

test('质检按同商品各行实际收货量显示；推进状态后能按质检原键查询', async () => {
  status = 3; await mount(); await click(/SKU7/)
  expect(host.textContent).toContain('已收货：3 件')
  qty('质检通过数量', '2'); qty('不合格数量', '1'); await click(/确认质检/)
  expect(posts()).toHaveLength(1)
  expect(posts()[0].url).toBe('/return-tasks/31/check')
  expect(JSON.parse(posts()[0].data)).toEqual({ productId: 7, passedQty: 2, rejectedQty: 1 })
  status = 4; await refetch(); await click('确认上次结果')
  expect(host.textContent).toContain('合格 2、不合格 1')
  expect(queries().at(-1)?.url).toContain(String(posts()[0].headers.get('X-Request-Key')))
  expect(posts()).toHaveLength(1)
})

test('轮询将收货任务推进到质检后，之前录入的箱数不能作为另一阶段的提交', async () => {
  await mount(); await click(/SKU7/); qty('箱1数量', '2')
  status = 3; await refetch()
  expect(host.textContent).not.toContain('确认收货 2 件')
  expect(host.textContent).not.toContain('确认质检：合格 2')
  await click(/SKU7/)
  expect(host.textContent).toContain('已收货：3 件')
  expect(posts()).toHaveLength(0)
})

test('旧版待确认操作重开时只查原单；未知及错单结果保留原记录', async () => {
  const { reserveTerminalSlot } = await import('@/lib/criticalTerminalStorage')
  const { saveOwnedCriticalPending } = await import('@/lib/pendingRequestStorage')
  const record = { requestKey: 'previous-return', action: 'return.receive.31', requestAction: 'return.receive', label: '退货收货', createdAt: new Date().toISOString(), endpoint: captureInboundEditOwner().baseURL, deviceCode: null, deviceWarehouseId: null, metadata: { productId: 7, expectedQty: 3 } }
  await reserveTerminalSlot('pda_owned_terminal_v3:1:previous-return', record)
  saveOwnedCriticalPending(1, record)
  status = 4
  await mount(); await click('确认上次结果')
  expect(queries().at(-1)?.url).toBe('/system/request-status/previous-return')
  expect(queries().at(-1)?.params.action).toBe('return.receive.31')
  receipt = { status: 'success', resourceType: 'return_task', resourceId: 32, data: { taskId: 32, containers: [] } }
  await click('确认上次结果')
  expect(readOwnedCriticalPending(1)).toHaveLength(1)
  expect(posts()).toHaveLength(0)
})

test('添加一箱后可撤掉末尾空箱，保留先前录入的箱数', async () => {
  await mount(); await click(/SKU7/)
  qty('箱1数量', '2'); await click('添加一箱')
  expect((getByRole(host, 'button', { name: '确认收货 2 件' }) as HTMLButtonElement).disabled).toBe(true)
  await click('删除箱2')
  expect((getByRole(host, 'spinbutton', { name: '箱1数量' }) as HTMLInputElement).value).toBe('2')
  await click('确认收货 2 件')
  expect(JSON.parse(posts()[0].data).packages).toEqual([{ qty: 2 }])
})

test('退货上架固定写入端点，按原任务核对归属后解除阻断', async () => {
  status = 4
  await mount(PutawayPage)
  for (const barcode of ['I000017', 'R000008']) {
    await act(async () => {
      for (const key of [...barcode, 'Enter']) document.body.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
    })
    await pause()
  }
  expect(posts()).toHaveLength(1)
  const post = posts()[0]
  expect(post.url).toBe('/return-tasks/31/putaway')
  expect(JSON.parse(post.data)).toEqual({ containerId: 17, locationId: 8 })
  expect(post).toMatchObject({ baseURL: captureInboundEditOwner().baseURL, _authSessionGeneration: useAuthStore.getState().sessionGeneration, automaticReplay: false, _erpApiFallbackTried: true })
  expect(post.headers.get('X-Client')).toBe('pda')
  const key = post.headers.get('X-Request-Key')
  expect(key).toEqual(expect.any(String))
  const payload = { taskId: 31, containerId: 17, locationId: 8, status: 5 }
  for (const wrong of [
    { status: 'failed', resourceType: 'return_task', resourceId: 32 },
    { status: 'success', resourceType: 'warehouse_task', resourceId: 31, data: payload },
    { status: 'success', resourceType: 'return_task', resourceId: 31, data: { ...payload, taskId: 32 } },
    { status: 'success', data: {} },
  ]) {
    receipt = wrong
    await click('确认上次结果')
    expect(readOwnedCriticalPending(1)).toHaveLength(1)
  }
  receipt = { status: 'success', resourceType: 'return_task', resourceId: 31, data: payload }
  await click('确认上次结果')
  expect(readOwnedCriticalPending(1)).toHaveLength(0)
  expect(queries().length).toBeGreaterThan(0)
  expect(queries().every(r => r.url?.endsWith('/' + key) && r.params.action === 'return.putaway.31' && r.baseURL === post.baseURL)).toBe(true)
  expect(posts()).toHaveLength(1)
})
