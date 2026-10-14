// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import PurchasePage from './index'
import { useAuthStore } from '@/store/authStore'
import { SectionVisibilityContext } from '@/components/layout/SectionVisibilityContext'
import { KIT_QUERY_KEY, loadKitQuery, saveKitQuery, type KitQueryRecord } from '@/lib/kitOperationRecovery'
import { kitQuerySession } from '@/lib/kitRecoveryIdentity'
import type { TableColumn } from '@/types'
import type { PurchaseOrder } from '@/types/purchase'

const io = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), defaults: { baseURL: '/a' }, invalidate: vi.fn() }))
vi.mock('@/api/client', () => ({ default: { defaults: io.defaults }, payloadClient: { get: io.get, post: io.post } }))
vi.mock('@/hooks/useInvalidate', () => ({ useInvalidate: () => io.invalidate }))
vi.mock('@/components/print/OrderPrintOverlay', () => ({ OrderPrintOverlay: () => null }))
vi.mock('./PurchaseQueryDialog', () => ({ default: () => null }))
vi.mock('@/lib/toast', () => ({ toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() } }))
// Isolate list layout/menus; the page, ConfirmDialog, APIs and recovery hooks are real.
vi.mock('@/components/shared/DataTable', () => ({ default: ({ columns, data }: { columns: TableColumn<PurchaseOrder>[]; data: PurchaseOrder[] }) => <div>{data.map(row => <div key={row.id} data-order={row.id}>{columns.map(c => <div key={c.key}>{c.render?.(row[c.key as keyof PurchaseOrder], row) as React.ReactNode}</div>)}</div>)}</div> }))
vi.mock('@/components/shared/TableActionsMenu', () => ({ default: ({ items }: { items: { label: string; disabled?: boolean; onClick: () => void }[] }) => <>{items.map(item => <button key={item.label} disabled={item.disabled} onClick={item.onClick}>{item.label}</button>)}</> }))

