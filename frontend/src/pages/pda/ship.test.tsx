// @vitest-environment jsdom
/**
 * 待出库退货任务列表：**出库后 total 必须刷新**。
 *
 * 列表路径（ship.tsx:239 的「确认出库」）不切「出库完成」整页，只 `invalidateQueries(['return-out-pending'])`
 * 让 useInfiniteQuery 重取。若这一步失效，任务出库后仍留在列表里，操作员会对着已完成的单重复点——
 * 本测试把「点一次出库 → 列表重取 → 标题数字跟着变」整条链路钉死。
 *
 * 断言的是**重取行为**（getReturnOutPendingApi 被再次调用）而不只是最终文本：
 * 文本可能因其它原因变化，但「出库成功后重新拉过列表」才是刷新成立的必要条件。
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import Page from './ship'

const api = vi.hoisted(() => ({
  pending: vi.fn(), ship: vi.fn(), task: vi.fn(), pkg: vi.fn(),
  ok: vi.fn(), err: vi.fn(), warn: vi.fn(),
}))

vi.mock('@/api/warehouse-tasks', () => ({
  getReturnOutPendingApi: api.pending,
  shipTaskApi: api.ship,
  getTaskByIdApi: api.task,
}))
vi.mock('@/api/packages', () => ({ getPackageByBarcodeApi: api.pkg }))
vi.mock('@/hooks/usePdaFeedback', () => ({
  usePdaFeedback: () => ({ flash: null, ok: api.ok, err: api.err, warn: api.warn }),
}))
vi.mock('@/hooks/useCriticalPdaAction', () => ({
  useCriticalPdaAction: ({ onConfirmed }: { onConfirmed: () => void }) => ({
    run: async (execute: (key: string) => Promise<unknown>) => {
      const data = await execute('stable-key')
      onConfirmed()
      return { kind: 'success', data }
    },
    blockedReason: null, pendingRecord: null, confirming: false, phase: 'idle', phaseMessage: null,
    lastErrorMessage: null, submitBlocked: false,
    confirmPending: async () => null, clearPending: () => {}, clearError: () => {},
  }),
}))

const task = (id: number, taskNo: string) => ({
  id, taskNo, taskType: 'sale_return_out' as const, returnId: id, partyName: `客户${id}`,
  warehouseId: 1, warehouseName: '主仓', priority: 1, itemCount: 1, totalRequired: 3,
  createdAt: '2026-09-27T00:00:00.000Z',
})

let root: Root
let host: HTMLDivElement
let qc: QueryClient

beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.resetAllMocks()
  // 首次：2 张待出库。之后（出库成功 → invalidate → 重取）：只剩 1 张，总数变 1。
  api.pending
    .mockResolvedValueOnce({ list: [task(1, 'WT-RET-A'), task(2, 'WT-RET-B')], total: 2, page: 1, pageSize: 100 })
    .mockResolvedValue({ list: [task(2, 'WT-RET-B')], total: 1, page: 1, pageSize: 100 })
  api.ship.mockResolvedValue({ taskId: 1 })
  api.task.mockResolvedValue({ id: 1, status: 7, statusName: '已出库' })
  qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => {
    root.render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/pda/ship']}><Page /></MemoryRouter>
      </QueryClientProvider>,
    )
  })
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)) })
})
afterEach(async () => { await act(async () => { root.unmount(); qc.clear() }); host.remove() })

test('列表点「确认出库」后，待出库列表被重新拉取且 total 从 2 刷成 1', async () => {
  expect(host.textContent).toContain('待出库的退货任务（2）')
  expect(host.textContent).toContain('WT-RET-A')
  expect(api.pending).toHaveBeenCalledTimes(1)

  const shipButtons = [...host.querySelectorAll('button')].filter(b => b.textContent?.includes('确认出库'))
  expect(shipButtons).toHaveLength(2)

  await act(async () => { (shipButtons[0] as HTMLButtonElement).click() })
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)) })

  expect(api.ship).toHaveBeenCalledWith(1, 'stable-key')
  expect(api.pending.mock.calls.length).toBeGreaterThanOrEqual(2)   // invalidate 真的触发了重取
  expect(host.textContent).toContain('待出库的退货任务（1）')          // total 刷新
  expect(host.textContent).not.toContain('WT-RET-A')               // 已出库的单从列表消失
  expect(host.textContent).toContain('WT-RET-B')                   // 未出库的仍在
})
