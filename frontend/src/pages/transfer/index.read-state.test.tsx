// @vitest-environment jsdom
// Real page, query cache, API and bounded collector; only transport and unrelated
// lookup data are synthetic. No HTTP server, database or business write is used.
import { act, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import TransferPage from './index'
import apiClient, { setApiClientBaseURL } from '@/api/client'
import { KeepAliveOutlet } from '@/components/layout/KeepAliveOutlet'
import { HOME_TAB, useWorkspaceStore } from '@/store/workspaceStore'
import { getWorkspaceListPath } from '@/lib/workspaceListNavigation'
import { disposeWorkspaceHistoryGuard } from '@/router/workspaceHistoryGuard'

const dialogCallbacks = vi.hoisted(() => ({ confirm: [] as (() => void)[], forceClose: [] as (() => void)[], dispatch: [] as (() => void)[] }))
// Observe delayed confirmation callbacks while still rendering the real modal.
vi.mock('@/components/shared/ConfirmDialog', async original => {
  const { ConfirmDialog } = await original<typeof import('@/components/shared/ConfirmDialog')>()
  return { ConfirmDialog: (props: Parameters<typeof ConfirmDialog>[0]) => {
    if (props.open) dialogCallbacks.confirm.push(props.onConfirm)
    return <ConfirmDialog {...props} />
  } }
})
vi.mock('@/components/shared/AppDialog', async original => {
  const { AppDialog } = await original<typeof import('@/components/shared/AppDialog')>()
  return { AppDialog: (props: Parameters<typeof AppDialog>[0]) => {
    if (props.open && props.dialogId === 'transfer-force-close-dialog') {
      const footer = props.footer as ReactElement<{ children: ReactElement<{ onClick: () => void }>[] }>
      dialogCallbacks.forceClose.push(footer.props.children[1].props.onClick)
    }
    return <AppDialog {...props} />
  } }
})
vi.mock('@/components/shared/TableActionsMenu', async original => {
  const { default: TableActionsMenu } = await original<typeof import('@/components/shared/TableActionsMenu')>()
  return { default: (props: Parameters<typeof TableActionsMenu>[0]) => {
    const dispatch = props.items.find(item => item.label === '确认派发')
    if (dispatch) dialogCallbacks.dispatch.push(dispatch.onClick)
    return <TableActionsMenu {...props} />
  } }
})
vi.mock('@/hooks/usePermission', () => ({ usePermission: () => ({ can: () => true }) }))
vi.mock('@/hooks/useWarehouses', () => ({ useWarehousesActive: () => ({ data: [] }) }))
vi.mock('@/hooks/useUserOptions', () => ({ useUserOptions: () => ({ options: [] }), userOptionLabel: () => '' }))
vi.mock('@/components/finder', () => ({ ProductFinder: () => null }))
vi.mock('@/components/shared/DatePicker', () => ({ DatePicker: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => <input type="date" value={value} onChange={event => onChange(event.target.value)} /> }))
vi.mock('@/lib/toast', () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() } }))
vi.mock('@/router/routeRegistry', async original => ({
  ...await original<typeof import('@/router/routeRegistry')>(),
  resolveRouteComponent: (path: string) => path === '/transfer' ? TransferPage : () => <p>合成详情占位</p>,
}))

