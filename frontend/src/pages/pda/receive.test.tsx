// @vitest-environment jsdom
//
// PDA 收货页交互回归（2026-09-14 用户决定：去掉扫码框）。
//
// 背景：来货没有条码、商品资料也不再维护条码，收货页那个「扫描商品条码」框
// 没有任何可匹配的值（只认商品编码 Pxxxxxx / P<商品ID>），现场永远扫不出结果；
// 配套的「未经扫码核对→再点一次」闸门于是变成每次收货都多一次的固定摩擦。
// 因此收货改为：点选商品 → 填箱数 → 点一次「打印并登记」即提交。
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
  status: 1,
  statusName: '收货中',
  submittedAt: '2026-09-14T16:12:00',
  warehouseId: 1,
  warehouseName: '主仓',
  supplierName: '某供应商',
  purchaseOrderNo: 'PC20260914001',
  receiptStatus: { label: '收货中' },
  printStatus: { label: '待派发' },
  putawayStatus: { label: '待上架' },
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
let root: Root

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

beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  api.task.mockReset()
  api.receive.mockReset()
  api.warn.mockReset()
  api.task.mockResolvedValue(TASK)
  api.receive.mockResolvedValue({ containers: [{ containerId: 108, barcode: 'I000108', qty: 4, status: 4 }], printJobIds: [198], noPrinterCount: 0 })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  await act(async () => {
    root.render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/receive/7']}>
          <Routes><Route path="/receive/:id" element={<Page />} /></Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )
  })
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)) })
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  host.remove()
})

test('收货页不再渲染扫码框', () => {
  expect(host.textContent).not.toContain('扫描商品条码')
  expect(host.textContent).not.toContain('手动输入')
})

test('点选商品后点一次「打印并登记」即提交，不再要求二次确认', async () => {
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
