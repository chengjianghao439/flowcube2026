// @vitest-environment jsdom
import { webcrypto } from 'node:crypto'
import { AxiosError, type InternalAxiosRequestConfig } from 'axios'
import { act, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import api, { setApiClientBaseURL } from '@/api/client'
import { useAuthStore } from '@/store/authStore'
import { AppToast } from '@/components/shared/AppToast'
import type { User } from '@/types'
import Sort from './sort'
import Ship from './ship'
import Inventory from './inventory-query'
import Split from './split'
import Fill from './fill'
import PlasticBox from './plastic-box'
import Workbench from './index'
import Pick from './task'

// 真实页面、Scanner、React Query、API拦截器、反馈与原请求恢复均保留；只隔离设备和网络。
const device = vi.hoisted(() => ({ bound: true }))
vi.mock('@/hooks/useNetworkStatus', () => ({ useNetworkStatus: () => 'online' }))
vi.mock('@/lib/pdaDeviceBinding', () => ({
  getDeviceCredential: () => device.bound ? { deviceCode: 'manual-test-device' } : null,
  getDeviceSession: () => device.bound ? { token: 'synthetic-device-ticket', warehouseId: 8 } : null,
}))

let host: HTMLDivElement, root: Root, qc: QueryClient, account = 889000
const originalAdapter = api.defaults.adapter
const requests: InternalAxiosRequestConfig[] = []
type Reply = (config: InternalAxiosRequestConfig) => unknown | Promise<unknown>
let lookup: Reply, write: Reply, receipt: Reply, task: Reply, todos: Reply
const source = { containerId: 11, barcode: 'I000011', productId: 3, warehouseId: 8, warehouseName: '测试仓', productName: '测试商品', productCode: 'P003', remainingQty: 10, containerKind: 'inventory', containerStatus: 'stored' }
const product = { taskId: 7, itemId: 9, taskNo: 'WT007', productCode: 'P003', productName: '测试商品', sortableQty: 2, unit: '个', sortingBinCode: 'A01' }
const parcel = { warehouseTaskId: 7, taskNo: 'WT007', customerName: '合成客户', warehouseName: '测试仓', warehouseTaskStatus: 6, packages: [] }
const notFound = '未找到可用的库存条码，请核对条码后重试'
function rejected(config: InternalAxiosRequestConfig, status = 404, message = '库存条码不存在或已失效', code = 'INVENTORY_BARCODE_NOT_FOUND'): never {
  throw new AxiosError('Request failed', 'ERR_BAD_REQUEST', config, undefined, { config, status, statusText: 'Rejected', headers: {}, data: { success: false, message, code } })
}
function deferred() {
  let resolve!: (value: unknown) => void, reject!: (error: unknown) => void
  const promise = new Promise<unknown>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const visible = (element: Element) => !element.closest('[hidden]')
const manualInput = () => [...host.querySelectorAll<HTMLInputElement>('[data-scanner-manual][aria-label^="手动输入："]')].find(visible)
async function mount(page: ReactElement, initialEntry = '/') {
  await act(async () => root.render(<QueryClientProvider client={qc}><MemoryRouter initialEntries={[initialEntry]}>{page}<AppToast placement="pda" /></MemoryRouter></QueryClientProvider>))
  await settle()
}
async function settle() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 15)) }) }
async function inputBarcode(code: string) {
  await act(async () => { [...host.querySelectorAll('button')].find(b => visible(b) && b.textContent === '手动输入')!.click() })
  const input = manualInput()!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, code)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  return input
}
async function enter(input: HTMLInputElement) {
  await act(async () => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })
  await settle()
}
async function retained(input: HTMLInputElement, code: string) {
  expect(manualInput()).toBe(input)
  expect(input.value).toBe(code)
  await vi.waitFor(() => expect(document.activeElement).toBe(input))
  expect(input.selectionStart).toBe(0); expect(input.selectionEnd).toBe(code.length)
  expect(document.querySelectorAll('.fc-toast')).toHaveLength(0)
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: webcrypto })
  Object.defineProperty(navigator, 'locks', { configurable: true, value: { request: async (_name: string, options: unknown, fn?: (lock: object) => unknown) => (typeof options === 'function' ? options : fn!)({}) } })
  device.bound = true; localStorage.clear(); requests.length = 0; account++
  setApiClientBaseURL('https://pda-manual.invalid/api')
  useAuthStore.getState().login('synthetic-token', null, { id: account, roleId: 1, username: 'manual-worker', permissions: [] } as unknown as User)
  lookup = config => rejected(config)
  write = () => ({ taskId: 7, allSorted: false, progress: '2/4' })
  receipt = () => ({ status: 'pending', data: null, message: '原请求仍在处理' })
  task = () => ({ id: 7, taskNo: 'WT007', status: 3, statusName: '待分拣' })
  todos = () => ({ inbound: 4 })
  api.defaults.adapter = async config => {
    requests.push(config)
    let data: unknown
    if (config.url === '/sorting-bins' || config.url === '/warehouse-tasks/return-out-pending') data = config.url === '/sorting-bins' ? [] : { list: [], total: 0, page: 1, pageSize: 100 }
    else if (config.url === '/pda/todo-counts') data = await todos(config)
    else if (config.url?.startsWith('/system/request-status/')) data = await receipt(config)
    else if (config.url === '/warehouse-tasks/7') data = await task(config)
    else if (config.url === '/warehouse-tasks/7/pick-suggestions') data = { items: [] }
    else if (config.method === 'put' || config.method === 'post') data = await write(config)
    else if (config.url === '/sorting-bins/scan' || config.url === '/inventory/query-by-barcode' || config.url?.startsWith('/inventory/containers/barcode/') || config.url?.startsWith('/packages/barcode/')) data = await lookup(config)
    else throw Error(`禁止未声明的网络端点 ${config.method} ${config.url}`)
    return { config, data: { success: true, data }, status: 200, statusText: 'OK', headers: {} }
  }
  qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => {
  await act(async () => { root.unmount(); qc.clear() }); host.remove()
  api.defaults.adapter = originalAdapter; useAuthStore.getState().logout(); localStorage.clear(); vi.restoreAllMocks()
})

