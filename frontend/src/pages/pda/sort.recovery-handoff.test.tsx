// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { useAuthStore } from '@/store/authStore'
import type { User } from '@/types'

// 保留真实 useCriticalPdaAction / usePendingRequests，仅隔离网络与硬件边界。
const api = vi.hoisted(() => ({ task: vi.fn(), sort: vi.fn(), receipt: vi.fn(), scan: null as null | ((code: string) => void) }))
vi.mock('@/hooks/useNetworkStatus', () => ({ useNetworkStatus: () => 'online' }))
vi.mock('@/hooks/usePdaFeedback', () => ({ usePdaFeedback: () => ({ flash: null, ok: vi.fn(), warn: vi.fn(), err: vi.fn() }) }))
vi.mock('@/api/warehouse-tasks', () => ({ getTaskByIdApi: api.task, sortDoneApi: api.sort }))
vi.mock('@/api/operation-requests', () => ({ getOperationRequestStatusApi: api.receipt }))
vi.mock('@/api/sorting-bins', () => ({ getSortingBinsApi: async () => [], scanProductForSortApi: async (code: string) => ({
  taskId: code === 'P2' ? 73 : 42, taskNo: code === 'P2' ? 'WT073' : 'WT042', itemId: code === 'P2' ? 11 : 9,
  sortingBinCode: code === 'P2' ? 'B01' : 'A01', productCode: code, productName: '测试商品', sortableQty: 1, unit: '个',
}) }))
vi.mock('@/components/pda/PdaScanner', () => ({ default: ({ onScan }: { onScan: (code: string) => void }) => { api.scan = onScan; return null } }))
import Page from './sort'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let host: HTMLDivElement
let root: Root
let client: QueryClient
let receiptResponses: ((status: { status: string; data: null }) => void)[] = []
const task42 = { id: 42, taskNo: 'WT042', status: 4, statusName: '待复核', items: [] }
const button = (text: string) => [...host.querySelectorAll('button')].find(b => b.textContent === text)
function Location() { return <output>{useLocation().pathname}</output> }
async function settle() { for (let i = 0; i < 5; i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)) }) }
async function scan(code: string) { await act(async () => { api.scan?.(code) }); await settle() }
async function mount() {
  host = document.createElement('div'); document.body.appendChild(host)
  root = createRoot(host)
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  await act(async () => { root.render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/pda/sort']}><Location /><Page /></MemoryRouter></QueryClientProvider>) })
  await settle()
}
beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  useAuthStore.setState({ user: { id: 901, roleId: 1, permissions: [] } as unknown as User, token: 'test-token', sessionGeneration: useAuthStore.getState().sessionGeneration + 1 })
  api.task.mockResolvedValue(task42)
  // 明确非传输错误：真实 hook 会用刚 claim 的原冻结 record 查询服务器状态。
  api.sort.mockRejectedValue(Object.assign(new Error('当前任务已进入待复核'), { code: 'TASK_STAGE_CHANGED' }))
  // claim 的共享订阅可能同时启动只读回执查询；让它仍在途，不能由并行自动查询救场。
  // 此用例必须由 run 自己持有的原冻结 record 兜底完成。
  receiptResponses = []
  api.receipt.mockImplementation(() => new Promise(resolve => { receiptResponses.push(resolve) }))
})
afterEach(async () => {
  await act(async () => { root?.unmount(); client?.clear() })
  host?.remove()
  useAuthStore.getState().logout()
  await act(async () => { receiptResponses.forEach(resolve => resolve({ status: 'pending', data: null })) })
  localStorage.clear()
})

test('真实 hook 从无 pending 提交，经原冻结 record 兜底确认后提供原任务复核入口', async () => {
  await mount(); await scan('P1'); await scan('A01')
  expect(api.sort).toHaveBeenCalledWith(42, [{ itemId: 9, sortedQty: 1 }], expect.any(String))
  expect(api.task).toHaveBeenCalledWith(42, { skipGlobalError: true })
  expect(button('去复核')).toBeTruthy()
  await act(async () => { button('去复核')!.click() })
  expect(host.querySelector('output')?.textContent).toBe('/pda/check/42')
  expect(api.sort).toHaveBeenCalledTimes(1)
  expect(JSON.parse(localStorage.getItem('pda_pending_request_confirmations') || '{}').records).toEqual([])
})

test('真实兜底确认后交接读取迟到，不能回写旧入口或清掉另一任务的新扫码提示', async () => {
  let resolve!: (task: typeof task42) => void
  api.task.mockResolvedValueOnce(task42).mockImplementationOnce(() => new Promise(r => { resolve = r }))
  await mount(); await scan('P1'); await scan('A01')
  expect(api.task).toHaveBeenCalledTimes(2)
  expect(button('去复核')).toBeUndefined()
  // hook 已清除原 pending；读取期间发生的新扫描以新任务为准。
  await scan('P2')
  expect(host.textContent).toContain('WT073'); expect(host.textContent).toContain('B01')
  await act(async () => { resolve(task42) }); await settle()
  expect(button('去复核')).toBeUndefined()
  expect(host.textContent).toContain('WT073'); expect(host.textContent).toContain('B01')
  expect(api.sort).toHaveBeenCalledTimes(1)
  expect(host.querySelector('output')?.textContent).toBe('/pda/sort')
})
