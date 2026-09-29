// @vitest-environment jsdom
/**
 * PDA 分拣页 · 待确认冻结与恢复文案（批 B3a 最小组件用例）。
 *
 * 只钉两件已经出过问题的事：
 *  1. 结果待确认期间页面**冻结原目标**，并显示**冻结记录**里的定位（重挂后 hint 已丢失，不能从新 hint 取数）；
 *  2. 恢复（查回执）成功后按 `allSorted` 区分「部分进度」与「整任务完成」，不得一律说分拣完成。
 *
 * 不扩公共 hook：这里只 mock 掉 `useCriticalPdaAction`，验证页面侧的使用方式。
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

const state = vi.hoisted(() => ({
  submitBlocked: false,
  blockedReason: null as string | null,
  pendingRecord: null as Record<string, unknown> | null,
  onConfirmed: null as null | ((data: unknown, ctx: { recovered: boolean }) => Promise<void>),
  feedback: [] as { kind: string; text: string }[],
  scannerDisabled: false,
  scannerOnScan: null as null | ((code: string) => void),
}))

vi.mock('@/hooks/useCriticalPdaAction', () => ({
  useCriticalPdaAction: (opts: { onConfirmed?: (data: unknown, ctx: { recovered: boolean }) => Promise<void> }) => {
    state.onConfirmed = opts.onConfirmed ?? null
    return {
      networkStatus: 'online',
      submitBlocked: state.submitBlocked,
      blockedReason: state.blockedReason,
      pendingRecord: state.pendingRecord,
      confirming: false,
      phase: 'idle',
      phaseMessage: null,
      lastErrorMessage: null,
      run: vi.fn(),
      confirmPending: vi.fn(),
      clearPending: vi.fn(),
      clearError: vi.fn(),
    }
  },
}))

vi.mock('@/hooks/usePdaFeedback', () => ({
  usePdaFeedback: () => ({
    flash: null,
    ok: (t: string) => { state.feedback.push({ kind: 'ok', text: t }) },
    warn: (t: string) => { state.feedback.push({ kind: 'warn', text: t }) },
    err: (t: string) => { state.feedback.push({ kind: 'err', text: t }) },
  }),
}))

vi.mock('@/api/sorting-bins', () => ({
  getSortingBinsApi: async () => [],
  scanProductForSortApi: async () => ({
    productCode: 'P1', productName: '测试商品', unit: '个',
    requiredQty: 10, pickedQty: 10, itemId: 9, taskId: 42, taskNo: 'WT001',
    customerName: '测试客户', warehouseId: 1, sortingBinId: 7, sortingBinCode: 'A01',
    taskItemCount: 1, sortableQty: 10,
  }),
}))
vi.mock('@/api/warehouse-tasks', () => ({
  getTaskByIdApi: async () => ({ status: 3, statusName: '待分拣', taskNo: 'WT001' }),
  sortDoneApi: async () => ({ allSorted: true }),
}))
vi.mock('@/components/pda/PdaScanner', () => ({
  default: (props: { disabled?: boolean; onScan?: (code: string) => void }) => {
    state.scannerDisabled = props.disabled ?? false
    state.scannerOnScan = props.onScan ?? null
    return null
  },
}))

import PdaSortPage from './sort'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

let root: Root | undefined
let container: HTMLDivElement
let client: QueryClient

function renderTree() {
  act(() => {
    root!.render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <PdaSortPage />
        </MemoryRouter>
      </QueryClientProvider>,
    )
  })
}

function mount() {
  container = document.createElement('div')
  document.body.appendChild(container)
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  root = createRoot(container)
  renderTree()
}

const cancelButton = () =>
  Array.from(container.querySelectorAll('button')).find(b => (b.textContent ?? '').includes('取消，重新扫商品'))

beforeEach(() => {
  state.submitBlocked = false
  state.blockedReason = null
  state.pendingRecord = null
  state.onConfirmed = null
  state.feedback = []
  state.scannerDisabled = false
  state.scannerOnScan = null
})

afterEach(() => {
  act(() => root?.unmount())
  root = undefined
  container?.remove()
  vi.clearAllMocks()
})

test('待确认期间冻结原目标：扫码入口禁用、取消重扫按钮不可点，且显示冻结记录里的原定位', async () => {
  // ① 先正常扫一次商品码建立 hint（取消按钮只在有提示时渲染）
  mount()
  await act(async () => { state.scannerOnScan?.('P-CODE-1') })
  expect(cancelButton()).toBeTruthy()
  expect(state.scannerDisabled).toBe(false)

  // ② 结果待确认 ⇒ 冻结扫码入口与取消重扫，并显示**冻结记录**里的定位
  state.submitBlocked = true
  state.blockedReason = '分拣确认 结果待确认。请先确认结果，避免重复提交。'
  state.pendingRecord = {
    action: 'warehouse.sort',
    requestKey: 'k1',
    label: '分拣确认',
    createdAt: '2026-09-29T00:00:00Z',
    metadata: { taskId: 42, binCode: 'A01', barcode: 'I000123', qty: 60, containerId: 777, itemId: 9 },
  }
  renderTree()

  expect(state.scannerDisabled).toBe(true)
  const cancel = cancelButton()
  expect(cancel).toBeTruthy()
  expect((cancel as HTMLButtonElement).disabled).toBe(true)

  const text = container.textContent ?? ''
  expect(text).toContain('上次分拣提交')
  expect(text).toContain('42')       // 任务
  expect(text).toContain('I000123')  // 原条码
  expect(text).toContain('60')       // 数量
})

test('恢复成功且 allSorted=false 时提示部分进度，不得说整任务分拣完成', async () => {
  mount()
  expect(state.onConfirmed).toBeTruthy()
  await act(async () => {
    await state.onConfirmed!({ allSorted: false, progress: '1/3' }, { recovered: true })
  })
  const kinds = state.feedback.map(f => f.kind)
  expect(kinds).not.toContain('ok')                       // 不得当成整任务完成
  const warn = state.feedback.find(f => f.kind === 'warn')
  expect(warn?.text).toContain('尚未全部分拣完成')
  expect(warn?.text).toContain('1/3')
})

test('恢复成功且 allSorted=true 时才提示进入待复核', async () => {
  mount()
  await act(async () => {
    await state.onConfirmed!({ allSorted: true }, { recovered: true })
  })
  const ok = state.feedback.find(f => f.kind === 'ok')
  expect(ok?.text).toContain('待复核')
})

test('非恢复路径（正常提交）不在 onConfirmed 里重复提示，避免与 handleBinScan 双发', async () => {
  mount()
  await act(async () => {
    await state.onConfirmed!({ allSorted: true }, { recovered: false })
  })
  expect(state.feedback).toHaveLength(0)
})
