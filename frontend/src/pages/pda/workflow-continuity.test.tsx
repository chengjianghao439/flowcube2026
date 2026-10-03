// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { PERMISSIONS as P } from '@/lib/permission-codes'

const state = vi.hoisted(() => ({
  permissions: [] as string[],
  options: new Map<string, { onConfirmed: (data: unknown, ctx: { recovered: boolean; requestKey: string }) => Promise<void> }>(),
  pending: null as null | { action: string; requestKey: string; metadata?: Record<string, unknown> },
  network: 'online',
  scan: null as null | ((code: string) => void),
  taskStatus: 2,
  taskId: 42,
  readError: false,
  getTask: vi.fn(),
  sort: vi.fn(),
  nav: null as null | ((path: string) => void),
}))
vi.mock('@/hooks/usePdaRole', () => ({ usePdaRole: () => ({
  permissionsMissing: false, canAll: (codes: string[]) => codes.every(code => state.permissions.includes(code)),
}) }))
vi.mock('@/hooks/useCriticalPdaAction', () => ({ useCriticalPdaAction: (opts: { action: string; onConfirmed: (data: unknown, ctx: { recovered: boolean; requestKey: string }) => Promise<void> }) => {
  state.options.set(opts.action, opts)
  const pending = state.pending?.action === opts.action ? state.pending : null
  return { networkStatus: state.network, submitBlocked: !!pending, pendingRecord: pending,
    phase: pending ? 'pending' : 'idle', confirming: false, blockedReason: pending ? '结果待确认' : null,
    run: async (execute: (key: string) => Promise<unknown>) => {
      const data = await execute('key')
      await opts.onConfirmed(data, { recovered: false, requestKey: 'key' })
      return { kind: 'success', data }
    }, confirmPending: vi.fn(), clearPending: vi.fn(), clearError: vi.fn(),
  }
} }))
vi.mock('@/hooks/usePendingRequests', () => ({ usePendingRequests: () => ({ records: state.pending ? [state.pending] : [] }) }))
vi.mock('@/hooks/usePdaFeedback', () => ({ usePdaFeedback: () => ({ flash: null, ok: vi.fn(), warn: vi.fn(), err: vi.fn() }) }))
vi.mock('@/hooks/useOfflineScan', () => ({ useOfflineScan: () => ({ submitScan: vi.fn(), logError: vi.fn() }) }))
vi.mock('@/components/pda/PdaScanner', () => ({ default: ({ onScan }: { onScan: (code: string) => void }) => { state.scan = onScan; return null } }))
vi.mock('@/api/warehouse-tasks', () => ({
  getTaskByIdApi: state.getTask, getPickSuggestionsApi: async () => ({ items: [] }),
  getTasksApi: async () => ({ list: [] }), sortDoneApi: state.sort,
  readyToShipApi: vi.fn(), packDoneApi: vi.fn(), submitCheckScanApi: vi.fn(),
}))
vi.mock('@/api/inventory', () => ({ getContainerByBarcodeApi: vi.fn() }))
vi.mock('@/api/packages', () => ({ getPackagesApi: async () => [], createPackageApi: vi.fn(), addPackageItemApi: vi.fn(),
  removePackageItemApi: vi.fn(), voidPackageApi: vi.fn(), finishPackageApi: vi.fn(), printPackageLabelApi: vi.fn(),
}))
vi.mock('@/api/sorting-bins', () => ({ getSortingBinsApi: async () => [], scanProductForSortApi: async () => ({
  taskId: 42, taskNo: 'WT042', itemId: 9, sortingBinCode: 'A01', productCode: 'P1', productName: '商品', sortableQty: 1, unit: '个',
}) }))

