// @vitest-environment jsdom
// Real stockcheck hook, API, QueryClient and browser ConfirmDialog; no backend.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import apiClient, { setApiClientBaseURL } from '@/api/client'
import { useAuthStore } from '@/store/authStore'
import { useDirtyGuardStore } from '@/store/dirtyGuardStore'
import type { StockCheck } from '@/types/stockcheck'
import CheckDetailDialog from './CheckDetailDialog'

// Observe callbacks at the real confirmation boundary, retaining its actual UI.
const observed = vi.hoisted(() => ({ confirms: new Map<string, () => void>() }))
vi.mock('@/components/shared/ConfirmDialog', async original => {
  const actual = await original<typeof import('@/components/shared/ConfirmDialog')>()
  return { ...actual, ConfirmDialog: (props: React.ComponentProps<typeof actual.ConfirmDialog>) => {
    if (props.open) observed.confirms.set(props.confirmText!, props.onConfirm)
    return <actual.ConfirmDialog {...props} />
  } }
})
// The activity tabs have their own GET contract and do not decide check eligibility.
vi.mock('@/components/shared/OrderDetailSections', () => ({ OrderDetailSections: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }))

const initial: StockCheck = { id: 1, checkNo: 'SYN-CK1', warehouseId: 8, warehouseName: '合成仓', checkType: 1, scopeType: null, scopeValue: null, status: 1, statusName: '进行中', operatorId: 9, operatorName: '合成员工', createdAt: '2026-10-15 08:00:00', items: [{ id: 11, productId: 3, productCode: 'SYN-P3', productName: '合成商品', unit: '个', bookQty: 5, actualQty: 3, diffQty: -2, scanDriven: false }] }
let check: StockCheck, readStatus: number, host: HTMLDivElement, root: Root, query: QueryClient
const requests: string[] = [], unexpected: string[] = [], closed = vi.fn()
const oldAdapter = apiClient.defaults.adapter, oldEnv = apiClient.defaults.env
function json(data: unknown, status = 200) { return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } }) }
const transport = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
  const method = (typeof input === 'object' && 'method' in input ? input.method : init?.method) || 'GET'
  requests.push(`${method} ${url.pathname}`)
  if (method === 'GET' && /^\/api\/stockcheck\/[12]$/.test(url.pathname)) return readStatus === 200 ? json({ success: true, data: check }) : json({ success: false, message: '合成详情读取失败', code: 'SYNTHETIC_READ_FAILURE' }, readStatus)
  if (method === 'GET' && url.pathname === '/api/products/qty-policies') return json({ success: true, data: [{ id: 3, allowDecimal: false }] })
  unexpected.push(`${method} ${url.pathname}`)
  return json({ success: false, message: '禁止非预期业务请求', code: 'SYNTHETIC_FORBIDDEN' }, 403)
}
function button(label: string) { return [...document.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent?.trim() === label) }
async function click(label: string) { const target = button(label); expect(target, label).toBeTruthy(); await act(async () => target!.click()) }
async function wait(assertion: () => void) { await vi.waitFor(async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)) }); assertion() }) }
async function draw(id: number | null = 1, open = id !== null) { await act(async () => root.render(<QueryClientProvider client={query}><CheckDetailDialog open={open} checkId={id} onClose={closed} /></QueryClientProvider>)) }
async function refresh() { await act(async () => { await query.invalidateQueries({ queryKey: ['stockcheck', 1] }) }); await wait(() => expect(query.getQueryState(['stockcheck', 1])?.status).toBe(readStatus === 200 ? 'success' : 'error')) }
async function input(value: string) {
  const field = document.querySelector<HTMLInputElement>('input[aria-label="合成商品实盘数量"]')!
  expect(field).toBeTruthy()
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, value)
    field.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  check = structuredClone(initial); readStatus = 200; requests.length = 0; unexpected.length = 0; closed.mockClear(); observed.confirms.clear()
  localStorage.clear(); sessionStorage.clear(); useDirtyGuardStore.setState({ pendingConfirm: null })
  setApiClientBaseURL('http://stockcheck.fixture.invalid/api')
  useAuthStore.getState().login('synthetic', null, { id: 9, username: 'synthetic', realName: '合成员工', roleId: 2, roleName: '合成角色', permissions: [] })
  apiClient.defaults.adapter = 'fetch'; apiClient.defaults.env = { ...oldEnv, fetch: transport }
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  query = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
})
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); query.clear()
  apiClient.defaults.adapter = oldAdapter; apiClient.defaults.env = oldEnv; setApiClientBaseURL('/api')
  useDirtyGuardStore.setState({ pendingConfirm: null }); localStorage.clear(); sessionStorage.clear()
  expect(unexpected).toEqual([])
})