const initial = '/transfer?keyword=TR-SYN&remark=原备注&operatorId=7&operatorName=合成经办人&status=1&productId=3&productCode=SYN3&productName=合成商品&warehouseId=8&warehouseName=合成原仓&startDate=2026-10-01&endDate=2026-10-14'
let host: HTMLDivElement, root: Root, query: QueryClient
let respond: (url: URL) => Response | Promise<Response>
const requests: URL[] = [], unexpectedRequests: string[] = []
const writes: { path: string; body: string }[] = []
let allowedWrite: string | null = null
const oldAdapter = apiClient.defaults.adapter, oldEnv = apiClient.defaults.env
const transport = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
  const method = (typeof input === 'object' && 'method' in input ? input.method : init?.method) || 'GET'
  if (method === 'POST' && url.pathname === allowedWrite) {
    writes.push({ path: url.pathname, body: input instanceof Request ? await input.clone().text() : String(init?.body || '') })
    return new Response(JSON.stringify({ success: true, data: null }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  if (method !== 'GET' || url.pathname !== '/api/transfer') {
    unexpectedRequests.push(`${method} ${url.pathname}`)
    return failure(403)
  }
  requests.push(url)
  return respond(url)
})
function row(id: number, status = 1) {
  return { id, orderNo: `TR-SYN-${id}`, fromWarehouseId: 8, fromWarehouseName: '合成调出仓', toWarehouseId: 9, toWarehouseName: '合成调入仓', status, statusName: status === 3 ? '在途' : '草稿', operatorName: '合成经办人', createdAt: '2026-10-14 08:00:00' }
}
function batch(url: URL, total: number, status = 1, idOffset = 0) {
  const page = Number(url.searchParams.get('page') || 1), pageSize = Number(url.searchParams.get('pageSize') || 200)
  const from = (page - 1) * pageSize
  return new Response(JSON.stringify({ success: true, data: {
    list: Array.from({ length: Math.max(0, Math.min(pageSize, total - from)) }, (_, index) => row(from + index + 1 + idOffset, status)),
    pagination: { page, pageSize, total },
  } }), { status: 200, headers: { 'Content-Type': 'application/json' } })
}
function failure(status = 503) {
  return new Response(JSON.stringify({ success: false, code: status === 403 ? 'WAREHOUSE_SCOPE_DENIED' : 'SYNTHETIC_READ_FAILURE', message: status === 403 ? '当前调拨范围拒绝' : '合成调拨读取失败' }), { status, headers: { 'Content-Type': 'application/json' } })
}
function Harness() {
  const location = useLocation(), navigate = useNavigate()
  return <><output data-location>{location.pathname}{location.search}</output><button onClick={() => navigate(getWorkspaceListPath('/transfer'))}>返回调拨列表</button><KeepAliveOutlet /></>
}
function button(label: string, scope: ParentNode = document.body) {
  return [...scope.querySelectorAll<HTMLElement>('button, [role="menuitem"]')].find(item => item.textContent?.trim() === label || item.getAttribute('aria-label') === label)
}
async function click(label: string, scope: ParentNode = document.body) {
  const target = button(label, scope)
  expect(target, `button ${label}`).toBeTruthy()
  await act(async () => target!.click())
}
async function wait(assertion: () => void) {
  await vi.waitFor(async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)) }); assertion() })
}
const transferQuery = () => query.getQueryCache().find({ queryKey: ['transfer'], exact: false })
function currentListQuery() {
  const path = host.querySelector('[data-location]')!.textContent!
  expect(path.split('?')[0]).toBe('/transfer')
  return Object.fromEntries(new URLSearchParams(path.split('?')[1]))
}
const initialQuery = Object.fromEntries(new URLSearchParams(initial.split('?')[1]))
async function mount(path = initial) {
  await act(async () => root.render(<QueryClientProvider client={query}><MemoryRouter initialEntries={[path]}><Harness /></MemoryRouter></QueryClientProvider>))
}
async function change(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  await act(async () => {
    const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, value)
    element.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
async function refreshFailure(status = 403) {
  respond = () => failure(status)
  await act(async () => { await query.invalidateQueries({ queryKey: ['transfer'] }) })
  await wait(() => expect(transferQuery()?.state.status).toBe('error'))
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  localStorage.clear(); requests.length = 0; unexpectedRequests.length = 0; transport.mockClear()
  dialogCallbacks.confirm = []; dialogCallbacks.forceClose = []; dialogCallbacks.dispatch = []; writes.length = 0; allowedWrite = null
  useWorkspaceStore.setState({ tabs: [HOME_TAB], activeKey: HOME_TAB.key })
  setApiClientBaseURL('http://transfer.fixture.invalid/api')
  apiClient.defaults.adapter = 'fetch'; apiClient.defaults.env = { ...oldEnv, fetch: transport }
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) { return this.matches('[data-workspace-scroll]') ? 480 : this.tagName === 'TR' ? 48 : 0 })
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(800)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const scroll = this.closest<HTMLElement>('[data-workspace-scroll]')
    const height = this.matches('[data-workspace-scroll]') ? 480 : this.tagName === 'TR' ? 48 : 0
    const top = this === scroll ? 0 : -(scroll?.scrollTop || 0)
    return { height, width: 800, top, left: 0, bottom: top + height, right: 800, x: 0, y: top, toJSON() {} }
  })
  Element.prototype.scrollIntoView = vi.fn()
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  query = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: Infinity } } })
})
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); query.clear(); disposeWorkspaceHistoryGuard()
  apiClient.defaults.adapter = oldAdapter; apiClient.defaults.env = oldEnv; setApiClientBaseURL('/api')
  useWorkspaceStore.setState({ tabs: [HOME_TAB], activeKey: HOME_TAB.key }); vi.restoreAllMocks(); vi.unstubAllGlobals()
  expect(unexpectedRequests).toEqual([])
})

