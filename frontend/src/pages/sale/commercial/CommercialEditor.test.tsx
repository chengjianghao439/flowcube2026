// @vitest-environment jsdom
import { act, useEffect, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, useNavigate, useLocation } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, expect, test, vi } from 'vitest'
import CommercialEditor from './CommercialEditor'
import KeepAliveSection from '@/components/shared/KeepAliveSection'
import SaleFormPage from '../form'
import { TabPathContext } from '@/components/layout/TabPathContext'
import type { SaleOrder } from '@/types/sale'
import type { CommercialBody, CommercialGroup } from '@/types/sale-commercial'
import { useAuthStore } from '@/store/authStore'
import { useWorkspaceStore } from '@/store/workspaceStore'
import { PERMISSIONS } from '@/lib/permission-codes'
import { setApiClientBaseURL } from '@/api/client'
import { toast } from '@/lib/toast'
const mocks = vi.hoisted(() => ({ query: vi.fn(), preview: vi.fn(), execute: vi.fn(), get: vi.fn(), qtyPolicies: vi.fn().mockResolvedValue([]), defaults: { baseURL: '/a' }, apiListeners: new Set<() => void>() }))
vi.mock('@/api/products', async importOriginal => ({ ...await importOriginal<typeof import('@/api/products')>(), getProductQtyPoliciesApi: mocks.qtyPolicies }))
vi.mock('@/api/client', () => ({ default: { defaults: mocks.defaults }, getApiClientBaseURL: () => mocks.defaults.baseURL, subscribeApiClientBaseURL: (fn: () => void) => { mocks.apiListeners.add(fn); return () => mocks.apiListeners.delete(fn) }, setApiClientBaseURL: (url: string) => { if (mocks.defaults.baseURL !== url) { mocks.defaults.baseURL = url; mocks.apiListeners.forEach(fn => fn()) } } }))
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
    receiverPhone: string
    setReceiverPhone: (value: string) => void
    phoneError?: string
    setCustomerFinderOpen: (b: boolean) => void
    setWarehouseId: (s: string) => void
    setWarehouseName: (s: string) => void
  }) => (
    <div data-header-readonly={p.headerReadOnly}>
      <div data-entry-field="phone"><input aria-label="联系电话" value={p.receiverPhone} onChange={e => p.setReceiverPhone(e.target.value)} />{p.phoneError && <p role="alert">{p.phoneError}</p>}</div>
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
  ProductFinder: () => null,
  CustomerFinder: ({ onConfirm }: { onConfirm: (c: unknown) => void }) => (
    <><button onClick={() => onConfirm({ id: 2, name: '客户B' })}>确认客户B</button><button onClick={() => onConfirm({ id: 3, name: '客户C' })}>确认客户C</button></>
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
              spec: 'M12', color: '银色', articleNumber: 'SUP-12', costPrice: 2,
              unit: name === '包装' ? '包' : kind === 'kit' ? '套' : '个',
              quantity: name === '包装' ? '2' : '1',
              price: name === 'A' ? '100' : name === 'B' ? '200' : name === '包装' ? '12.3456' : '',
              units: kind === 'ordinary' ? [{ unitName: '包', conversionRate: 10 }] : [],
              ...(kind === 'kit' ? { components: [
                { productId: 11, productCode: 'P11', productName: '共享铰链', spec: 'H-20', color: '本色', articleNumber: 'ART-11', baseQty: 1, unit: '个' },
                { productId: 12, productCode: 'P12', productName: '螺钉', spec: 'M4×12', color: '黑色', articleNumber: 'ART-12', baseQty: 4, unit: '个' },
              ] } : {}),
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
    priceSource: input.priceSource,
    warehouseId: input.warehouseId ?? b.warehouseId,
    quantity: input.quantity * (input.lineKey === '包装' ? 10 : 1),
    unitPrice: input.unitPrice ?? (input.kind === 'kit' ? 100 : b.customerId === 2 ? 30 : 10),
    amount: input.lineKey === '包装' ? 24.69 : (input.unitPrice ?? (b.customerId === 2 ? 30 : 10)),
    metadata: {
      priceCustomerId: b.customerId,
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
    components: input.kind === 'ordinary' ? [{ productId: input.productId, productCode: `P${input.productId}`, productName: input.lineKey, baseQty: 1, unit: '个', spec: 'M12', color: '银色', articleNumber: 'SUP-12' }] : [
      { productId: 11, productCode: 'P11', productName: '共享铰链', spec: 'H-20', color: '本色', articleNumber: 'ART-11', baseQty: 1, unit: '个' },
      { productId: 12, productCode: 'P12', productName: '螺钉', spec: 'M4×12', color: '黑色', articleNumber: 'ART-12', baseQty: 4, unit: '个' }
    ]
  })) as unknown as CommercialGroup[]
  return {
    customerId: b.customerId, warehouseId: b.warehouseId,
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
  mocks.qtyPolicies.mockResolvedValue([])
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
      permissions: [PERMISSIONS.SALE_ORDER_CREATE, PERMISSIONS.SALE_ORDER_UPDATE, PERMISSIONS.SALE_ORDER_VIEW, PERMISSIONS.PRODUCT_VIEW]
    }
  })
})
async function flush() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 3))
  })
}
async function click(name: string) {
  const b = Array.from(document.querySelectorAll('button')).find((b) => name === '保存草稿' ? ['保存草稿', '保存修改', '提交改单'].includes(b.textContent ?? '') : name === '返回订单' ? ['返回订单', '取消编辑', '取消'].includes(b.textContent ?? '') : b.textContent === name)
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
async function mount(run: () => Promise<void>, order?: SaleOrder, adjust = false, onDone: () => void = () => {}, unified = false) {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host),
    cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  try {
    await act(async () => {
      root.render(
        <QueryClientProvider client={cache}>
          <MemoryRouter initialEntries={[unified ? '/sale/new' : '/']}>
            {unified ? <TabPathContext.Provider value="/sale/new"><SaleFormPage /></TabPathContext.Provider> : <CommercialEditor
              order={order}
              owner={owner}
              tabPath={order ? `/sale/${order.id}` : '/sale/new-kit'}
              adjust={adjust}
              onDone={onDone}
            />}
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
    await click('添加套装')
    await click('选A')
    await click('添加套装')
    await click('选B')
    await click('添加商品')
    await click('选普通')
    await click('添加商品')
    await click('选包装')
    expect(document.body.textContent).not.toContain('整单供货预览')
    expect(mocks.preview.mock.results.at(-1)).toBeDefined()
    expect(mocks.preview).toHaveBeenCalled()
    expect(document.body.textContent).not.toContain('ACTIVE')
    expect(document.body.textContent).not.toContain('物理向量')
    expect(document.body.textContent).not.toContain('当前现货不足')
    expect(document.body.textContent).not.toContain('缺货明细')
    expect(document.body.querySelector('[data-stock-shortage]')).toBeNull()
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
test('kit unit follows authoritative preview after current master unit changes', async () => {
  mocks.preview.mockImplementation(async (body) => {
    const preview = fixturePreview(body)
    for (const group of preview.commercialGroups) if (group.kind === 'kit') group.metadata.kitUnit = '箱'
    return preview
  })
  await mount(async () => {
    await click('选择客户')
    await click('确认客户B')
    await click('选择仓库')
    await click('添加套装')
    await click('选A')
    const quantity = document.querySelector<HTMLInputElement>('input[aria-label="A数量"]')!
    const row = quantity.closest('tr')!
    expect(row.cells[2].textContent).toBe('箱')
  })
})
test('成套录入直接显示全部配件，输入套数即时更新子量，保存仍只提交原成交组', async () => {
  await mount(async () => {
    await click('选择客户'); await click('确认客户B'); await click('选择仓库'); await click('添加套装'); await click('选A')
    const children = () => [...document.querySelectorAll('[data-sale-kit-line="component"]')].map(e => e.closest('tr')!)
    expect(children()).toHaveLength(2)
    expect(children().map(row => row.cells[1].textContent)).toEqual(['1', '4'])
    await change('A数量', '3')
    expect(children().map(row => row.cells[1].textContent)).toEqual(['3', '12'])
    for (const child of children()) {
      expect(child.cells).toHaveLength(7)
      expect(child.cells[3].textContent).toBe('—'); expect(child.cells[4].textContent).toBe('—')
      expect(child.querySelectorAll('input,button,select')).toHaveLength(0)
    }
    await change('A数量', '')
    expect(children()).toHaveLength(2)
    expect(children().map(row => row.cells[1].textContent)).toEqual(['—', '—'])
    await change('A数量', '2'); await change('A备注', '分两箱装'); await click('保存草稿')
    expect(mocks.execute.mock.calls[0][0].operation.body.commercialGroups).toEqual([{ kind: 'kit', lineKey: 'A', warehouseId: 1, kitVersionId: 19, quantity: 2, priceSource: 'manual', unitPrice: 100, remark: '分两箱装' }])
  })
})
test('fresh ordinary auxiliary selection preserves known basic unit so a mistaken package choice can be changed back', async () => {
  await mount(async () => {
    await click('选择客户')
    await click('确认客户B')
    await click('选择仓库')
    await click('添加商品')
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
    expect(Array.from(document.querySelectorAll('button')).find((b) => ['保存草稿', '保存修改', '提交改单'].includes(b.textContent ?? ''))!.disabled).toBe(
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
      expect(Array.from(document.querySelectorAll('button')).find((b) => ['保存草稿', '保存修改', '提交改单'].includes(b.textContent ?? ''))!.disabled).toBe(
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
    expect(Array.from(document.querySelectorAll('button')).find((b) => ['返回订单', '取消编辑', '取消'].includes(b.textContent ?? ''))!.disabled).toBe(
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
vi.mock('@/api/sale', async original => ({
  ...await original<typeof import('@/api/sale')>(),
  getSaleDetailApi: async (id: number) => ({ ...order, id, orderNo: 'SO' + id, status: 1, totalAmount: 24.69 })
}))
vi.mock('@/pages/sale/commercial/CommercialFulfillmentSummary', () => ({ default: () => null }))
vi.mock('@/pages/sale/form/components/SaleOrderOverview', () => ({ SaleOrderOverview: () => null }))
vi.mock('@/pages/sale/form/components/FulfillmentProgressCard', () => ({ FulfillmentProgressCard: () => null }))
vi.mock('@/components/print/SaleOrderPrintTemplate', () => ({ PrintPreviewOverlay: () => null }))
function GateRoute({ path, active }: { path: string; active: boolean }) {
  const navigate = useNavigate()
  const navigation = useRef(navigate)
  navigation.current = navigate
  useEffect(() => { navigation.current(path) }, [path])
  const location = useLocation()
  return <><output data-route>{location.pathname + location.search}</output><KeepAliveSection active={active}><TabPathContext.Provider value={path}><SaleFormPage /></TabPathContext.Provider></KeepAliveSection></>
}
async function actualGate(run: (setPath: (path: string, active?: boolean) => Promise<void>, host: HTMLElement) => Promise<void>, initialPath = '/sale/80') {
  mocks.get.mockImplementation(async (id: number) => ({ ...order, id, orderNo: 'SO' + id, status: 1, totalAmount: 24.69 }))
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host), cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  async function setPath(path: string, active = true) {
    await act(async () => root.render(<QueryClientProvider client={cache}><MemoryRouter initialEntries={[initialPath]}><GateRoute path={path} active={active} /></MemoryRouter></QueryClientProvider>))
    await flush(); await flush()
  }
  try { await setPath(initialPath); await run(setPath, host) }
  finally { act(() => root.unmount()); cache.clear(); host.remove() }
}
test('actual gate handoff preserves editor DOM and 15.1234 draft, then writes original SO normally', async () => {
  await actualGate(async (setPath, host) => {
    await click('编辑'); await change('原包装成交单价', '15.1234')
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
    await click('编辑'); await change('原包装成交单价', '15.1234'); await click('保存草稿')
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
  await actualGate(async () => { await click('编辑'); await change('原包装成交单价', '15.1234'); await click('保存草稿') })
  const first = mocks.execute.mock.calls[0][0]
  mocks.query.mockResolvedValue({ status: 'success', resourceType: 'sale_order', resourceId: 80, data: null })
  await actualGate(async (_, host) => {
    await click('编辑')
    expect([...host.querySelectorAll('button')].find(b => b.textContent === '按原请求重试')!.disabled).toBe(true)
    await click('查询原操作结果')
    expect(mocks.query).toHaveBeenCalledWith(first.requestKey, 'sale.update.80', expect.objectContaining({ baseURL: '/a' }))
    expect(host.textContent).toContain('查看已保存销售单')
    expect(host.textContent).toContain('SO80')
    expect((host.querySelector('input[aria-label="原包装成交单价"]') as HTMLInputElement).value).toBe('12.3456')
    expect(mocks.execute).toHaveBeenCalledTimes(1)
    await click('查看已保存销售单')
    expect(host.querySelector('input[aria-label="原包装成交单价"]')).toBeNull()
    expect(host.textContent).toContain('编辑')
  }, '/sale/80?focus=progress&taskId=90')
})
test('actual gate different SO creates an independent draft and leaves SO80 unknown query untouched', async () => {
  mocks.execute.mockRejectedValueOnce({ status: 408 }).mockResolvedValue({ id: 81 })
  await actualGate(async (setPath, host) => {
    await click('编辑'); await change('原包装成交单价', '15.1234'); await click('保存草稿')
    const original = JSON.parse(sessionStorage.getItem('flowcube-kit-query-records-v1')!).records[0]
    await setPath('/sale/81?focus=progress&taskId=91'); await click('编辑')
    expect((host.querySelector('input[aria-label="原包装成交单价"]') as HTMLInputElement).value).toBe('12.3456')
    await click('保存草稿')
    expect(mocks.execute.mock.calls[1][0].operation.id).toBe(81)
    expect(mocks.execute.mock.calls[1][0].requestKey).not.toBe(original.requestKey)
    expect(JSON.parse(sessionStorage.getItem('flowcube-kit-query-records-v1')!).records).toEqual([original])
  })
})


test('standard new sale opens the shared editor and saves ordinary plus kit as separate commercial groups', async () => {
  await mount(async () => {
    expect(document.body.textContent).toContain('新建销售单')
    await click('选择客户'); await click('确认客户B'); await click('选择仓库')
    await click('添加商品'); await click('选普通')
    await click('添加套装'); await click('选A')
    expect(document.querySelectorAll('[data-sale-entry-items] tbody tr')).toHaveLength(4)
    expect(document.querySelectorAll('[data-sale-kit-line="component"]')).toHaveLength(2)
    await click('保存草稿')
    expect(mocks.execute.mock.calls[0][0].operation.body).toMatchObject({
      commercialModel: 'kit-v1', commercialGroups: [{ kind: 'ordinary', productId: 11 }, { kind: 'kit', kitVersionId: 19 }]
    })
  }, undefined, false, () => {}, true)
})
test('standard new sale with ordinary auxiliary manual price keeps ordinary saving and the exact entry price', async () => {
  await mount(async () => {
    await click('选择客户'); await click('确认客户B'); await click('选择仓库')
    await click('添加商品'); await click('选包装')
    await click('保存草稿')
    const body = mocks.execute.mock.calls[0][0].operation.body
    expect(body.commercialModel).toBeUndefined()
    expect(body.commercialGroups).toBeUndefined()
    expect(body.items).toMatchObject([{ productId: 12, entryUnit: '包', quantity: 2, unitPrice: 12.3456, priceSource: 'manual' }])
    expect(JSON.stringify(body)).not.toContain('priceIsBase')
  }, undefined, false, () => {}, true)
})

test('shared new rows retain product identity, base quantity, below-cost hint and discounted total with Enter navigation', async () => {
  await mount(async () => {
    await click('选择客户'); await click('确认客户B'); await click('选择仓库')
    await click('添加商品'); await click('选包装')
    expect(document.body.textContent).toContain('M12')
    expect(document.body.textContent).toContain('银色')
    expect(document.body.textContent).toContain('SUP-12')
    expect(document.body.textContent).toContain('折合 20个')
    expect(document.body.textContent).toContain('低于进价')
    await change('折扣金额', '2')
    expect(document.body.textContent).toContain('订单金额¥22.69')
    const quantity = document.querySelector<HTMLInputElement>('input[aria-label="包装数量"]')!
    quantity.focus()
    await act(async () => quantity.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
    expect(document.activeElement).toBe(document.querySelector('input[aria-label="包装成交单价"]'))
  }, undefined, false, () => {}, true)
})
test('配件子行在未选客户、报价后和临时无效套数时保留完整商品身份', async () => {
  await mount(async () => {
    await click('选择仓库'); await click('添加套装'); await click('选A')
    const identities = () => [...document.querySelectorAll('[data-sale-kit-line="component"]')].map(row => row.textContent)
    const complete = ['P11共享铰链型号 H-20 · 颜色 本色 · 供应商型号 ART-11', 'P12螺钉型号 M4×12 · 颜色 黑色 · 供应商型号 ART-12']
    expect(identities()).toEqual(complete)
    expect(mocks.preview).not.toHaveBeenCalled()
    await click('选择客户'); await click('确认客户B')
    expect(identities()).toEqual(complete)
    await change('A数量', '')
    expect(identities()).toEqual(complete)
    const children = [...document.querySelectorAll('[data-sale-kit-line="component"]')].map(row => row.closest('tr')!)
    expect(children.map(row => row.cells[1].textContent)).toEqual(['—', '—'])
    expect(children.map(row => row.cells[3].textContent)).toEqual(['—', '—'])
    expect(mocks.execute).not.toHaveBeenCalled()
  }, undefined, false, () => {}, true)
})

test('standard new customer change resets ordinary manual quote to the new customer default while keeping kit manual quote', async () => {
  await mount(async () => {
    await click('选择客户'); await click('确认客户B'); await click('选择仓库')
    await click('添加商品'); await click('选包装')
    await click('添加套装'); await click('选A')
    await click('选择客户'); await click('确认客户C')
    expect(document.querySelector<HTMLInputElement>('input[aria-label="包装成交单价"]')?.value).toBe('10')
    expect(document.querySelector<HTMLInputElement>('input[aria-label="A成交单价"]')?.value).toBe('100')
    expect(mocks.preview.mock.calls.at(-1)?.[0].commercialGroups[0].priceSource).toBe('default')
  }, undefined, false, () => {}, true)
})


test('shared new entry retains the saved draft when receipt arrives after hide/show and requires explicit navigation', async () => {
  let finish!: (value: unknown) => void
  mocks.execute.mockImplementation(() => new Promise(resolve => { finish = resolve }))
  await actualGate(async (setPath, host) => {
    await click('选择客户'); await click('确认客户B'); await click('选择仓库')
    await click('添加商品'); await click('选包装'); await click('保存草稿')
    expect(mocks.execute).toHaveBeenCalledTimes(1)
    await setPath('/sale/new', false); await setPath('/sale/new', true)
    await act(async () => { finish({ id: 80 }); await Promise.resolve() }); await flush()
    expect(host.querySelector('[data-route]')?.textContent).toBe('/sale/new')
    expect(host.querySelector<HTMLInputElement>('[aria-label="包装成交单价"]')?.value).toBe('12.3456')
    expect([...host.querySelectorAll('button')].find(b => ['保存草稿', '保存修改', '提交改单'].includes(b.textContent ?? ''))!.disabled).toBe(true)
    await click('查看已保存销售单')
    expect(host.querySelector('[data-route]')?.textContent).toBe('/sale/80')
  }, '/sale/new')
})


test('shared blank create preserves original key and body when saved ACK arrives after server A to B to A', async () => {
  let finish!: (value: unknown) => void
  mocks.execute.mockImplementation(() => new Promise(resolve => { finish = resolve }))
  await actualGate(async (_, host) => {
    await click('选择客户'); await click('确认客户B'); await click('选择仓库')
    await click('添加商品'); await click('选包装'); await click('保存草稿')
    const stored = sessionStorage.getItem('flowcube-kit-query-records-v1')
    const original = mocks.execute.mock.calls[0][0]
    await act(async () => { setApiClientBaseURL('/b'); setApiClientBaseURL('/a'); finish({ id: 80 }); await Promise.resolve() }); await flush()
    expect(host.querySelector('[data-route]')?.textContent).toBe('/sale/new')
    expect(host.textContent).toContain('原请求结果待确认')
    expect(host.querySelector<HTMLInputElement>('[aria-label="包装成交单价"]')?.value).toBe('12.3456')
    expect(sessionStorage.getItem('flowcube-kit-query-records-v1')).toBe(stored)
    await click('按原请求重试')
    expect(mocks.query).not.toHaveBeenCalled()
    expect(mocks.execute).toHaveBeenCalledTimes(1)
    expect(mocks.execute.mock.calls[0][0]).toEqual(original)
  }, '/sale/new')
})

test('shared blank preview cannot apply a late quote after server A to B to A', async () => {
  let finish!: () => void
  mocks.preview.mockImplementation(b => new Promise(resolve => { finish = () => resolve(fixturePreview(b)) }))
  await actualGate(async (_, host) => {
    await click('选择客户'); await click('确认客户B'); await click('选择仓库')
    await click('添加商品'); await click('选包装')
    expect(finish).toBeTruthy()
    await act(async () => { setApiClientBaseURL('/b'); setApiClientBaseURL('/a'); finish(); await Promise.resolve() }); await flush()
    expect([...host.querySelectorAll('button')].find(b => ['保存草稿', '保存修改', '提交改单'].includes(b.textContent ?? ''))!.disabled).toBe(true)
    expect(host.textContent).toContain('原草稿保留')
    expect(host.querySelector<HTMLInputElement>('[aria-label="包装数量"]')?.value).toBe('2')
    expect(mocks.execute).not.toHaveBeenCalled()
  }, '/sale/new')
})


test('standard blank create accepts normal token renewal in the same session and applies its saved receipt', async () => {
  let finish!: (value: unknown) => void
  mocks.execute.mockImplementation(() => new Promise(resolve => { finish = resolve }))
  await actualGate(async (_, host) => {
    await click('选择客户'); await click('确认客户B'); await click('选择仓库')
    await click('添加商品'); await click('选包装'); await click('保存草稿')
    const session = useAuthStore.getState().sessionGeneration
    await act(async () => { useAuthStore.getState().setTokens('renewed-test-only', null); finish({ id: 80 }); await Promise.resolve() }); await flush()
    expect(useAuthStore.getState().sessionGeneration).toBe(session)
    expect(host.querySelector('[data-route]')?.textContent).toBe('/sale/80')
    expect(host.textContent).not.toContain('原请求结果待确认')
    expect(mocks.execute).toHaveBeenCalledTimes(1)
  }, '/sale/new')
})


test('shared new order reports an excessive discount and focuses its field without writing', async () => {
  await mount(async () => {
    await click('选择客户'); await click('确认客户B'); await click('选择仓库')
    await click('添加商品'); await click('选包装')
    await change('折扣金额', '30'); await click('保存草稿')
    const alert = document.querySelector('[role="alert"]')!
    expect(alert.textContent).toContain('折扣金额不能超过商品金额')
    expect(alert.closest('[data-entry-field]')?.getAttribute('data-entry-field')).toBe('discount')
    expect(document.querySelectorAll('[role="alert"]')).toHaveLength(1)
    expect(document.activeElement).toBe(document.querySelector('[aria-label="折扣金额"]'))
    expect(mocks.execute).not.toHaveBeenCalled()
  }, undefined, false, () => {}, true)
})

test('entry sample has a useful empty state and keeps missing lines beside the add action', async () => {
  await mount(async () => {
    expect(document.body.textContent).toContain('尚未添加商品')
    expect(document.body.textContent).not.toContain('普通商品与成套配件可在同一张订单销售')
    await click('保存草稿')
    expect(document.querySelector('[data-entry-field="add"]')?.textContent).toContain('请添加至少一条商品明细')
    expect(document.body.textContent).not.toContain('处需要处理，点击可定位')
    expect(mocks.execute).not.toHaveBeenCalled()
  }, undefined, false, () => {}, true)
})

test('entry sample collapses general supply explanations but keeps server prices and full totals', async () => {
  mocks.preview.mockImplementation(async body => {
    const result = fixturePreview(body)
    result.commercialGroups = result.commercialGroups.map(item => ({ ...item, amount: Number((item.metadata.entry!.entryQty * item.metadata.entry!.entryUnitPrice).toFixed(2)) }))
    result.amount = result.commercialGroups.reduce((sum, item) => sum + item.amount, 0)
    return result
  })
  await mount(async () => {
    expect(document.body.textContent).not.toContain('整单供货预览')
    expect(document.body.textContent).not.toContain('普通商品与成套配件可在同一张订单销售')
    expect(document.querySelector('[aria-label="金额汇总"]')?.textContent).toContain('¥24.69')
    expect(document.querySelector('[aria-label="金额汇总"]')?.textContent).not.toContain('商品金额')
    expect([...document.querySelectorAll('th')].map(header => header.textContent)).not.toContain('价格来源')
    expect(document.body.textContent).not.toContain('用默认价')
    await change('原包装成交单价', '15.1234')
    expect(document.querySelector('[aria-label="金额汇总"]')?.textContent).toContain('¥30.25')
    await click('保存草稿')
    expect(mocks.execute.mock.calls[0][0].operation.body.commercialGroups[0].unitPrice).toBe(15.1234)
  }, order)
})


test('saved mixed editor shows invalid phone and negative discount locally even while save is disabled', async () => {
  await mount(async () => {
    await change('联系电话', 'invalid-phone')
    let alerts = [...document.querySelectorAll('[role="alert"]')]
    expect(alerts.map(a => a.textContent)).toContain('联系电话格式不正确')
    expect(alerts.find(a => a.textContent === '联系电话格式不正确')?.closest('[data-entry-field]')?.getAttribute('data-entry-field')).toBe('phone')
    expect([...document.querySelectorAll('button')].find(b => ['保存草稿', '保存修改', '提交改单'].includes(b.textContent ?? ''))!.disabled).toBe(true)
    await change('联系电话', '')
    await change('折扣金额', '-1')
    alerts = [...document.querySelectorAll('[role="alert"]')]
    expect(alerts.map(a => a.textContent)).toContain('折扣金额须为非负数')
    expect(alerts.find(a => a.textContent === '折扣金额须为非负数')?.closest('[data-entry-field]')?.getAttribute('data-entry-field')).toBe('discount')
    expect(mocks.execute).not.toHaveBeenCalled()
  }, order)
})


test('new order invalid row quantity is local after save and correction clears it without writing', async () => {
  await mount(async () => {
    await click('选择客户'); await click('确认客户B'); await click('选择仓库')
    await click('添加商品'); await click('选普通')
    await change('普通数量', '0')
    expect(document.querySelector('[role="alert"]')).toBeNull()
    await click('保存草稿')
    const alerts = [...document.querySelectorAll('[role="alert"]')]
    expect(alerts).toHaveLength(1)
    expect(alerts[0].textContent).toContain('数量须大于零')
    expect(alerts[0].closest('[data-entry-field]')?.getAttribute('data-entry-field')).toBe('item-普通-quantity')
    expect(document.activeElement?.getAttribute('aria-label')).toBe('普通数量')
    expect(mocks.execute).not.toHaveBeenCalled()
    await change('普通数量', '1')
    expect(document.querySelector('[role="alert"]')).toBeNull()
  }, undefined, false, undefined, true)
})

test('成套编辑沿普通编辑标题、保存操作、商品列和汇总，不增加成交依据展开项', async () => {
  await mount(async () => {
    expect(document.body.textContent).toContain(`${order.orderNo} · 编辑`)
    const buttons = [...document.querySelectorAll('button')].map(button => button.textContent)
    expect(buttons).toContain('保存修改')
    expect(buttons).toContain('取消编辑')
    expect(document.body.textContent).toContain('商品明细')
    expect([...document.querySelectorAll('th')].map(th => th.textContent)).toContain('单价 (¥)')
    expect(document.body.textContent).toContain('基本数量')
    expect(document.body.textContent).not.toContain('基本量是否支持小数尚未核对')
    expect(document.body.textContent).not.toContain('可保存草稿；发货前仍需')
    expect(document.querySelector('button[aria-label="删除商品行"]')).not.toBeNull()
    await change('原包装数量', '1')
    expect(document.querySelector('[data-sale-entry-items] details')).toBeNull()
    expect(document.querySelector('[data-sale-entry-items]')?.textContent).not.toContain('成交依据')
    expect(mocks.execute).not.toHaveBeenCalled()
  }, order)
})

test('200个成套展开600行仍虚拟挂载，全量汇总和输入保留，Enter可定位屏幕外主行', async () => {
  mocks.preview.mockImplementation(async body => {
    const result = fixturePreview(body)
    result.commercialGroups = result.commercialGroups.map(item => ({ ...item, amount: item.unitPrice * item.quantity }))
    result.amount = result.commercialGroups.reduce((sum, item) => sum + item.amount, 0)
    return result
  })
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) { return this.getAttribute('aria-label') === '销售录入明细' ? 480 : 0 })
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) { return this.getAttribute('aria-label') === '销售录入明细' ? 480 : 0 })
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function (this: HTMLElement) { return this.getAttribute('aria-label') === '销售录入明细' ? 600 * 48 : 0 })
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(1200)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const scroll = document.querySelector<HTMLElement>('[aria-label="销售录入明细"]')
    const height = this === scroll ? 480 : this.tagName === 'TR' ? 48 : 0
    return { height, width: 1200, top: this === scroll ? 0 : -(scroll?.scrollTop ?? 0), left: 0, bottom: height, right: 1200, x: 0, y: 0, toJSON() {} }
  })
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  const groups = Array.from({ length: 200 }, (_, index) => ({
    ...group, id: index + 1, kind: 'kit', lineKey: `kit-${index}`, kitVersionId: 19,
    kitCode: `K${index}`, kitName: `套装${index + 1}`, originalQty: 1, targetQty: 1, unitPrice: 100, amount: 100, originalAmount: 100,
    metadata: { entry: null, input: { kind: 'kit', lineKey: `kit-${index}`, kitVersionId: 19, warehouseId: 1, quantity: 1, priceSource: 'kit_default' } },
    components: [{ productId: 11, productCode: 'P11', productName: '共享铰链', baseQty: 1, unit: '个' }, { productId: 12, productCode: 'P12', productName: '螺钉', baseQty: 4, unit: '个' }],
  })) as CommercialGroup[]
  try {
    await mount(async () => {
      const scroll = document.querySelector<HTMLElement>('[aria-label="销售录入明细"]')!
      scroll.scrollTo = vi.fn((options: ScrollToOptions) => { scroll.scrollTop = options.top ?? 0; scroll.dispatchEvent(new Event('scroll')) }) as typeof scroll.scrollTo
      const mountedRows = () => scroll.querySelectorAll('tbody tr:not([aria-hidden])')
      expect(scroll.querySelector('table')?.getAttribute('aria-rowcount')).toBe('601')
      expect(mountedRows().length).toBeGreaterThan(0); expect(mountedRows().length).toBeLessThan(50)
      expect(document.querySelector('[aria-label="金额汇总"]')?.textContent).toContain('¥20,000.00')
      await change('套装1数量', '3')
      await act(async () => { scroll.scrollTop = 600 * 48 - 480; scroll.dispatchEvent(new Event('scroll')) })
      expect(document.querySelector('input[aria-label="套装1数量"]')).toBeNull()
      expect(scroll.textContent).toContain('套装200')
      expect(mountedRows().length).toBeLessThan(50)
      const discount = document.querySelector<HTMLInputElement>('input[aria-label="折扣金额"]')!
      discount.focus()
      await act(async () => { discount.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true })) })
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 40)) })
      expect({ focus: document.activeElement?.getAttribute('aria-label'), scrollTop: scroll.scrollTop, endMounted: !!document.querySelector('input[aria-label="套装200成交单价"]'), lastScroll: vi.mocked(scroll.scrollTo).mock.calls.at(-1) }).toMatchObject({ focus: '套装200成交单价', endMounted: true })
      await act(async () => { document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true })) })
      expect(document.activeElement?.getAttribute('aria-label')).toBe('套装200数量')
      await change('套装200数量', '3')
      expect([...scroll.querySelectorAll('[data-sale-kit-line="component"][data-sale-kit-group="kit-199"]')].map(element => element.closest('tr')?.cells[1].textContent)).toEqual(['3', '12'])
      // 等虚拟列表的一帧定位校准结束，再模拟下一次手工滚动。
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 40)) })
      await act(async () => { scroll.scrollTop = 0; scroll.dispatchEvent(new Event('scroll')) })
      expect(document.querySelector<HTMLInputElement>('input[aria-label="套装1数量"]')?.value).toBe('3')
      discount.focus()
      await act(async () => { discount.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true })) })
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 40)) })
      expect({ focus: document.activeElement?.getAttribute('aria-label'), scrollTop: scroll.scrollTop, endMounted: !!document.querySelector('input[aria-label="套装200成交单价"]'), lastScroll: vi.mocked(scroll.scrollTo).mock.calls.at(-1) }).toMatchObject({ focus: '套装200成交单价', endMounted: true })
      await click('保存草稿')
      const inputs = mocks.execute.mock.calls[0][0].operation.body.commercialGroups
      expect(inputs).toHaveLength(200)
      expect(inputs[0].quantity).toBe(3); expect(inputs[199].quantity).toBe(3)
      expect(inputs.every((input: object) => !('components' in input))).toBe(true)
    }, { ...order, commercialGroups: groups })
  } finally { vi.restoreAllMocks(); vi.unstubAllGlobals() }
})