// Backend documentStatusRules.stockcheck: submit/cancel only from1, to2/to3.
for (const action of [{ open: '提交盘点', confirm: '确认提交', title: '确认提交盘点' }, { open: '取消盘点', confirm: '确认取消', title: '确认取消本次盘点？' }]) {
  test.each([2, 3] as const)(`同ID成功GET成为终态%i撤回已开${action.open}资格`, async status => {
    await draw(); await wait(() => expect(button(action.open)).toBeTruthy())
    await click(action.open); expect(button(action.confirm)).toBeTruthy()
    check = { ...check, status, statusName: status === 2 ? '已完成' : '已取消' }
    await refresh()
    await wait(() => expect(document.body.textContent).toContain(check.statusName))
    expect(button(action.confirm)).toBeUndefined()
    expect(document.body.textContent).not.toContain(action.title)
    expect(button('保存实盘数')).toBeUndefined()
    expect(document.querySelectorAll('[role="dialog"] table thead th')).toHaveLength(5)
    expect(document.querySelectorAll('[role="dialog"] table tbody td')).toHaveLength(5)
    expect(document.querySelectorAll('[role="dialog"] table thead button[aria-label^="调整"]')).toHaveLength(5)
    expect(requests.filter(item => !item.startsWith('GET '))).toEqual([])
    expect(closed).not.toHaveBeenCalled()
  })
  test.each([2, 3] as const)(`保留的旧${action.open}回调在同ID成功GET终态%i后也不发送写请求`, async status => {
    await draw(); await wait(() => expect(button(action.open)).toBeTruthy())
    await click(action.open)
    const oldConfirm = observed.confirms.get(action.confirm)!
    expect(oldConfirm).toBeTypeOf('function')
    check = { ...check, status, statusName: status === 2 ? '已完成' : '已取消' }
    await refresh(); await wait(() => expect(document.body.textContent).toContain(check.statusName))
    await act(async () => oldConfirm())
    expect(requests.filter(item => !item.startsWith('GET '))).toEqual([])
    expect(closed).not.toHaveBeenCalled()
  })
  test(`保留的旧${action.open}回调在换ID或关闭同ID后不发送写请求`, async () => {
    await draw(); await wait(() => expect(button(action.open)).toBeTruthy())
    await click(action.open)
    const firstConfirm = observed.confirms.get(action.confirm)!
    check = { ...initial, id: 2, checkNo: 'SYN-CK2' }; await draw(2)
    await wait(() => expect(document.body.textContent).toContain('SYN-CK2'))
    await act(async () => firstConfirm())
    expect(requests.filter(item => !item.startsWith('GET '))).toEqual([])
    await click(action.open)
    const secondConfirm = observed.confirms.get(action.confirm)!
    await draw(2, false)
    expect(button(action.confirm)).toBeUndefined()
    await act(async () => secondConfirm())
    expect(requests.filter(item => !item.startsWith('GET '))).toEqual([])
  })
}

test('正常同ID成功刷新保持合法确认，用户关闭确认不发写请求', async () => {
  await draw(); await wait(() => expect(button('提交盘点')).toBeTruthy())
  await click('提交盘点')
  check = { ...check, remark: '合成后台刷新' }; await refresh()
  await wait(() => expect(document.body.textContent).toContain('合成后台刷新'))
  expect(button('确认提交')).toBeTruthy()
  await click('取消')
  expect(button('确认提交')).toBeUndefined()
  expect(requests.filter(item => !item.startsWith('GET '))).toEqual([])
})

test('详情失败后原GET重试恢复草稿，旧确认不自动重开', async () => {
  await draw(); await wait(() => expect(button('提交盘点')).toBeTruthy())
  await input('4'); await click('提交盘点')
  readStatus = 500; await refresh()
  await wait(() => expect(button('重试')).toBeTruthy())
  expect(button('确认提交')).toBeUndefined()
  await click('关闭')
  expect(closed).not.toHaveBeenCalled()
  expect(useDirtyGuardStore.getState().pendingConfirm).not.toBeNull()
  act(() => useDirtyGuardStore.getState().resolveConfirm(false))
  readStatus = 200; check = { ...check, items: check.items!.map(item => ({ ...item, actualQty: 2 })) }
  await click('重试')
  await wait(() => expect(document.querySelector<HTMLInputElement>('input[aria-label="合成商品实盘数量"]')?.value).toBe('4'))
  expect(button('确认提交')).toBeUndefined()
  await click('提交盘点'); expect(button('确认提交')).toBeTruthy()
})

test('切换当前ID或关闭详情清除旧确认，回原单不自动重开', async () => {
  await draw(); await wait(() => expect(button('提交盘点')).toBeTruthy())
  await click('提交盘点')
  check = { ...initial, id: 2, checkNo: 'SYN-CK2' }; await draw(2)
  await wait(() => expect(document.body.textContent).toContain('SYN-CK2'))
  expect(button('确认提交')).toBeUndefined()
  await click('提交盘点'); await draw(null)
  expect(button('确认提交')).toBeUndefined()
  await draw(2)
  expect(button('确认提交')).toBeUndefined()
})