const pages = [
  { name: '分拣商品', page: <Sort />, code: 'P003', result: product },
  { name: '出库', page: <Ship />, code: 'L000007', result: parcel },
  { name: '库存查询', page: <Inventory />, code: 'I000011', result: [source] },
  { name: '拆分', page: <Split />, code: 'I000011', result: source },
  { name: '放货来源', page: <Fill />, code: 'I000011', result: source },
]
async function mountPick() {
  task = () => ({ id: 7, taskNo: 'WT007', status: 2, statusName: '待拣货', items: [{ id: 9, productId: 3, requiredQty: 2, pickedQty: 0 }] })
  await mount(<Routes><Route path="/pda/task/:id" element={<Pick />} /></Routes>, '/pda/task/7')
}
test('拣货：手输UITEST123格式拒绝后顶部反馈，原码保留并聚焦全选', async () => {
  await mountPick(); const input = await inputBarcode('UITEST123'); await enter(input)
  const alert = host.querySelector('[role="alert"]')
  expect(alert?.textContent).toContain('识别失败')
  expect(host.querySelector('header')?.nextElementSibling).toBe(alert)
  await retained(input, 'UITEST123')
  expect(requests.filter(r => r.url === '/scan-logs')).toHaveLength(0)
})
test('拣货：合法形状的不存在条码在查询结束前双回车只查一次，拒绝后保留手输', async () => {
  const pending = deferred(); lookup = () => pending.promise
  await mountPick(); const input = await inputBarcode('I123456'); await enter(input); await enter(input)
  const lookups = requests.filter(r => r.url?.startsWith('/inventory/containers/barcode/'))
  expect(lookups).toHaveLength(1); expect(manualInput()).toBe(input); expect(input.readOnly).toBe(true)
  await act(async () => { try { rejected(lookups[0]) } catch (error) { pending.reject(error) } }); await settle()
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('库存条码')
  await retained(input, 'I123456')
  expect(requests.filter(r => r.url === '/scan-logs')).toHaveLength(0)
})
test.each(['success', 'failed'])('拣货：未知扫码不清原码，原键%s回执后才清理或恢复手输', async result => {
  lookup = () => source; write = config => config.url === '/scan-logs' ? rejected(config, 503, '网络中断', 'SERVICE_UNAVAILABLE') : null
  await mountPick(); const input = await inputBarcode('I000011'); await enter(input)
  await vi.waitFor(() => expect(host.textContent).toContain('结果待确认'))
  expect(manualInput()).toBe(input); expect(input.readOnly).toBe(true)
  await enter(input)
  receipt = () => ({ status: result, data: { id: 7 }, message: '已确认原结果' })
  await vi.waitFor(() => expect([...host.querySelectorAll('button')].some(button => button.textContent === '确认上次结果' && !button.disabled)).toBe(true))
  await act(async () => { [...host.querySelectorAll('button')].find(button => button.textContent === '确认上次结果')!.click() }); await settle()
  if (result === 'success') await vi.waitFor(() => expect(manualInput()).toBeUndefined())
  else { await retained(input, 'I000011'); expect(input.readOnly).toBe(false) }
  const writes = requests.filter(r => r.url === '/scan-logs')
  expect(writes).toHaveLength(1)
  expect(requests.filter(r => r.url?.startsWith('/system/request-status/')).every(r => r.url?.includes(String(writes[0].headers.get('X-Request-Key'))))).toBe(true)
})
test('拣货：自动核对原键为明确失败时恢复手输，不依赖已消失的查询按钮', async () => {
  lookup = () => source
  write = config => config.url === '/scan-logs' ? rejected(config, 503, '网络中断', 'SERVICE_UNAVAILABLE') : null
  receipt = () => ({ status: 'failed', data: null, message: '原拣货未执行' })
  await mountPick(); const input = await inputBarcode('I000011'); await enter(input)
  await vi.waitFor(() => expect(input.readOnly).toBe(false))
  await retained(input, 'I000011')
  expect(requests.filter(r => r.url === '/scan-logs')).toHaveLength(1)
})
test('分拣：找不到UITEST123时使用未找到提示，保留手输且不提交分拣', async () => {
  lookup = () => null
  await mount(<Sort />); const input = await inputBarcode('UITEST123'); await enter(input)
  expect(host.querySelector('[role="alert"]')?.textContent).toBe('未找到可分拣的商品或取货码，请核对条码后重试')
  await retained(input, 'UITEST123')
  expect(requests.filter(r => r.method === 'put')).toHaveLength(0)
})
test.each(pages)('$name：真实查询失败保留手输原码、聚焦全选且只显示页面反馈', async ({ page, code, name }) => {
  await mount(page); const input = await inputBarcode(code); await enter(input)
  const alert = host.querySelector('[role="alert"]')
  expect(alert).not.toBeNull()
  expect(host.querySelector('header')?.nextElementSibling).toBe(alert)
  if (name === '库存查询' || name === '拆分' || name === '放货来源') expect(alert?.textContent).toBe(notFound)
  await retained(input, code)
})
test.each(pages)('$name：异步未结束保留输入，连续Enter不重复，业务成功才收起', async ({ page, code, result }) => {
  const pending = deferred(); lookup = () => pending.promise
  await mount(page); const input = await inputBarcode(code); await enter(input); await enter(input)
  expect(manualInput()).toBe(input)
  expect(requests.filter(r => r.url !== '/sorting-bins' && r.url !== '/warehouse-tasks/return-out-pending')).toHaveLength(1)
  await act(async () => pending.resolve(result)); await settle()
  await vi.waitFor(() => expect(manualInput()).toBeUndefined())
})

