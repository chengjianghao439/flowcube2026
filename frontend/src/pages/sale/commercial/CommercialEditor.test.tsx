// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, expect, test, vi } from 'vitest'
import CommercialEditor from './CommercialEditor'
import type { SaleOrder } from '@/types/sale'
import type { CommercialBody, CommercialGroup } from '@/types/sale-commercial'
import { useAuthStore } from '@/store/authStore'
import { PERMISSIONS } from '@/lib/permission-codes'
const mocks = vi.hoisted(() => ({ query: vi.fn(), preview: vi.fn(), execute: vi.fn(), get: vi.fn(), defaults: { baseURL: '/a' } }))
vi.mock('@/api/client', () => ({ default: { defaults: mocks.defaults }, getApiClientBaseURL: () => mocks.defaults.baseURL, subscribeApiClientBaseURL: () => () => {} }))
vi.mock('@/api/operation-requests', () => ({ getOperationRequestStatusApi: mocks.query }))
vi.mock('@/api/sale-commercial', () => ({
  previewCommercialSaleApi: mocks.preview,
  executeCommercialSaleApi: mocks.execute,
  getCommercialSaleApi: mocks.get
}))
vi.mock('@/hooks/useCarriers', () => ({ useCarriersActive: () => ({ data: [] }) }))
vi.mock('../form/components/SaleOrderHeaderFields', () => ({
  SaleOrderHeaderFields: (p: {
    headerReadOnly: boolean
    setCustomerFinderOpen: (b: boolean) => void
    setWarehouseId: (s: string) => void
    setWarehouseName: (s: string) => void
  }) => (
    <div data-header-readonly={p.headerReadOnly}>
      <button disabled={p.headerReadOnly} onClick={() => p.setCustomerFinderOpen(true)}>
        选择客户
      </button>
      <button
        disabled={p.headerReadOnly}
        onClick={() => {
          p.setWarehouseId('1')
          p.setWarehouseName('测试仓')
        }}
      >
        选择仓库
      </button>
    </div>
  )
}))
vi.mock('@/components/finder', () => ({
  CustomerFinder: ({ onConfirm }: { onConfirm: (c: unknown) => void }) => (
    <button onClick={() => onConfirm({ id: 2, name: '客户B' })}>确认客户B</button>
  )
}))
vi.mock('./CommercialPicker', () => ({
  default: ({ kind, onSelect }: { kind: string; onSelect: (r: unknown) => void }) => (
    <div>
      {(kind === 'kit' ? ['A', 'B'] : ['普通', '包装']).map((name) => (
        <button
          key={name}
          onClick={() =>
            onSelect({
              input:
                kind === 'kit'
                  ? {
                      kind: 'kit',
                      lineKey: name,
                      warehouseId: 1,
                      kitVersionId: name === 'A' ? 19 : 20,
                      quantity: 1,
                      priceSource: 'manual',
                      unitPrice: name === 'A' ? 100 : 200
                    }
                  : {
                      kind: 'ordinary',
                      lineKey: name,
                      warehouseId: 1,
                      productId: name === '普通' ? 11 : 12,
                      entryUnit: name === '包装' ? '包' : '个',
                      quantity: name === '包装' ? 2 : 1,
                      priceSource: name === '包装' ? 'manual' : 'default',
                      ...(name === '包装' ? { unitPrice: 12.3456 } : {})
                    },
              name,
              code: name,
              unit: name === '包装' ? '包' : kind === 'kit' ? '套' : '个',
              quantity: name === '包装' ? '2' : '1',
              price: name === 'A' ? '100' : name === 'B' ? '200' : name === '包装' ? '12.3456' : '',
              units: kind === 'ordinary' ? [{ unitName: '包', conversionRate: 10 }] : [],
              baseUnit: kind === 'ordinary' ? '个' : '套',
              packagingExpressible: true
            })
          }
        >
          选{name}
        </button>
      ))}
    </div>
  )
}))
const owner = { baseURL: '/a', userId: 5, sessionGeneration: 10 }
function fixturePreview(b: CommercialBody) {
  const groups = b.commercialGroups.map((input) => ({
    id: input.kind === 'kit' ? input.kitVersionId : input.productId,
    lineKey: input.lineKey,
    kind: input.kind,
    unitPrice: input.unitPrice ?? (input.kind === 'kit' ? 100 : b.customerId === 2 ? 30 : 10),
    amount: input.lineKey === '包装' ? 24.69 : (input.unitPrice ?? (b.customerId === 2 ? 30 : 10)),
    metadata: {
      input,
      entry:
        input.kind === 'ordinary'
          ? {
              entryUnit: input.entryUnit,
              entryQty: input.quantity,
              conversionRate: input.lineKey === '包装' ? 10 : 1,
              entryUnitPrice: input.unitPrice ?? (b.customerId === 2 ? 30 : 10)
            }
          : null,
      quote:
        input.kind === 'ordinary'
          ? {
              referenceUnitPrice: b.customerId === 2 ? 30 : 10,
              resolvedPriceSource: 'price_level',
              resolvedPriceLevel: 'A'
            }
          : null
    },
    components: [
      { productId: 11, productCode: 'P11', productName: '共享铰链', baseQty: 1, unit: '个' },
      { productId: 12, productCode: 'P12', productName: '螺钉', baseQty: 4, unit: '个' }
    ]
  })) as unknown as CommercialGroup[]
  return {
    commercialGroups: groups,
    amount: groups.reduce((s, g) => s + g.amount, 0),
    physicalItems: [
      {
        productId: 11,
        productCode: 'P11',
        productName: '共享铰链',
        warehouseId: 1,
        quantity: 3,
        unit: '个',
        inventory: { available: 1, shortage: 2 }
      }
    ],
    canFulfillEntireVector: false,
    expected: null,
    readyDate: null,
    inventoryExplanation:
      '当前现货可用来自 ACTIVE 容器余量减现有预占；按整个物理向量核对。不能据此保证可拣或占库成功；共享组件只汇总一次',
    readyDateExplanation: '未分配'
  }
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  localStorage.clear(); sessionStorage.clear()
  vi.resetAllMocks()
  mocks.defaults.baseURL = '/a'
  mocks.query.mockResolvedValue({ status: 'not_found', data: null })
  mocks.preview.mockImplementation(async (b) => fixturePreview(b))
  mocks.execute.mockResolvedValue({ id: 80 })
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
      permissions: [PERMISSIONS.SALE_ORDER_CREATE, PERMISSIONS.SALE_ORDER_UPDATE, PERMISSIONS.PRODUCT_VIEW]
    }
  })
})
async function flush() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 3))
  })
}
async function click(name: string) {
  const b = Array.from(document.querySelectorAll('button')).find((b) => b.textContent === name)
  expect(b, name).toBeTruthy()
  await act(async () => {
    b!.click()
  })
  await flush()
}
async function change(label: string, value: string) {
  const input = document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!
  expect(input, label).toBeTruthy()
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await flush()
}
async function mount(run: () => Promise<void>, order?: SaleOrder, adjust = false, onDone: () => void = () => {}) {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host),
    cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  try {
    await act(async () => {
      root.render(
        <QueryClientProvider client={cache}>
          <MemoryRouter>
            <CommercialEditor
              order={order}
              owner={owner}
              tabPath={order ? `/sale/${order.id}` : '/sale/new-kit'}
              adjust={adjust}
              onDone={onDone}
            />
          </MemoryRouter>
        </QueryClientProvider>
      )
    })
    await flush()
    await run()
  } finally {
    act(() => root.unmount())
    cache.clear()
    host.remove()
  }
}
test('mounted sharedcart A100 B200 ordinary30 and manual4 packaging uses server preview; shortage still saves', async () => {
  await mount(async () => {
    await click('选择客户')
    await click('确认客户B')
    await click('选择仓库')
    await click('添加成套配件')
    await click('选A')
    await click('添加成套配件')
    await click('选B')
    await click('添加普通商品')
    await click('选普通')
    await click('添加普通商品')
    await click('选包装')
    expect(document.body.textContent).toContain('当前现货存在短缺')
    expect(document.body.textContent).toContain('共享组件只汇总一次')
    expect(document.body.textContent).toContain(
      '当前现货可用来自有效库存条码余量减现有预占；按整单配件需求核对。不能据此保证可拣或占库成功'
    )
    expect(document.body.textContent).not.toContain('ACTIVE')
    expect(document.body.textContent).not.toContain('物理向量')
    expect(document.body.textContent).toContain('共享铰链 · 测试仓 · 总需求 3')
    expect(document.body.textContent).not.toContain('共享铰链 · 仓库 #1')
    expect(document.body.textContent).toContain('¥354.69')
    await click('保存草稿')
    const plan = mocks.execute.mock.calls[0][0]
    expect(plan.operation.body.commercialGroups).toMatchObject([
      { kind: 'kit', unitPrice: 100, quantity: 1 },
      { kind: 'kit', unitPrice: 200, quantity: 1 },
      { kind: 'ordinary', priceSource: 'default' },
      { kind: 'ordinary', quantity: 2, entryUnit: '包', unitPrice: 12.3456, priceSource: 'manual' }
    ])
    expect(plan.operation.body.commercialGroups.every((g: { warehouseId: number }) => g.warehouseId === 1)).toBe(true)
  })
})
test('fresh ordinary auxiliary selection preserves known basic unit so a mistaken package choice can be changed back', async () => {
  await mount(async () => {
    await click('选择客户')
    await click('确认客户B')
    await click('选择仓库')
    await click('添加普通商品')
    await click('选普通')
    const select = document.querySelector<HTMLSelectElement>('select[aria-label="普通录入单位"]')!
    await act(async () => {
      select.value = '包'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(Array.from(select.options).map((option) => option.value)).toContain('个')
    expect(Array.from(select.options).map((option) => option.value)).toContain('包')
    await act(async () => {
      select.value = '个'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await flush()
    expect(select.value).toBe('个')
    expect(mocks.preview.mock.calls.at(-1)?.[0].commercialGroups[0].entryUnit).toBe('个')
  })
})
const group = {
  id: 1,
  lineKey: 'original',
  kind: 'ordinary',
  warehouseId: 3,
  originalQty: 20,
  targetQty: 20,
  quantity: 20,
  unitPrice: 1.23456,
  amount: 24.69,
  originalAmount: 24.69,
  metadata: {
    input: {
      kind: 'ordinary',
      lineKey: 'original',
      productId: 11,
      warehouseId: 3,
      entryUnit: '包',
      quantity: 2,
      unitPrice: 12.3456,
      priceSource: 'manual'
    },
    entry: { entryUnit: '包', entryQty: 2, entryUnitPrice: 12.3456, conversionRate: 10 }
  },
  components: [{ productId: 11, productCode: 'P', productName: '原包装', unit: '个', baseQty: 1 }]
} as unknown as CommercialGroup
const order = {
  id: 80,
  orderNo: 'SO80',
  commercialModel: 'kit-v1',
  commercialRevision: 7,
  customerId: 1,
  customerName: '客户A',
  warehouseId: 1,
  warehouseName: '仓一',
  commercialGroups: [group],
  items: []
} as unknown as SaleOrder
test('saved initialize retains exact entry/manual quote and separate group warehouse; explicit customer change does not rewrite manual', async () => {
  await mount(async () => {
    expect(document.querySelector<HTMLInputElement>('input[aria-label="原包装数量"]')!.value).toBe('2')
    expect(document.querySelector<HTMLInputElement>('input[aria-label="原包装成交单价"]')!.value).toBe('12.3456')
    await click('选择客户')
    await click('确认客户B')
    await click('保存草稿')
    expect(mocks.execute.mock.calls[0][0].operation.body).toMatchObject({
      expectedRevision: 7,
      customerId: 2,
      commercialGroups: [group.metadata.input]
    })
  }, order)
})
test('execution adjust uses readonly shared header and saved formal preview; no sale.create required', async () => {
  useAuthStore.setState({
    user: { ...useAuthStore.getState().user!, permissions: [PERMISSIONS.SALE_ORDER_UPDATE, PERMISSIONS.PRODUCT_VIEW] }
  })
  await mount(
    async () => {
      expect(document.querySelector('[data-header-readonly]')!.getAttribute('data-header-readonly')).toBe('true')
      expect(mocks.preview.mock.calls[0][2]).toBe(80)
      await click('保存草稿')
      expect(mocks.execute.mock.calls[0][0].operation.action).toBe('adjust')
    },
    order,
    true
  )
})
test('preview failure disables save and editing409 preserves exact draft until explicit copied reload', async () => {
  mocks.preview.mockRejectedValueOnce(new Error('预览失败'))
  await mount(async () => {
    expect(document.body.textContent).toContain('预览失败')
    expect(Array.from(document.querySelectorAll('button')).find((b) => b.textContent === '保存草稿')!.disabled).toBe(
      true
    )
  }, order)
  mocks.preview.mockImplementation(async (b) => fixturePreview(b))
  mocks.execute.mockRejectedValue({ status: 409, message: '版本变化' })
  await mount(async () => {
    await change('原包装成交单价', '15.1234')
    await click('保存草稿')
    expect(document.querySelector<HTMLInputElement>('input[aria-label="原包装成交单价"]')!.value).toBe('15.1234')
    expect(mocks.get).not.toHaveBeenCalled()
    expect(
      Array.from(document.querySelectorAll('button')).find((b) => b.textContent === '重读最新订单')!.disabled
    ).toBe(true)
  }, order)
})
test('customer changes reprice only default ordinary; retained old kit snapshot stays on original version', async () => {
  const oldKit = {
    ...group,
    id: 2,
    lineKey: 'old',
    kind: 'kit',
    kitVersionId: 19,
    kitName: '原停用套',
    kitCode: 'KO',
    originalQty: 2,
    targetQty: 1,
    unitPrice: 100,
    metadata: {
      input: { kind: 'kit', lineKey: 'old', kitVersionId: 19, quantity: 2, warehouseId: 3, priceSource: 'kit_default' },
      entry: null
    }
  } as unknown as CommercialGroup
  const ordinaryDefault = {
    ...group,
    id: 3,
    lineKey: 'ordinary-default',
    originalQty: 1,
    targetQty: 1,
    metadata: {
      input: {
        kind: 'ordinary',
        lineKey: 'ordinary-default',
        productId: 12,
        quantity: 1,
        warehouseId: 1,
        entryUnit: '个',
        priceSource: 'default'
      },
      entry: { entryUnit: '个', entryQty: 1, conversionRate: 1, entryUnitPrice: 10 }
    },
    components: [{ productId: 12, productCode: 'PD', productName: '默认普通', unit: '个', baseQty: 1 }]
  } as unknown as CommercialGroup
  await mount(
    async () => {
      const kitQuote = document.querySelector<HTMLInputElement>('input[aria-label="原停用套成交单价"]')!.value
      await click('选择客户')
      await click('确认客户B')
      expect(document.querySelector<HTMLInputElement>('input[aria-label="默认普通成交单价"]')!.value).toBe('30')
      expect(document.querySelector<HTMLInputElement>('input[aria-label="原包装成交单价"]')!.value).toBe('12.3456')
      expect(document.querySelector<HTMLInputElement>('input[aria-label="原停用套成交单价"]')!.value).toBe(kitQuote)
      await click('保存草稿')
      expect(mocks.execute.mock.calls[0][0].operation.body.commercialGroups).toEqual([
        group.metadata.input,
        { ...oldKit.metadata.input, quantity: 1 },
        ordinaryDefault.metadata.input
      ])
      expect(mocks.get).not.toHaveBeenCalled()
    },
    { ...order, commercialGroups: [group, oldKit, ordinaryDefault] }
  )
})
test('zero default reference is valid preview but blocks formal save until explicit positive quote', async () => {
  mocks.preview.mockImplementation(async (b) => {
    const result = fixturePreview(b)
    result.commercialGroups = result.commercialGroups.map((g) => ({
      ...g,
      unitPrice: g.metadata.input.priceSource === 'manual' ? g.unitPrice : 0
    }))
    return result
  })
  await mount(
    async () => {
      expect(document.body.textContent).toContain('默认报价为零')
      expect(Array.from(document.querySelectorAll('button')).find((b) => b.textContent === '保存草稿')!.disabled).toBe(
        true
      )
    },
    {
      ...order,
      commercialGroups: [
        {
          ...group,
          metadata: {
            ...group.metadata,
            input: {
              kind: 'ordinary',
              lineKey: group.lineKey,
              productId: 11,
              warehouseId: 3,
              entryUnit: '包',
              quantity: 2,
              priceSource: 'default'
            }
          }
        }
      ]
    }
  )
})
test('local return preserves edited draft until explicit discard; continue editing keeps exact input', async () => {
  const done = vi.fn()
  await mount(
    async () => {
      await change('原包装成交单价', '15.1234')
      await click('返回订单')
      expect(done).not.toHaveBeenCalled()
      expect(document.querySelector<HTMLInputElement>('input[aria-label="原包装成交单价"]')!.value).toBe('15.1234')
      await click('继续编辑')
      expect(done).not.toHaveBeenCalled()
      await click('返回订单')
      await click('放弃并返回')
      expect(done).toHaveBeenCalledTimes(1)
    },
    order,
    false,
    done
  )
})
test('unknown request blocks local discard and new-input submission', async () => {
  mocks.execute.mockRejectedValue({ status: 408 })
  await mount(async () => {
    await click('保存草稿')
    expect(Array.from(document.querySelectorAll('button')).find((b) => b.textContent === '返回订单')!.disabled).toBe(
      true
    )
    expect(document.body.textContent).not.toContain('放弃并返回')
    expect(document.querySelector<HTMLInputElement>('input[aria-label="原包装成交单价"]')!.matches(':disabled')).toBe(
      true
    )
  }, order)
})

test('Editor retry late receipt after endpoint switch cannot close or navigate current draft', async () => {
  mocks.execute.mockRejectedValue({ status: 408 })
  let finish!: (v: unknown) => void
  mocks.query.mockImplementation(() => new Promise(resolve => { finish = resolve }))
  const done = vi.fn()
  await mount(async () => {
    await change('原包装成交单价', '15.1234')
    await click('保存草稿')
    const retry = [...document.querySelectorAll('button')].find(b => b.textContent === '按原请求重试')!
    act(() => retry.click())
    mocks.defaults.baseURL = '/b'
    await act(async () => { finish({ status: 'success', resourceType: 'sale_order', resourceId: 80, data: null }); await new Promise(r => setTimeout(r, 5)) })
    expect(done).not.toHaveBeenCalled()
    expect(document.querySelector<HTMLInputElement>('input[aria-label="原包装成交单价"]')!.value).toBe('15.1234')
    expect(document.body.textContent).toContain('原请求结果待确认')
    expect(mocks.execute).toHaveBeenCalledTimes(1)
  }, order, false, done)
})

test('restored or copied Editor record queries only and cannot onDone or reset fresh draft', async () => {
  mocks.execute.mockRejectedValue({ status: 408 })
  await mount(async () => { await click('保存草稿') }, order)
  mocks.query.mockResolvedValue({ status: 'success', resourceType: 'sale_order', resourceId: 80, data: null })
  const done = vi.fn()
  await mount(async () => {
    expect([...document.querySelectorAll('button')].find(b => b.textContent === '按原请求重试')!.disabled).toBe(true)
    await click('查询原操作结果')
    expect(done).not.toHaveBeenCalled()
    expect(document.querySelector<HTMLInputElement>('input[aria-label="原包装成交单价"]')!.value).toBe('12.3456')
    expect(mocks.execute).toHaveBeenCalledTimes(1)
  }, order, false, done)
})

// Use the real SaleFormPage/model gate/page/editor chain for handoff identity.
import SaleFormPage from '@/pages/sale/form'
import { TabPathContext } from '@/components/layout/TabPathContext'
vi.mock('@/api/sale', async original => ({
  ...await original<typeof import('@/api/sale')>(),
  getSaleDetailApi: async (id: number) => ({ ...order, id, orderNo: 'SO' + id, status: 1, totalAmount: 24.69 })
}))
vi.mock('@/pages/sale/commercial/CommercialFulfillmentSummary', () => ({ default: () => null }))
vi.mock('@/pages/sale/form/components/SaleOrderOverview', () => ({ SaleOrderOverview: () => null }))
vi.mock('@/pages/sale/form/components/FulfillmentProgressCard', () => ({ FulfillmentProgressCard: () => null }))
vi.mock('@/components/print/SaleOrderPrintTemplate', () => ({ PrintPreviewOverlay: () => null }))
async function actualGate(run: (setPath: (path: string) => Promise<void>, host: HTMLElement) => Promise<void>, initialPath = '/sale/80') {
  mocks.get.mockImplementation(async (id: number) => ({ ...order, id, orderNo: 'SO' + id, status: 1, totalAmount: 24.69 }))
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host), cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  async function setPath(path: string) {
    await act(async () => root.render(<QueryClientProvider client={cache}><MemoryRouter><TabPathContext.Provider value={path}><SaleFormPage /></TabPathContext.Provider></MemoryRouter></QueryClientProvider>))
    await flush(); await flush()
  }
  try { await setPath(initialPath); await run(setPath, host) }
  finally { act(() => root.unmount()); cache.clear(); host.remove() }
}
test('actual gate handoff preserves editor DOM and 15.1234 draft, then writes original SO normally', async () => {
  await actualGate(async (setPath, host) => {
    await click('编辑订单'); await change('原包装成交单价', '15.1234')
    const input = host.querySelector('input[aria-label="原包装成交单价"]')
    await setPath('/sale/80?focus=progress&taskId=90')
    expect(host.querySelector('input[aria-label="原包装成交单价"]')).toBe(input)
    expect((input as HTMLInputElement).value).toBe('15.1234')
    await click('保存草稿')
    expect(mocks.execute).toHaveBeenCalledTimes(1)
    expect(mocks.execute.mock.calls[0][0].operation.body.commercialGroups[0].unitPrice).toBe(15.1234)
  })
})
test('actual gate handoff retains unknown original key/body and explicit query-first mounted retry', async () => {
  mocks.execute.mockRejectedValueOnce({ status: 408 }).mockResolvedValue({ id: 80 })
  await actualGate(async (setPath, host) => {
    await click('编辑订单'); await change('原包装成交单价', '15.1234'); await click('保存草稿')
    const first = mocks.execute.mock.calls[0][0]
    await setPath('/sale/80?focus=progress&taskId=90')
    expect((host.querySelector('input[aria-label="原包装成交单价"]') as HTMLInputElement).value).toBe('15.1234')
    await click('按原请求重试')
    expect(mocks.query.mock.calls[0][1]).toBe('sale.update.80')
    expect(mocks.execute.mock.calls[1][0]).toEqual(first)
  })
})
test('actual gate reload at handoff path finds original query-only identity without restoring body or closing editor', async () => {
  mocks.execute.mockRejectedValue({ status: 408 })
  await actualGate(async () => { await click('编辑订单'); await change('原包装成交单价', '15.1234'); await click('保存草稿') })
  const first = mocks.execute.mock.calls[0][0]
  mocks.query.mockResolvedValue({ status: 'success', resourceType: 'sale_order', resourceId: 80, data: null })
  await actualGate(async (_, host) => {
    await click('编辑订单')
    expect([...host.querySelectorAll('button')].find(b => b.textContent === '按原请求重试')!.disabled).toBe(true)
    await click('查询原操作结果')
    expect(mocks.query).toHaveBeenCalledWith(first.requestKey, 'sale.update.80', expect.objectContaining({ baseURL: '/a' }))
    expect((host.querySelector('input[aria-label="原包装成交单价"]') as HTMLInputElement).value).toBe('12.3456')
    expect(mocks.execute).toHaveBeenCalledTimes(1)
  }, '/sale/80?focus=progress&taskId=90')
})
test('actual gate different SO creates an independent draft and leaves SO80 unknown query untouched', async () => {
  mocks.execute.mockRejectedValueOnce({ status: 408 }).mockResolvedValue({ id: 81 })
  await actualGate(async (setPath, host) => {
    await click('编辑订单'); await change('原包装成交单价', '15.1234'); await click('保存草稿')
    const original = JSON.parse(sessionStorage.getItem('flowcube-kit-query-records-v1')!).records[0]
    await setPath('/sale/81?focus=progress&taskId=91'); await click('编辑订单')
    expect((host.querySelector('input[aria-label="原包装成交单价"]') as HTMLInputElement).value).toBe('12.3456')
    await click('保存草稿')
    expect(mocks.execute.mock.calls[1][0].operation.id).toBe(81)
    expect(mocks.execute.mock.calls[1][0].requestKey).not.toBe(original.requestKey)
    expect(JSON.parse(sessionStorage.getItem('flowcube-kit-query-records-v1')!).records).toEqual([original])
  })
})
