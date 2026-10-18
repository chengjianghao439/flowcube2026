// @vitest-environment jsdom
// Real panel/query/API/recovery with a closed, synthetic fetch transport. No server.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import apiClient, { setApiClientBaseURL } from '@/api/client'
import { useAuthStore } from '@/store/authStore'
import { HOME_TAB, useWorkspaceStore } from '@/store/workspaceStore'
import { SectionVisibilityContext } from '@/components/layout/SectionVisibilityContext'
import { PERMISSIONS as P } from '@/lib/permission-codes'
import { HANDLING_STORAGE, saveHandlingRecord, type HandlingRecord } from '@/lib/disposalHandlingRecovery'
import type { HandlingSource } from '@/types/disposal-handling'
import { HandlingSourcesPanel } from './HandlingSourcesPanel'

// Retain an old event callback while rendering the actual shared Button.
const observed = vi.hoisted(() => ({ release: undefined as undefined | (() => void) }))
vi.mock('@/components/ui/button', async original => {
  const actual = await original<typeof import('@/components/ui/button')>()
  const { forwardRef } = await import('react')
  return { ...actual, Button: forwardRef<HTMLButtonElement, React.ComponentProps<typeof actual.Button>>((props, ref) => {
    if (props.children === '确认核对解除') observed.release = () => props.onClick?.({} as React.MouseEvent<HTMLButtonElement>)
    return <actual.Button {...props} ref={ref} />
  }) }
})

const source: HandlingSource = {
  id: 11, intentUuid: '11111111-1111-4111-8111-111111111111', productId: 3,
  productCode: 'SYN-P3', productName: '合成普通来源', warehouseId: 8,
  warehouseName: '合成仓', warehouseCode: 'SYN-W8', unit: '个', handlingType: 1,
  quantity: 10, revision: 1, originKind: 'ordinary', createdAt: '2026-10-15 08:00:00',
  // Lawful cancelled, unshipped ordinary sale: A6/E0/R0, pending explicit release.
  budget: { intentionQuantity: 10, allocatedQuantity: 6, actualExecutedQuantity: 0, releasedQuantity: 0, availableQuantity: 4, progress: '目标终止待解除' },
  links: [{ linkId: 7, state: 'ACTIVE', allocatedQuantity: 6, executedQuantity: 0,
    releasedQuantity: 0, terminal: true, returnClosed: true, pendingReason: null,
    target: { type: 'sale_order', id: 91, orderNo: 'SYN-SO91', path: '/sale/91', status: 5 } }],
}
let host: HTMLDivElement, root: Root, query: QueryClient
let respond: () => Response | Promise<Response>
const requests: URL[] = [], unexpected: string[] = []
const oldAdapter = apiClient.defaults.adapter, oldEnv = apiClient.defaults.env
const transport = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
  const method = (typeof input === 'object' && 'method' in input ? input.method : init?.method) || 'GET'
  if (method !== 'GET' || url.pathname !== '/api/disposals/handling-sources') {
    unexpected.push(`${method} ${url.pathname}`)
    return failure(403)
  }
  requests.push(url)
  return respond()
}
function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
}
function success(list: HandlingSource[] = [source], page = 1, total = list.length) {
  return json({ success: true, data: { list, pagination: { page, pageSize: Number(requests.at(-1)?.searchParams.get('pageSize') || 20), total } } })
}
function failure(status: number) {
  return json({ success: false, code: status === 403 ? 'WAREHOUSE_SCOPE_DENIED' : 'SYNTHETIC_READ_FAILURE', message: status === 403 ? '合成来源范围拒绝' : '合成来源读取失败' }, status)
}
function Harness() { const location = useLocation(); return <><output data-location>{location.pathname}{location.search}</output><HandlingSourcesPanel /></> }
function button(label: string) { return [...document.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent?.trim() === label) }
async function click(label: string) { const target = button(label); expect(target, label).toBeTruthy(); await act(async () => target!.click()) }
async function wait(assertion: () => void) {
  await vi.waitFor(async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)) }); assertion() })
}
const cache = () => query.getQueryCache().find({ queryKey: ['disposal-handling', 'sources'], exact: false })
async function mount(active = true) {
  await act(async () => root.render(<QueryClientProvider client={query}><MemoryRouter initialEntries={['/disposals']}><SectionVisibilityContext.Provider value={active}><Harness /></SectionVisibilityContext.Provider></MemoryRouter></QueryClientProvider>))
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  localStorage.clear(); sessionStorage.clear(); requests.length = 0; unexpected.length = 0; observed.release = undefined
  setApiClientBaseURL('http://handling.fixture.invalid/api')
  useAuthStore.getState().login('synthetic', null, { id: 9, username: 'synthetic', realName: '合成员工', roleId: 2, roleName: '合成角色', permissions: [P.INVENTORY_DISPOSAL_VIEW, P.INVENTORY_DISPOSAL_CREATE, P.SALE_ORDER_CREATE, P.SALE_ORDER_VIEW] })
  useWorkspaceStore.setState({ tabs: [HOME_TAB], activeKey: HOME_TAB.key })
  apiClient.defaults.adapter = 'fetch'; apiClient.defaults.env = { ...oldEnv, fetch: transport }
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  query = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
})
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); query.clear()
  apiClient.defaults.adapter = oldAdapter; apiClient.defaults.env = oldEnv; setApiClientBaseURL('/api')
  localStorage.clear(); sessionStorage.clear(); useWorkspaceStore.setState({ tabs: [HOME_TAB], activeKey: HOME_TAB.key })
  expect(unexpected).toEqual([])
})

