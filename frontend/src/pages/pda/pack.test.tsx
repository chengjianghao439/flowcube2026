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
  removePending: null as Record<string, unknown> | null,
  voidPending: null as Record<string, unknown> | null,
  finishConfirmCalls: 0,
  finishClearCalls: 0,
  /** 完成箱子是否处于「结果待确认」阻断（页面把它也纳入本页冻结） */
  finishSubmitBlocked: false,
  finishOnConfirmed: null as null | ((d: unknown, c: { recovered: boolean }) => Promise<void>),
  /** 该箱在**列表**里的状态：C3 要用「列表已完成」与「原键回执」不一致来验证不许猜 */
  pkgStatus: 1,
  /** `getOperationRequestStatusApi` 的返回：null 表示 not_found */
  opStatus: null as Record<string, unknown> | null,
  finishResolve: null as null | ((c: unknown) => Promise<{ effective: boolean; data?: unknown } | null | undefined>),
  /** 页面注册给各关键操作的 action 名（用于断言「不随 taskId 漂移」） */
  seenActions: [] as string[],
  /** `usePendingRequests` 暴露的既有记录（用于验证「旧版 scoped finish 记录仍可见」） */
  pendingRecords: [] as Record<string, unknown>[],
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
    if (opts.action) st.seenActions.push(opts.action)
    const base = {
      networkStatus: 'online', submitBlocked: false, blockedReason: null as string | null,
      pendingRecord: null as Record<string, unknown> | null,
      confirming: false, phase: 'idle', phaseMessage: null as string | null, lastErrorMessage: null as string | null,
      run: vi.fn(), confirmPending: vi.fn(), clearPending: vi.fn(), clearError: vi.fn(),
    }
    // 移出 / 作废各自的待确认记录（页面按 action 分派，互不覆盖）
    if (opts.action === 'package.remove-item') {
      return {
        ...base,
        submitBlocked: Boolean(st.removePending),
        blockedReason: st.removePending ? '移出确认 结果待确认。请先确认结果，避免重复提交。' : null,
        pendingRecord: st.removePending,
      }
    }
    if (opts.action === 'package.void') {
      return {
        ...base,
        submitBlocked: Boolean(st.voidPending),
        blockedReason: st.voidPending ? '作废确认 结果待确认。请先确认结果，避免重复提交。' : null,
        pendingRecord: st.voidPending,
      }
    }
    // 完成箱子的 action 带 taskId 后缀（`package.finish.<taskId>`），按前缀匹配
    if (String(opts.action).startsWith('package.finish')) {
      st.finishResolve = (opts as { resolveServerState?: typeof st.finishResolve }).resolveServerState ?? null
      st.finishOnConfirmed = (opts as { onConfirmed?: typeof st.finishOnConfirmed }).onConfirmed ?? null
      // 模拟真实 hook 的关键行为：**按 action 名**在既有记录里匹配 —— 这正是
      // 「旧版 scoped 记录若沿用原 action 就仍能被找到」的机制所在。
      const matched = st.pendingRecords.find(r => r.action === opts.action) ?? null
      st.finishSubmitBlocked = Boolean(matched)
      return {
        ...base,
        submitBlocked: Boolean(matched),
        blockedReason: matched ? `${String(matched.label ?? '完成箱子')} 结果待确认。请先确认结果，避免重复提交。` : null,
        pendingRecord: matched,
        confirmPending: () => { st.finishConfirmCalls += 1; return Promise.resolve(null) },
        clearPending: () => { st.finishClearCalls += 1 },
      }
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

vi.mock('@/hooks/usePendingRequests', () => ({
  usePendingRequests: () => ({
    records: st.pendingRecords,
    claimPending: vi.fn(), removePending: vi.fn(), discardUnclaimed: vi.fn(),
  }),
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
    id: 8, barcode: 'L000008', status: st.pkgStatus, statusName: '打包中', createdAt: '2026-09-29T00:00:00Z',
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
  // 默认 success（保持既有用例行为）；C3 的用例会把它改成 not_found 来验证「不许猜」
  getOperationRequestStatusApi: async () => st.opStatus
    ?? { status: 'success', data: { addedQty: 20, qty: 60, unit: '个' }, resourceId: 8 },
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
  st.removePending = null
  st.voidPending = null
  st.finishConfirmCalls = 0
  st.finishClearCalls = 0
  st.finishSubmitBlocked = false
  st.finishOnConfirmed = null
  st.pkgStatus = 1
  st.opStatus = null
  st.finishResolve = null
  st.seenActions = []
  st.pendingRecords = []
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

test('移出待确认期间冻结扫码入口，并显示冻结的原箱与原明细定位（与当前界面不同）', async () => {
  st.removePending = {
    action: 'package.remove-item',
    requestKey: 'k2',
    label: '移出确认',
    createdAt: '2026-09-29T00:00:00Z',
    // 冻结的是**原目标与原货**：任务 41 / 箱 7 / 明细 #99 / 取货码 I002053 / 商品名。
    // 与当前界面（路由 taskId=42、active 箱 L000008）**刻意不同**——否则「拿当前值替代」也会绿。
    // 原明细行在**整行移出后会被删掉**，所以卡片必须靠这份快照才认得出原货。
    metadata: {
      taskId: 41, taskNo: 'WT041', packageId: 7, packageBarcode: 'L000007', itemId: 99,
      labelBarcode: 'I002053', productName: 'PB测试商品A', qty: null,
    },
  }
  mount()
  await act(async () => { await new Promise(r => setTimeout(r, 50)) })
  await act(async () => { await new Promise(r => setTimeout(r, 50)) })

  expect(st.scannerDisabled).toBe(true)

  const text = container.textContent ?? ''
  expect(text).toContain('上次移出提交')
  expect(text).toContain('WT041')          // 原任务号
  expect(text).toContain('L000007')        // 原箱码（当前是 L000008）
  expect(text).toContain('#99')            // 原明细行
  expect(text).toContain('I002053')        // 原取货码（认得出是哪张标签）
  expect(text).toContain('PB测试商品A')     // 原商品名（行已删，只有快照还记得）
  expect(text).toContain('整份')            // 整份移出语义
})

test('作废待确认期间同样冻结入口，并显示冻结的原箱', async () => {
  st.voidPending = {
    action: 'package.void',
    requestKey: 'k3',
    label: '作废确认',
    createdAt: '2026-09-29T00:00:00Z',
    metadata: { taskId: 41, taskNo: 'WT041', packageId: 7, packageBarcode: 'L000007' },
  }
  mount()
  await act(async () => { await new Promise(r => setTimeout(r, 50)) })
  await act(async () => { await new Promise(r => setTimeout(r, 50)) })

  expect(st.scannerDisabled).toBe(true)

  const text = container.textContent ?? ''
  expect(text).toContain('上次作废提交')
  expect(text).toContain('L000007')   // 原箱码（当前是 L000008）
})

test('完成箱子待确认：定位显示该箱，且「确认/清除」落在完成箱子上而不是完成打包', async () => {
  // 回归护栏：共用「当前待确认」位次的链里**必须保留 finishAction**。
  // 漏掉它会让 frozenRecord 变 null、查询/清除落到 finalizeAction —— 等于把既有的
  // 「完成箱子」恢复入口改回归了。
  st.pendingRecords = [{
    action: 'package.finish',
    requestKey: 'k4',
    label: '完成箱子',
    createdAt: '2026-09-29T00:00:00Z',
    metadata: { taskId: 42, taskNo: 'WT042', packageId: 8, packageBarcode: 'L000008' },
  }]
  mount()
  await act(async () => { await new Promise(r => setTimeout(r, 50)) })
  await act(async () => { await new Promise(r => setTimeout(r, 50)) })

  const text = container.textContent ?? ''
  // 文案按各自 label 区分，**不得**把完成箱子/打印/完成打包一律写成「装箱提交」
  expect(text).toContain('上次完成箱子')
  expect(text).not.toContain('上次装箱提交')
  expect(text).toContain('L000008')

  const buttons = Array.from(container.querySelectorAll('button'))
  const confirmBtn = buttons.find(b => (b.textContent ?? '').includes('确认上次结果'))
  const clearBtn = buttons.find(b => (b.textContent ?? '').includes('清除记录'))
  expect(confirmBtn).toBeTruthy()
  expect(clearBtn).toBeTruthy()

  await act(async () => { confirmBtn!.click() })
  expect(st.finishConfirmCalls).toBe(1)   // 查询走的是**完成箱子**
  await act(async () => { clearBtn!.click() })
  expect(st.finishClearCalls).toBe(1)     // 清除走的是**完成箱子**
})

test('C3 完成箱子恢复：列表 status=2 不能当本次成功，必须靠原键回执', async () => {
  // 该箱在**列表**里是「已完成」，但**原键回执查不到** ⇒ 本次成功**尚不能确认**。
  // 注意：查不到**不能反向断言"没生效"**（回执可能只是还没落 / 已过期清理），
  // 它只说明**不能据此判本次成功** —— status=2 完全可能来自**上一次**完成。
  st.pkgStatus = 2
  st.opStatus = { status: 'not_found', data: null }
  mount()
  await act(async () => { await new Promise(r => setTimeout(r, 0)) })
  expect(st.finishResolve).toBeTruthy()

  const res = await st.finishResolve!({ record: { requestKey: 'k9', metadata: { taskId: 42, packageId: 8 } } })
  expect(res?.effective).toBe(false)
})

test('C3 完成箱子恢复：原键回执 success 才判本次成功', async () => {
  st.pkgStatus = 2
  st.opStatus = { status: 'success', data: { id: 8, allPackagesDone: true }, resourceId: 8 }
  mount()
  await act(async () => { await new Promise(r => setTimeout(r, 0)) })
  expect(st.finishResolve).toBeTruthy()

  const res = await st.finishResolve!({ record: { requestKey: 'k9b', metadata: { taskId: 42, packageId: 8 } } })
  expect(res?.effective).toBe(true)
})

test('C3 完成箱子恢复：注册的 action 不绑 taskId（否则换任务重挂就找不到原 pending）', async () => {
  // `usePendingRequests` 按 **action 名**存 / 找 pending 记录。若 finish 的 action 带 taskId
  // （`package.finish.<taskId>`），换到别的任务重挂后 action 名随之改变，
  // 原 pending 就再也匹配不上 —— 既看不到冻结定位、也没有「确认」入口。
  // 本用例只断言**页面注册的 action 名不含 taskId** 这一代码事实；
  // 它**不等于**「真实持久化重挂已验」（那需要真实浏览器 + 真实断网，见 C3 交接）。
  mount()
  await act(async () => { await new Promise(r => setTimeout(r, 0)) })
  expect(st.seenActions).toContain('package.finish')
  expect(st.seenActions).not.toContain('package.finish.42')
})

test('C3 兼容旧版本 pending：旧 scoped 记录仍沿用原 action 阻断，归属一致时展示原内容', async () => {
  // 旧版本把 action 写成 `package.finish.<taskId>`，记录**已落盘**。直接换 base 会让它们
  // 再也匹配不上；这里必须沿用**原 action**（记录继续阻断不消失），归属一致才据以展示。
  st.pendingRecords = [{
    requestKey: 'legacy-k', action: 'package.finish.41', requestAction: 'package.finish',
    label: '完成箱子', createdAt: '2026-09-29T00:00:00Z',
    metadata: { taskId: 41, taskNo: 'WT041', packageId: 7, packageBarcode: 'L000007' },
  }]
  mount()
  await act(async () => { await new Promise(r => setTimeout(r, 50)) })
  await act(async () => { await new Promise(r => setTimeout(r, 50)) })
  expect(st.seenActions).toContain('package.finish.41')   // 沿用旧 action ⇒ 旧记录仍可见
  expect(st.seenActions).not.toContain('package.finish')  // 不再注册 base 把它盖掉
  expect(st.finishSubmitBlocked).toBe(true)               // 仍然阻断（完成箱子按钮）
  expect(st.scannerDisabled).toBe(true)                   // **本页扫码也冻结**：否则工人在别的箱上继续动手，定位就没意义
  const text = container.textContent ?? ''
  expect(text).toContain('上次完成箱子')
  expect(text).toContain('L000007')                       // 归属一致 ⇒ 展示原内容
})

test('C3 兼容旧版本 pending：残缺记录仍阻断但不展示原内容', async () => {
  // 缺 packageId ⇒ 无法核对是哪个箱：**仍然沿用旧 action 让它阻断**（不静默抛弃），
  // 但**不展示**原内容（展示错的比不展示更糟）。
  st.pendingRecords = [{
    requestKey: 'legacy-bad', action: 'package.finish.43', requestAction: 'package.finish',
    label: '完成箱子', createdAt: '2026-09-29T00:00:00Z',
    metadata: { taskId: 43, taskNo: 'WT043', packageBarcode: 'L00000X' },
  }]
  mount()
  await act(async () => { await new Promise(r => setTimeout(r, 50)) })
  await act(async () => { await new Promise(r => setTimeout(r, 50)) })
  expect(st.seenActions).toContain('package.finish.43')   // 旧 action 仍生效 ⇒ 阻断不消失
  expect(st.finishSubmitBlocked).toBe(true)
  expect(st.scannerDisabled).toBe(true)                   // 残缺记录同样**保留本页冻结**
  const text = container.textContent ?? ''
  expect(text).toContain('归属无法确认')
  expect(text).not.toContain('L00000X')                   // 残缺记录的原箱码不外显
})

test('C3 兼容旧版本 pending：action 后缀与 metadata.taskId 不一致时不据以恢复', async () => {
  st.pendingRecords = [{
    requestKey: 'legacy-mismatch', action: 'package.finish.41', requestAction: 'package.finish',
    label: '完成箱子', createdAt: '2026-09-29T00:00:00Z',
    metadata: { taskId: 43, packageId: 7 },   // 后缀 41 ≠ taskId 43
  }]
  st.opStatus = { status: 'success', data: { id: 7 }, resourceId: 7 }
  mount()
  await act(async () => { await new Promise(r => setTimeout(r, 0)) })
  const res = await st.finishResolve!({ record: st.pendingRecords[0] })
  expect(res?.effective).toBe(false)
})

test('C3 完成箱子恢复：回执绑定的是别的资源时拒绝', async () => {
  st.opStatus = { status: 'success', data: { id: 9 }, resourceId: 9 }   // resourceId ≠ 原箱 8
  mount()
  await act(async () => { await new Promise(r => setTimeout(r, 0)) })
  const res = await st.finishResolve!({ record: { requestKey: 'k9c', metadata: { taskId: 42, packageId: 8 } } })
  expect(res?.effective).toBe(false)
})

test('C3 成功提示：在别的任务页面查回原任务回执时，不把原任务的「全部完成」说成当前任务', async () => {
  mount()
  await act(async () => { await new Promise(r => setTimeout(r, 0)) })
  expect(st.finishOnConfirmed).toBeTruthy()

  // 回执自带的原任务是 #41，而当前页面 taskId=42 ⇒ 不得说「本任务所有箱子已完成」
  await act(async () => {
    await st.finishOnConfirmed!({ id: 8, warehouseTaskId: 41, allPackagesDone: true }, { recovered: true })
  })

  const texts = st.feedback.map(f => f.text).join(' | ')
  expect(texts).toContain('原任务 #41')
  expect(texts).not.toContain('本任务所有箱子已完成')
})

test('C3 成功提示：回执就是当前任务时才说「本任务全部完成」', async () => {
  mount()
  await act(async () => { await new Promise(r => setTimeout(r, 0)) })
  await act(async () => {
    await st.finishOnConfirmed!({ id: 8, warehouseTaskId: 42, allPackagesDone: true }, { recovered: true })
  })
  const texts = st.feedback.map(f => f.text).join(' | ')
  expect(texts).toContain('本任务所有箱子已完成')
})
