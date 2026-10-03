// @vitest-environment jsdom
import { createRequire } from 'node:module'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, expect, test, vi } from 'vitest'
import SaleReturnFormPage from './index'
import { TabPathContext } from '@/components/layout/TabPathContext'
import { useAuthStore } from '@/store/authStore'
const mocks = vi.hoisted(() => ({
  confirm: vi.fn(),
  cancel: vi.fn(),
  source: vi.fn(),
  detail: vi.fn(),
  create: vi.fn(),
  defaults: { baseURL: '/a' }
}))
vi.mock('@/api/client', () => ({ default: { defaults: mocks.defaults } }))
vi.mock('@/api/returns', () => ({
  getSaleReturnSourceOrderApi: mocks.source,
  getSaleReturnDetailApi: mocks.detail,
  createSaleReturnApi: mocks.create,
  confirmSaleReturnApi: mocks.confirm,
  cancelSaleReturnApi: mocks.cancel
}))
vi.mock('@/components/finder', () => ({
  CustomerFinder: () => null,
  ProductFinder: () => null
}))
vi.mock('@/components/shared/WarehouseSelect', () => ({
  WarehouseSelect: () => <span>warehouse</span>
}))
vi.mock('@/components/shared/OrderDetailSections', () => ({
  OrderDetailSections: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  )
}))
vi.mock('@/hooks/useProductQtyPolicies', () => ({
  useProductQtyPolicies: () => () => true
}))
vi.mock('@/hooks/useDirtyGuard', () => ({ useDirtyGuard: () => {} }))
vi.mock('@/hooks/useWorkspaceTabTitle', () => ({
  useWorkspaceTabTitle: () => {}
}))
vi.mock('@/lib/toast', () => ({
  toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() }
}))
const component = {
  sourceItemId: 30,
  productId: 1,
  productCode: 'I',
  productName: '铰链',
  unit: '个',
  quantity: 10,
  sourceQuantity: 10,
  returnedQty: 2,
  remainingQty: 8,
  unitPrice: 8,
  sourceBudgetAmount: 80,
  sourceFinancialEstimate: 72,
  actualQualifiedQty: 1,
  actualRefundGross: 8,
  actualRefundAmount: 7.2,
  dispatchComponentId: 40,
  commercialComponentId: 50,
  kind: 'kit',
  kitCode: 'KA',
  kitName: '套A',
  groupId: 60,
  lineKey: 'A',
  taskId: 70,
  taskNo: 'WT70',
  confirmedAt: '2026-10-01T00:00:00Z',
  warehouseId: 1,
  warehouseName: '仓一',
  allowDecimalQty: false
}
const source = {
  id: 80,
  orderNo: 'SO80',
  customerId: 1,
  customerName: '测试客户',
  warehouseId: 1,
  warehouseName: '仓一',
  commercialModel: 'kit-v1',
  commercialRevision: 4,
  items: [
    component,
    { ...component, dispatchComponentId: 41, taskId: 71, taskNo: 'WT71' }
  ]
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  sessionStorage.clear()
  vi.resetAllMocks()
  mocks.source.mockResolvedValue(source)
  useAuthStore
    .getState()
    .login('fixture', null, { id: 5, roleId: 1, permissions: ['*'] } as never)
})
async function renderPage(
  path: string,
  run: (host: HTMLElement) => Promise<void>
) {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host),
    cache = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  try {
    await act(async () => {
      root.render(
        <QueryClientProvider client={cache}>
          <MemoryRouter>
            <TabPathContext.Provider value={path}>
              <SaleReturnFormPage />
            </TabPathContext.Provider>
          </MemoryRouter>
        </QueryClientProvider>
      )
      await new Promise((r) => setTimeout(r, 5))
    })
    await act(async () => {
      await new Promise((r) => setTimeout(r, 15))
    })
    await run(host)
  } finally {
    act(() => root.unmount())
    host.remove()
    cache.clear()
  }
}
async function click(host: HTMLElement, text: string) {
  const b = [...host.querySelectorAll('button')].find(
    (b) => b.textContent === text
  )
  expect(b, text).toBeTruthy()
  await act(async () => {
    b!.click()
    await new Promise((r) => setTimeout(r, 5))
  })
}
async function bind(host: HTMLElement) {
  const input = host.querySelector('input[placeholder="输入原单号"]')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value'
    )!.set!.call(input, 'SO80')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await click(host, '载入')
}
const factDraft = {
  id: 90,
  returnNo: 'SR90',
  status: 1,
  totalAmount: 1,
  warehouseName: '仓一',
  customerName: '测试',
  createdAt: '2026-10-01',
  items: [{ id: 1, ...component, quantity: 1, amount: 1, source: component }]
}
const factConfirmed = {
  ...factDraft,
  status: 2,
  task: { id: 100, taskNo: 'RT100', status: 1 }
}
const factsKey = 'flowcube-source-return-facts-v1:90'
async function startFactCheck(host: HTMLElement, action: 'confirm' | 'cancel') {
  await click(host, action === 'confirm' ? '确认（派发到 PDA）' : '取消')
  await click(document.body, action === 'confirm' ? '确认' : '确认取消')
  await click(host, '查询当前单据')
}
test.each(['confirm', 'cancel'] as const)(
  'acknowledged %s keeps original actions blocked until owned fresh detail replaces stale draft',
  async (action) => {
    const current =
      action === 'confirm' ? factConfirmed : { ...factDraft, status: 4 }
    let resolve!: (value: typeof current) => void
    mocks.detail
      .mockResolvedValueOnce(factDraft)
      .mockResolvedValueOnce(current)
      .mockImplementation(
        () =>
          new Promise((r) => {
            resolve = r
          })
      )
    mocks[action].mockRejectedValue({ status: 503, message: 'response lost' })
    await renderPage('/returns/sale/90', async (host) => {
      await startFactCheck(host, action)
      await click(host, '已核对当前单据')
      const stale = [...host.querySelectorAll('button')].find(
        (b) => b.textContent === '确认（派发到 PDA）'
      )!
      expect(stale.disabled).toBe(true)
      expect(sessionStorage.getItem(factsKey)).toBeTruthy()
      await act(async () => {
        resolve(current)
        await new Promise((r) => setTimeout(r, 10))
      })
      expect(sessionStorage.getItem(factsKey)).toBeNull()
      expect(host.textContent).not.toContain('确认（派发到 PDA）')
      expect(mocks[action]).toHaveBeenCalledTimes(1)
    })
  }
)
test.each(['confirm', 'cancel'] as const)(
  'acknowledged %s refresh failure keeps durable identity and permits explicit read-only retry',
  async (action) => {
    const current =
      action === 'confirm' ? factConfirmed : { ...factDraft, status: 4 }
    mocks.detail
      .mockResolvedValueOnce(factDraft)
      .mockResolvedValueOnce(current)
      .mockRejectedValueOnce({ status: 503 })
      .mockResolvedValue(current)
    mocks[action].mockRejectedValue({ status: 503, message: 'response lost' })
    await renderPage('/returns/sale/90', async (host) => {
      await startFactCheck(host, action)
      const originalRecord = sessionStorage.getItem(factsKey)
      await click(host, '已核对当前单据')
      expect(sessionStorage.getItem(factsKey)).toBe(originalRecord)
      expect(host.textContent).toContain('详情更新未完成')
      expect(
        [...host.querySelectorAll('button')].find(
          (b) => b.textContent === '确认（派发到 PDA）'
        )!.disabled
      ).toBe(true)
      await click(host, '查询当前单据')
      await click(host, '已核对当前单据')
      expect(sessionStorage.getItem(factsKey)).toBeNull()
      expect(mocks[action]).toHaveBeenCalledTimes(1)
    })
  }
)
test.each(['foreign', 'stale', 'owner'] as const)(
  'acknowledged facts never clear original identity after %s fresh-detail result',
  async (scenario) => {
    let resolve!: (value: typeof factDraft) => void
    mocks.detail
      .mockResolvedValueOnce(factDraft)
      .mockResolvedValueOnce(factConfirmed)
      .mockImplementation(
        () =>
          new Promise((r) => {
            resolve = r
          })
      )
    mocks.confirm.mockRejectedValue({ status: 503 })
    await renderPage('/returns/sale/90', async (host) => {
      await startFactCheck(host, 'confirm')
      const original = sessionStorage.getItem(factsKey)
      await click(host, '已核对当前单据')
      await act(async () => {
        if (scenario === 'owner') {
          useAuthStore.getState().logout()
          useAuthStore.getState().login('new-login', null, { id: 5 } as never)
        }
        resolve(
          scenario === 'foreign'
            ? { ...factConfirmed, id: 91 }
            : scenario === 'stale'
              ? factDraft
              : factConfirmed
        )
        await new Promise((r) => setTimeout(r, 10))
      })
      expect(sessionStorage.getItem(factsKey)).toBe(original)
      expect(
        [...host.querySelectorAll('button')].find(
          (b) => b.textContent === '确认（派发到 PDA）'
        )!.disabled
      ).toBe(true)
      expect(mocks.confirm).toHaveBeenCalledTimes(1)
    })
  }
)
test('leaving detail during acknowledgement never clears durable original verification', async () => {
  let resolve!: (value: typeof factConfirmed) => void
  mocks.detail
    .mockResolvedValueOnce(factDraft)
    .mockResolvedValueOnce(factConfirmed)
    .mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r
        })
    )
  mocks.confirm.mockRejectedValue({ status: 503 })
  let original: string | null = null
  await renderPage('/returns/sale/90', async (host) => {
    await startFactCheck(host, 'confirm')
    original = sessionStorage.getItem(factsKey)
    await click(host, '已核对当前单据')
  })
  await act(async () => {
    resolve(factConfirmed)
    await new Promise((r) => setTimeout(r, 10))
  })
  expect(sessionStorage.getItem(factsKey)).toBe(original)
  expect(mocks.confirm).toHaveBeenCalledTimes(1)
})
test('kit binding requires explicit original component, same SKU different source is split, selection quantity editable but source price fixed', async () => {
  await renderPage('/returns/sale/new', async (host) => {
    await bind(host)
    expect(host.querySelectorAll('input[aria-label="退货数量"]')).toHaveLength(
      0
    )
    expect(host.textContent).toContain('来源全量参考')
    await click(host, '选择 WT70 · 套A · 铰链')
    expect(host.querySelectorAll('input[aria-label="退货数量"]')).toHaveLength(
      1
    )
    expect(
      (host.querySelector('input[aria-label="退货数量"]') as HTMLInputElement)
        .disabled
    ).toBe(false)
    expect(
      (host.querySelector('input[aria-label="退货单价"]') as HTMLInputElement)
        .disabled
    ).toBe(true)
    await click(host, '选择 WT71 · 套A · 铰链')
    expect(host.textContent).toContain('分单')
    expect(host.querySelectorAll('input[aria-label="退货数量"]')).toHaveLength(
      1
    )
    expect(host.textContent).not.toContain('¥72.00')
  })
})
test('saved source return uses exact nested source and actual net four places without reading SO', async () => {
  mocks.detail.mockResolvedValue({
    id: 90,
    returnNo: 'SR90',
    status: 3,
    totalAmount: 0.005,
    warehouseName: '仓一',
    customerName: '测试',
    createdAt: '2026-10-01',
    items: [
      { id: 1, ...component, quantity: 1, amount: 0.005, source: component }
    ]
  })
  await renderPage('/returns/sale/90', async (host) => {
    expect(host.textContent).toContain('WT70')
    expect(host.textContent).toContain('实际净冲减')
    expect(host.textContent).toContain('0.0050')
    expect(mocks.source).not.toHaveBeenCalled()
  })
})

