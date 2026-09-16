// @vitest-environment jsdom
//
// PDA 收货页交互回归（2026-09-14 用户决定：去掉扫码框）。
//
// 背景：来货没有条码、商品资料也不再维护条码，收货页那个「扫描商品条码」框
// 没有任何可匹配的值（只认商品编码 Pxxxxxx / P<商品ID>），现场永远扫不出结果；
// 配套的「未经扫码核对→再点一次」闸门于是变成每次收货都多一次的固定摩擦。
// 因此收货改为：点选商品 → 填箱数 → 点一次「打印并登记」即提交。
//
// 2026-09-16 追加：能否继续收货只看任务状态（< 3），不看「有没有容器在等上架」。
// 后者每收一箱就成立，多商品单收到一半会被误判成已收完而整页锁死。夹具的
// putawayStatus 必须带 key（真实响应有），否则这组回归在单测里永远不会被触发。
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import Page from './receive'

const api = vi.hoisted(() => ({ task: vi.fn(), receive: vi.fn(), warn: vi.fn() }))

vi.mock('@/api/inbound-tasks', () => ({
  getInboundTaskByIdApi: api.task,
  receiveInboundApi: api.receive,
}))
vi.mock('@/hooks/usePdaFeedback', () => ({
  usePdaFeedback: () => ({ flash: null, ok: vi.fn(), err: vi.fn(), warn: api.warn }),
}))
// 隔离 localStorage 依赖：本测试只关心页面交互，不关心待确认记录的持久化。
vi.mock('@/hooks/usePendingRequests', () => ({
  usePendingRequests: () => ({ records: [], addPending: vi.fn(), removePending: vi.fn() }),
}))

const TASK = {
  id: 7,
  taskNo: 'IN20260914001',
  status: 2,
  statusName: '收货中',
  submittedAt: '2026-09-14T16:12:00',
  warehouseId: 1,
  warehouseName: '主仓',
  supplierName: '某供应商',
  purchaseOrderNo: 'PC20260914001',
  receiptStatus: { key: 'receiving', label: '收货中' },
  printStatus: { key: 'queued', label: '待派发' },
  putawayStatus: { key: 'not_started', label: '未开始' },
  printSummary: { success: 0, queued: 0, printing: 0, failed: 0 },
  putawaySummary: { waitingContainers: 0, storedContainers: 0 },
  items: [
    {
      id: 7,
      productId: 169,
      productCode: 'P111135',
      productName: 'CLIP top BLUMOTION 铰链',
      unit: '个',
      orderedQty: 12,
      receivedQty: 0,
      purchaseOrderNo: 'PC20260914001',
    },
    {
      id: 8,
      productId: 162,
      productCode: 'P111128',
      productName: 'CLIP top BLUMOTION 底座',
      unit: '个',
      orderedQty: 23,
      receivedQty: 0,
      purchaseOrderNo: 'PC20260914001',
    },
  ],
}

let host: HTMLDivElement
let root: Root | null = null

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  setter?.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

function buttonByText(text: string): HTMLButtonElement {
  const found = [...host.querySelectorAll('button')].find(b => b.textContent?.includes(text))
  if (!found) throw new Error(`未找到按钮：${text}`)
  return found as HTMLButtonElement
}

async function mountPage(task: Record<string, unknown> = TASK) {
  api.task.mockResolvedValue(task)
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  await act(async () => {
    root!.render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/receive/7']}>
          <Routes><Route path="/receive/:id" element={<Page />} /></Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )
  })
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)) })
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  api.task.mockReset()
  api.receive.mockReset()
  api.warn.mockReset()
  api.receive.mockResolvedValue({ containers: [{ containerId: 108, barcode: 'I000108', qty: 4, status: 4 }], printJobIds: [198], noPrinterCount: 0 })
  root = null
})

afterEach(async () => {
  if (root) await act(async () => { root!.unmount() })
  host?.remove()
})