test('实际商业读取链从列表直接编辑，只消费一次交接，已有四位价草稿不被重建', async () => {
  await actualGate(async (setPath, host) => {
    const input = host.querySelector<HTMLInputElement>('input[aria-label="原包装成交单价"]')
    expect(input).not.toBeNull()
    expect(host.querySelector('[data-route]')?.textContent).toBe('/sale/80')
    await change('原包装成交单价', '15.1234')
    await setPath('/sale/80?edit=1', false)
    await setPath('/sale/80?edit=1')
    expect(host.querySelector('input[aria-label="原包装成交单价"]')).toBe(input)
    expect(input!.value).toBe('15.1234')
    expect(mocks.execute).not.toHaveBeenCalled()
  }, '/sale/80?edit=1')
})

test('legacy ordinary editor can add a kit without replacing original quantity, quote or remark', async () => {
  const ordinary={id:80,orderNo:'XS-80',customerId:2,customerName:'客户B',warehouseId:1,warehouseName:'仓1',status:1,discountAmount:0,editFingerprint:'a'.repeat(64),items:[{id:91,productId:11,productCode:'P11',productName:'旧普通行',unit:'个',entryUnit:'个',entryQty:3,quantity:3,conversionRate:1,unitPrice:21.1234,amount:63.37,remark:'原备注',warehouseId:1}]} as SaleOrder
  await mount(async () => {
    expect((document.querySelector('input[aria-label="旧普通行成交单价"]') as HTMLInputElement).value).toBe('21.1234')
    await click('添加套装');await click('选A')
    await click('保存草稿')
    const operation=mocks.execute.mock.calls[0][0].operation
    expect(operation.action).toBe('update');expect(operation.id).toBe(80)
    expect(operation.body.expectedRevision).toBe(0);expect(operation.body.expectedEditFingerprint).toBe('a'.repeat(64))
    expect(operation.body.commercialGroups).toHaveLength(2)
    expect(operation.body.commercialGroups[0]).toMatchObject({lineKey:'ordinary:91',kind:'ordinary',quantity:3,unitPrice:21.1234,remark:'原备注'})
    expect(operation.body.commercialGroups[1].kind).toBe('kit')
  },ordinary)
})

