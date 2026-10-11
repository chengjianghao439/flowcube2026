// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { SupplierFinder } from './SupplierFinder'
import { getSuppliersApi } from '@/api/suppliers'
import { useAuthStore } from '@/store/authStore'
import { PERMISSIONS } from '@/lib/permission-codes'
import { ApiClientError } from '@/api/client'

vi.mock('@/api/suppliers', () => ({ getSuppliersApi: vi.fn() }))
vi.mock('@/components/shared/AppDialog', () => ({
  AppDialog: ({ children, footer, dialogId, captureFocusOnOpen }: { children: ReactNode; footer?: ReactNode; dialogId?: string; captureFocusOnOpen?: boolean }) => <div data-dialog-id={dialogId} data-capture-focus={captureFocusOnOpen}>{children}{footer}</div>,
}))

const supplier = (id = 1, isActive = true) => ({ id, name: `供应商${id}`, code: `S${id}`, contact: '联系人', phone: '电话', isActive })
let host: HTMLDivElement, root: Root, cache: QueryClient, open: boolean
const confirm = vi.fn(), close = vi.fn()
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  cache = new QueryClient({ defaultOptions: { queries: { retry: false } } }); open = true; confirm.mockReset(); close.mockReset()
  vi.mocked(getSuppliersApi).mockReset()
  vi.mocked(getSuppliersApi).mockResolvedValue({ list: [supplier()], pagination: { page: 1, pageSize: 200, total: 1 } } as never)
  useAuthStore.getState().login('offline-supplier-fixture', null, { id: 1, username: 'fixture', realName: 'fixture', roleName: 'fixture', roleId: 2, permissions: [PERMISSIONS.SUPPLIER_VIEW] })
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) { return this.hasAttribute('data-table-scroll') ? 480 : 0 })
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(800)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const scroll = this.closest<HTMLElement>('[data-table-scroll]'), height = this.hasAttribute('data-table-scroll') ? 480 : this.tagName === 'TR' ? 48 : 0
    return { height, width: 800, top: this === scroll ? 0 : -(scroll?.scrollTop || 0), left: 0, bottom: height, right: 800, x: 0, y: 0, toJSON() {} }
  })
})
afterEach(() => { act(() => root.unmount()); cache.clear(); host.remove(); useAuthStore.setState({ token: null, user: null }); vi.restoreAllMocks(); vi.unstubAllGlobals() })
async function draw() { await act(async () => { root.render(<QueryClientProvider client={cache}><SupplierFinder compact context="purchase" dialogId="purchase-supplier-finder" open={open} onClose={close} onConfirm={confirm} /></QueryClientProvider>); await new Promise(resolve => setTimeout(resolve, 10)) }) }
const row = (id = 1) => host.querySelector<HTMLElement>(`[data-finder-key="${id}"]`)!
const button = (label: string) => [...host.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent?.trim() === label)!
async function ready() { await vi.waitFor(() => expect(row()).toBeTruthy()); await vi.waitFor(() => expect(button('确认选择').disabled).toBe(true)) }

test('purchase opts into supplier text, separate dialog settings and Space/Enter without customer labels', async () => {
  await draw(); await ready()
  expect(host.querySelector('[data-dialog-id]')?.getAttribute('data-dialog-id')).toBe('purchase-supplier-finder')
  expect(host.querySelector('[data-capture-focus]')?.getAttribute('data-capture-focus')).toBe('true')
  expect(host.textContent).toContain('供应商名称'); expect(host.textContent).toContain('共 1 个供应商'); expect(host.textContent).not.toContain('客户')
  await act(async () => row().dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true })))
  expect(confirm).not.toHaveBeenCalled(); expect(button('确认选择').disabled).toBe(false)
  await act(async () => { row().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); button('确认选择').click() })
  expect(confirm).toHaveBeenCalledOnce(); expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ id: 1, name: '供应商1' }))
})

test('truncation counts raw records accurately and still confirms a loaded active supplier', async () => {
  const list = Array.from({ length: 5000 }, (_, index) => supplier(index + 1, index !== 1))
  vi.mocked(getSuppliersApi).mockResolvedValue({ list, pagination: { page: 1, pageSize: 5000, total: 5100 }, truncated: true } as never)
  await draw(); await ready()
  expect(host.textContent).toContain('已读取 5,000 / 5,100 条供应商记录'); expect(host.textContent).toContain('缩小搜索范围')
  expect(host.textContent).not.toContain('共 4999'); expect(host.textContent).not.toContain('共 4,999')
  expect(host.querySelectorAll('[data-finder-key]').length).toBeLessThan(40)
  expect(row(2)).toBeNull()
  await act(async () => row().click())
  expect(button('确认选择').disabled).toBe(false)
  await act(async () => { row().dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); row().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); button('确认选择').click() })
  expect(confirm).toHaveBeenCalledOnce(); expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }))
})