test('分拣恢复入口挂载前手输已只读，不能以只读作为可点击的依据', async () => {
  lookup = () => product; write = config => rejected(config, 503, '网络中断', 'SERVICE_UNAVAILABLE')
  await mount(<Sort />); await enter(await inputBarcode('P003'))
  const lockGate = deferred()
  const originalLocks = navigator.locks
  Object.defineProperty(navigator, 'locks', { configurable: true, value: { request: async (name: string, options: unknown, fn?: (lock: object) => unknown) => {
    if (name.startsWith('flowcube-pda:')) await lockGate.promise
    return (typeof options === 'function' ? options : fn!)({})
  } } })
  try {
    const input = await inputBarcode('A01'); await enter(input)
    expect(input.readOnly).toBe(true)
    expect([...host.querySelectorAll('button')].find(button => button.textContent === '确认上次结果')).toBeUndefined()
    await act(async () => lockGate.resolve(null))
    await vi.waitFor(() => expect([...host.querySelectorAll('button')].some(button => visible(button) && button.textContent === '确认上次结果' && !button.disabled)).toBe(true))
  } finally {
    await act(async () => lockGate.resolve(null)); await settle()
    Object.defineProperty(navigator, 'locks', { configurable: true, value: originalLocks })
  }
})

test.each([
  { name: '拆分待上架', page: <Split />, result: { ...source, containerStatus: 'waiting_putaway' }, message: '待上架' },
  { name: '拆分任务锁定', page: <Split />, result: { ...source, lockedByTaskId: 5 }, message: '锁定' },
  { name: '拆分固定方向', page: <Split fixedMode="repack" />, result: source, message: '须扫塑料盒' },
  { name: '放货来源为盒', page: <Fill />, result: { ...source, containerKind: 'plastic_box' }, message: '不能作为放货来源' },
  { name: '放货来源无余量', page: <Fill />, result: { ...source, remainingQty: 0 }, message: '已无余量' },
])('$name：HTTP成功但业务拒绝仍保留手输', async ({ page, result, message }) => {
  lookup = () => result; await mount(page)
  const input = await inputBarcode('I000011'); await enter(input)
  expect(host.querySelector('[role="alert"]')?.textContent).toContain(message)
  await retained(input, 'I000011')
})