test('source confirm unknown offers exact current facts only, never invents receipt/retry', async () => {
  const ret = {
    id: 90,
    returnNo: 'SR90',
    status: 1,
    totalAmount: 1,
    warehouseName: '仓一',
    customerName: '测试',
    createdAt: '2026-10-01',
    items: [{ id: 1, ...component, quantity: 1, amount: 1, source: component }]
  }
  mocks.detail.mockResolvedValue(ret)
  mocks.confirm.mockRejectedValue({ status: 503, message: 'response lost' })
  await renderPage('/returns/sale/90', async (host) => {
    await click(host, '确认（派发到 PDA）')
    // ConfirmDialog is portalled to document.body.
    await click(document.body, '确认')
    expect(host.textContent).toContain('查询当前单据')
    mocks.detail.mockResolvedValue({
      ...ret,
      status: 2,
      task: { id: 100, taskNo: 'RT100', status: 1 }
    })
    await click(host, '查询当前单据')
    expect(host.textContent).toContain('当前单据已确认')
    expect(host.textContent).toContain('不代表原请求结果')
    expect(mocks.confirm).toHaveBeenCalledTimes(1)
  })
})

test('source creation submits actual strict route schema with original snapshots and marker/revision', async () => {
  mocks.create.mockRejectedValue({ status: 408 })
  await renderPage('/returns/sale/new', async (host) => {
    await bind(host)
    await click(host, '选择 WT70 · 套A · 铰链')
    await click(host, '创建退货单')
    const payload = mocks.create.mock.calls[0][0]
    const { saleReturnSchema } = createRequire(import.meta.url)(
      '../../../../../../backend/src/modules/returns/returns.contracts.js'
    )
    expect(saleReturnSchema.safeParse(payload).success).toBe(true)
    expect(payload).toMatchObject({
      commercialModel: 'kit-v1',
      expectedRevision: 4,
      items: [
        {
          dispatchComponentId: 40,
          commercialComponentId: 50,
          sourceItemId: 30,
          productCode: 'I',
          productName: '铰链',
          unitPrice: 8
        }
      ]
    })
  })
})