test('收货页不再渲染扫码框', async () => {
  await mountPage()
  expect(host.textContent).not.toContain('扫描商品条码')
  expect(host.textContent).not.toContain('手动输入')
})

test('点选商品后点一次「打印并登记」即提交，不再要求二次确认', async () => {
  await mountPage()
  const input = host.querySelector<HTMLInputElement>('input[type="number"]')
  expect(input, '应有箱数输入框').toBeTruthy()
  await act(async () => { setInputValue(input!, '4') })

  await act(async () => { buttonByText('打印并登记').click() })
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)) })

  expect(api.receive).toHaveBeenCalledTimes(1)
  const [taskId, payload] = api.receive.mock.calls[0]
  expect(taskId).toBe(7)
  expect(payload.productId).toBe(169)
  expect(payload.packages).toEqual([{ qty: 4 }])
  expect(payload.scannedBarcode).toBeUndefined()
})

test('一个商品收完后自动切到下一个未收完的商品', async () => {
  await mountPage()
  // 第一个商品（169）本次整单收完
  const first = host.querySelector<HTMLInputElement>('input[type="number"]')!
  await act(async () => { setInputValue(first, '12') })
  await act(async () => { buttonByText('打印并登记').click() })
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)) })
  expect(api.receive.mock.calls[0][1].productId).toBe(169)

  // 不应停在"请点选商品"的空态：直接填数再提交，应落到下一个商品 162
  const nextInput = host.querySelector<HTMLInputElement>('input[type="number"]')
  expect(nextInput, '收完后应已切到下一个商品的编辑区').toBeTruthy()
  await act(async () => { setInputValue(nextInput!, '23') })
  await act(async () => { buttonByText('打印并登记').click() })
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)) })

  expect(api.receive).toHaveBeenCalledTimes(2)
  expect(api.receive.mock.calls[1][1].productId).toBe(162)
})

test('部分收货（已有待上架容器）仍能继续收剩下的商品', async () => {
  // 生产 IN20260914001 的真实中间态：第一项 12 件已收满并生成 1 个待上架容器，
  // 任务状态仍是 2 收货中，第二项 23 件一件没收。
  await mountPage({
    ...TASK,
    putawayStatus: { key: 'waiting', label: '待上架' },
    putawaySummary: { waitingContainers: 1, storedContainers: 0 },
    items: [
      { ...TASK.items[0], receivedQty: 12 },
      { ...TASK.items[1], receivedQty: 0 },
    ],
  })

  expect(host.textContent, '有待上架容器不等于整单收完').not.toContain('本单已全部收货')
  expect(host.textContent).toContain('待收商品')

  // 已收满的 169 不可再选，页面应停在还没收的 162 上并且能提交
  expect(host.textContent).toContain('CLIP top BLUMOTION 底座')
  const input = host.querySelector<HTMLInputElement>('input[type="number"]')
  expect(input, '第二个商品应可继续收货').toBeTruthy()
  await act(async () => { setInputValue(input!, '23') })
  await act(async () => { buttonByText('打印并登记').click() })
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)) })

  expect(api.receive).toHaveBeenCalledTimes(1)
  expect(api.receive.mock.calls[0][1].productId).toBe(162)
})

test('任务推进到待上架后才收起收货界面，给出去上架入口', async () => {
  await mountPage({
    ...TASK,
    status: 3,
    statusName: '待上架',
    receiptStatus: { key: 'printed_waiting_putaway', label: '待上架' },
    putawayStatus: { key: 'waiting', label: '待上架' },
    putawaySummary: { waitingContainers: 2, storedContainers: 0 },
    items: [
      { ...TASK.items[0], receivedQty: 12 },
      { ...TASK.items[1], receivedQty: 23 },
    ],
  })

  expect(host.textContent).toContain('本单已全部收货')
  expect(buttonByText('扫码上架'), '应给出上架入口').toBeTruthy()
  expect(host.querySelector('input[type="number"]'), '已进入上架阶段不应再渲染收货录入').toBeNull()
})