test('a complete empty supplier result has configurable text and no permanent upper-limit notice', async () => {
  vi.mocked(getSuppliersApi).mockResolvedValue({ list: [], pagination: { page: 1, pageSize: 200, total: 0 } } as never)
  await draw(); await vi.waitFor(() => expect(host.textContent).toContain('没有匹配的供应商'))
  expect(host.textContent).not.toContain('客户'); expect(host.textContent).not.toContain('缩小搜索范围')
})

test('closing while a search debounce is pending resets selection and invalidates old row callbacks', async () => {
  await draw(); await ready(); const old = row()
  await act(async () => old.click()); expect(button('确认选择').disabled).toBe(false)
  const input = host.querySelector('input')!
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '旧词'); input.dispatchEvent(new Event('input', { bubbles: true })); button('取消').click() })
  await act(async () => old.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })))
  expect(confirm).not.toHaveBeenCalled()
  open = false; await draw(); open = true; await draw(); await ready()
  expect(host.querySelector<HTMLInputElement>('input')!.value).toBe('')
  await act(async () => old.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })))
  expect(confirm).not.toHaveBeenCalled()
})

test.each([
  [new ApiClientError({ status: 403, message: '当前账号没有供应商查看权限' }), '没有供应商查看权限'],
  [new Error('网络连接中断'), '加载失败'],
])('purchase separates forbidden and transport failures and restores selection after a real retry', async (error, title) => {
  vi.mocked(getSuppliersApi).mockRejectedValue(error)
  await draw(); await vi.waitFor(() => expect([...host.querySelectorAll('p.font-medium')].some(node => node.textContent === title)).toBe(true))
  expect(host.textContent).not.toContain('共 0'); expect(button('确认选择').disabled).toBe(true)
  vi.mocked(getSuppliersApi).mockResolvedValue({ list: [supplier()], pagination: { page: 1, pageSize: 200, total: 1 } } as never)
  await act(async () => button('重试').click()); await ready()
  await act(async () => row().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
  expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }))
})

test('purchase losing view permission pauses existing input without a false empty result', async () => {
  await draw(); await ready(); const old = row()
  await act(async () => useAuthStore.setState({ user: { ...useAuthStore.getState().user!, permissions: [] } }))
  expect(host.textContent).toContain('当前没有供应商查看权限')
  expect(host.textContent).not.toContain('共 0'); expect(host.textContent).not.toContain('没有匹配的供应商')
  await act(async () => old.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })))
  expect(confirm).not.toHaveBeenCalled()
})

test('compact confirms updated metadata for a stable id and refuses an id removed by refresh', async () => {
  await draw(); await ready(); const old = row()
  await act(async () => old.click())
  vi.mocked(getSuppliersApi).mockResolvedValue({ list: [{ ...supplier(), name: '已更新供应商', phone: '新电话' }], pagination: { page: 1, pageSize: 200, total: 1 } } as never)
  await act(async () => { await cache.invalidateQueries({ queryKey: ['suppliers'] }) })
  await vi.waitFor(() => expect(row().textContent).toContain('已更新供应商'))
  await act(async () => old.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })))
  expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ id: 1, name: '已更新供应商', phone: '新电话' }))
  open = false; await draw(); open = true; await draw(); await ready(); confirm.mockClear()
  const removed = row(); await act(async () => removed.click())
  vi.mocked(getSuppliersApi).mockResolvedValue({ list: [supplier(2)], pagination: { page: 1, pageSize: 200, total: 1 } } as never)
  await act(async () => { await cache.invalidateQueries({ queryKey: ['suppliers'] }) })
  await vi.waitFor(() => expect(row(2)).toBeTruthy())
  expect(button('确认选择').disabled).toBe(true)
  await act(async () => removed.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })))
  expect(confirm).not.toHaveBeenCalled()
})

test.each([{}, { list: [] }])('legacy supplier callers do not require compact pagination metadata: %j', async result => {
  vi.mocked(getSuppliersApi).mockResolvedValue(result as never)
  await act(async () => root.render(<QueryClientProvider client={cache}><SupplierFinder open onClose={close} onConfirm={confirm} /></QueryClientProvider>))
  await vi.waitFor(() => expect(host.textContent).toContain('暂无数据'))
  expect(host.textContent).toContain('单击选择，双击直接填入')
  expect(host.textContent).not.toContain('已读取')
})