test('source read arriving after order-number change cannot bind another draft', async () => {
  let finish!: (v: unknown) => void
  mocks.source.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  await renderPage('/returns/sale/new', async (host) => {
    await bind(host)
    const input = host.querySelector('input[placeholder="输入原单号"]')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value'
      )!.set!.call(input, 'SO81')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    mocks.source.mockResolvedValue({
      ...source,
      id: 81,
      orderNo: 'SO81',
      items: [{ ...component, kitName: '套B', taskNo: 'WT81' }]
    })
    await click(host, '载入')
    await act(async () => {
      finish(source)
      await new Promise((r) => setTimeout(r, 5))
    })
    expect(host.textContent).toContain('SO81')
    expect(host.textContent).toContain('WT81')
    expect(host.textContent).not.toContain('WT70')
    expect(host.querySelectorAll('input[aria-label="退货数量"]')).toHaveLength(
      0
    )
  })
})
test('ordinary source still automatically fills original remaining quantity and has no commercial marker', async () => {
  mocks.source.mockResolvedValue({
    ...source,
    commercialModel: undefined,
    commercialRevision: undefined,
    items: [
      {
        sourceItemId: 30,
        productId: 1,
        productCode: 'I',
        productName: '铰链',
        unit: '个',
        quantity: 10,
        returnedQty: 2,
        remainingQty: 8,
        unitPrice: 8
      }
    ]
  })
  mocks.create.mockRejectedValue({ status: 400 })
  await renderPage('/returns/sale/new', async (host) => {
    await bind(host)
    expect(
      (host.querySelector('input[aria-label="退货数量"]') as HTMLInputElement)
        .value
    ).toBe('8')
    expect(host.textContent).not.toContain('来源全量参考')
    await click(host, '创建退货单')
    expect(mocks.create.mock.calls[0][0].commercialModel).toBeUndefined()
    expect(mocks.create.mock.calls[0][0].items[0]).toMatchObject({
      quantity: 8,
      unitPrice: 8
    })
  })
})
test('refresh with malformed query records blocks entire empty source form before ordinary branch can submit', async () => {
  sessionStorage.setItem(
    'flowcube-kit-query-records-v1',
    JSON.stringify({ version: 0, records: [] })
  )
  await renderPage('/returns/sale/new', async (host) => {
    const create = [...host.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('创建退货单')
    )!
    expect(create.disabled).toBe(true)
    await act(async () => create.click())
    expect(mocks.create).not.toHaveBeenCalled()
    expect(host.textContent).toContain('历史查询记录')
  })
})
test('refresh storage read failure blocks empty form with no original boundSource, never ordinary POST', async () => {
  const original = Storage.prototype.getItem
  const spy = vi
    .spyOn(Storage.prototype, 'getItem')
    .mockImplementation(function (this: Storage, key) {
      if (key === 'flowcube-kit-query-records-v1')
        throw new Error('records read blocked')
      return original.call(this, key)
    })
  try {
    await renderPage('/returns/sale/new', async (host) => {
      const create = [...host.querySelectorAll('button')].find((b) =>
        b.textContent?.includes('创建退货单')
      )!
      expect(create.disabled).toBe(true)
      await act(async () => create.click())
      expect(mocks.create).not.toHaveBeenCalled()
      expect(host.textContent).toContain('records read blocked')
    })
  } finally {
    spy.mockRestore()
  }
})
test('known409 keeps editable draft but source clear/reload requires precise backup first', async () => {
  mocks.create.mockRejectedValue({ status: 409 })
  await renderPage('/returns/sale/new', async (host) => {
    await bind(host)
    await click(host, '选择 WT70 · 套A · 铰链')
    await click(host, '创建退货单')
    expect(
      [...host.querySelectorAll('button')].find(
        (b) => b.textContent === '清除'
      )!.disabled
    ).toBe(true)
    expect(
      [...host.querySelectorAll('button')].find(
        (b) => b.textContent === '备份后清除来源'
      )!.disabled
    ).toBe(true)
    expect(
      (host.querySelector('input[aria-label="退货数量"]') as HTMLInputElement)
        .disabled
    ).toBe(false)
    expect(host.textContent).toContain('原成交版本已变化')
  })
})
