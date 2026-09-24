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