test('saved ordinary rows reuse the batch quantity policy and reject fractional input without changing the draft', async () => {
  mocks.qtyPolicies.mockResolvedValue([{ id: 11, allowDecimal: false }])
  const rejected = vi.spyOn(toast, 'error')
  const ordinary = { id: 80, customerId: 2, customerName: '客户B', warehouseId: 1, warehouseName: '仓1', status: 1,
    items: [{ id: 91, productId: 11, productName: '整数商品', productCode: 'P11', unit: '个', quantity: 3, unitPrice: 21, warehouseId: 1 }] } as SaleOrder
  try {
    await mount(async () => {
      const quantity = document.querySelector<HTMLInputElement>('input[aria-label="整数商品数量"]')!
      expect(quantity.step).toBe('1')
      expect(mocks.qtyPolicies).toHaveBeenCalledWith([11], expect.objectContaining({ baseURL: '/a', signal: expect.any(AbortSignal) }))
      await change('整数商品数量', '1.5')
      expect(quantity.value).toBe('3')
      expect(rejected).toHaveBeenCalledWith(expect.stringContaining('整数'))
      expect(mocks.execute).not.toHaveBeenCalled()
    }, ordinary)
  } finally { rejected.mockRestore(); mocks.qtyPolicies.mockResolvedValue([]) }
})


