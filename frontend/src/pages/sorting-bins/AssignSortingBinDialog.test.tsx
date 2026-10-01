// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, afterEach, expect, test, vi } from 'vitest'
import AssignSortingBinDialog from './AssignSortingBinDialog'

const api = vi.hoisted(() => ({ list: vi.fn(), assign: vi.fn() }))
vi.mock('@/api/warehouse-tasks', () => ({ getPendingSortingBinTasksApi: api.list, assignSortingBinApi: api.assign }))
vi.mock('@/lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) => open ? <div>{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
}))

let host: HTMLDivElement
let root: Root
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  api.list.mockReset().mockResolvedValue({ list: [{ id: 11, taskNo: 'WT-11', warehouseName: '主仓', customerName: '客户', statusName: '待分拣' }], pagination: { page: 1, pageSize: 20, total: 1 } })
  api.assign.mockReset().mockResolvedValue({ taskId: 11, binId: 2, binCode: 'A02' })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

test('主管可从待分配列表以稳定请求键补分配', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  await act(async () => { root.render(<QueryClientProvider client={client}><AssignSortingBinDialog open onClose={() => {}} warehouseId={1} /></QueryClientProvider>); await new Promise(resolve => setTimeout(resolve, 30)) })
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)) })
  expect(host.textContent).toContain('WT-11')
  const button = [...host.querySelectorAll('button')].find(node => node.textContent === '补分配')!
  await act(async () => { button.click(); await new Promise(resolve => setTimeout(resolve, 20)) })
  expect(api.assign).toHaveBeenCalledWith(11, expect.any(String))
  expect(api.assign.mock.calls[0][1].length).toBeGreaterThan(8)
})

test('目标交接精确查询超过首分页的任务，打开不自动分配', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  api.list.mockResolvedValue({ list: [{ id: 91, taskNo: 'WT-91', warehouseId: 8, warehouseName: '分仓', status: 2 }], pagination: { total: 1 } })
  await act(async () => { root.render(<QueryClientProvider client={client}><AssignSortingBinDialog open onClose={() => {}} warehouseId={8} taskId={91} /></QueryClientProvider>); await new Promise(resolve => setTimeout(resolve, 30)) })
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)) })
  expect(api.list).toHaveBeenCalledWith({ warehouseId: 8, taskId: 91, page: 1, pageSize: 20 })
  expect(host.textContent).toContain('WT-91')
  expect(api.assign).not.toHaveBeenCalled()
})

test('重新打开先读取最新资格，缓存行在刷新期间不能分配，失效后无陈旧动作', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  const view = (open: boolean) => <QueryClientProvider client={client}><AssignSortingBinDialog open={open} onClose={() => {}} warehouseId={1} taskId={11} /></QueryClientProvider>
  api.list.mockResolvedValue({ list: [{ id: 11, taskNo: 'WT-11', warehouseId: 1, status: 2 }], pagination: { total: 1 } })
  await act(async () => { root.render(view(true)); await new Promise(resolve => setTimeout(resolve, 30)) })
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)) })
  act(() => root.render(view(false)))
  let resolve!: (value: unknown) => void
  api.list.mockImplementation(() => new Promise(done => { resolve = done }))
  act(() => root.render(view(true)))
  expect([...host.querySelectorAll('button')].filter(node => node.textContent === '补分配').every(node => node.disabled)).toBe(true)
  expect(api.list).toHaveBeenCalledTimes(2)
  await act(async () => { resolve({ list: [], pagination: { total: 0 } }); await new Promise(done => setTimeout(done, 30)) })
  expect(host.textContent).toContain('已刷新')
  expect([...host.querySelectorAll('button')].find(node => node.textContent === '补分配')).toBeUndefined()
  expect(api.assign).not.toHaveBeenCalled()
})

test('交接目标 A 到 B 时，在途分配与回执始终绑定 A，不自动提交 B', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  api.list.mockImplementation(({ taskId, warehouseId }) => Promise.resolve({ list: [{ id: taskId, warehouseId, taskNo: `WT-${taskId}`, status: 2 }], pagination: { total: 1 } }))
  let finish!: (value: unknown) => void
  api.assign.mockImplementation(() => new Promise(resolve => { finish = resolve }))
  const view = (taskId: number, warehouseId: number) => <QueryClientProvider client={client}><AssignSortingBinDialog open onClose={() => {}} taskId={taskId} warehouseId={warehouseId} /></QueryClientProvider>
  await act(async () => { root.render(view(11, 1)); await new Promise(done => setTimeout(done, 30)) })
  await act(async () => { await new Promise(done => setTimeout(done, 30)) })
  act(() => [...host.querySelectorAll('button')].find(node => node.textContent === '补分配')!.click())
  await act(async () => { root.render(view(91, 8)); await new Promise(done => setTimeout(done, 30)) })
  await act(async () => { await new Promise(done => setTimeout(done, 30)) })
  expect(host.textContent).toContain('WT-91'); expect(host.textContent).not.toContain('WT-11')
  expect([...host.querySelectorAll('button')].find(node => node.textContent === '补分配')!.disabled).toBe(true)
  expect(api.assign).toHaveBeenCalledTimes(1); expect(api.assign.mock.calls[0][0]).toBe(11)
  await act(async () => { finish({ taskId: 11, binId: 2, binCode: 'A02' }); await new Promise(done => setTimeout(done, 30)) })
  expect(api.assign).toHaveBeenCalledTimes(1)
  expect(host.textContent).toContain('WT-91')
})

test('刷新读取失败不显示缓存写动作，并可重试', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const view = (open: boolean) => <QueryClientProvider client={client}><AssignSortingBinDialog open={open} onClose={() => {}} warehouseId={1} taskId={11} /></QueryClientProvider>
  await act(async () => { root.render(view(true)); await new Promise(done => setTimeout(done, 30)) })
  await act(async () => { await new Promise(done => setTimeout(done, 30)) })
  act(() => root.render(view(false)))
  api.list.mockRejectedValue(new Error('无权访问或读取失败'))
  await act(async () => { root.render(view(true)); await new Promise(done => setTimeout(done, 30)) })
  await act(async () => { await new Promise(done => setTimeout(done, 30)) })
  expect(host.textContent).toContain('无权访问或读取失败')
  expect([...host.querySelectorAll('button')].find(node => node.textContent === '补分配')).toBeUndefined()
  expect([...host.querySelectorAll('button')].find(node => node.textContent === '重试')).toBeTruthy()
  expect(api.assign).not.toHaveBeenCalled()
})