test('放货目标不是塑料盒时保留目标手输，来源不丢失', async () => {
  lookup = () => source; await mount(<Fill />)
  await enter(await inputBarcode('I000011'))
  const input = await inputBarcode('I000012'); await enter(input)
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('目标必须是塑料盒')
  expect(host.textContent).toContain('来源：I000011'); await retained(input, 'I000012')
})

test('出库拒绝错误码类型时解释物流条码要求，不发查询或写请求', async () => {
  await mount(<Ship />); const input = await inputBarcode('I000011'); await enter(input)
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('物流条码')
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('库存条码')
  expect(requests.filter(r => r.url !== '/warehouse-tasks/return-out-pending')).toHaveLength(0)
  await retained(input, 'I000011')
})

test('出库读取成功仍等待真实出库结果；明确写拒绝保留原输入', async () => {
  lookup = () => parcel; const pending = deferred(); write = () => pending.promise
  await mount(<Ship />); const input = await inputBarcode('L000007'); await enter(input)
  await vi.waitFor(() => expect(requests.some(r => r.method === 'put')).toBe(true))
  expect(manualInput()).toBe(input)
  const config = requests.find(r => r.method === 'put')!
  await act(async () => { try { rejected(config, 409, '箱贴尚未打印，不能出库', 'PACKAGE_NOT_READY') } catch (error) { pending.reject(error) } }); await settle()
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('箱贴尚未打印')
  await retained(input, 'L000007')
})