test('first rejected read offers retry instead of successful empty data or a zero count', async () => {
  respond = () => failure(); await mount()
  await wait(() => expect(transferQuery()?.state.status).toBe('error'))
  expect(host.textContent).toContain('调拨列表读取失败'); expect(button('重试')).toBeTruthy()
  expect(host.textContent).not.toMatch(/暂无数据|共 0 单/)
})
test('a failed continuation rejects all partial rows and provides retry', async () => {
  respond = url => Number(url.searchParams.get('page')) === 2 ? failure() : batch(url, 201)
  await mount(); await wait(() => expect(transferQuery()?.state.status).toBe('error'))
  expect(requests).toHaveLength(2); expect(transferQuery()?.state.data).toBeUndefined()
  expect(host.textContent).toContain('调拨列表读取失败'); expect(host.textContent).not.toMatch(/TR-SYN-1|共 201 单|暂无数据/)
})
test('cached 403 hides old rows, row actions and the old success count', async () => {
  respond = url => batch(url, 1); await mount(); await wait(() => expect(host.textContent).toContain('TR-SYN-1'))
  await click('更多操作')
  await wait(() => expect(document.querySelector('[role="menuitem"]')).not.toBeNull())
  await refreshFailure()
  expect(transferQuery()?.state.data).toBeTruthy()
  expect(host.textContent).toContain('调拨列表读取失败')
  expect(document.body.textContent).not.toMatch(/TR-SYN-1|确认派发|取消调拨|共 1 单/)
  expect(host.querySelector('tbody')).toBeNull(); expect(button('详情')).toBeUndefined()
})
test('retry uses applied parameters and keeps the query dialog unapplied draft', async () => {
  respond = () => failure(); await mount(); await wait(() => expect(transferQuery()?.state.status).toBe('error'))
  await click('查询')
  const dialog = document.querySelector('[role="dialog"]')!
  const keyword = dialog.querySelector<HTMLInputElement>('input[placeholder="调拨单号 / 仓库名称…"]')!
  await change(keyword, '尚未应用草稿')
  let release!: (value: Response) => void
  respond = () => new Promise(resolve => { release = resolve })
  // Trigger the background retry through its real QueryClient while the modal
  // owns interaction; no synthetic click through an inert dialog overlay.
  await act(async () => { void query.invalidateQueries({ queryKey: ['transfer'] }) })
  await wait(() => expect(release).toBeTypeOf('function'))
  await act(async () => release(batch(requests.at(-1)!, 1)))
  await wait(() => expect(transferQuery()?.state.status).toBe('success'))
  expect(keyword.value).toBe('尚未应用草稿')
  await click('取消', dialog)
  await refreshFailure()
  respond = url => batch(url, 1); await click('重试')
  await wait(() => expect(host.textContent).toContain('共 1 单'))
  for (const url of requests) expect(Object.fromEntries(url.searchParams)).toMatchObject({ keyword: 'TR-SYN', remark: '原备注', operatorId: '7', status: '1', productId: '3', warehouseId: '8', startDate: '2026-10-01', endDate: '2026-10-14' })
  expect(currentListQuery()).toEqual(initialQuery)
})
test.each([5000, 5001])('real collector reads 5000 of %i matches and discloses completeness without pagination', async total => {
  respond = url => batch(url, total); await mount()
  await wait(() => expect(transferQuery()?.state.status).toBe('success'))
  expect(requests).toHaveLength(25)
  const data = transferQuery()?.state.data as { list: unknown[]; truncated: boolean }
  expect(data.list).toHaveLength(5000); expect(data.truncated).toBe(total > 5000)
  const summary = host.querySelector('[role="status"]')?.textContent || ''
  if (total > 5000) { expect(summary).toMatch(/5,000.*5,001.*缩小查询范围/); expect(summary).not.toBe('共 5,001 单'); expect(host.querySelector('.desktop-page-description')?.textContent).toContain('请缩小查询范围') }
  else expect(summary).toBe('共 5,000 单')
  expect(host.textContent).not.toMatch(/上一页|下一页/)
}, 20000)
test('5000 rows mount a bounded window and the last row stays reachable across detail return', async () => {
  respond = url => batch(url, 5000); await mount(); await wait(() => expect(transferQuery()?.state.status).toBe('success'))
  expect(host.querySelectorAll('tbody tr:not([aria-hidden])').length).toBeLessThan(50)
  const scroll = host.querySelector<HTMLElement>('[data-workspace-scroll]')!
  await act(async () => { scroll.scrollTop = 5000 * 48 - 480; scroll.dispatchEvent(new Event('scroll')) })
  await wait(() => expect(host.textContent).toContain('TR-SYN-5000'))
  const last = [...host.querySelectorAll('tbody tr')].find(item => item.textContent?.includes('TR-SYN-5000'))!
  await click('详情', last)
  await wait(() => expect(host.querySelector('[data-location]')?.textContent).toBe('/transfer/5000'))
  await click('返回调拨列表'); await wait(() => expect(currentListQuery()).toEqual(initialQuery))
  expect(scroll.scrollTop).toBeGreaterThan(230000); expect(host.textContent).toContain('TR-SYN-5000')
  expect(host.querySelectorAll('tbody tr:not([aria-hidden])').length).toBeLessThan(50)
}, 20000)
test('an offscreen cancellation keeps its source row and returns focus after the real modal closes', async () => {
  respond = url => batch(url, 5000); await mount(); await wait(() => expect(transferQuery()?.state.status).toBe('success'))
  const firstTrigger = host.querySelector<HTMLButtonElement>('button[aria-label="更多操作"]')!
  await act(async () => { firstTrigger.focus(); firstTrigger.click() })
  await wait(() => expect(button('取消')).toBeTruthy())
  // The first open lazily installs the actual DropdownMenuTrigger.
  const source = host.querySelector<HTMLButtonElement>('button[aria-label="更多操作"]')!
  await click('取消')
  await wait(() => expect(button('确认取消')).toBeTruthy())
  const scroll = host.querySelector<HTMLElement>('[data-workspace-scroll]')!
  await act(async () => { scroll.scrollTop = 5000 * 48 - 480; scroll.dispatchEvent(new Event('scroll')) })
  await wait(() => expect(host.textContent).toContain('TR-SYN-5000'))
  expect(source.isConnected).toBe(true)
  const dialog = document.querySelector('[role="dialog"]')!
  await click('取消', dialog)
  await wait(() => expect(document.activeElement).toBe(source))
  expect(scroll.scrollTop).toBeGreaterThan(230000)
  expect(unexpectedRequests).toEqual([])
}, 20000)
test('a complete successful empty list alone displays the zero result', async () => {
  respond = url => batch(url, 0); await mount(); await wait(() => expect(transferQuery()?.state.status).toBe('success'))
  expect(host.textContent).toContain('暂无数据'); expect(host.textContent).toContain('共 0 单'); expect(button('重试')).toBeUndefined()
})
test('loading does not announce a successful zero result', async () => {
  let release!: (value: Response) => void
  respond = () => new Promise(resolve => { release = resolve }); await mount()
  await wait(() => expect(release).toBeTypeOf('function'))
  expect(host.querySelector('table[aria-busy="true"]')).not.toBeNull(); expect(host.textContent).not.toContain('共 0 单')
  await act(async () => release(batch(requests.at(-1)!, 0)))
  await wait(() => expect(host.textContent).toContain('共 0 单'))
})
test('detail navigation and workspace return retain the applied query and no new writes', async () => {
  respond = url => batch(url, 1); await mount(); await wait(() => expect(host.textContent).toContain('TR-SYN-1'))
  await click('详情'); await wait(() => expect(host.querySelector('[data-location]')?.textContent).toBe('/transfer/1'))
  await click('返回调拨列表'); await wait(() => expect(currentListQuery()).toEqual(initialQuery))
  expect(host.textContent).toContain('单号：TR-SYN'); expect(host.textContent).toContain('TR-SYN-1')
  expect(requests).toHaveLength(1)
})
test('an already opened row cancellation cannot invoke its old write callback after 403', async () => {
  respond = url => batch(url, 1); await mount(); await wait(() => expect(host.textContent).toContain('TR-SYN-1'))
  await click('更多操作'); await wait(() => expect(button('取消')).toBeTruthy()); await click('取消')
  await wait(() => expect(button('确认取消')).toBeTruthy())
  // Keep the original handler closure as a delayed callback from the row that
  // opened this confirmation. Merely disabling a new render is insufficient.
  const oldOnClick = dialogCallbacks.confirm.at(-1)!
  await refreshFailure()
  await act(async () => oldOnClick())
  expect(unexpectedRequests).toEqual([])
  expect(button('确认取消')).toBeUndefined()
})
test('a failed list read hides in-transit write controls and retains the unsaved reason for retry', async () => {
  respond = url => batch(url, 1, 3); await mount('/transfer?range=all&status=3')
  await wait(() => expect(host.textContent).toContain('TR-SYN-1'))
  await click('更多操作'); await wait(() => expect(button('异常了结（运输丢失）')).toBeTruthy()); await click('异常了结（运输丢失）')
  await wait(() => expect(document.querySelector('textarea')).not.toBeNull())
  await change(document.querySelector('textarea')!, '尚未提交的合成原因')
  await refreshFailure()
  expect(button('确认异常了结')).toBeUndefined()
  respond = url => batch(url, 1, 3); await click('重试')
  await wait(() => expect(document.querySelector<HTMLTextAreaElement>('textarea')?.value).toBe('尚未提交的合成原因'))
  expect(unexpectedRequests).toEqual([])
})