test.each([500, 403])('首次来源GET %i显示错误与原条件重试，不冒称成功空表', async status => {
  respond = () => failure(status); await mount(); await wait(() => expect(cache()?.state.status).toBe('error'))
  expect(host.textContent).toContain('来源读取失败')
  expect(host.textContent).not.toContain('暂无处理来源')
  expect(button('重试')).toBeTruthy()
  respond = () => success(); await click('重试')
  await wait(() => expect(host.textContent).toContain(source.productCode))
  expect(requests).toHaveLength(2)
  expect(Object.fromEntries(requests[1].searchParams)).toEqual({ page: '1', pageSize: '100' })
})

test.each([500, 403])('缓存来源GET %i隐藏旧商品、目标链接及新目标/解除入口', async status => {
  respond = () => success(); await mount(); await wait(() => expect(host.textContent).toContain(source.productCode))
  expect(button('创建正常目标')?.disabled).toBe(false)
  expect(button('核对解除')?.disabled).toBe(false)
  respond = () => failure(status)
  await act(async () => { await query.invalidateQueries({ queryKey: ['disposal-handling', 'sources'] }) })
  await wait(() => expect(cache()?.state.status).toBe('error'))
  expect(cache()?.state.data).toBeTruthy() // Real QueryClient retains the old success value.
  expect(host.textContent).not.toContain(source.productCode)
  expect(button('SYN-SO91')).toBeUndefined()
  expect(button('创建正常目标')).toBeUndefined()
  expect(button('核对解除')).toBeUndefined()
  expect(host.textContent).not.toContain('共 1 条')
})

test('来源失败冻结已开解除说明，成功重试后保留草稿并恢复资格', async () => {
  respond = () => success(); await mount(); await wait(() => expect(button('核对解除')).toBeTruthy())
  await click('核对解除')
  const field = document.querySelector<HTMLInputElement>('input[aria-label="解除说明"]')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, '合成核对说明')
    field.dispatchEvent(new Event('input', { bubbles: true }))
  })
  expect(button('确认核对解除')?.disabled).toBe(false)
  respond = () => failure(500)
  await act(async () => { await query.invalidateQueries({ queryKey: ['disposal-handling', 'sources'] }) })
  await wait(() => expect(cache()?.state.status).toBe('error'))
  expect(field.value).toBe('合成核对说明')
  expect(button('确认核对解除')?.disabled).toBe(true)
  // Clicking a disabled control cannot emit a write to the closed transport.
  await click('确认核对解除')
  expect(unexpected).toEqual([])
  await click('关闭并保留说明')
  expect(button('确认核对解除')).toBeUndefined()
  respond = () => success(); await click('重试')
  await wait(() => expect(button('核对解除')).toBeTruthy())
  await click('核对解除')
  expect(button('确认核对解除')?.disabled).toBe(false)
  expect(document.querySelector<HTMLInputElement>('input[aria-label="解除说明"]')?.value).toBe('合成核对说明')
})

test('正常完整空来源保留空态，正常目标链接沿原工作区导航', async () => {
  respond = () => success([]); await mount(); await wait(() => expect(host.textContent).toContain('暂无处理来源'))
  expect(button('重试')).toBeUndefined()
  respond = () => success()
  await act(async () => { await query.invalidateQueries({ queryKey: ['disposal-handling', 'sources'] }) })
  await wait(() => expect(button('SYN-SO91')).toBeTruthy())
  await click('SYN-SO91')
  expect(host.querySelector('[data-location]')?.textContent).toBe('/sale/91')
  expect(unexpected).toEqual([])
})

test('隐藏工作区的失败重试不能绕过原读取资格', async () => {
  respond = () => failure(500); await mount(); await wait(() => expect(cache()?.state.status).toBe('error'))
  await mount(false)
  const before = requests.length
  await click('重试')
  expect(requests).toHaveLength(before)
  respond = () => success(); await mount(true)
  await wait(() => expect(host.textContent).toContain(source.productCode))
})

