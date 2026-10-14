// @vitest-environment jsdom
import { act } from 'react'
import { webcrypto } from 'node:crypto'
import { AxiosError, type InternalAxiosRequestConfig } from 'axios'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes, useNavigate, type NavigateFunction } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import TransferIn from './transfer-in'
import TransferOut from './transfer-out'
import apiClient, { setApiClientBaseURL } from '@/api/client'
import { useAuthStore } from '@/store/authStore'
import { captureInboundEditOwner } from '@/hooks/useInboundTaskEditRecovery'
import { saveOwnedCriticalPending, readOwnedCriticalPending } from '@/lib/pendingRequestStorage'
import { reserveTerminalSlot } from '@/lib/criticalTerminalStorage'
import type { PendingRequestRecord } from '@/hooks/usePendingRequests'
import type { TransferOrder } from '@/api/transfer'
import type { User } from '@/types'

const scanner = vi.hoisted(() => ({ scan: null as null | ((raw: string) => void | Promise<void>), disabled: false }))
vi.mock('@/components/pda/PdaScanner', () => ({ default: ({ onScan, disabled }: { onScan: (raw: string) => void | Promise<void>; disabled: boolean }) => { scanner.scan = onScan; scanner.disabled = disabled; return <button disabled={disabled}>合成扫码边界</button> } }))
vi.mock('@/hooks/useNetworkStatus', () => ({ useNetworkStatus: () => 'online' }))

type Direction = 'In' | 'Out'
const originalAdapter = apiClient.defaults.adapter
const originalBaseURL = apiClient.defaults.baseURL
let root: Root, host: HTMLDivElement, cache: QueryClient
let direction: Direction, detail: () => Promise<unknown>, receipt: () => Promise<unknown>, location: () => Promise<unknown>
let requests: InternalAxiosRequestConfig[]
let navigate: NavigateFunction
function NavigationProbe() { navigate = useNavigate(); return null }
const order = (status: TransferOrder['status'] = 4) => ({ id: 31, orderNo: 'TR31', status, statusName: status === 4 ? '已完成' : status === 5 ? '已取消' : status === 1 ? '草稿' : '在途', fromWarehouseId: 1, fromWarehouseName: '源仓', toWarehouseId: 2, toWarehouseName: '目标仓', items: [{ id: 1, productId: 7, productCode: 'P7', productName: '铰链', unit: '个', quantity: 1, deductedQty: 1, receivedQty: status === 4 ? 1 : 0 }] })
const key = (d: Direction) => `original-${d}-31`
const pendingKey = (d: Direction) => `pda_owned_request_v3:1:${key(d)}`
const statusCalls = () => requests.filter(r => r.url?.startsWith('/system/request-status/'))
const posts = () => requests.filter(r => r.method === 'post')
const pause = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) })
function reply(config: InternalAxiosRequestConfig, data: unknown) { return { config, data: { success: true, data }, status: 200, statusText: 'OK', headers: {} } }
function rejection(status = 503) { throw Object.assign(Error('合成暂不可读'), { status }) }
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: webcrypto })
  Object.defineProperty(navigator, 'locks', { configurable: true, value: { request: async (_name: string, options: unknown, run?: (lock: object) => unknown) => (typeof options === 'function' ? options : run!)({}) } })
  localStorage.clear(); sessionStorage.clear(); scanner.scan = null; scanner.disabled = false
  useAuthStore.getState().login('synthetic-memory', null, { id: 1, roleId: 1 } as User)
  setApiClientBaseURL('/api'); direction = 'In'; requests = []
  detail = async () => order(); receipt = async () => ({ status: 'not_found', data: null, message: '' }); location = async () => ({ id: 88, code: 'R88' })
  apiClient.defaults.adapter = async config => {
    requests.push(config)
    try {
      if (config.method === 'get' && /^\/transfer\/(31|32)$/.test(config.url || '')) return reply(config, await detail())
      if (config.method === 'get' && config.url?.startsWith('/system/request-status/')) return reply(config, await receipt())
      if (config.method === 'get' && config.url?.startsWith('/locations/code/')) return reply(config, await location())
      if (config.method === 'post' && /^\/transfer\/(31|32)\/scan-(in|out)$/.test(config.url || '')) rejection(503)
      throw Error(`unexpected ${config.method} ${config.url}`)
    } catch (e) {
      if (e instanceof AxiosError) throw e
      const status = (e as { status?: number }).status
      throw new AxiosError('synthetic rejection', 'ERR_BAD_RESPONSE', config, undefined, status ? { config, status, statusText: 'Rejected', headers: {}, data: { success: false, message: '合成暂不可读' } } : undefined)
    }
  }
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  cache = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0, gcTime: 0 } } })
})
afterEach(async () => { await act(async () => root.unmount()); cache.clear(); host.remove(); apiClient.defaults.adapter = originalAdapter; apiClient.defaults.baseURL = originalBaseURL; useAuthStore.getState().logout() })
async function seed(d: Direction, requestKey = key(d), action = `transfer.scan${d}.31`) {
  const record: PendingRequestRecord = { action, requestAction: action, requestKey, label: '原调拨扫码', createdAt: new Date().toISOString(), endpoint: captureInboundEditOwner().baseURL, deviceCode: null, deviceWarehouseId: null, metadata: { barcode: 'I000001' } }
  await reserveTerminalSlot(`pda_owned_terminal_v3:1:${requestKey}`, record)
  saveOwnedCriticalPending(1, record); return record
}
async function render(d = direction) {
  direction = d
  await act(async () => root.render(<QueryClientProvider client={cache}><MemoryRouter initialEntries={[`/pda/transfer-${d === 'In' ? 'in' : 'out'}/31`]}><NavigationProbe /><input aria-label="另一草稿" defaultValue="原草稿未保存" /><Routes><Route path="/pda/transfer-in/:id" element={<TransferIn />} /><Route path="/pda/transfer-out/:id" element={<TransferOut />} /><Route path="/pda/transfer" element={<p>调拨执行列表</p>} /></Routes></MemoryRouter></QueryClientProvider>)); await pause()
}
const button = (name: string) => [...host.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === name)
async function click(name: string) { expect(button(name), name).toBeTruthy(); await act(async () => button(name)!.click()); await pause() }
const success = (d: Direction) => ({ status: 'success', resourceType: 'transfer_order', resourceId: 31, data: { transferId: 31, containerBarcode: 'I000001', productId: 7, qty: 1, completed: d === 'In' }, message: '' })

