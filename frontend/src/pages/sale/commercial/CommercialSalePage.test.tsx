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
const mocks = vi.hoisted(() => ({ query: vi.fn(), execute: vi.fn(), get: vi.fn(), defaults: { baseURL: '/a' } }))
vi.mock('@/api/client', () => ({ default: { defaults: mocks.defaults } }))
vi.mock('@/api/operation-requests', () => ({ getOperationRequestStatusApi: mocks.query }))
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
  localStorage.clear(); sessionStorage.clear()
  vi.resetAllMocks()
  mocks.defaults.baseURL = '/a'
  mocks.query.mockResolvedValue({ status: 'not_found', data: null })
  mocks.execute.mockResolvedValue({ tasks: [] })
  mocks.get.mockResolvedValue(order)
  useAuthStore.getState().logout()
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
async function mount(run: (host: HTMLElement) => Promise<void>, input = order, onClose = () => {}) {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host),
    cache = new QueryClient()
  try {
    await act(async () =>
      root.render(
        <QueryClientProvider client={cache}>
          <MemoryRouter>
            <CommercialSalePage initial={input} owner={owner} tabPath="/sale/80" onClose={onClose} />
          </MemoryRouter>
        </QueryClientProvider>
      )
    )
    await run(host)
  } finally {
    await act(async () => { root.unmount(); await new Promise<void>(resolve => setTimeout(resolve, 0)) })
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

async function pagePaths(run: (setPath: (path: string) => Promise<void>, host: HTMLElement) => Promise<void>, initialPath = '/sale/80') {
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host), cache = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  async function setPath(path: string) {
    await act(async () => root.render(<QueryClientProvider client={cache}><MemoryRouter><CommercialSalePage initial={order} owner={owner} tabPath={path} onClose={() => {}} /></MemoryRouter></QueryClientProvider>))
    await flush()
  }
  try { await setPath(initialPath); await run(setPath, host) }
  finally { act(() => root.unmount()); cache.clear(); host.remove() }
}
async function chooseShip() {
  await click('安排本次发货')
  const input = document.querySelector<HTMLInputElement>('input[aria-label="套A本批数量"]')!
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '1'); input.dispatchEvent(new Event('input', { bubbles: true })) })
  return input
}
test('same SO progress handoff preserves ship selection and current operation remains writable', async () => {
  await pagePaths(async (setPath) => {
    const input = await chooseShip()
    await setPath('/sale/80?focus=progress&taskId=90')
    expect(document.querySelector('input[aria-label="套A本批数量"]')).toBe(input)
    await click('确认发起出库')
    expect(mocks.execute).toHaveBeenCalledTimes(1)
    expect(mocks.execute.mock.calls[0][0].operation.id).toBe(80)
  })
})
test('same SO progress handoff permits query-first retry of exact frozen detail action', async () => {
  mocks.execute.mockRejectedValueOnce({ status: 408 }).mockResolvedValue(null)
  await pagePaths(async setPath => {
    await chooseShip(); await click('确认发起出库')
    const original = mocks.execute.mock.calls[0][0]
    await setPath('/sale/80?focus=progress&taskId=90')
    await click('按原请求重试')
    expect(mocks.query.mock.calls[0][1]).toBe('sale.ship.80')
    expect(mocks.execute.mock.calls[1][0]).toEqual(original)
  })
})
test('detail reload at progress handoff finds original query-only record without applying or posting', async () => {
  mocks.execute.mockRejectedValue({ status: 408 })
  await pagePaths(async () => { await chooseShip(); await click('确认发起出库') })
  const original = mocks.execute.mock.calls[0][0]
  mocks.query.mockResolvedValue({ status: 'success', resourceType: 'sale_order', resourceId: 80, data: null })
  await pagePaths(async (_, host) => {
    expect([...host.querySelectorAll('button')].find(b => b.textContent === '按原请求重试')!.disabled).toBe(true)
    await click('查询原操作结果')
    expect(mocks.query).toHaveBeenCalledWith(original.requestKey, 'sale.ship.80', expect.objectContaining({ baseURL: '/a' }))
    expect(mocks.execute).toHaveBeenCalledTimes(1)
    expect(mocks.get).not.toHaveBeenCalled()
  }, '/sale/80?focus=progress&taskId=90')
})

