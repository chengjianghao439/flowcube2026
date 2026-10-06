// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { AxiosError, type InternalAxiosRequestConfig } from 'axios'
import api, { setApiClientBaseURL } from '@/api/client'
import { useAuthStore } from '@/store/authStore'
import { PERMISSIONS } from '@/lib/permission-codes'
import PdaSplitPage from './split'
vi.mock('@/hooks/useNetworkStatus', () => ({ useNetworkStatus: () => 'online' }))
vi.mock('@/lib/toast', () => ({ toast: { error: vi.fn(), warning: vi.fn(), success: vi.fn() } }))
vi.mock('@/components/pda/PdaScanner', () => ({ default: ({ onScan, disabled }: { onScan: (code: string) => void; disabled?: boolean }) => <><button disabled={disabled} onClick={() => onScan('I11')}>扫描I11</button><button disabled={disabled} onClick={() => onScan('B12')}>扫描B12</button></> }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let host: HTMLDivElement, root: Root | null, qc: QueryClient, owner = 78100
const originalAdapter = api.defaults.adapter
const requests: InternalAxiosRequestConfig[] = []
let status = 'not_found', failQuery = false
let receiptData: unknown
let readReceipt: (() => Promise<unknown>) | null
let post: (config: InternalAxiosRequestConfig) => Promise<unknown>
let load: ((config: InternalAxiosRequestConfig) => Promise<unknown>) | null
const key = () => `flowcube_pda_split_v1:${owner}`
const success = { sourceContainerId: 11, sourceBarcode: 'I11', sourceRemainingAfter: 7, newContainerId: 12, newBarcode: 'B12', newContainerKind: 'plastic_box', productId: 3, warehouseId: 8, printJobId: null, printJobIds: [], noPrinterCount: 0, renderFailedCount: 0 }
const record = () => ({ accountId: owner, endpoint: 'https://split-a.invalid/api', sourceContainerId: 11, sourceBarcode: 'I11', productId: 3, warehouseId: 8, remaining: 10, action: 'inventory.container.split.11', requestKey: 'original-key', createdAt: new Date().toISOString(), body: { qty: 3, printLabel: true } })
const seed = (r: object = record()) => localStorage.setItem(key(), JSON.stringify({ version: 1, records: [r] }))
async function draw(active = true) { await act(async () => root!.render(<QueryClientProvider client={qc}><MemoryRouter><PdaSplitPage active={active} /></MemoryRouter></QueryClientProvider>)) }
async function mount() { root = createRoot(host); await draw() }
async function click(label: string) { const b = [...host.querySelectorAll('button')].find(b => b.textContent === label); expect(b, label).toBeTruthy(); await act(async () => { b!.click() }) }
const flush = () => new Promise(resolve => setTimeout(resolve, 20))
async function input(value: string) { const i = host.querySelector<HTMLInputElement>('input[type="number"]')!; await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(i, value); i.dispatchEvent(new Event('input', { bubbles: true })) }) }
beforeEach(() => {
  owner++; localStorage.clear(); requests.length = 0; status = 'not_found'; failQuery = false; root = null; load = null; receiptData = success; readReceipt = null
  setApiClientBaseURL('https://split-a.invalid/api')
  useAuthStore.getState().login('offline', null, { id: owner, username: 'fixture', realName: 'fixture', roleName: 'fixture', roleId: 5, permissions: [PERMISSIONS.INVENTORY_VIEW, PERMISSIONS.INVENTORY_CONTAINER_SPLIT] })
  post = async config => { throw new AxiosError('server uncertain', 'ERR_BAD_RESPONSE', config, {}, { status: 503, statusText: 'Unavailable', data: { success: false, message: 'unknown' }, headers: {}, config }) }
  api.defaults.adapter = async config => {
    requests.push(config)
    let data: unknown
    if (config.method === 'post') data = await post(config)
    else if (config.url?.startsWith('/inventory/containers/barcode/')) data = load ? await load(config) : { containerId: config.url.endsWith('B12') ? 12 : 11, barcode: config.url.endsWith('B12') ? 'B12' : 'I11', containerKind: config.url.endsWith('B12') ? 'plastic_box' : 'inventory', containerStatus: 'stored', productId: 3, warehouseId: 8, productName: '离线商品', productCode: 'P3', remainingQty: 10 }
    else if (config.url?.startsWith('/system/request-status/')) { if (failQuery) throw new Error('query unavailable'); data = readReceipt ? await readReceipt() : { status, data: status === 'success' ? receiptData : null, resourceType: 'inventory_container', resourceId: 11 } }
    else throw new Error(`禁止未stub请求 ${config.url}`)
    return { data: { success: true, data }, status: 200, statusText: 'OK', headers: {}, config }
  }
  host = document.createElement('div'); document.body.append(host); qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
})
afterEach(() => { act(() => root?.unmount()); qc.clear(); host.remove(); api.defaults.adapter = originalAdapter; useAuthStore.getState().logout(); vi.restoreAllMocks() })
test('真实PDA拆分5xx保留原账号/服务器/源码/完整body/key，重挂只展示不自动POST或查询', async () => {
  await mount(); await click('扫描I11'); await act(flush); await input('3'); await click('确认拆分'); await act(flush)
  const submitted = requests.find(r => r.method === 'post')!
  expect(submitted.headers.get('X-Request-Key')).toBeTruthy(); expect(submitted.headers.get('X-Client')).toBe('pda')
  const stored = JSON.parse(localStorage.getItem(key())!).records[0]
  expect(stored).toMatchObject({ accountId: owner, endpoint: 'https://split-a.invalid/api', sourceContainerId: 11, sourceBarcode: 'I11', body: { qty: 3, printLabel: false } })
  expect(stored.requestKey).toBe(submitted.headers.get('X-Request-Key'))
  expect(host.querySelector<HTMLInputElement>('input[type="number"]')?.disabled).toBe(true)
  act(() => root!.unmount()); root = null; const count = requests.length; await mount(); await act(flush)
  expect(host.textContent).toContain('原提交'); expect(host.textContent).toContain('I11'); expect(requests).toHaveLength(count)
  await click('重新扫码'); expect(host.textContent).toContain('I11'); expect(localStorage.getItem(key())).toBeTruthy()
})
test('首发明确未执行的业务拒绝释放记录并保留输入可修正；恢复重试4xx仍保留原未知', async () => {
  post = async config => { throw new AxiosError('rejected', 'ERR_BAD_REQUEST', config, {}, { status: 400, statusText: 'Bad Request', data: { success: false, message: '个体条码不可拆分', code: 'INDIVIDUAL_CONTAINER_NO_SPLIT', data: { containerSplitNotExecuted: true } }, headers: {}, config }) }
  await mount(); await click('扫描I11'); await act(flush); await input('3'); await click('确认拆分'); await act(flush)
  expect(localStorage.getItem(key())).toBeNull(); expect(host.querySelector<HTMLInputElement>('input[type="number"]')?.value).toBe('3')
  expect(host.querySelector<HTMLInputElement>('input[type="number"]')?.disabled).toBe(false)
  seed(); act(() => root!.unmount()); root = null; await mount(); await click('查询原拆分结果'); await act(flush); await click('按原内容重试'); await act(flush)
  expect(localStorage.getItem(key())).toBeTruthy()
  expect(requests.filter(r => r.method === 'post').at(-1)?.headers.get('X-Request-Key')).toBe('original-key')
})
test.each(['PERMISSION_DENIED', 'WAREHOUSE_SCOPE_DENIED'])('首发已知前置403可修正；恢复重试同拒绝不能抹掉原未知：%s', async code => {
  post = async config => { throw new AxiosError('denied', 'ERR_BAD_REQUEST', config, {}, { status: 403, statusText: 'Forbidden', data: { success: false, message: '无权执行', code, data: null }, headers: {}, config }) }
  await mount(); await click('扫描I11'); await act(flush); await input('3'); await click('确认拆分'); await act(flush)
  expect(localStorage.getItem(key())).toBeNull(); expect(host.querySelector<HTMLInputElement>('input[type="number"]')?.disabled).toBe(false)
  seed(); act(() => root!.unmount()); root = null; await mount(); await click('查询原拆分结果'); await act(flush); await click('按原内容重试'); await act(flush)
  expect(localStorage.getItem(key())).toBeTruthy()
})
test('查询失败/pending均保留；fresh not_found仅员工主动原键原body重试', async () => {
  seed(); await mount(); failQuery = true; await click('查询原拆分结果'); await act(flush)
  expect(localStorage.getItem(key())).toBeTruthy(); expect(requests.filter(r => r.method === 'post')).toHaveLength(0)
  failQuery = false; status = 'pending'; await click('查询原拆分结果'); await act(flush)
  expect([...host.querySelectorAll('button')].some(b => b.textContent === '按原内容重试' && !b.disabled)).toBe(false)
  status = 'not_found'; await click('查询原拆分结果'); await act(flush); await click('按原内容重试'); await act(flush)
  const submitted = requests.find(r => r.method === 'post')!
  expect(submitted.headers.get('X-Request-Key')).toBe('original-key'); expect(JSON.parse(submitted.data)).toEqual({ qty: 3, printLabel: true }); expect(submitted.baseURL).toBe('https://split-a.invalid/api')
  expect(localStorage.getItem(key())).toBeTruthy()
})
test.each(['expired', 'future', 'missing-body'])('过期/异常时间/残缺快照仅核对，不因not_found再扣量：%s', async bad => {
  const r = record(); if (bad === 'expired') r.createdAt = new Date(Date.now() - 8 * 86400000).toISOString(); if (bad === 'future') r.createdAt = new Date(Date.now() + 86400000).toISOString()
  seed(bad === 'missing-body' ? { ...r, body: undefined } : r); await mount(); await click('查询原拆分结果'); await act(flush)
  expect(host.textContent).toContain('人工核对'); expect([...host.querySelectorAll('button')].some(b => b.textContent === '按原内容重试' && !b.disabled)).toBe(false)
  expect(requests.filter(r => r.method === 'post')).toHaveLength(0); expect(localStorage.getItem(key())).toBeTruthy()
})
test('A→B→A改址后的迟到POST成功不得确认或清原记录', async () => {
  let resolve!: (data: unknown) => void; post = () => new Promise(r => { resolve = r })
  await mount(); await click('扫描I11'); await act(flush); await input('3')
  act(() => [...host.querySelectorAll('button')].find(b => b.textContent === '确认拆分')!.click()); await act(flush)
  act(() => { setApiClientBaseURL('https://split-b.invalid/api'); setApiClientBaseURL('https://split-a.invalid/api') })
  await act(async () => { resolve(success); await flush() })
  expect(localStorage.getItem(key())).toBeTruthy(); expect(host.textContent).not.toContain('拆分成功')
})
test('扫描load在动作隐藏后迟到不填入表单；后台scanner不吃广播', async () => {
  let resolve!: (data: unknown) => void; load = () => new Promise(r => { resolve = r })
  await mount(); act(() => [...host.querySelectorAll('button')].find(b => b.textContent === '扫描I11')!.click()); await act(flush)
  await draw(false); await act(async () => { resolve({ containerId: 11, barcode: 'I11', containerKind: 'inventory', containerStatus: 'stored', productId: 3, warehouseId: 8, productName: '旧读商品', productCode: 'P3', remainingQty: 10 }); await flush() })
  expect(host.textContent).not.toContain('旧读商品'); expect(host.querySelector('input[type="number"]')).toBeNull()
  expect([...host.querySelectorAll('button')].find(b => b.textContent === '扫描I11')?.disabled).toBe(true)
})
test('撤权→恢复后的迟到成功仍不得清原记录；撤写权可查本人结果但不得retry', async () => {
  let resolve!: (data: unknown) => void; post = () => new Promise(r => { resolve = r })
  await mount(); await click('扫描I11'); await act(flush); await input('3')
  act(() => [...host.querySelectorAll('button')].find(b => b.textContent === '确认拆分')!.click()); await act(flush)
  act(() => { useAuthStore.getState().updateUser({ permissions: [] }); useAuthStore.getState().updateUser({ permissions: [PERMISSIONS.INVENTORY_VIEW, PERMISSIONS.INVENTORY_CONTAINER_SPLIT] }) })
  await act(async () => { resolve(success); await flush() }); expect(localStorage.getItem(key())).toBeTruthy()
  act(() => useAuthStore.getState().updateUser({ permissions: [] })); await click('查询原拆分结果'); await act(flush)
  expect(requests.filter(r => r.method === 'get' && r.url?.startsWith('/system/request-status'))).toHaveLength(1)
  expect([...host.querySelectorAll('button')].some(b => b.textContent === '按原内容重试' && !b.disabled)).toBe(false)
})
test.each(['account-roundtrip', 'server-roundtrip'])('原回执query晚到也不能跨离开再返回的上下文清记录：%s', async change => {
  let resolve!: (data: unknown) => void; readReceipt = () => new Promise(r => { resolve = r })
  seed(); await mount(); act(() => [...host.querySelectorAll('button')].find(b => b.textContent === '查询原拆分结果')!.click()); await act(flush)
  act(() => {
    if (change === 'account-roundtrip') {
      useAuthStore.getState().login('other', null, { id: owner + 900, username: 'other', realName: 'other', roleName: 'fixture', roleId: 5, permissions: [] })
      useAuthStore.getState().login('offline', null, { id: owner, username: 'fixture', realName: 'fixture', roleName: 'fixture', roleId: 5, permissions: [PERMISSIONS.INVENTORY_VIEW, PERMISSIONS.INVENTORY_CONTAINER_SPLIT] })
    } else { setApiClientBaseURL('https://split-b.invalid/api'); setApiClientBaseURL('https://split-a.invalid/api') }
  })
  await act(async () => { resolve({ status: 'success', data: success, resourceType: 'inventory_container', resourceId: 11 }); await flush() })
  expect(localStorage.getItem(key())).toBeTruthy(); expect(host.textContent).not.toContain('已核对：拆分成功')
})
test('登出不删除原拆分；原账号重登录重挂仍可见且不自动重发', async () => {
  seed(); await mount(); act(() => { root!.unmount(); root = null; useAuthStore.getState().logout() })
  expect(localStorage.getItem(key())).toBeTruthy()
  useAuthStore.getState().login('offline', null, { id: owner, username: 'fixture', realName: 'fixture', roleName: 'fixture', roleId: 5, permissions: [PERMISSIONS.INVENTORY_VIEW, PERMISSIONS.INVENTORY_CONTAINER_SPLIT] })
  await mount(); expect(host.textContent).toContain('original-key'); expect(requests).toHaveLength(0)
})
test('残缺原body或成功身份不一致仍保留人工核对，不把普通返回当本次成功', async () => {
  seed({ ...record(), body: undefined }); status = 'success'; await mount(); await click('查询原拆分结果'); await act(flush)
  expect(localStorage.getItem(key())).toBeTruthy(); expect(host.textContent).toContain('人工核对')
})
test.each(['wrong-source', 'wrong-new', 'missing-target-qty'])('完整body的异常成功仍待人工核对：%s', async kind => {
  const r = record()
  if (kind === 'missing-target-qty') {
    seed({ ...r, body: { ...r.body, targetContainerId: 12 } })
    receiptData = { ...success, targetContainerId: 12, targetBarcode: 'B12' }
  } else {
    seed(r); receiptData = { ...success, ...(kind === 'wrong-source' ? { sourceContainerId: 99 } : { newContainerId: 11 }) }
  }
  status = 'success'; await mount(); await click('查询原拆分结果'); await act(flush)
  expect(localStorage.getItem(key())).toBeTruthy(); expect(host.textContent).toContain('人工核对')
  expect(host.textContent).not.toContain('已核对：拆分成功')
})
test.each(['account', 'server-roundtrip'])('保留的来源草稿不能跨读取上下文显示或执行：%s', async change => {
  await mount(); await click('扫描I11'); await act(flush); await input('3')
  act(() => {
    if (change === 'account') useAuthStore.getState().login('other', null, { id: owner + 900, username: 'other', realName: 'other', roleName: 'fixture', roleId: 5, permissions: [PERMISSIONS.INVENTORY_VIEW, PERMISSIONS.INVENTORY_CONTAINER_SPLIT] })
    else { setApiClientBaseURL('https://split-b.invalid/api'); setApiClientBaseURL('https://split-a.invalid/api') }
  })
  expect(host.textContent).not.toContain('离线商品'); expect(host.querySelector('input[type="number"]')).toBeNull()
  expect(requests.filter(r => r.method === 'post')).toHaveLength(0); expect(host.textContent).toContain('重新扫码')
})
