// @vitest-environment jsdom
// Real panel, API, QueryClient and collector. Closed synthetic GET transport only.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { HandlingSourcesPanel } from './HandlingSourcesPanel'
import apiClient, { setApiClientBaseURL } from '@/api/client'
import { useAuthStore } from '@/store/authStore'
import { HOME_TAB, useWorkspaceStore } from '@/store/workspaceStore'
import { SectionVisibilityContext } from '@/components/layout/SectionVisibilityContext'
import { TabPathContext } from '@/components/layout/TabPathContext'
import { PERMISSIONS as P } from '@/lib/permission-codes'
import { HANDLING_STORAGE, saveHandlingRecord, type HandlingRecord } from '@/lib/disposalHandlingRecovery'
import type { HandlingSource } from '@/types/disposal-handling'
import type { PaginatedData } from '@/types'

let host: HTMLDivElement, root: Root, query: QueryClient
let respond: (url: URL) => Response | Promise<Response>
const requests: URL[] = [], unexpected: string[] = []
const oldAdapter = apiClient.defaults.adapter, oldEnv = apiClient.defaults.env
function json(data: unknown, status = 200) { return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } }) }
function failure(status = 500) { return json({ success: false, message: '合成来源读取失败', code: status === 403 ? 'WAREHOUSE_SCOPE_DENIED' : 'SYNTHETIC_READ_FAILURE' }, status) }
const transport = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
  const method = (typeof input === 'object' && 'method' in input ? input.method : init?.method) || 'GET'
  if (method !== 'GET' || url.pathname !== '/api/disposals/handling-sources') { unexpected.push(`${method} ${url.pathname}`); return failure(403) }
  requests.push(url)
  // Current backend rejects, rather than clamps, pageSize above100.
  if (Number(url.searchParams.get('pageSize')) > 100) return json({ success: false, message: '分页范围不正确', code: 'DISPOSAL_HANDLING_INPUT_INVALID' }, 400)
  return respond(url)
}
function row(id: number): HandlingSource {
  return { id, intentUuid: `11111111-1111-4111-8111-${String(id).padStart(12, '0')}`, productId: id,
    productCode: `SYN-HP${id}`, productName: `合成来源${id}`, warehouseId: 8, warehouseName: '合成仓', warehouseCode: 'SYN-W8',
    unit: '个', handlingType: 1, quantity: 10, revision: 1, originKind: 'ordinary', createdAt: '2026-10-16 08:00:00',
    // Lawful cancelled/unshipped ordinary target, A6/E0/R0 pending explicit release.
    budget: { intentionQuantity: 10, allocatedQuantity: 6, actualExecutedQuantity: 0, releasedQuantity: 0, availableQuantity: 4, progress: '目标终止待解除' },
    links: [{ linkId: 700000 + id, state: 'ACTIVE', allocatedQuantity: 6, executedQuantity: 0, releasedQuantity: 0,
      terminal: true, returnClosed: true, pendingReason: null,
      target: { type: 'sale_order', id: 100000 + id, orderNo: `SYN-SO${100000 + id}`, path: `/sale/${100000 + id}`, status: 5 } }],
  }
}
function batch(url: URL, total: number) {
  const page = Number(url.searchParams.get('page') || 1), pageSize = Number(url.searchParams.get('pageSize') || 20), start = (page - 1) * pageSize
  return json({ success: true, data: { list: Array.from({ length: Math.max(0, Math.min(pageSize, total - start)) }, (_, index) => row(total - start - index)), pagination: { page, pageSize, total } } })
}
function Harness({ active }: { active: boolean }) {
  const location = useLocation()
  return <><output data-location>{location.pathname}{location.search}</output><SectionVisibilityContext.Provider value={active}><TabPathContext.Provider value="/disposals"><div data-workspace-scroll style={{ height: 480, overflow: 'auto' }}><HandlingSourcesPanel /></div></TabPathContext.Provider></SectionVisibilityContext.Provider></>
}
function button(label: string, scope: ParentNode = document.body) { return [...scope.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent?.trim() === label) }
async function click(label: string, scope: ParentNode = document.body) { const target = button(label, scope); expect(target, label).toBeTruthy(); await act(async () => target!.click()) }
async function wait(assertion: () => void) { await vi.waitFor(async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)) }); assertion() }) }
const cached = () => query.getQueryCache().find({ queryKey: ['disposal-handling', 'sources'], exact: false })
const data = () => cached()?.state.data as PaginatedData<HandlingSource> | undefined
async function draw(active = true) { await act(async () => root.render(<QueryClientProvider client={query}><MemoryRouter initialEntries={['/disposals']}><Harness active={active} /></MemoryRouter></QueryClientProvider>)) }
async function reason(value: string) {
  const field = document.querySelector<HTMLInputElement>('input[aria-label="解除说明"]')!
  expect(field).toBeTruthy()
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, value)
    field.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  localStorage.clear(); sessionStorage.clear(); requests.length = 0; unexpected.length = 0
  setApiClientBaseURL('http://handling-continuous.fixture.invalid/api')
  useAuthStore.getState().login('synthetic', null, { id: 9, username: 'synthetic', realName: '合成员工', roleId: 2, roleName: '合成角色', permissions: [P.INVENTORY_DISPOSAL_VIEW, P.INVENTORY_DISPOSAL_CREATE, P.SALE_ORDER_CREATE, P.SALE_ORDER_VIEW] })
  useWorkspaceStore.setState({ tabs: [HOME_TAB], activeKey: HOME_TAB.key })
  apiClient.defaults.adapter = 'fetch'; apiClient.defaults.env = { ...oldEnv, fetch: transport }
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) { return this.matches('[data-workspace-scroll]') ? 480 : this.tagName === 'TR' ? 48 : 0 })
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(800)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const scroll = this.closest<HTMLElement>('[data-workspace-scroll]'), height = this.matches('[data-workspace-scroll]') ? 480 : this.tagName === 'TR' ? 48 : 0, top = this === scroll ? 0 : -(scroll?.scrollTop || 0)
    return { height, width: 800, top, left: 0, bottom: top + height, right: 800, x: 0, y: top, toJSON() {} }
  })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  query = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
})
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); query.clear()
  apiClient.defaults.adapter = oldAdapter; apiClient.defaults.env = oldEnv; setApiClientBaseURL('/api')
  useWorkspaceStore.setState({ tabs: [HOME_TAB], activeKey: HOME_TAB.key }); vi.restoreAllMocks(); vi.unstubAllGlobals()
  expect(unexpected).toEqual([])
})