test('分拣错格和明确写失败保留第二步目标与手输', async () => {
  lookup = () => product; await mount(<Sort />); await enter(await inputBarcode('P003'))
  let input = await inputBarcode('A02'); await enter(input)
  await retained(input, 'A02'); expect(host.textContent).toContain('WT007')
  // 在原输入内修正，明确拒绝不能清掉原分拣提示。
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'A01'); input.dispatchEvent(new Event('input', { bubbles: true })) })
  write = config => rejected(config, 409, '任务已挂起，请联系主管', 'TASK_PAUSED')
  await enter(input); input = manualInput()!
  await retained(input, 'A01'); expect(host.textContent).toContain('请将以下商品放入指定分拣格')
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('任务已挂起')
})

test('分拣写已确认成功，后续状态读取失败不会伪装本次写失败或开放原码重发', async () => {
  lookup = () => product; task = config => rejected(config, 503, '暂时无法读取任务状态', 'SERVICE_UNAVAILABLE')
  await mount(<Sort />); await enter(await inputBarcode('P003')); await enter(await inputBarcode('A01'))
  await vi.waitFor(() => expect(manualInput()).toBeUndefined())
  expect(host.textContent).toContain('本次分拣已确认')
  expect(host.textContent).not.toContain('分拣失败')
  expect(requests.filter(r => r.method === 'put')).toHaveLength(1)
})

test.each([{ name: '分拣', page: <Sort />, barcode: 'A01' }, { name: '出库', page: <Ship />, barcode: 'L000007' }])('$name：真实5xx保留原请求，手输不能换键重发，只查询原回执', async ({ page, name, barcode }) => {
  lookup = () => name === '分拣' ? product : parcel
  write = config => rejected(config, 503, '网络中断', 'SERVICE_UNAVAILABLE')
  await mount(page)
  if (name === '分拣') await enter(await inputBarcode('P003'))
  const input = await inputBarcode(barcode); await enter(input)
  await vi.waitFor(() => expect(host.textContent).toContain('结果待确认'))
  expect(manualInput()).toBe(input); expect(input.readOnly || input.disabled).toBe(true)
  await enter(input); await settle()
  const writes = requests.filter(r => r.method === 'put')
  expect(writes).toHaveLength(1)
  expect(writes[0].headers.get('X-Request-Key')).toBeTruthy()
  const queries = requests.filter(r => r.url?.startsWith('/system/request-status/'))
  expect(queries.length).toBeGreaterThan(0)
  expect(queries.every(r => r.url?.includes(String(writes[0].headers.get('X-Request-Key'))))).toBe(true)
})

test.each([
  { name: '分拣', page: <Sort />, code: 'A01', result: 'success' }, { name: '分拣', page: <Sort />, code: 'A01', result: 'failed' },
  { name: '出库', page: <Ship />, code: 'L000007', result: 'success' }, { name: '出库', page: <Ship />, code: 'L000007', result: 'failed' },
])('$name原键回执$result后才清理或恢复原手输，不再写入', async ({ name, page, code, result }) => {
  lookup = () => name === '分拣' ? product : parcel
  write = config => rejected(config, 503, '网络中断', 'SERVICE_UNAVAILABLE')
  await mount(page)
  if (name === '分拣') await enter(await inputBarcode('P003'))
  const input = await inputBarcode(code); await enter(input)
  // 只读也覆盖原键持久化前的提交阶段；真实恢复入口挂载且可点击才可核原结果。
  await vi.waitFor(() => expect([...host.querySelectorAll('button')].some(button => visible(button) && button.textContent === '确认上次结果' && !button.disabled)).toBe(true))
  expect(input.readOnly).toBe(true)
  receipt = () => ({ status: result, data: { allSorted: false, progress: '2/4' }, message: '已确认原结果' })
  await act(async () => { [...host.querySelectorAll('button')].find(b => b.textContent === '确认上次结果')!.click() }); await settle()
  if (result === 'success') {
    await vi.waitFor(() => expect(manualInput()).toBeUndefined())
    expect(host.textContent).not.toContain('请将以下商品放入指定分拣格')
  } else {
    await retained(input, code); expect(input.readOnly).toBe(false)
    if (name === '分拣') expect(host.textContent).toContain('请将以下商品放入指定分拣格')
  }
  expect(requests.filter(r => r.method === 'put')).toHaveLength(1)
})