test.each(['missing', 'different-row', 'ineligible'] as const)('a cancel confirmation cannot reopen or send its captured callback when recovery is %s', async recovery => {
  respond = url => batch(url, 1); await mount(); await wait(() => expect(host.textContent).toContain('TR-SYN-1'))
  await click('更多操作'); await wait(() => expect(button('取消')).toBeTruthy()); await click('取消')
  await wait(() => expect(button('确认取消')).toBeTruthy())
  const oldConfirm = dialogCallbacks.confirm.at(-1)!
  await refreshFailure()
  respond = url => batch(url, recovery === 'missing' ? 0 : 1, recovery === 'ineligible' ? 3 : 1, recovery === 'different-row' ? 1 : 0)
  await click('重试'); await wait(() => expect(transferQuery()?.state.status).toBe('success'))
  await act(async () => oldConfirm())
  expect(unexpectedRequests).toEqual([]); expect(writes).toEqual([])
  expect(button('确认取消')).toBeUndefined()
})
test.each(['missing', 'different-row', 'ineligible'] as const)('an in-transit reason remains local while recovery is %s and the old callback cannot send', async recovery => {
  respond = url => batch(url, 1, 3); await mount('/transfer?range=all&status=3')
  await wait(() => expect(host.textContent).toContain('TR-SYN-1'))
  await click('更多操作'); await wait(() => expect(button('异常了结（运输丢失）')).toBeTruthy()); await click('异常了结（运输丢失）')
  await wait(() => expect(document.querySelector('textarea')).not.toBeNull())
  await change(document.querySelector('textarea')!, '未保存原因在恢复期间保留')
  const oldForceClose = dialogCallbacks.forceClose.at(-1)!
  await refreshFailure()
  respond = url => batch(url, recovery === 'missing' ? 0 : 1, recovery === 'ineligible' ? 4 : 3, recovery === 'different-row' ? 1 : 0)
  await click('重试'); await wait(() => expect(transferQuery()?.state.status).toBe('success'))
  await act(async () => oldForceClose())
  expect(unexpectedRequests).toEqual([]); expect(writes).toEqual([])
  expect(button('确认异常了结')).toBeUndefined(); expect(document.querySelector('textarea')).toBeNull()
  // A later verified read of this same in-transit row restores the local draft,
  // without automatically executing it or switching to a different record.
  respond = url => batch(url, 1, 3)
  await act(async () => { await query.invalidateQueries({ queryKey: ['transfer'] }) })
  await wait(() => expect(document.querySelector<HTMLTextAreaElement>('textarea')?.value).toBe('未保存原因在恢复期间保留'))
  expect(writes).toEqual([])
})
test('a previously captured dispatch action cannot submit a row recovered in status 2', async () => {
  respond = url => batch(url, 1); await mount(); await wait(() => expect(host.textContent).toContain('TR-SYN-1'))
  const oldDispatch = dialogCallbacks.dispatch.at(-1)!
  await refreshFailure(); respond = url => batch(url, 1, 2)
  await click('重试'); await wait(() => expect(transferQuery()?.state.status).toBe('success'))
  await act(async () => oldDispatch())
  expect(unexpectedRequests).toEqual([]); expect(writes).toEqual([])
})
test.each([
  { status: 1, action: '确认派发', endpoint: 'confirm' },
  { status: 1, action: '取消', endpoint: 'cancel' },
  { status: 2, action: '取消', endpoint: 'cancel' },
  { status: 3, action: '异常了结（运输丢失）', endpoint: 'force-close' },
])('a currently verified status $status row keeps its normal $endpoint action', async ({ status, action, endpoint }) => {
  respond = url => batch(url, 1, status); await mount(`/transfer?range=all&status=${status}`)
  await wait(() => expect(host.textContent).toContain('TR-SYN-1'))
  allowedWrite = `/api/transfer/1/${endpoint}`
  await click('更多操作'); await wait(() => expect(button(action)).toBeTruthy()); await click(action)
  if (endpoint === 'cancel') { await wait(() => expect(button('确认取消')).toBeTruthy()); await click('确认取消') }
  if (endpoint === 'force-close') {
    await wait(() => expect(document.querySelector('textarea')).not.toBeNull())
    await change(document.querySelector('textarea')!, '合法本地原因')
    await click('确认异常了结')
  }
  await wait(() => expect(writes).toHaveLength(1))
  expect(writes[0].path).toBe(allowedWrite)
  if (endpoint === 'force-close') expect(JSON.parse(writes[0].body)).toEqual({ reason: '合法本地原因' })
})
