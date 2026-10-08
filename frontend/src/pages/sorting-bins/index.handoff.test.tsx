// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, afterEach, expect, test, vi } from 'vitest'
import SortingBinsPage from './index'
import { TabPathContext } from '@/components/layout/TabPathContext'
import { resolveRoutePermission } from '@/router/routeDefinitions'
import { hasPermission } from '@/lib/permissions'
import { PERMISSIONS } from '@/lib/permission-codes'
const state = vi.hoisted(() => ({ assign: true, view: false, manage: false, bins: vi.fn(), warehouses: vi.fn(), pending: vi.fn(), post: vi.fn() }))
vi.mock('@/hooks/usePermission', () => ({ usePermission: () => ({ can: (code: string) => (code === 'warehouse.task.assign' && state.assign) || (code === 'sorting.bin.view' && state.view) || (code === 'sorting.bin.manage' && state.manage) }) }))
vi.mock('@/api/sorting-bins', () => ({ getSortingBinsApi: state.bins }))
vi.mock('@/api/warehouses', () => ({ getWarehousesActiveApi: state.warehouses }))
vi.mock('@/api/warehouse-tasks', () => ({ getPendingSortingBinTasksApi: state.pending, assignSortingBinApi: state.post }))
vi.mock('@/components/ui/dialog', async importOriginal => ({ ...await importOriginal<typeof import('@/components/ui/dialog')>(), Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) => open ? <div>{children}</div> : null, DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>, DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>, DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>, DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }))
let host: HTMLDivElement, root: Root
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); state.assign = true; state.view = false; state.manage = false; state.bins.mockReset().mockResolvedValue([]); state.warehouses.mockReset().mockResolvedValue([]); state.pending.mockReset().mockResolvedValue({ list: [], pagination: { total: 0 } }); state.post.mockReset(); host = document.createElement('div'); document.body.append(host); root = createRoot(host) })
afterEach(() => { act(() => root.unmount()); host.remove() })
async function render(path: string) { const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); await act(async () => { root.render(<QueryClientProvider client={client}><TabPathContext.Provider value={path}><SortingBinsPage /></TabPathContext.Provider></QueryClientProvider>); await new Promise(done => setTimeout(done, 30)) }); await act(async () => { await new Promise(done => setTimeout(done, 30)) }) }
test('仅任务分配权限可进注册页且不读分拣格管理数据', async () => {
  expect(hasPermission([PERMISSIONS.WAREHOUSE_TASK_ASSIGN], resolveRoutePermission('/sorting-bins')!, 5)).toBe(true)
  await render('/sorting-bins?taskId=91&warehouseId=8')
  expect(state.pending).toHaveBeenCalledWith({ taskId: 91, warehouseId: 8, page: 1, pageSize: 20 })
  expect(state.bins).not.toHaveBeenCalled(); expect(state.warehouses).not.toHaveBeenCalled(); expect(state.post).not.toHaveBeenCalled()
})
test.each(['taskId=0&warehouseId=8', 'taskId=91', 'taskId=91&warehouseId=8&taskId=92', 'taskId=9007199254740992&warehouseId=8', 'taskId=1e2&warehouseId=8'])('非法直接上下文拒绝读取和分配：%s', async search => {
  await render(`/sorting-bins?${search}`)
  expect(host.textContent).toContain('交接信息无效')
  expect(state.pending).not.toHaveBeenCalled(); expect(state.post).not.toHaveBeenCalled()
})
test('无任务分配权限的直接交接明确拒绝且不读任务', async () => {
  state.assign = false; await render('/sorting-bins?taskId=91&warehouseId=8')
  expect(host.textContent).toContain('没有分配仓库任务的权限')
  expect(state.pending).not.toHaveBeenCalled(); expect(state.post).not.toHaveBeenCalled()
})


test('已有分拣格表单草稿在缓存页接收 A/B 交接时仍保留', async () => {
  state.view = true; state.manage = true
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const view = (path: string) => <QueryClientProvider client={client}><TabPathContext.Provider value={path}><SortingBinsPage /></TabPathContext.Provider></QueryClientProvider>
  await act(async () => { root.render(view('/sorting-bins')); await new Promise(done => setTimeout(done, 30)) })
  await act(async () => { await new Promise(done => setTimeout(done, 30)) })
  act(() => [...host.querySelectorAll('button')].find(node => node.textContent === '+ 新建分拣格')!.click())
  const input = host.querySelector<HTMLInputElement>('#sorting-bin-code')!
  expect(input).toBeTruthy()
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '草稿格位')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => { root.render(view('/sorting-bins?taskId=11&warehouseId=1')); await new Promise(done => setTimeout(done, 30)) })
  await act(async () => { root.render(view('/sorting-bins?taskId=91&warehouseId=8')); await new Promise(done => setTimeout(done, 30)) })
  expect(host.querySelector<HTMLInputElement>('#sorting-bin-code')!.value).toBe('草稿格位')
  expect(state.pending).toHaveBeenLastCalledWith({ taskId: 91, warehouseId: 8, page: 1, pageSize: 20 })
  expect(state.post).not.toHaveBeenCalled()
})