test.each(['/sale/new', '/sale/new-kit'])('query-only create receipt opens detail and retains %s draft tab', async path => {
  mocks.execute.mockRejectedValue({ status: 408 })
  await actualGate(async () => {
    await click('选择客户'); await click('确认客户B'); await click('选择仓库')
    await click('添加商品'); await click('选包装'); await click('保存草稿')
  }, path)
  useWorkspaceStore.setState({ tabs: [{ key: path, path, title: '新建销售单', closable: true }], activeKey: path })
  mocks.query.mockResolvedValue({ status: 'success', resourceType: 'sale_order', resourceId: 80, data: { id: 80, orderNo: 'SO80' } })
  await actualGate(async (_, host) => {
    await click('查询原操作结果')
    expect(host.textContent).toContain('SO80')
    await click('查看已保存销售单')
    expect(host.querySelector('[data-route]')?.textContent).toBe('/sale/80')
    expect(useWorkspaceStore.getState().tabs.map(tab => tab.key)).toEqual([path, '/sale/80'])
    expect(mocks.execute).toHaveBeenCalledTimes(1)
  }, path)
})


test('compatible new kit entry keeps empty required fields quiet before validation', async () => {
  await mount(async () => {
    expect(document.body.textContent).toContain('新建销售单')
    expect(document.body.textContent).not.toContain('请选择客户和出库仓库')
    expect(document.querySelector('[role="alert"]')).toBeNull()
  })
})


test('query-only pending adjustment keeps warehouse confirmation status and live view permission', async () => {
  mocks.execute.mockRejectedValue({ status: 408 })
  await mount(async () => { await click('保存草稿') }, order, true)
  mocks.query.mockResolvedValue({ status: 'success', resourceType: 'sale_order', resourceId: order.id, data: { id: order.id, pending: true } })
  const done = vi.fn()
  await mount(async () => {
    await click('查询原操作结果')
    expect(document.body.textContent).toContain('改单已提交，等待仓库确认')
    expect(document.body.textContent).not.toContain('已确认保存')
    act(() => useAuthStore.setState({ user: { ...useAuthStore.getState().user!, permissions: [PERMISSIONS.SALE_ORDER_UPDATE, PERMISSIONS.PRODUCT_VIEW] } }))
    const view = [...document.querySelectorAll('button')].find(button => button.textContent === '查看已保存销售单')!
    expect(view.disabled).toBe(true)
    act(() => view.click())
    expect(done).not.toHaveBeenCalled()
  }, order, true, done)
})
