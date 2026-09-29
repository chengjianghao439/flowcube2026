// @vitest-environment jsdom
/**
 * PDA 打包页 · 待确认冻结与恢复文案（批 B3b 最小组件用例）。
 *
 * 只钉两件已经出过问题的事：
 *  1. 结果待确认期间**冻结原目标**（扫码入口禁用），并显示**冻结记录**里的原提交定位
 *     （重挂后 activePackageId 可能已指向别的箱子，不能让界面当前状态替代原目标）；
 *  2. 恢复成功后按回执区分「**本次增量**」与该来源的「**累计量**」，不能说成同一个数。
 *
 * 不扩公共 hook：这里只 mock 掉 `useCriticalPdaAction`，验证页面侧的使用方式。
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

const st = vi.hoisted(() => ({
  blocked: false,
  pending: null as Record<string, unknown> | null,
  feedback: [] as { kind: string; text: string }[],
  scannerDisabled: false,
  scannerOnScan: null as null | ((code: string) => void),
  onConfirmed: null as null | ((d: unknown, c: { recovered: boolean }) => Promise<void>),
}))

vi.mock('@/hooks/useCriticalPdaAction', () => ({
  useCriticalPdaAction: (opts: {
    action?: string
    onConfirmed?: (d: unknown, c: { recovered: boolean }) => Promise<void>
  }) => {
    const base = {
      networkStatus: 'online', submitBlocked: false, blockedReason: null as string | null,
      pendingRecord: null as Record<string, unknown> | null,
      confirming: false, phase: 'idle', phaseMessage: null as string | null, lastErrorMessage: null as string | null,
      run: vi.fn(), confirmPending: vi.fn(), clearPending: vi.fn(), clearError: vi.fn(),
    }
    if (opts.action === 'package.add') {
      st.onConfirmed = opts.onConfirmed ?? null
      return {
        ...base,
        submitBlocked: st.blocked,
        blockedReason: st.blocked ? '装箱确认 结果待确认。请先确认结果，避免重复提交。' : null,
        pendingRecord: st.pending,
        // 真实 hook 的 run：成功后回调 onConfirmed，再返回 success
        run: async (executor: (k: string) => Promise<unknown>) => {
          const data = await executor('k')
          await opts.onConfirmed?.(data, { recovered: false })
          return { kind: 'success' as const, data }
        },
      }
    }
    return base
  },
}))

vi.mock('@/hooks/usePdaFeedback', () => ({
  usePdaFeedback: () => ({
    flash: null,
    ok: (t: string) => { st.feedback.push({ kind: 'ok', text: t }) },
    warn: (t: string) => { st.feedback.push({ kind: 'warn', text: t }) },
    err: (t: string) => { st.feedback.push({ kind: 'err', text: t }) },
  }),
}))

vi.mock('@/api/packages', () => ({
  // 有一个打包中的箱子：页面会自动把它设为 activePackageId，扫码条才会渲染出来
  getPackagesApi: async () => ([{
    id: 8, barcode: 'L000008', status: 1, statusName: '打包中', createdAt: '2026-09-29T00:00:00Z',
    items: [], printStatus: { key: 'no_job', label: '未生成箱贴' },
  }]),
  createPackageApi: async () => ({ id: 1, barcode: 'L000001' }),
  addPackageItemApi: async () => ({ id: 1, addedQty: 20, qty: 60, unit: '个', productName: '测试商品' }),
  removePackageItemApi: async () => ({}),
  voidPackageApi: async () => ({}),
  finishPackageApi: async () => ({}),
  printPackageLabelApi: async () => ({}),
}))
vi.mock('@/api/warehouse-tasks', () => ({
  getTaskByIdApi: async () => ({ id: 42, taskNo: 'WT042', status: 5, statusName: '待打包', warehouseId: 1, warehouseName: '主仓' }),
}))
vi.mock('@/api/operation-requests', () => ({
  getOperationRequestStatusApi: async () => ({ status: 'success', data: { addedQty: 20, qty: 60, unit: '个' }, resourceId: 8 }),
}))
vi.mock('@/components/pda/PdaScanner', () => ({
  default: (props: { disabled?: boolean; onScan?: (code: string) => void }) => {
    st.scannerDisabled = props.disabled ?? false
    st.scannerOnScan = props.onScan ?? null
    return null
  },
}))

import PdaPackPage from './pack'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

let root: Root | undefined
let container: HTMLDivElement
let client: QueryClient

function mount() {
  container = document.createElement('div')
  document.body.appendChild(container)
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  root = createRoot(container)
  act(() => {
    root!.render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/pda/pack?taskId=42']}>
          <PdaPackPage />
        </MemoryRouter>
      </QueryClientProvider>,
    )
  })
}

beforeEach(() => {
  st.blocked = false
  st.pending = null
  st.feedback = []
  st.scannerDisabled = false
  st.scannerOnScan = null
  st.onConfirmed = null
})

afterEach(() => {
  act(() => root?.unmount())
  root = undefined
  container?.remove()
  vi.clearAllMocks()
})

test('待确认期间冻结扫码入口，并显示冻结记录里的原提交定位（与当前界面不同）', async () => {
  st.blocked = true
  st.pending = {
    action: 'package.add',
    requestKey: 'k1',
    label: '装箱确认',
    createdAt: '2026-09-29T00:00:00Z',
    // 冻结的是**原目标**：任务 41 / 箱 7 / 取货码 I002053 / 数量为空（整份）。
    // 与当前界面（路由 taskId=42、active 箱 L000008）**刻意不同**——否则「拿当前值替代」
    // 也会让断言变绿，用例就白写了。
    metadata: {
      taskId: 41, taskNo: 'WT041',
      packageId: 7, packageBarcode: 'L000007',
      labelBarcode: 'I002053', productCode: null, qty: null,
    },
  }
  mount()
  // 让任务/箱子查询落地（要等 React Query 的 fetch 与随后的 useEffect 都跑完）
  await act(async () => { await new Promise(r => setTimeout(r, 50)) })
  await act(async () => { await new Promise(r => setTimeout(r, 50)) })

  expect(st.scannerDisabled).toBe(true)

  const text = container.textContent ?? ''
  expect(text).toContain('上次装箱提交')
  // 展示人要看得懂的**冻结**标识，而不是数据库编号。
  // 这两个值只会来自冻结记录（当前是 WT042 / L000008），所以出现即证明没有拿当前值替代。
  expect(text).toContain('WT041')     // 原任务号
  expect(text).toContain('L000007')   // 原箱码
  expect(text).toContain('I002053')   // 原条码
  expect(text).toContain('整份')       // 数量为空 ⇒ 整份
})

test('成功反馈收敛到 onConfirmed：submitAdd 不再重复发提示', async () => {
  mount()
  await act(async () => { await new Promise(r => setTimeout(r, 50)) })
  await act(async () => { await new Promise(r => setTimeout(r, 50)) })
  expect(st.scannerOnScan).toBeTruthy()

  // 正常提交（hook 的 run 会回调 onConfirmed 一次）
  await act(async () => { st.scannerOnScan!('I002053') })
  await act(async () => { await new Promise(r => setTimeout(r, 10)) })

  const oks = st.feedback.filter(f => f.kind === 'ok')
  expect(oks).toHaveLength(1)          // 唯一一条：submitAdd 没再发第二遍
  expect(oks[0].text).toContain('本次装箱')
})

test('恢复成功时区分「本次增量」与该来源「累计量」', async () => {
  mount()
  await act(async () => { await new Promise(r => setTimeout(r, 0)) })
  expect(st.onConfirmed).toBeTruthy()

  await act(async () => {
    await st.onConfirmed!({ addedQty: 20, qty: 60, unit: '个' }, { recovered: true })
  })

  const okMsg = st.feedback.find(f => f.kind === 'ok')?.text ?? ''
  expect(okMsg).toContain('本次装箱 20')
  expect(okMsg).toContain('累计 60')
})
