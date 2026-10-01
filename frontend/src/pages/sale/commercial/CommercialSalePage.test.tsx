// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, expect, test, vi } from 'vitest'
import CommercialSalePage from './CommercialSalePage'
import type { SaleOrder } from '@/types/sale'
import type { CommercialGroup } from '@/types/sale-commercial'
import { useAuthStore } from '@/store/authStore'
import { PERMISSIONS } from '@/lib/permission-codes'
const mocks = vi.hoisted(() => ({ execute: vi.fn(), get: vi.fn(), defaults: { baseURL: '/a' } }))
vi.mock('@/api/client', () => ({ default: { defaults: mocks.defaults } }))
vi.mock('@/api/sale-commercial', () => ({ executeCommercialSaleApi: mocks.execute, getCommercialSaleApi: mocks.get }))
vi.mock('./CommercialFulfillmentSummary', () => ({ default: () => <p>真实供货分配</p> }))
vi.mock('../form/components/SaleOrderOverview', () => ({ SaleOrderOverview: () => <p>原销售概览</p> }))
vi.mock('../form/components/FulfillmentProgressCard', () => ({ FulfillmentProgressCard: () => <p>原任务归还入口</p> }))
vi.mock('@/components/print/SaleOrderPrintTemplate', () => ({ PrintPreviewOverlay: () => <p>客户预览</p> }))
const owner = { baseURL: '/a', userId: 5, sessionGeneration: 10 }
const group = {
  id: 8,
  lineKey: 'A',
  kind: 'kit',
  kitVersionId: 19,
  kitCode: 'KA',
  kitName: '套A',
  warehouseId: 1,
  originalQty: 2,
  targetQty: 2,
  unitPrice: 100,
  amount: 200,
  originalAmount: 200,
  metadata: { input: { kind: 'kit' }, entry: null },
  components: [],
  dispatch: { confirmedShippedQty: 1, outstandingQty: 0, activeAllocatedQty: 1, availableQty: 1, facts: [] }
} as unknown as CommercialGroup
const order = {
  id: 80,
  orderNo: 'SO80',
  customerId: 1,
  customerName: '测试',
  warehouseId: 1,
  warehouseName: '仓一',
  commercialModel: 'kit-v1',
  commercialRevision: 4,
  status: 3,
  statusName: '执行中',
  totalAmount: 200,
  commercialGroups: [group],
  commercialDispatches: [
    {
      dispatchGroupId: 1,
      groupId: 8,
      taskId: 90,
      taskNo: 'WT-A',
      warehouseId: 1,
      taskStatus: 7,
      quantity: 1,
      active: true,
      confirmedShipped: true,
      outstanding: false,
      allocated: true
    },
    {
      dispatchGroupId: 2,
      groupId: 7,
      taskId: 90,
      taskNo: 'WT-OLD',
      warehouseId: 1,
      taskStatus: 7,
      quantity: 1,
      active: false,
      confirmedShipped: false,
      outstanding: false,
      allocated: false
    }
  ],
  items: [],
  tasks: [],
  createdAt: '2026-10-01'
} as unknown as SaleOrder
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  localStorage.clear()
  vi.resetAllMocks()
  mocks.defaults.baseURL = '/a'
  mocks.execute.mockResolvedValue({ tasks: [] })
  mocks.get.mockResolvedValue(order)
  useAuthStore.setState({
    token: 'test-only',
    sessionGeneration: 10,
    user: {
      id: 5,
      username: 'fixture',
      realName: '测试',
      roleId: 5,
      roleName: '测试',
      permissions: [PERMISSIONS.SALE_ORDER_SHIP, PERMISSIONS.SALE_ORDER_CANCEL, PERMISSIONS.SALE_ORDER_VIEW]
    }
  })
})
async function flush() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 3))
  })
}
async function click(label: string) {
  const b = Array.from(document.querySelectorAll('button')).find((b) => b.textContent === label)
  expect(b, label).toBeTruthy()
  await act(async () => b!.click())
  await flush()
}
async function mount(run: (host: HTMLElement) => Promise<void>, input = order) {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host),
    cache = new QueryClient()
  try {
    await act(async () =>
      root.render(
        <QueryClientProvider client={cache}>
          <MemoryRouter>
            <CommercialSalePage initial={input} owner={owner} tabPath="/sale/80" onClose={() => {}} />
          </MemoryRouter>
        </QueryClientProvider>
      )
    )
    await run(host)
  } finally {
    act(() => root.unmount())
    cache.clear()
    host.remove()
  }
}
test('commercial bridge keeps confirmed vs inactive unconfirmed WT7 distinct; actions use source permission', async () => {
  await mount(async (host) => {
    expect(host.textContent).toContain('WT-A · 套A · 1套 · 仓一 · 已出库 · 已确认实发')
    expect(host.textContent).toContain('WT-OLD · 原成交行 #7 · 1 · 仓一 · 已出库 · 原批次（未确认） · 已撤销批次')
    expect(host.textContent).not.toContain('编辑订单')
    expect(host.textContent).not.toContain('整单占库')
    expect(host.textContent).toContain('关闭剩余未发')
  })
})
test('mounted ship selection rejects fractional kits and submits commercial group/revision under original identity', async () => {
  await mount(async () => {
    await click('安排本次发货')
    const input = document.querySelector<HTMLInputElement>('input[aria-label="套A本批数量"]')!
    async function change(value: string) {
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
        input.dispatchEvent(new Event('input', { bubbles: true }))
      })
    }
    await change('0.8')
    expect(
      Array.from(document.querySelectorAll('button')).find((b) => b.textContent === '确认发起出库')!.disabled
    ).toBe(true)
    await change('1')
    await click('确认发起出库')
    expect(mocks.execute.mock.calls[0][0].operation).toEqual({
      action: 'ship',
      id: 80,
      body: { commercialModel: 'kit-v1', expectedRevision: 4, groups: [{ groupId: 8, qty: 1 }] }
    })
  })
})
test('returning task blocks dispatch/cancel without claiming reservation released', async () => {
  await mount(
    async (host) => {
      expect(host.textContent).toContain('不视为预占释放')
      expect(Array.from(host.querySelectorAll('button')).find((b) => b.textContent === '安排本次发货')!.disabled).toBe(
        true
      )
    },
    { ...order, warehouseTaskCancelRequestedAt: '2026-10-01' }
  )
})
test('confirmed original retry safely rereads changed revision/dispatch allowance after mounted unknown', async () => {
  mocks.execute.mockRejectedValueOnce({ status: 408 }).mockResolvedValueOnce(null)
  mocks.get.mockResolvedValue({
    ...order,
    commercialRevision: 5,
    commercialGroups: [{ ...group, dispatch: { ...group.dispatch, availableQty: 0, outstandingQty: 1 } }]
  })
  await mount(async (host) => {
    await click('安排本次发货')
    const input = document.querySelector<HTMLInputElement>('input[aria-label="套A本批数量"]')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '1')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await click('确认发起出库')
    expect(host.textContent).toContain('原操作结果待确认')
    expect(mocks.get).not.toHaveBeenCalled()
    await click('按原请求重试')
    expect(mocks.get).toHaveBeenCalledWith(80, owner)
    expect(mocks.execute.mock.calls[1][0].requestKey).toBe(mocks.execute.mock.calls[0][0].requestKey)
    expect(mocks.execute.mock.calls[1][0].operation).toEqual(mocks.execute.mock.calls[0][0].operation)
    await click('安排本次发货')
    expect(document.body.textContent).toContain('没有可选发货余量')
  })
})