test('隐藏放货实例的迟到读取不填新目标、不清手输、不抢焦点', async () => {
  const pending = deferred(); lookup = () => pending.promise
  await mount(<PlasticBox />)
  await act(async () => { [...host.querySelectorAll('button')].find(b => b.textContent?.includes('整件放入盒'))!.click() })
  const input = await inputBarcode('I000011'); await enter(input)
  await act(async () => { [...host.querySelectorAll('button')].find(b => visible(b) && b.textContent === '← 返回')!.click() })
  const next = [...host.querySelectorAll<HTMLButtonElement>('button')].find(b => visible(b) && b.textContent?.includes('盒还原整件'))!
  next.focus()
  await act(async () => pending.resolve(source)); await settle()
  expect(document.activeElement).toBe(next); expect(input.value).toBe('I000011')
  expect(host.textContent).not.toContain('来源：I000011')
  expect(requests.filter(r => r.url?.startsWith('/inventory/containers/barcode/'))).toHaveLength(1)
})

test.each(['WAREHOUSE_SCOPE_DENIED', 'SERVICE_UNAVAILABLE'])('库存查询保留%s真实中文原因', async code => {
  lookup = config => rejected(config, code === 'WAREHOUSE_SCOPE_DENIED' ? 403 : 503, '请联系主管核对当前仓库', code)
  await mount(<Inventory />); const input = await inputBarcode('I000011'); await enter(input)
  expect(host.querySelector('[role="alert"]')?.textContent).toBe('请联系主管核对当前仓库')
  await retained(input, 'I000011')
})

test.each(['empty', 'not_found', 'expired'])('库存%s：已知找不到库存的中文统一，单个Flash放在Header后', async kind => {
  lookup = config => kind === 'empty' ? [] : rejected(config, 404, kind === 'expired' ? '库存条码不存在或已失效' : '未找到该条码对应的库存条码')
  await mount(<Inventory />); await enter(await inputBarcode('I000011'))
  const alerts = host.querySelectorAll('[role="alert"]'); expect(alerts).toHaveLength(1); expect(alerts[0].textContent).toBe(notFound)
  expect(host.querySelector('header')?.nextElementSibling).toBe(alerts[0])
})

test('未绑定首页只给一处绑定入口，不请求待办、不显示缓存待办或假可用数量', async () => {
  device.bound = false; qc.setQueryData(['pda-todo-counts'], { inbound: 14 })
  await mount(<Workbench />)
  expect([...host.querySelectorAll('button')].filter(b => b.textContent === '去绑定设备')).toHaveLength(1)
  expect(host.textContent).not.toContain('本机尚未绑定设备')
  expect(host.textContent).not.toContain('可用作业'); expect(host.textContent).not.toContain('待办任务')
  expect(requests.filter(r => r.url === '/pda/todo-counts')).toHaveLength(0)
  expect(document.querySelectorAll('.fc-toast')).toHaveLength(0)
  vi.useFakeTimers()
  try {
    await act(async () => { await vi.advanceTimersByTimeAsync(91_000) })
    expect(requests.filter(r => r.url === '/pda/todo-counts')).toHaveLength(0)
    expect(document.querySelectorAll('.fc-toast')).toHaveLength(0)
  } finally { vi.useRealTimers() }
})

test.each([{ status: 503, code: 'SERVICE_UNAVAILABLE' }, { status: 403, code: 'PERMISSION_DENIED' }])('已绑定首页的真实$status错误继续通过原全局提示显示', async ({ status, code }) => {
  todos = config => rejected(config, status, '待办读取失败，请联系主管核对', code)
  await mount(<Workbench />)
  await vi.waitFor(() => expect(document.querySelector('.fc-toast')?.textContent).toContain('待办读取失败'))
  expect(requests.some(r => r.url === '/pda/todo-counts')).toBe(true)
})