test.each(['In', 'Out'] as const)('terminal %s keeps manual receipt query after one automatic not_found; no POST', async d => {
  await seed(d); await render(d)
  expect(host.textContent).toContain('已完成'); expect(statusCalls()).toHaveLength(1)
  await pause(); expect(statusCalls()).toHaveLength(1)
  expect(button('确认上次结果')).toBeTruthy(); expect(localStorage.getItem(pendingKey(d))).toBeTruthy()
  receipt = async () => success(d); await click('确认上次结果')
  expect(statusCalls()).toHaveLength(2); expect(localStorage.getItem(pendingKey(d))).toBeNull(); expect(posts()).toHaveLength(0)
  for (const r of statusCalls()) { expect(r.url).toBe(`/system/request-status/${key(d)}`); expect(r.params.action).toBe(`transfer.scan${d}.31`); expect(r.baseURL).toBe(captureInboundEditOwner().baseURL); expect(r.automaticReplay).toBe(false) }
})
test.each(['In', 'Out'] as const)('loading %s retains receipt recovery instead of swallowing it behind a spinner', async d => {
  detail = () => new Promise(() => {}); await seed(d); await render(d)
  expect(button('确认上次结果')).toBeTruthy(); expect(host.textContent).not.toContain('请选择调拨单')
  receipt = async () => success(d); await click('确认上次结果'); expect(posts()).toHaveLength(0)
})
test.each(['In', 'Out'] as const)('successful empty detail %s is distinguishable from loading and still retains receipt recovery', async d => {
  detail = async () => null; await seed(d); await render(d)
  expect(host.textContent).toContain('未读取到调拨单'); expect(button('重试')).toBeTruthy(); expect(button('确认上次结果')).toBeTruthy(); expect(posts()).toHaveLength(0)
  detail = async () => order(3); await click('重试'); expect(scanner.disabled).toBe(true)
  receipt = async () => { const result = success(d); return { ...result, data: { ...result.data, completed: false } } }
  await click('确认上次结果'); expect(scanner.disabled).toBe(false); expect(posts()).toHaveLength(0)
})
test.each(['In', 'Out'] as const)('initial detail error %s already retains error and receipt query', async d => {
  detail = async () => rejection(); await seed(d); await render(d)
  expect(host.textContent).toContain('加载失败'); expect(button('重试')).toBeTruthy(); expect(button('确认上次结果')).toBeTruthy(); expect(posts()).toHaveLength(0)
})
test.each(['In', 'Out'] as const)('healthy original receipt %s clears pending automatically even when order is terminal', async d => {
  receipt = async () => success(d); await seed(d); await render(d); await pause()
  expect(localStorage.getItem(pendingKey(d))).toBeNull(); expect(posts()).toHaveLength(0); expect(button('确认上次结果')).toBeUndefined()
})
test.each(['In', 'Out'] as const)('terminal %s without any original pending does not invent a recovery notice or scanner', async d => {
  await render(d); expect(host.textContent).toContain('已完成'); expect(button('确认上次结果')).toBeUndefined(); expect(scanner.scan).toBeNull(); expect(statusCalls()).toHaveLength(0); expect(posts()).toHaveLength(0)
})
test.each([['In', 'pending'], ['Out', 'pending'], ['In', '503'], ['Out', '503']] as const)('terminal %s permits manual GET after automatic %s and serializes rapid clicks', async (d, automatic) => {
  receipt = automatic === '503' ? async () => rejection() : async () => ({ status: 'pending', data: null, message: '仍在处理' })
  await seed(d); await render(d); expect(statusCalls()).toHaveLength(1)
  let resolve!: (value: unknown) => void
  receipt = () => new Promise(r => { resolve = r })
  const confirm = button('确认上次结果')!
  expect(confirm).toBeTruthy(); await act(async () => { confirm.click(); confirm.click() }); await pause()
  expect(statusCalls()).toHaveLength(2); expect(button('确认中…')?.disabled).toBe(true)
  expect(localStorage.getItem(pendingKey(d))).toBeTruthy()
  await act(async () => resolve(success(d))); await pause()
  expect(localStorage.getItem(pendingKey(d))).toBeNull(); expect(posts()).toHaveLength(0)
})
test.each(['In', 'Out'] as const)('actual scan %s loses response, then terminal remount queries original key and blocks changed body', async d => {
  detail = async () => order(3); await render(d)
  await act(async () => scanner.scan!('I000001')); await pause()
  if (d === 'In') { await act(async () => scanner.scan!('R88')); await pause() }
  expect(posts()).toHaveLength(1)
  const original = readOwnedCriticalPending(1)[0] as PendingRequestRecord
  const stored = localStorage.getItem(`pda_owned_request_v3:1:${original.requestKey}`)
  expect(original.action).toBe(`transfer.scan${d}.31`)
  expect(JSON.parse(posts()[0].data)).toEqual(d === 'In' ? { containerBarcode: 'I000001', locationId: 88 } : { containerBarcode: 'I000001' })
  expect(posts()[0].headers.get('X-Request-Key')).toBe(original.requestKey)
  expect(scanner.disabled).toBe(true)
  // Simulate a late scanner callback too: the shared pending gate still forbids a new body POST.
  await act(async () => scanner.scan!('I000002')); await pause()
  if (d === 'In') { await act(async () => scanner.scan!('R99')); await pause() }
  expect(posts()).toHaveLength(1); expect(localStorage.getItem(`pda_owned_request_v3:1:${original.requestKey}`)).toBe(stored)
  await act(async () => root.unmount()); root = createRoot(host); cache.clear(); detail = async () => order(); await render(d)
  const queriesBefore = statusCalls().length
  expect(button('确认上次结果')).toBeTruthy(); expect(posts()).toHaveLength(1)
  receipt = async () => success(d); await click('确认上次结果')
  expect(statusCalls()).toHaveLength(queriesBefore + 1)
  expect(statusCalls().at(-1)?.url).toBe(`/system/request-status/${original.requestKey}`)
  expect(localStorage.getItem(`pda_owned_request_v3:1:${original.requestKey}`)).toBeNull(); expect(posts()).toHaveLength(1)
})
test.each(['In', 'Out'] as const)('server/actor changes %s never send original query to a new owner', async d => {
  await seed(d); await render(d); const original = localStorage.getItem(pendingKey(d)), count = statusCalls().length
  await act(async () => setApiClientBaseURL('/other-api')); await click('确认上次结果')
  expect(statusCalls()).toHaveLength(count); expect(localStorage.getItem(pendingKey(d))).toBe(original)
  await act(async () => useAuthStore.getState().login('other-memory', null, { id: 2, roleId: 1 } as User)); await pause()
  expect(button('确认上次结果')).toBeUndefined(); expect(statusCalls()).toHaveLength(count)
  expect(localStorage.getItem(pendingKey(d))).toBe(original); expect(posts()).toHaveLength(0)
})
test.each(['In', 'Out'] as const)('return %s preserves unrelated pending body, sibling draft and original recovery', async d => {
  await seed(d); await seed('Out', 'other-transfer-key', 'transfer.scanOut.99')
  await render(d); const original = localStorage.getItem(pendingKey(d)), other = localStorage.getItem('pda_owned_request_v3:1:other-transfer-key')
  await click('返回调拨执行')
  expect(host.textContent).toContain('调拨执行列表'); expect((host.querySelector('[aria-label="另一草稿"]') as HTMLInputElement).value).toBe('原草稿未保存')
  expect(localStorage.getItem(pendingKey(d))).toBe(original); expect(localStorage.getItem('pda_owned_request_v3:1:other-transfer-key')).toBe(other)
  expect(posts()).toHaveLength(0)
})
test('late location response after a server switch cannot create a new scan-in on the new server', async () => {
  detail = async () => order(3); await render('In')
  await act(async () => scanner.scan!('I000001')); await pause()
  let resolve!: (value: unknown) => void; location = () => new Promise(r => { resolve = r })
  await act(async () => { void scanner.scan!('R88') }); await pause()
  await act(async () => setApiClientBaseURL('/other-api'))
  await act(async () => resolve({ id: 88, code: 'R88' })); await pause()
  expect(posts()).toHaveLength(0)
})
test.each([['In', 'server'], ['Out', 'server'], ['In', 'actor'], ['Out', 'actor']] as const)('late receipt %s after %s changes cannot clear or apply original pending', async (d, change) => {
  await seed(d); const original = localStorage.getItem(pendingKey(d))
  let resolve!: (value: unknown) => void; receipt = () => new Promise(r => { resolve = r })
  await render(d); expect(statusCalls()).toHaveLength(1)
  await act(async () => { if (change === 'server') setApiClientBaseURL('/other-api'); else useAuthStore.getState().login('other-memory', null, { id: 2, roleId: 1 } as User) })
  await act(async () => resolve(success(d))); await pause()
  expect(localStorage.getItem(pendingKey(d))).toBe(original); expect(posts()).toHaveLength(0); expect(statusCalls()).toHaveLength(1)
})
test.each(['In', 'Out'] as const)('immutable original barcode/key %s cannot be replaced by a different stored scan intention', async d => {
  await seed(d); await render(d); const original = JSON.parse(localStorage.getItem(pendingKey(d))!), reads = statusCalls().length
  localStorage.setItem(pendingKey(d), JSON.stringify({ ...original, metadata: { barcode: 'I000002' } }))
  await act(async () => window.dispatchEvent(new StorageEvent('storage', { key: pendingKey(d) }))); await pause()
  await click('确认上次结果')
  expect(statusCalls()).toHaveLength(reads); expect(posts()).toHaveLength(0); expect(localStorage.getItem(pendingKey(d))).toBeTruthy()
})
test('stale loaded outbound order cannot start a new POST after server change', async () => {
  detail = async () => order(3); await render('Out')
  await act(async () => setApiClientBaseURL('/other-api'))
  await act(async () => scanner.scan!('I000001')); await pause()
  expect(posts()).toHaveLength(0)
})
test('original inbound container cannot be carried into a server chosen before location lookup', async () => {
  detail = async () => order(3); await render('In')
  await act(async () => scanner.scan!('I000001')); await pause()
  await act(async () => setApiClientBaseURL('/other-api'))
  await act(async () => scanner.scan!('R88')); await pause()
  expect(requests.filter(r => r.url?.startsWith('/locations/'))).toHaveLength(0); expect(posts()).toHaveLength(0)
})
test('rescan and lookup generation keep an old location response from submitting a different container', async () => {
  detail = async () => order(3); await render('In')
  await act(async () => scanner.scan!('I000001')); await pause()
  let resolveOld!: (value: unknown) => void; location = () => new Promise(r => { resolveOld = r })
  await act(async () => { void scanner.scan!('R88') }); await pause()
  await click('重扫'); await act(async () => scanner.scan!('I000002')); await pause()
  await act(async () => resolveOld({ id: 88, code: 'R88' })); await pause(); expect(posts()).toHaveLength(0)
  location = async () => ({ id: 99, code: 'R99' }); await act(async () => scanner.scan!('R99')); await pause()
  expect(posts()).toHaveLength(1); expect(JSON.parse(posts()[0].data)).toEqual({ containerBarcode: 'I000002', locationId: 99 })
})
test.each(['In', 'Out'] as const)('same component route %s rejects old callbacks and allows a valid new transfer scan', async d => {
  detail = async () => order(3); await render(d); const oldScan = scanner.scan!
  let resolveOld!: (value: unknown) => void
  if (d === 'In') {
    await act(async () => oldScan('I000001')); await pause()
    location = () => new Promise(r => { resolveOld = r }); await act(async () => { void scanner.scan!('R88') }); await pause()
  }
  detail = async () => ({ ...order(3), id: 32, orderNo: 'TR32' })
  await act(async () => navigate(`/pda/transfer-${d === 'In' ? 'in' : 'out'}/32`)); await pause()
  if (d === 'In') { await act(async () => resolveOld({ id: 88, code: 'R88' })); await pause() }
  else { await act(async () => oldScan('I000001')); await pause() }
  expect(posts()).toHaveLength(0)
  await act(async () => scanner.scan!('I000002')); await pause()
  if (d === 'In') { location = async () => ({ id: 99, code: 'R99' }); await act(async () => scanner.scan!('R99')); await pause() }
  expect(posts()).toHaveLength(1); expect(posts()[0].url).toBe(`/transfer/32/scan-${d === 'In' ? 'in' : 'out'}`)
  expect(JSON.parse(posts()[0].data).containerBarcode).toBe('I000002')
})
test('unmounted inbound lookup cannot dispatch a POST or change another mounted draft', async () => {
  detail = async () => order(3); await render('In'); await act(async () => scanner.scan!('I000001')); await pause()
  let resolve!: (value: unknown) => void; location = () => new Promise(r => { resolve = r })
  await act(async () => { void scanner.scan!('R88') }); await pause()
  await click('← 返回'); await act(async () => resolve({ id: 88, code: 'R88' })); await pause()
  expect(posts()).toHaveLength(0); expect(host.textContent).toContain('调拨执行列表')
  expect((host.querySelector('[aria-label="另一草稿"]') as HTMLInputElement).value).toBe('原草稿未保存')
})
test.each(['In', 'Out'] as const)('explicit original failure %s stays distinct from completed order state', async d => {
  await seed(d); await render(d); receipt = async () => ({ status: 'failed', data: null, message: '原请求明确未执行' })
  await click('确认上次结果'); expect(localStorage.getItem(pendingKey(d))).toBeNull()
  expect(host.textContent).toContain('原请求明确未执行'); expect(host.textContent).toContain('已完成'); expect(posts()).toHaveLength(0)
})
test.each([['In', 1], ['Out', 1], ['In', 5], ['Out', 5]] as const)('non-executable %s status %s retains only original receipt recovery', async (d, status) => {
  detail = async () => order(status); await seed(d); await render(d)
  expect(button('确认上次结果')).toBeTruthy(); expect(scanner.scan).toBeNull(); expect(posts()).toHaveLength(0)
  expect(host.textContent).toContain(status === 1 ? '草稿' : '已取消')
})
test.each(['In', 'Out'] as const)('mismatched detail identity %s cannot submit a new container against the route', async d => {
  detail = async () => ({ ...order(3), id: 99 }); await render(d)
  expect(scanner.disabled).toBe(true); await act(async () => scanner.scan!('I000001')); await pause()
  if (d === 'In') { await act(async () => scanner.scan!('R88')); await pause() }
  expect(posts()).toHaveLength(0)
})