const orders = [80, 81].map(id => ({ id, orderNo: `PO${id}`, status: 2, canCloseRemaining: true, totalAmount: 100 }))
let host: HTMLDivElement, root: Root, cache: QueryClient
const success = { purchaseOrderId: 80, status: 3, closedReason: 'short_close' }
const flush = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 15)) })
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  sessionStorage.clear(); vi.resetAllMocks(); io.defaults.baseURL = '/a'
  useAuthStore.getState().login('fixture', null, { id: 5, roleId: 1, permissions: ['*'] } as never)
  io.get.mockImplementation((url: string) => url === '/purchase'
    ? Promise.resolve({ list: orders, pagination: { total: 2 } })
    : Promise.resolve({ status: 'not_found', data: null, message: '' }))
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  cache = new QueryClient({ defaultOptions: { queries: { retry: false } } })
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); cache.clear() })
async function render(active = true) {
  await act(async () => root.render(<QueryClientProvider client={cache}><MemoryRouter initialEntries={['/purchase?range=all']}><SectionVisibilityContext.Provider value={active}><PurchasePage /></SectionVisibilityContext.Provider></MemoryRouter></QueryClientProvider>)); await flush()
}
const button = (scope: ParentNode, name: string) => [...scope.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === name)!
async function click(scope: ParentNode, name: string) {
  const target = button(scope, name); expect(target, name).toBeTruthy(); expect(target.disabled, name).toBe(false)
  await act(async () => target.click()); await flush()
}
async function submit() {
  await click(host.querySelector('[data-order="80"]')!, '结束剩余采购')
  const dialog = document.querySelector('[role="dialog"]')!
  expect(dialog.textContent).toContain('未收采购余量将取消')
  await click(dialog, '结束剩余采购')
}
function pending() { return loadKitQuery('purchase-close-remaining')! }
function seed(change: Partial<KitQueryRecord> = {}) {
  saveKitQuery({ version: 1, draftId: 'original-mount', scope: 'purchase-close-remaining', sessionId: kitQuerySession(), userId: 5, baseURL: '/a', requestKey: 'original-key', action: 'purchase.closeRemaining.80', kind: 'close-remaining', resourceType: 'purchase_order', resourceId: 80, ...change })
}
test('unknown close freezes original key/body and prevents another purchase close; scoped read rejection keeps it', async () => {
  io.post.mockRejectedValue({ status: 503 }); await render(); await submit()
  const original = pending()
  expect(original).toMatchObject({ action: 'purchase.closeRemaining.80', resourceId: 80 })
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  expect(button(host.querySelector('[data-order="81"]')!, '结束剩余采购').disabled).toBe(true)
  expect(io.post.mock.calls[0]).toEqual(['/purchase/80/close', {}, expect.objectContaining({ baseURL: '/a', _erpApiFallbackTried: true, headers: { 'X-Request-Key': original.requestKey } })])
  io.get.mockRejectedValueOnce({ status: 403 }); await click(host, '查询原提交结果')
  expect(pending()).toEqual(original); expect(io.post).toHaveBeenCalledTimes(1)
})
test('mounted retry queries first then resubmits only original empty body and key; later 403 cannot clear unknown', async () => {
  io.post.mockRejectedValueOnce({ status: 503 }).mockRejectedValueOnce({ status: 403 })
  await render(); await submit(); const original = pending()
  await click(host, '按原请求重试')
  expect(io.get.mock.calls.find(call => call[0].startsWith('/system/request-status/'))).toEqual([`/system/request-status/${original.requestKey}`, expect.objectContaining({ params: { action: original.action }, baseURL: '/a' })])
  expect(io.post).toHaveBeenCalledTimes(2); expect(io.post.mock.calls[1]).toEqual(io.post.mock.calls[0])
  expect(pending()).toEqual(original)
})
test('cold page restores query identity only, never POSTs or retries; explicit GET confirms matching result', async () => {
  seed(); io.get.mockImplementation((url: string) => url === '/purchase' ? Promise.resolve({ list: orders, pagination: { total: 2 } }) : Promise.resolve({ status: 'success', resourceType: 'purchase_order', resourceId: 80, data: success }))
  await render()
  expect(io.post).not.toHaveBeenCalled(); expect(io.get.mock.calls.filter(c => c[0].startsWith('/system/'))).toHaveLength(0)
  expect(button(host, '按原请求重试').disabled).toBe(true)
  await click(host, '查询原提交结果')
  expect(io.post).not.toHaveBeenCalled(); expect(pending()).toBeNull(); expect(io.invalidate).toHaveBeenCalledWith('purchase_close')
})
test('actual unknown page unmount/remount loses body retry but preserves original query key', async () => {
  io.post.mockRejectedValue({ status: 503 }); await render(); await submit(); const original = pending()
  await act(async () => root.unmount()); root = createRoot(host); cache.clear(); await render()
  expect(pending()).toEqual(original); expect(button(host, '按原请求重试').disabled).toBe(true)
  await click(host, '查询原提交结果')
  expect(io.post).toHaveBeenCalledTimes(1)
  expect(io.get.mock.calls.at(-1)).toEqual([`/system/request-status/${original.requestKey}`, expect.objectContaining({ params: { action: original.action } })])
  expect(pending()).toEqual(original)
})
test('revoked write permission leaves original query available but cannot repeat POST', async () => {
  io.post.mockRejectedValue({ status: 503 }); await render(); await submit(); const original = pending()
  await act(async () => useAuthStore.setState({ user: { id: 5, roleId: 2, permissions: [] } as never }))
  expect(button(host, '按原请求重试').disabled).toBe(true)
  await click(host, '查询原提交结果')
  expect(pending()).toEqual(original); expect(io.post).toHaveBeenCalledTimes(1)
})
test.each([
  { resourceType: 'sale_order', resourceId: 80, data: success },
  { resourceType: 'purchase_order', resourceId: 81, data: success },
  { resourceType: 'purchase_order', resourceId: 80, data: { ...success, purchaseOrderId: 81 } },
])('cold query cannot accept foreign receipt %j', async receipt => {
  seed(); await render(); io.get.mockResolvedValueOnce({ status: 'success', ...receipt }); await click(host, '查询原提交结果')
  expect(pending()).toBeTruthy(); expect(io.post).not.toHaveBeenCalled(); expect(io.invalidate).not.toHaveBeenCalled()
})
test('hidden page and changed server cannot dispatch original reads or new writes', async () => {
  seed(); await render(false); await click(host, '查询原提交结果')
  expect(io.get.mock.calls.filter(c => c[0].startsWith('/system/'))).toHaveLength(0)
  await render(true); io.defaults.baseURL = '/b'; await click(host, '查询原提交结果')
  expect(io.get.mock.calls.filter(c => c[0].startsWith('/system/'))).toHaveLength(0); expect(io.post).not.toHaveBeenCalled(); expect(pending()).toBeTruthy()
})
test('account change during pending read cannot apply result or remove original identity', async () => {
  seed(); await render(); const original = sessionStorage.getItem(KIT_QUERY_KEY)
  let resolve!: (result: unknown) => void
  io.get.mockImplementationOnce(() => new Promise(r => { resolve = r }))
  await click(host, '查询原提交结果')
  await act(async () => useAuthStore.getState().login('another-fixture', null, { id: 6, roleId: 1, permissions: ['*'] } as never))
  await act(async () => resolve({ status: 'success', resourceType: 'purchase_order', resourceId: 80, data: success })); await flush()
  expect(sessionStorage.getItem(KIT_QUERY_KEY)).toBe(original); expect(io.invalidate).not.toHaveBeenCalled(); expect(io.post).not.toHaveBeenCalled()
})
