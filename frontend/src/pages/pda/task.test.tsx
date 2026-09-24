// @vitest-environment jsdom
//
// PDA 扫码拣货页（/pda/task/:id）输入模式回归（2026-09-17 用户要求）。
//
// 现场用工业 PDA 的扫描头（键盘模式）直接扫库存条码。这个页面此前在进页面时自动
// focus 底部输入框，并把整页 onClick 也接到同一个 focus 上，于是每次进页面、
// 每次扫码结束后都会弹出软键盘，挡住半个拣货列表。
// 现在统一走 PdaScanner：默认「扫码模式」（不渲染输入框、不聚焦、不弹键盘），
// 只有点「手动输入」才渲染输入框并唤起软键盘。
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import Page from './task'

const api = vi.hoisted(() => ({
  task: vi.fn(),
  sug: vi.fn(),
  ready: vi.fn(),
  container: vi.fn(),
  submitScan: vi.fn(),
  logError: vi.fn(),
  ok: vi.fn(),
  err: vi.fn(),
  warn: vi.fn(),
}))

vi.mock('@/api/warehouse-tasks', () => ({
  getTaskByIdApi: api.task,
  getPickSuggestionsApi: api.sug,
  readyToShipApi: api.ready,
}))
vi.mock('@/api/inventory', () => ({ getContainerByBarcodeApi: api.container }))
vi.mock('@/hooks/useOfflineScan', () => ({
  useOfflineScan: () => ({ submitScan: api.submitScan, logError: api.logError, logUndo: vi.fn() }),
}))
vi.mock('@/hooks/usePdaFeedback', () => ({
  usePdaFeedback: () => ({ flash: null, ok: api.ok, err: api.err, warn: api.warn }),
}))
// 真实 hook 依赖 localStorage 待确认记录；本测试只关心输入模式与提交载荷。
vi.mock('@/hooks/useCriticalPdaAction', () => ({
  useCriticalPdaAction: () => ({
    run: async (execute: (key: string) => Promise<unknown>) => ({ kind: 'success', data: await execute('stable-key') }),
    submitBlocked: false,
    phase: 'idle',
    phaseMessage: null,
    lastErrorMessage: null,
    pendingRecord: null,
    confirmPending: vi.fn(),
    clearPending: vi.fn(),
    clearError: vi.fn(),
  }),
}))

const TASK = {
  id: 42,
  taskNo: 'WT20260917001',
  status: 2,
  statusName: '待拣货',
  customerName: '某客户',
  items: [{ id: 501, productId: 2782, requiredQty: 10, pickedQty: 0 }],
}

const SUGGESTIONS = {
  items: [{
    id: 501,
    productId: 2782,
    productName: 'CLIP top BLUMOTION 铰链',
    productCode: 'P111135',
    unit: '个',
    requiredQty: 10,
    pickedQty: 0,
    remaining: 10,
    suggestions: [{
      containerId: 917,
      barcode: 'I000123',
      remainingQty: 3,
      locationCode: 'A-01',
      containerKind: 'stock',
      locked: false,
    }],
  }],
}

let host: HTMLDivElement
let root: Root | null = null
let qc: QueryClient

beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.resetAllMocks()
  api.task.mockResolvedValue(TASK)
  api.sug.mockResolvedValue(SUGGESTIONS)
  api.ready.mockResolvedValue({ taskId: 42 })
  api.submitScan.mockResolvedValue(undefined)
  qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => {
    root!.render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/pda/task/42']}>
          <Routes><Route path="/pda/task/:id" element={<Page />} /></Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )
  })
  // 任务查询 → 推荐查询是两级串行，需要多轮宏任务才会全部落库；
  // 末尾再等过「延迟 focus」（80ms）窗口：页面若仍残留自动聚焦，这里足够露出输入框。
  await settle(150)
})

afterEach(async () => {
  await act(async () => { root?.unmount(); qc.clear() })
  host.remove()
  root = null
})

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  setter?.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