test('21条普通来源自动完整读取，不提供员工翻页', async () => {
  respond = url => batch(url, 21); await draw(); await wait(() => expect(cached()?.state.status).toBe('success'))
  expect(data()?.list).toHaveLength(21)
  expect(host.textContent).toContain('SYN-HP1合成来源1')
  expect(host.textContent).not.toMatch(/上一页|下一页|第 \d+ \/ \d+ 页/)
})
test.each([5000, 5001])('真实收集器%i来源按100批有界读取并披露数量/截断', async total => {
  respond = url => batch(url, total); await draw(); await wait(() => expect(cached()?.state.status).toBe('success'))
  expect(data()?.list).toHaveLength(5000); expect(data()?.truncated).toBe(total > 5000)
  expect(requests).toHaveLength(50); expect(requests.every(url => url.searchParams.get('pageSize') === '100')).toBe(true)
  const text = [...host.querySelectorAll('[role="status"]')].map(node => node.textContent).join(' ')
  if (total > 5000) expect(/5,?000.*5,?001/.test(text) && /仅显示|未全部|未完整|截断/.test(text)).toBe(true)
  else expect(text).toContain('5,000')
  expect(host.querySelectorAll('article').length).toBeLessThan(50)
}, 15000)
test('真实虚拟来源末条与链接可达，滚动保留聚焦目标入口', async () => {
  respond = url => batch(url, 5000); await draw(); await wait(() => expect(data()?.list).toHaveLength(5000))
  const first = button('创建正常目标')!; await act(async () => first.focus())
  const scroll = host.querySelector<HTMLElement>('[data-workspace-scroll]')!
  await act(async () => { scroll.scrollTop = 5000 * 48 - 480; scroll.dispatchEvent(new Event('scroll')) })
  await wait(() => expect(host.textContent).toContain('SYN-HP1合成来源1'))
  expect(first.isConnected).toBe(true); expect(document.activeElement).toBe(first)
  await click('SYN-SO100001')
  expect(host.querySelector('[data-location]')?.textContent).toBe('/sale/100001')
}, 15000)
test('新目标仍沿原处理来源ID打开普通创建页，不自动写入', async () => {
  respond = url => batch(url, 1); await draw(); await wait(() => expect(button('创建正常目标')).toBeTruthy())
  await click('创建正常目标')
  expect(host.querySelector('[data-location]')?.textContent).toBe('/sale/new?handlingSourceId=1')
  expect(unexpected).toEqual([])
})
test('续批失败拒绝部分来源，重试从原条件第一批恢复', async () => {
  respond = url => Number(url.searchParams.get('page')) === 2 ? failure() : batch(url, 101)
  await draw(); await wait(() => expect(cached()?.state.status).toBe('error'))
  expect(data()).toBeUndefined(); expect(requests).toHaveLength(2)
  expect(host.querySelector('article')).toBeNull(); expect(host.textContent).not.toContain('暂无处理来源')
  respond = url => batch(url, 101); await click('重试'); await wait(() => expect(data()?.list).toHaveLength(101))
  expect(Object.fromEntries(requests[2].searchParams)).toEqual({ page: '1', pageSize: '100' })
})
test.each(['total', 'duplicate'] as const)('续批%s不完整证据拒绝整份来源列表', async fault => {
  respond = url => {
    const page = Number(url.searchParams.get('page'))
    return page === 2 ? json({ success: true, data: { list: [row(fault === 'duplicate' ? 101 : 1)], pagination: { page: 2, pageSize: 100, total: fault === 'total' ? 102 : 101 } } }) : batch(url, 101)
  }
  await draw(); await wait(() => expect(cached()?.state.status).toBe('error'))
  expect(data()).toBeUndefined(); expect(host.querySelector('article')).toBeNull()
})
test.each([500, 403])('缓存后续批%i失格时保留解除草稿并冻结确认，原条件重试恢复', async status => {
  respond = url => batch(url, 101); await draw(); await wait(() => expect(data()?.list).toHaveLength(101))
  await click('核对解除'); await reason('合成未提交说明')
  respond = url => Number(url.searchParams.get('page')) === 2 ? failure(status) : batch(url, 101)
  await act(async () => { await query.invalidateQueries({ queryKey: ['disposal-handling', 'sources'] }) })
  await wait(() => expect(cached()?.state.status).toBe('error'))
  expect(host.querySelector('article')).toBeNull()
  expect(document.querySelector<HTMLInputElement>('input[aria-label="解除说明"]')?.value).toBe('合成未提交说明')
  expect(button('确认核对解除')?.disabled).toBe(true)
  await click('关闭并保留说明')
  respond = url => batch(url, 101); await click('重试'); await wait(() => expect(data()?.list).toHaveLength(101))
  await click('核对解除')
  expect(document.querySelector<HTMLInputElement>('input[aria-label="解除说明"]')?.value).toBe('合成未提交说明')
  expect(button('确认核对解除')?.disabled).toBe(false)
})
test('连续读取失败与重开不改变未知解除请求原body/UUID/key', async () => {
  respond = url => batch(url, 101); await draw(); await wait(() => expect(data()?.list).toHaveLength(101))
  await click('核对解除'); await reason('原未知说明')
  const source = row(101), link = source.links[0], uuid = '22222222-2222-4222-8222-222222222222'
  const record: HandlingRecord = { version: 1, userId: 9, baseURL: 'http://handling-continuous.fixture.invalid/api',
    kind: 'release', draftIdentity: `handling-release:${source.id}:${link.linkId}`, sourceId: source.id, linkId: link.linkId, intentUuid: source.intentUuid,
    operationUuid: uuid, requestKey: 'synthetic-original-release-key', action: `disposal.handling.link.release.${link.linkId}`,
    path: `/disposals/handling-sources/${source.id}/links/${link.linkId}/release`, method: 'post', createdAt: Date.now(), phase: 'pending',
    body: { operationUuid: uuid, expectedRevision: 1, reason: '原未知说明' } }
  await act(async () => saveHandlingRecord(record))
  const original = localStorage.getItem(HANDLING_STORAGE)
  respond = url => Number(url.searchParams.get('page')) === 2 ? failure() : batch(url, 101)
  await act(async () => { await query.invalidateQueries({ queryKey: ['disposal-handling', 'sources'] }) })
  await wait(() => expect(cached()?.state.status).toBe('error'))
  expect(button('确认核对解除')?.disabled).toBe(true)
  expect(button('查询原处理结果')).toBeTruthy()
  expect(localStorage.getItem(HANDLING_STORAGE)).toBe(original)
  await click('关闭并保留说明')
  respond = url => batch(url, 101); await click('重试'); await wait(() => expect(data()?.list).toHaveLength(101))
  await click('核对解除')
  expect(button('确认核对解除')?.disabled).toBe(true)
  expect(localStorage.getItem(HANDLING_STORAGE)).toBe(original)
})
test('隐藏原工作区停止连续续批，激活后从首批重新读取', async () => {
  let finish!: (response: Response) => void
  respond = () => new Promise(resolve => { finish = resolve })
  await draw(); await wait(() => expect(finish).toBeTypeOf('function'))
  await draw(false)
  await act(async () => finish(batch(requests[0], 101)))
  expect(requests).toHaveLength(1)
  respond = url => batch(url, 101); await draw(); await wait(() => expect(data()?.list).toHaveLength(101))
  expect(requests[1].searchParams.get('page')).toBe('1')
})