import Check from './check'
import Sort from './sort'
import Task from './task'
import Pack from './pack'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let host: HTMLDivElement
let root: Root
let client: QueryClient
let rerender: () => void
function Location() { const loc = useLocation(); state.nav = useNavigate(); return <output>{loc.pathname}</output> }
const pages = { check: Check, sort: Sort, task: Task, pack: Pack }
async function mount(page: keyof typeof pages) {
  const Page = pages[page]
  host = document.createElement('div'); document.body.appendChild(host)
  root = createRoot(host)
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  rerender = () => root.render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[`/pda/${page}${page === 'sort' ? '' : '/42'}`]}>
    <Location /><Routes><Route path={`/pda/${page}${page === 'sort' ? '' : '/:id'}`} element={<Page />} /><Route path="*" element={<div>目标页</div>} /></Routes>
  </MemoryRouter></QueryClientProvider>)
  await act(async () => { rerender() })
  await settle()
}
async function settle() { for (let i = 0; i < 3; i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)) }) }
const button = (text: string) => [...host.querySelectorAll('button')].find(b => b.textContent === text)
async function confirmed(action: string, data: unknown, recovered = false) {
  await act(async () => { await state.options.get(action)!.onConfirmed(data, { recovered, requestKey: 'key' }) })
  await settle()
}
async function click(text: string) { expect(button(text)).toBeTruthy(); await act(async () => { button(text)!.click() }) }
beforeEach(() => {
  state.options.clear(); state.pending = null; state.network = 'online'; state.taskId = 42; state.readError = false
  state.permissions = [P.WAREHOUSE_TASK_VIEW, P.WAREHOUSE_TASK_CHECK, P.WAREHOUSE_TASK_PACK, P.WAREHOUSE_TASK_SHIP, P.SORTING_BIN_VIEW, P.WAREHOUSE_TASK_SORT]
  state.getTask.mockImplementation(async (id: number) => {
    if (state.readError) throw new Error('读取失败')
    return { id: state.taskId === 42 ? id : state.taskId, taskNo: `WT${String(id).padStart(3, '0')}`, status: state.taskStatus, statusName: '任务状态', items: [] }
  })
  state.sort.mockResolvedValue({ allSorted: true })
})
afterEach(async () => { await act(async () => { root?.unmount(); client?.clear() }); host?.remove(); vi.clearAllMocks() })