function allowDetailActions() {
  useAuthStore.setState({ user: { ...useAuthStore.getState().user!, permissions: [
    PERMISSIONS.SALE_ORDER_VIEW, PERMISSIONS.SALE_ORDER_RESERVE, PERMISSIONS.SALE_ORDER_RELEASE,
    PERMISSIONS.SALE_ORDER_CANCEL, PERMISSIONS.SALE_ORDER_DELETE, PERMISSIONS.SALE_ORDER_SHIP
  ] } })
}
function actionOrder(status: SaleOrder['status']): SaleOrder {
  return { ...order, status, commercialDispatches: [], commercialGroups: [{
    ...group, dispatch: { ...group.dispatch!, confirmedShippedQty: 0 }
  }] }
}
function expectRecoveryVisible(host: HTMLElement) {
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  expect(host.closest('[aria-hidden="true"]')).toBeNull()
  expect(host.textContent).toContain('原操作结果待确认')
  expect(host.textContent).not.toContain('操作失败')
  expect(host.textContent).not.toContain('请稍后重试')
  const query = [...host.querySelectorAll('button')].find(button => button.textContent === '查询原操作结果')!
  expect(query.disabled).toBe(false)
  expect(query.closest('[aria-hidden="true"]')).toBeNull()
}
test.each([
  ['reserve', 1, '整单占库'], ['release', 2, '释放占库'],
  ['cancel', 1, '取消订单'], ['delete', 5, '删除订单']
] as const)('real confirmation %s unknown removes overlay but preserves exact mounted request and write block', async (action, status, label) => {
  allowDetailActions()
  mocks.execute.mockRejectedValueOnce({ status: 503, message: '操作失败，请稍后重试' }).mockResolvedValueOnce(null)
  const onClose = vi.fn()
  await mount(async host => {
    await click(label)
    expect(document.querySelector('[role="dialog"]')).toBeTruthy()
    await click('确认')
    const original = mocks.execute.mock.calls[0][0]
    expect(original.operation).toEqual({ action, id: 80, body: { commercialModel: 'kit-v1', expectedRevision: 4 } })
    const saved = sessionStorage.getItem('flowcube-kit-query-records-v1')
    expect(saved).toContain(original.requestKey)
    expectRecoveryVisible(host)
    expect(host.querySelector('[role="alert"]')?.textContent).toBe('原操作结果待确认，请先查询原操作结果')
    expect([...host.querySelectorAll('button')].find(button => button.textContent === label)!.disabled).toBe(true)
    expect(mocks.execute).toHaveBeenCalledTimes(1)
    expect(onClose).not.toHaveBeenCalled()
    await click('查询原操作结果')
    expect(mocks.query.mock.calls[0][1]).toBe(`sale.${action}.80`)
    expect(host.querySelector('[role="alert"]')?.textContent).toBe('暂未找到原操作结果，这不证明提交失败。刷新后只可继续查询；原表单未保存，不能重新拼接提交。')
    expect(sessionStorage.getItem('flowcube-kit-query-records-v1')).toBe(saved)
    expect(mocks.execute).toHaveBeenCalledTimes(1)
    await click('按原请求重试')
    expect(mocks.execute).toHaveBeenCalledTimes(2)
    expect(mocks.execute.mock.calls[1][0]).toEqual(original)
    expect(mocks.query).toHaveBeenCalledTimes(2)
    expect(onClose).toHaveBeenCalledTimes(action === 'delete' ? 1 : 0)
  }, actionOrder(status), onClose)
})
test('real ship dialog unknown removes overlay while keeping selected groups frozen and query-first retry', async () => {
  mocks.execute.mockRejectedValueOnce({ status: 408 }).mockResolvedValueOnce(null)
  await mount(async host => {
    await chooseShip()
    expect(document.querySelector('[role="dialog"]')).toBeTruthy()
    await click('确认发起出库')
    const original = mocks.execute.mock.calls[0][0]
    expectRecoveryVisible(host)
    expect(host.querySelector('[role="alert"]')?.textContent).toBe('提交结果待确认。原请求已冻结，请先查询原操作结果。')
    expect([...host.querySelectorAll('button')].find(button => button.textContent === '安排本次发货')!.disabled).toBe(true)
    expect(original.operation.body.groups).toEqual([{ groupId: 8, qty: 1 }])
    expect(mocks.execute).toHaveBeenCalledTimes(1)
    await click('按原请求重试')
    expect(mocks.query).toHaveBeenCalledWith(original.requestKey, 'sale.ship.80', expect.objectContaining({ baseURL: '/a' }))
    expect(mocks.execute.mock.calls[1][0]).toEqual(original)
  })
})
test.each(['cancel', 'ship'] as const)('real %s dialog cannot dismiss or submit again while original request is busy', async action => {
  allowDetailActions()
  let finish!: (reason: unknown) => void
  mocks.execute.mockImplementationOnce(() => new Promise((_, reject) => { finish = reject }))
  await mount(async host => {
    if (action === 'ship') { await chooseShip(); await click('确认发起出库') }
    else { await click('取消订单'); await click('确认') }
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!
    expect(dialog).toBeTruthy()
    const cancel = [...dialog.querySelectorAll('button')].find(button => button.textContent === (action === 'ship' ? '返回订单' : '取消'))!
    expect(cancel.disabled).toBe(true)
    const close = [...dialog.querySelectorAll('button')].find(button => button.textContent === '关闭')!
    expect(close).toBeTruthy()
    await act(async () => {
      cancel.click()
      close.click()
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    await flush()
    expect(document.querySelector('[role="dialog"]')).toBe(dialog)
    expect(mocks.execute).toHaveBeenCalledTimes(1)
    await act(async () => finish({ status: 503 }))
    await flush()
    expectRecoveryVisible(host)
    expect(mocks.execute).toHaveBeenCalledTimes(1)
  }, action === 'cancel' ? actionOrder(1) : order)
})
test('terminal business failure keeps its error and permits an explicit new action instead of unknown recovery', async () => {
  allowDetailActions()
  mocks.execute.mockRejectedValue({ status: 400, message: '业务拒绝夹具' })
  await mount(async host => {
    await click('取消订单'); await click('确认')
    expect(host.textContent).toContain('业务拒绝夹具')
    expect(host.querySelector('[role="alert"]')?.textContent).toBe('业务拒绝夹具')
    expect(host.textContent).not.toContain('原操作结果待确认')
    expect([...host.querySelectorAll('button')].find(button => button.textContent === '取消订单')!.disabled).toBe(false)
    expect(sessionStorage.getItem('flowcube-kit-query-records-v1')).not.toContain('requestKey')
    expect(mocks.execute).toHaveBeenCalledTimes(1)
    expect(document.querySelector('[role="dialog"]')).toBeTruthy()
    await click('取消')
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    await click('取消订单')
    expect(mocks.execute).toHaveBeenCalledTimes(1)
  }, actionOrder(1))
})
test('unknown delete after reload stays query-only without overlay, POST, close or applying the original receipt', async () => {
  allowDetailActions()
  mocks.execute.mockRejectedValue({ status: 503 })
  await mount(async () => { await click('删除订单'); await click('确认') }, actionOrder(5))
  const original = mocks.execute.mock.calls[0][0]
  const saved = sessionStorage.getItem('flowcube-kit-query-records-v1')
  const onClose = vi.fn()
  mocks.query.mockResolvedValue({ status: 'success', resourceType: 'sale_order', resourceId: 80, data: null })
  await mount(async host => {
    expectRecoveryVisible(host)
    expect([...host.querySelectorAll('button')].find(button => button.textContent === '按原请求重试')!.disabled).toBe(true)
    expect(sessionStorage.getItem('flowcube-kit-query-records-v1')).toBe(saved)
    await click('查询原操作结果')
    expect(mocks.query).toHaveBeenCalledWith(original.requestKey, 'sale.delete.80', expect.objectContaining({ baseURL: '/a' }))
    expect(mocks.execute).toHaveBeenCalledTimes(1)
    expect(mocks.get).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  }, actionOrder(5), onClose)
})
test('pending query retains the specific original session refusal instead of hiding recovery information', async () => {
  allowDetailActions()
  mocks.execute.mockRejectedValue({ status: 503, message: '操作失败，请稍后重试' })
  await mount(async host => {
    await click('取消订单'); await click('确认')
    const saved = sessionStorage.getItem('flowcube-kit-query-records-v1')
    await act(async () => useAuthStore.setState({ sessionGeneration: 11 }))
    await click('查询原操作结果')
    expect(host.querySelector('[role="alert"]')?.textContent).toBe('原记录的服务器、账号或登录状态已变化，请回原来源人工核对')
    expect(host.textContent).toContain('原操作结果待确认')
    expect(mocks.query).not.toHaveBeenCalled()
    expect(mocks.execute).toHaveBeenCalledTimes(1)
    expect(sessionStorage.getItem('flowcube-kit-query-records-v1')).toBe(saved)
  }, actionOrder(1))
})