/** 让挂起的查询/异步提交跑完：多轮宏任务，单次 act 不够（两级串行查询）。 */
async function settle(ms = 10, rounds = 3) {
  for (let i = 0; i < rounds; i += 1) {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, ms)) })
  }
}

function buttonByText(text: string): HTMLButtonElement {
  const found = [...host.querySelectorAll('button')].find(b => b.textContent?.includes(text))
  if (!found) throw new Error(`未找到按钮：${text}`)
  return found as HTMLButtonElement
}

/** 扫码枪是键盘模式：连续按键 + Enter 直接进 document。 */
async function gunScan(code: string) {
  await act(async () => {
    for (const key of [...code, 'Enter']) {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
    }
  })
  await settle()
}

test('进页面默认扫码模式：不渲染输入框，也不把焦点放到输入框（不弹软键盘）', () => {
  expect(host.querySelector('input')).toBeNull()
  expect(host.textContent?.match(/扫描库存条码/g)).toHaveLength(1)
  expect(document.activeElement?.tagName ?? '').not.toBe('INPUT')
})

test('点击扫码区不会唤起软键盘，只有点「手动输入」才渲染输入框', async () => {
  const bottomBar = host.querySelector<HTMLDivElement>('div.sticky')
  expect(bottomBar).not.toBeNull()
  await act(async () => {
    bottomBar!.click()
  })
  expect(host.querySelector('[data-scanner-manual="true"]')).toBeNull()

  await act(async () => { buttonByText('手动输入').click() })
  const input = host.querySelector<HTMLInputElement>('[data-scanner-manual="true"]')
  expect(input).not.toBeNull()
  // 手动模式下才聚焦（这才是软键盘弹出的唯一入口）
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 100)) })
  expect(document.activeElement).toBe(input)
})

test('手动输入回车提交后回到扫码模式，输入框消失、载荷仍是后端主键', async () => {
  await act(async () => { buttonByText('手动输入').click() })
  const input = host.querySelector<HTMLInputElement>('[data-scanner-manual="true"]')!
  await act(async () => { setInputValue(input, 'I000123') })
  await act(async () => {
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  })
  await settle()

  expect(api.submitScan).toHaveBeenCalledWith({
    taskId: 42,
    itemId: 501,
    containerId: 917,
    barcode: 'I000123',
    productId: 2782,
    qty: 3,
    scanMode: '整件',
    locationCode: 'A-01',
  }, 'stable-key')
  // 提交后退出手动模式：输入框卸载、软键盘收起
  expect(host.querySelector('[data-scanner-manual="true"]')).toBeNull()
})

test('没有输入框时扫码枪键盘事件照样能提交，扫完不重新聚焦', async () => {
  await gunScan('I000123')

  expect(api.submitScan).toHaveBeenCalledWith(expect.objectContaining({ barcode: 'I000123', containerId: 917 }), 'stable-key')
  expect(api.ok).toHaveBeenCalledWith('✓ 已拣 CLIP top BLUMOTION 铰链 ×3')
  expect(host.querySelector('input')).toBeNull()
  expect(document.activeElement?.tagName ?? '').not.toBe('INPUT')
})

test('推荐库位行点击仍可拣货（扫码之外的人工兜底没有被打断）', async () => {
  await act(async () => { buttonByText('I000123').click() })
  await settle()

  expect(api.submitScan).toHaveBeenCalledWith(expect.objectContaining({ barcode: 'I000123' }), 'stable-key')
})

test('其他任务独占容器时显示任务号和释放指引，不提示直接扫码', async () => {
  api.sug.mockResolvedValue({ items: [{
    ...SUGGESTIONS.items[0], suggestions: [],
    blockedByTasks: [{ taskId: 73, taskNo: 'WT-LOCK-73', containerCount: 1, quantity: 5 }],
  }] })
  await act(async () => { await qc.invalidateQueries({ queryKey: ['pda-suggestions', 42] }) })
  await settle()
  expect(host.textContent).toContain('WT-LOCK-73')
  expect(host.textContent).toContain('任务完成或逆向归还')
  expect(host.textContent).not.toContain('请直接扫码')
})