test('成功刷新已解除关联后，旧解除草稿也不能继续提交', async () => {
  respond = () => success(); await mount(); await wait(() => expect(button('核对解除')).toBeTruthy())
  await click('核对解除')
  const field = document.querySelector<HTMLInputElement>('input[aria-label="解除说明"]')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, '已核对草稿')
    field.dispatchEvent(new Event('input', { bubbles: true }))
  })
  respond = () => success([{ ...source, revision: 2,
    budget: { ...source.budget, releasedQuantity: 6, availableQuantity: 10, progress: '待关联' },
    links: source.links.map(link => ({ ...link, state: 'TERMINATED', releasedQuantity: 6 })),
  }])
  await act(async () => { await query.invalidateQueries({ queryKey: ['disposal-handling', 'sources'] }) })
  await wait(() => expect(host.textContent).toContain('已核对终结'))
  expect(button('确认核对解除')?.disabled).toBe(true)
  await click('确认核对解除')
  expect(unexpected).toEqual([])
})

function nextRevision(): HandlingSource {
  return { ...source, revision: 2,
    budget: { ...source.budget, allocatedQuantity: 7, availableQuantity: 3 },
    links: [...source.links, { ...source.links[0], linkId: 8, allocatedQuantity: 1, terminal: false, returnClosed: false,
      target: { type: 'sale_order', id: 92, orderNo: 'SYN-SO92', path: '/sale/92', status: 1 } }],
  }
}
async function releaseDraft() {
  respond = () => success(); await mount(); await wait(() => expect(button('核对解除')).toBeTruthy())
  await click('核对解除')
  const field = document.querySelector<HTMLInputElement>('input[aria-label="解除说明"]')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, '原未提交说明')
    field.dispatchEvent(new Event('input', { bubbles: true }))
  })
  return observed.release!
}
test('其他正常目标推进revision后，明确重开可重核合法关联并保留未提交说明', async () => {
  const oldRelease = await releaseDraft()
  respond = () => success([nextRevision()])
  await act(async () => { await query.invalidateQueries({ queryKey: ['disposal-handling', 'sources'] }) })
  await wait(() => expect(button('SYN-SO92')).toBeTruthy())
  expect(button('确认核对解除')?.disabled).toBe(true)
  await click('关闭并保留说明'); await click('核对解除')
  expect(button('确认核对解除')?.disabled).toBe(false)
  expect(document.querySelector<HTMLInputElement>('input[aria-label="解除说明"]')?.value).toBe('原未提交说明')
  await act(async () => oldRelease())
  expect(unexpected).toEqual([])
})

test('已持久化未知解除请求遇revision推进，重开仍保原body/UUID/key且不重发', async () => {
  await releaseDraft()
  const record: HandlingRecord = { version: 1, userId: 9, baseURL: 'http://handling.fixture.invalid/api',
    kind: 'release', draftIdentity: 'handling-release:11:7', sourceId: 11, linkId: 7, intentUuid: source.intentUuid,
    operationUuid: '22222222-2222-4222-8222-222222222222', requestKey: 'synthetic-original-key',
    action: 'disposal.handling.link.release.7', path: '/disposals/handling-sources/11/links/7/release',
    method: 'post', createdAt: Date.now(), phase: 'pending',
    body: { operationUuid: '22222222-2222-4222-8222-222222222222', expectedRevision: 1, reason: '原未知请求说明' },
  }
  await act(async () => saveHandlingRecord(record))
  const original = localStorage.getItem(HANDLING_STORAGE)
  respond = () => success([nextRevision()])
  await act(async () => { await query.invalidateQueries({ queryKey: ['disposal-handling', 'sources'] }) })
  await wait(() => expect(button('SYN-SO92')).toBeTruthy())
  await click('关闭并保留说明'); await click('核对解除')
  expect(button('确认核对解除')?.disabled).toBe(true)
  expect(button('查询原处理结果')).toBeTruthy()
  await click('确认核对解除')
  expect(localStorage.getItem(HANDLING_STORAGE)).toBe(original)
  expect(unexpected).toEqual([])
})

test('21条连续来源隐藏再激活重新取齐，不出现可见分页或丢失末条', async () => {
  const empty = (id: number): HandlingSource => ({ ...source, id, intentUuid: `11111111-1111-4111-8111-${String(id).padStart(12, '0')}`,
    productCode: `SYN-P${id}`, links: [], budget: { ...source.budget, allocatedQuantity: 0, availableQuantity: 10, progress: '待关联' } })
  respond = () => success(Array.from({ length: 21 }, (_, index) => empty(11 + index)))
  await mount(); await wait(() => expect(host.textContent).toContain('共 21 条'))
  expect(button('下一页')).toBeUndefined()
  await mount(false)
  await mount(true)
  await wait(() => expect(host.textContent).toContain('共 21 条'))
  expect(Object.fromEntries(requests.at(-1)!.searchParams)).toEqual({ page: '1', pageSize: '100' })
  expect(host.textContent).toContain('SYN-P31')
})