test('复核完成入口携带原任务 ID，选择任务与返回入口保留', async () => {
  state.taskStatus = 4; await mount('check'); state.taskStatus = 5
  await confirmed('warehouse.check-scan.42', { allChecked: true })
  expect(host.textContent).toContain('WT042'); expect(button('选择任务')).toBeTruthy()
  await click('去打包'); expect(host.querySelector('output')?.textContent).toBe('/pda/pack/42')
})
test.each([[P.WAREHOUSE_TASK_PACK], [P.WAREHOUSE_TASK_VIEW]])('复核目标同时要求 VIEW 与 PACK，只有 %s 时不给入口', async permission => {
  state.permissions = [permission]; state.taskStatus = 4; await mount('check'); state.taskStatus = 5
  await confirmed('warehouse.check-scan.42', { allChecked: true }); expect(button('去打包')).toBeUndefined()
})
test('未确认的复核不能进入下一步，换任务后旧完成结果也不放行', async () => {
  state.taskStatus = 4; state.pending = { action: 'warehouse.check-scan.42', requestKey: 'key' }; await mount('check')
  expect(button('去打包')).toBeUndefined()
  state.pending = null; state.taskStatus = 5; await confirmed('warehouse.check-scan.42', { allChecked: true })
  await act(async () => { state.nav?.('/pda/check/43') }); await settle()
  expect(button('去打包')).toBeUndefined()
})
test('拣货完成展示任务号并进入全局分拣，提示仍需扫码货码格码', async () => {
  state.taskStatus = 2; await mount('task'); state.taskStatus = 3
  await confirmed('warehouse.ready.42', { taskId: 42 })
  expect(host.textContent).toContain('WT042'); expect(host.textContent).toContain('分拣格')
  expect(button('返回任务列表')).toBeTruthy(); await click('去分拣')
  expect(host.querySelector('output')?.textContent).toBe('/pda/sort')
})
test('分拣确认真实任务后可进入该任务复核，继续扫码保持原模式', async () => {
  state.taskStatus = 4; await mount('sort')
  await act(async () => { state.scan?.('P1') }); await act(async () => { state.scan?.('A01') }); await settle()
  expect(state.sort).toHaveBeenCalledWith(42, [{ itemId: 9, sortedQty: 1 }], 'key')
  expect(host.textContent).toContain('WT042'); await click('去复核')
  expect(host.querySelector('output')?.textContent).toBe('/pda/check/42')
})
test('分拣恢复入口只能使用冻结记录原任务，即使当前提示属于另一任务', async () => {
  state.taskStatus = 4; await mount('sort'); await act(async () => { state.scan?.('P1') })
  state.pending = { action: 'warehouse.sort', requestKey: 'key', metadata: { taskId: 73, itemId: 11, binCode: 'B01' } }
  // 重新渲染使原回执记录进入页面 callback 闭包。
  await act(async () => { rerender() }); await settle()
  await confirmed('warehouse.sort', { allSorted: true }, true)
  state.pending = null; await act(async () => { rerender() }); await settle()
  expect(state.getTask).toHaveBeenCalledWith(73, { skipGlobalError: true })
  await click('去复核'); expect(host.querySelector('output')?.textContent).toBe('/pda/check/73')
})
test('旧分拣回执缺定位仍保留恢复兼容文案但没有下一步入口', async () => {
  state.taskStatus = 4; state.pending = { action: 'warehouse.sort', requestKey: 'key' }; await mount('sort')
  await confirmed('warehouse.sort', { allSorted: true }, true)
  expect(button('去复核')).toBeUndefined()
})
test('打包本任务完成才给去出库入口，保留继续打包与返回并提示物流/箱码', async () => {
  state.taskStatus = 5; await mount('pack'); state.taskStatus = 6
  await confirmed('warehouse.pack-done', { taskId: 42 }, true)
  expect(host.textContent).toContain('WT042'); expect(host.textContent).toMatch(/物流.*箱码/)
  expect(button('继续打包')).toBeTruthy(); expect(button('返回工作台')).toBeTruthy()
  await click('去出库'); expect(host.querySelector('output')?.textContent).toBe('/pda/ship')
})
test('另一任务的打包回执不能替当前任务放行', async () => {
  state.taskStatus = 5; await mount('pack'); state.taskStatus = 6
  await confirmed('warehouse.pack-done', { taskId: 73 }, true); expect(button('去出库')).toBeUndefined()
})
test.each(['read-error', 'wrong-id', 'offline'] as const)('打包确认后的 %s 不显示下一步入口', async reason => {
  state.taskStatus = 5; await mount('pack'); state.taskStatus = 6
  state.readError = reason === 'read-error'; state.taskId = reason === 'wrong-id' ? 73 : 42; state.network = reason === 'offline' ? 'offline' : 'online'
  await confirmed('warehouse.pack-done', { taskId: 42 }); expect(button('去出库')).toBeUndefined()
})
test.each(['task', 'sort', 'pack'] as const)('%s 缺少目标作业权限不显示下一步', async page => {
  state.permissions = [P.WAREHOUSE_TASK_VIEW]
  state.taskStatus = page === 'task' ? 2 : page === 'pack' ? 5 : 4
  await mount(page)
  if (page === 'task') { state.taskStatus = 3; await confirmed('warehouse.ready.42', { taskId: 42 }) }
  if (page === 'pack') { state.taskStatus = 6; await confirmed('warehouse.pack-done', { taskId: 42 }) }
  if (page === 'sort') { await act(async () => { state.scan?.('P1') }); await act(async () => { state.scan?.('A01') }); await settle() }
  expect(button(page === 'task' ? '去分拣' : page === 'sort' ? '去复核' : '去出库')).toBeUndefined()
})
test.each(['pending', 'partial', 'wrong-id', 'read-error', 'wrong-stage'] as const)('分拣 %s 不显示复核入口', async reason => {
  state.taskStatus = reason === 'wrong-stage' ? 3 : 4
  await mount('sort'); await act(async () => { state.scan?.('P1') })
  state.pending = { action: 'warehouse.sort', requestKey: 'key', metadata: { taskId: 73, itemId: 11, binCode: 'B01' } }
  state.taskId = reason === 'wrong-id' ? 99 : 42; state.readError = reason === 'read-error'
  await act(async () => { rerender() })
  if (reason !== 'pending') await confirmed('warehouse.sort', { allSorted: reason !== 'partial', progress: '1/2' }, true)
  state.pending = null; await act(async () => { rerender() })
  expect(button('去复核')).toBeUndefined()
})
test('分拣完成后继续扫另一商品立即收起旧任务入口，不自动复核或提交其他任务', async () => {
  state.taskStatus = 4; await mount('sort')
  await act(async () => { state.scan?.('P1') }); await act(async () => { state.scan?.('A01') }); await settle()
  expect(button('去复核')).toBeTruthy()
  await act(async () => { state.scan?.('P2') }); await settle()
  expect(button('去复核')).toBeUndefined(); expect(state.sort).toHaveBeenCalledTimes(1)
  expect(host.querySelector('output')?.textContent).toBe('/pda/sort')
})
test('任务 A 的完成读取迟到时不能给任务 B 下一步入口', async () => {
  state.taskStatus = 5; await mount('pack')
  let resolve!: (task: unknown) => void
  state.getTask.mockImplementationOnce(() => new Promise(r => { resolve = r }))
  let completion!: Promise<void>
  await act(async () => { completion = state.options.get('warehouse.pack-done')!.onConfirmed({ taskId: 42 }, { recovered: false, requestKey: 'key' }) })
  await act(async () => { state.nav?.('/pda/pack/43') }); await settle()
  await act(async () => { resolve({ id: 42, taskNo: 'WT042', status: 6 }); await completion })
  expect(button('去出库')).toBeUndefined(); expect(host.textContent).not.toContain('打包完成！')
})