test('虚拟来源打开解除后保留原按钮，关闭返回原焦点并保留说明', async () => {
  respond = url => batch(url, 5000); await draw(); await wait(() => expect(data()?.list).toHaveLength(5000))
  const trigger = button('核对解除')!; await act(async () => trigger.focus())
  await click('核对解除'); await reason('滚动前核对草稿')
  const scroll = host.querySelector<HTMLElement>('[data-workspace-scroll]')!
  await act(async () => { scroll.scrollTop = 5000 * 48 - 480; scroll.dispatchEvent(new Event('scroll')) })
  await wait(() => expect(host.textContent).toContain('SYN-HP1合成来源1'))
  expect(trigger.isConnected).toBe(true)
  await click('关闭并保留说明')
  await wait(() => expect(document.activeElement).toBe(trigger))
  await act(async () => trigger.click())
  expect(document.querySelector<HTMLInputElement>('input[aria-label="解除说明"]')?.value).toBe('滚动前核对草稿')
  expect(unexpected).toEqual([])
}, 15000)

test('读取owner变更丢弃旧服务器晚响应，撤回查看权即时隐藏旧入口', async () => {
  let finish!: (response: Response) => void
  respond = url => url.hostname === 'handling-continuous.fixture.invalid' ? new Promise(resolve => { finish = resolve }) : batch(url, 21)
  await draw(); await wait(() => expect(finish).toBeTypeOf('function'))
  await act(async () => setApiClientBaseURL('http://handling-current.fixture.invalid/api'))
  await wait(() => expect(host.textContent).toContain('SYN-HP21合成来源21'))
  await act(async () => finish(batch(requests[0], 101)))
  expect(host.textContent).not.toContain('SYN-HP101合成来源101')
  await act(async () => useAuthStore.getState().updateUser({ permissions: [P.SALE_ORDER_VIEW] }))
  expect(host.querySelector('article')).toBeNull()
  expect(button('创建正常目标')).toBeUndefined(); expect(button('核对解除')).toBeUndefined()
  const count = requests.length
  await act(async () => { await query.invalidateQueries({ queryKey: ['disposal-handling', 'sources'] }) })
  expect(requests).toHaveLength(count)
})
