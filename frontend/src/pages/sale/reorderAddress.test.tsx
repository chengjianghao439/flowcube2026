// @vitest-environment jsdom
import { act, useState, type ComponentProps } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, expect, test, vi } from 'vitest'
import apiClient, { setApiClientBaseURL } from '@/api/client'
import { useAuthStore } from '@/store/authStore'
import { HOME_TAB, useWorkspaceStore } from '@/store/workspaceStore'
import KeepAliveSection from '@/components/shared/KeepAliveSection'
import { TabPathContext } from '@/components/layout/TabPathContext'
import SaleFormPage from './form'
import type { AxiosRequestConfig } from 'axios'
import { _registerConfirmFn, type ConfirmOptions } from '@/lib/confirm'
import type { CommercialInput, CommercialPreview } from '@/types/sale-commercial'

const calls: AxiosRequestConfig[] = []
const address = { id: 9, customerId: 4, receiverName: '原收货人', receiverPhone: '12345', receiverAddress: '原常用地址', isDefault: true }
const captured = vi.hoisted(() => ({ next: 0, values: new Map<number, (v: string) => void>(), addressSelect: null as null | ((a: { receiverAddress: string }) => void) }))
vi.mock('@/lib/toast', () => ({ toast: { warning: vi.fn(), error: vi.fn(), success: vi.fn() } }))
vi.mock('@/components/finder', () => ({ CustomerFinder: () => null, ProductFinder: () => null }))
vi.mock('@/components/ui/select', async importOriginal => {
  const original = await importOriginal<typeof import('@/components/ui/select')>()
  return { ...original, Select: function Select(props: ComponentProps<typeof original.Select>) { const [id] = useState(() => captured.next++); if (props.onValueChange) captured.values.set(id, props.onValueChange); return <original.Select {...props} /> } }
})
vi.mock('@/pages/sale/components/AddressBookDialog', async importOriginal => {
  const original = await importOriginal<typeof import('@/pages/sale/components/AddressBookDialog')>()
  return { ...original, default: function AddressBook(props: ComponentProps<typeof original.default>) { captured.addressSelect = props.onSelect; return <original.default {...props} /> } }
})
vi.mock('@/pages/sale/form/components/SaleOrderItemsTable', () => ({ SaleOrderItemsTable: (p: { items: { _key: number; quantity: number }[] }) => <output>{p.items.map(i => i.quantity).join(',')}</output> }))
function ordinaryPreview(config: AxiosRequestConfig): CommercialPreview | null {
  // Derive the response only from this immutable Axios request, never a later page/store state.
  const body = JSON.parse(config.data) as { customerId: number; warehouseId: number; groups: CommercialInput[] }
  if (body.groups.some(input => input.kind === 'kit')) return null
  expect(config.method).toBe('post')
  expect(body.customerId).toBe(4)
  expect(body.warehouseId).toBe(8)
  expect(body.groups).toHaveLength(1)
  const commercialGroups = body.groups.map(input => {
    if (input.kind !== 'ordinary') throw new Error('普通预览须为准确普通商品')
    expect(input.lineKey).toEqual(expect.any(String)); expect(input.lineKey).not.toBe('')
    expect(input.productId).toBe(3); expect(input.entryUnit).toBe('个'); expect(input.priceSource).toBe('default')
    expect(input.warehouseId).toBeUndefined(); expect(input.quantity).toBe(2)
    const amount = input.quantity * 7
    return {
      id: 0, lineKey: input.lineKey, kind: input.kind, warehouseId: body.warehouseId,
      kitVersionId: null, kitCode: null, kitName: null,
      originalQty: input.quantity, targetQty: input.quantity, quantity: input.quantity,
      unitPrice: 7, amount, originalAmount: amount, priceSource: input.priceSource,
      components: [{ productId: 3, productCode: 'P3', productName: '当前商品', unit: '个', baseQty: 1, quantity: input.quantity, allocatedAmount: amount }],
      metadata: {
        input: { ...input, warehouseId: body.warehouseId }, priceCustomerId: body.customerId,
        entry: { entryUnit: input.entryUnit!, entryQty: input.quantity, conversionRate: 1, entryUnitPrice: 7 },
        quote: { referenceUnitPrice: 7, resolvedPriceSource: 'price_level', resolvedPriceLevel: 'B', priceListId: null }
      }
    }
  })
  return {
    customerId: body.customerId, warehouseId: body.warehouseId, commercialGroups,
    physicalItems: commercialGroups.map(group => ({
      id: 0, productId: 3, productCode: 'P3', productName: '当前商品', unit: '个', warehouseId: body.warehouseId,
      quantity: group.quantity, unitPrice: 7, amount: group.amount,
      inventory: { quantity: 10, reserved: 0, available: 10, required: group.quantity, shortage: 0 }
    })),
    amount: commercialGroups.reduce((sum, group) => sum + group.amount, 0), canFulfillEntireVector: true,
    expected: null, readyDate: null, inventoryExplanation: '当前现货', readyDateExplanation: '未分配'
  }
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); sessionStorage.clear(); localStorage.clear(); calls.length = 0
  captured.next = 0; captured.values.clear(); captured.addressSelect = null
  setApiClientBaseURL('/a'); useAuthStore.getState().login('fixture', null, { id: 9, roleId: 1, permissions: ['*'] } as never)
  useWorkspaceStore.setState({ tabs: [HOME_TAB], activeKey: HOME_TAB.key })
  apiClient.defaults.adapter = async config => {
    calls.push(config)
    let data: unknown
    if (config.url === '/sale/80/reorder-source') {
      data = { id: 80, orderNo: 'S80', model: 'ordinary', customerId: 4, items: [{ kind: 'ordinary', productId: 3, baseUnit: '个', baseQty: 2 }] }
    } else if (config.url === '/customers/4') data = { id: 4, name: '当前客户', isActive: true }
    else if (config.url === '/products/3') data = { id: 3, code: 'P3', name: '当前商品', unit: '个', units: [], isActive: true, allowDecimalQty: false }
    else if (config.url === '/price-lists/customer-price') data = { salePrice: 7, priceLevel: 'B', source: 'price_level', priceLevelName: 'B价' }
    else if (config.url === '/kits/7') data = { id: 7, name: '当前套', code: 'K7', isActive: true, deletedAt: null, currentVersionId: 41, version: { id: 41, kitId: 7, versionNo: 1, referenceUnitPrice: 12, components: [{ productId: 3, productActive: true }] } }
    else if (config.url === '/kits/preview') data = ordinaryPreview(config) ?? { amount: 24, commercialGroups: [], physicalItems: [], inventoryExplanation: '当前现货', readyDateExplanation: '未分配', canFulfillEntireVector: true }
    else if (config.url === '/customer-addresses' && config.method === 'get') data = [address]
    else if (config.url === '/carriers/active') data = [{ id: 5, name: '当前承运商', platformCode: 'deppon', shippingProduct: 'DJBK' }]
    else if (config.url === '/warehouses/active') data = [{ id: 8, name: '当前仓' }, { id: 9, name: '另一仓' }]
    else if (config.url === '/sale' && config.method === 'post') throw Error('原保存结果未知')
    else throw Error(`禁止网络，未stub ${config.method} ${config.url}`)
    return { data: { success: true, data }, status: 200, statusText: 'OK', config, headers: {} }
  }
})
async function flush() { await act(async () => { await new Promise(r => setTimeout(r, 5)) }) }
async function click(parent: ParentNode, label: string) {
  if (label === '选择当前仓') { expect(captured.values.get(0)).toBeTruthy(); await act(async () => captured.values.get(0)!('8')); await flush(); return }
  const button = [...parent.querySelectorAll('button')].find(b => b.textContent?.trim() === label)
  expect(button, label).toBeTruthy(); await act(async () => button!.click()); await flush()
}
async function input(element: HTMLTextAreaElement, value: string) {
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(element, value); element.dispatchEvent(new Event('input', { bubbles: true })) })
}
async function page(model: 'ordinary' | 'kit-v1', run: (host: HTMLElement, show: (active: boolean) => Promise<void>, cache: QueryClient) => Promise<void>) {
  const adapter = apiClient.defaults.adapter
  if (typeof adapter !== 'function') throw Error('需要离线adapter')
  if (model === 'kit-v1') apiClient.defaults.adapter = async config => {
    if (config.url !== '/sale/80/reorder-source') return adapter(config)
    calls.push(config)
    return { data: { success: true, data: { id: 80, orderNo: 'S80', model, customerId: 4, items: [{ kind: 'kit', kitId: 7, originalKitVersionId: 41, quantity: 2 }] } }, status: 200, statusText: 'OK', config, headers: {} }
  }
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host), cache = new QueryClient({ defaultOptions: { queries: { retry: false } } }), path = `/sale/${model === 'kit-v1' ? 'new-kit' : 'new'}?sourceId=80`
  const show = async (active: boolean) => { await act(async () => root.render(<MemoryRouter initialEntries={[path]}><QueryClientProvider client={cache}><KeepAliveSection active={active}><TabPathContext.Provider value={path}><SaleFormPage /></TabPathContext.Provider></KeepAliveSection></QueryClientProvider></MemoryRouter>)); await flush() }
  await show(true)
  try { await act(async () => host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click()); await click(host, '载入当前客户和商品'); await run(host, show, cache) }
  finally { await act(async () => root.unmount()); cache.clear(); host.remove() }
}
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]')
const receiver = (host: HTMLElement) => host.querySelector<HTMLTextAreaElement>('textarea[placeholder="请输入详细收货地址"]')!

test.each(['ordinary', 'kit-v1'] as const)('%s 真实地址portal隐藏暂停；恢复同实例保未保存输入和合法选用', async model => {
  await page(model, async (host, show, cache) => {
    await click(host, '从地址簿选择'); expect(dialog()).not.toBeNull(); await click(dialog()!, '新增地址')
    await input(dialog()!.querySelector<HTMLTextAreaElement>('textarea[aria-label="详细收货地址"]')!, '未保存的地址输入')
    const reads = calls.filter(c => c.url === '/customer-addresses').length
    await show(false); expect(dialog()).toBeNull()
    await act(async () => { await cache.invalidateQueries({ queryKey: ['customer-addresses'] }) }); await flush()
    expect(calls.filter(c => c.url === '/customer-addresses')).toHaveLength(reads)
    await show(true)
    expect(dialog()!.querySelector<HTMLTextAreaElement>('textarea[aria-label="详细收货地址"]')?.value).toBe('未保存的地址输入')
    await click(dialog()!, '仅填入订单'); expect(receiver(host).value).toBe('未保存的地址输入')
  })
})
test.each(['ordinary', 'kit-v1'] as const)('%s unknown保存立即暂停已开portal，旧选用回调不能回写或再维护', async model => {
  await page(model, async host => {
    await click(host, '选择当前仓'); await flush(); await click(host, '从地址簿选择')
    const oldPick = [...dialog()!.querySelectorAll('button')].find(b => b.textContent === '选用')!
    await click(host, '保存草稿'); expect(calls.filter(c => c.url === '/sale' && c.method === 'post')).toHaveLength(1)
    expect(dialog()).toBeNull(); await act(async () => oldPick.click())
    expect(receiver(host).value).toBe(''); expect(host.textContent).toContain('原请求结果待确认')
    expect(calls.some(c => c.url === '/customer-addresses' && c.method !== 'get')).toBe(false)
  })
})
test.each(['ordinary', 'kit-v1'] as const)('%s 地址读取A→B→A晚到和撤权不应用到新单；原输入保留', async model => {
  await page(model, async (host, show) => {
    const adapter = apiClient.defaults.adapter
    if (typeof adapter !== 'function') throw Error('需要adapter')
    let complete: (() => void) | undefined
    apiClient.defaults.adapter = config => config.url === '/customer-addresses' ? new Promise(resolve => { calls.push(config); complete = () => resolve({ data: { success: true, data: [address] }, status: 200, statusText: 'OK', config, headers: {} }) }) : adapter(config)
    await input(receiver(host), '员工原输入'); await click(host, '从地址簿选择'); expect(complete).toBeTruthy()
    await act(async () => { setApiClientBaseURL('/b'); setApiClientBaseURL('/a'); complete!() }); await flush()
    expect(dialog()).toBeNull(); expect(receiver(host).value).toBe('员工原输入')
    await show(false); await show(true); expect(dialog()).toBeNull()
    await act(async () => useAuthStore.setState({ user: { ...useAuthStore.getState().user!, roleId: 2, permissions: [] } }))
    expect(dialog()).toBeNull(); expect(receiver(host).value).toBe('员工原输入')
  })
})
test('R9维护地址首发合法UPDATE；隐藏后迟到完成不清原地址草稿或填新单', async () => {
  await page('ordinary', async (host, show) => {
    const adapter = apiClient.defaults.adapter
    if (typeof adapter !== 'function') throw Error('需要adapter')
    let complete: (() => void) | undefined
    apiClient.defaults.adapter = config => config.url === '/customer-addresses' && config.method === 'post' ? new Promise(resolve => { calls.push(config); complete = () => resolve({ data: { success: true, data: { id: 77 } }, status: 200, statusText: 'OK', config, headers: {} }) }) : adapter(config)
    await click(host, '从地址簿选择'); await click(dialog()!, '新增地址')
    await input(dialog()!.querySelector<HTMLTextAreaElement>('textarea[aria-label="详细收货地址"]')!, '维护后仍待核对的输入')
    await click(dialog()!, '保存地址'); expect(complete).toBeTruthy()
    await show(false); await act(async () => complete!()); await flush(); await show(true)
    expect(dialog()!.querySelector<HTMLTextAreaElement>('textarea[aria-label="详细收货地址"]')?.value).toBe('维护后仍待核对的输入')
    expect(receiver(host).value).toBe('')
    expect(calls.filter(c => c.url === '/customer-addresses' && c.method === 'post')).toHaveLength(1)
  })
})
test.each([['ordinary', 'unknown'], ['ordinary', 'ABA'], ['kit-v1', 'unknown'], ['kit-v1', 'ABA']] as const)('%s 原Header选择回调在%s后守实时归属，仓/承运商/运费/产品/地址均不回写', async (model, cause) => {
  await page(model, async host => {
    await click(host, '选择当前仓')
    await act(async () => { captured.values.get(1)!('5'); captured.values.get(2)!('1') }); await flush()
    expect(captured.values.get(3)).toBeTruthy()
    await act(async () => captured.values.get(3)!('DJBK')); await flush()
    const oldCallbacks = [0, 1, 2, 3].map(id => captured.values.get(id)!), oldSelect = captured.addressSelect!
    const before = [...host.querySelectorAll('select')].map(select => select.value)
    const beforeLabels = [...host.querySelectorAll('[role="combobox"]')].map(select => select.textContent)
    if (cause === 'unknown') await click(host, '保存草稿')
    await act(async () => {
      if (cause === 'ABA') { setApiClientBaseURL('/b'); setApiClientBaseURL('/a') }
      oldCallbacks[0]('9'); oldCallbacks[1]('__none__'); oldCallbacks[2]('2'); oldCallbacks[3]('DJTK'); oldSelect(address)
    }); await flush()
    expect([...host.querySelectorAll('select')].map(select => select.value)).toEqual(before)
    expect([...host.querySelectorAll('[role="combobox"]')].map(select => select.textContent)).toEqual(beforeLabels)
    expect(receiver(host).value).toBe('')
    expect(dialog()).toBeNull()
  })
})
test('R9地址删除慢确认在隐藏再恢复后不得执行原确认或改当前草稿', async () => {
  await page('ordinary', async (host, show) => {
    let confirmation: ConfirmOptions | undefined
    _registerConfirmFn(options => { confirmation = options })
    try {
      await click(host, '从地址簿选择')
      const del = dialog()!.querySelector<HTMLButtonElement>('button[title="删除"]')!
      await act(async () => del.click()); expect(confirmation?.title).toBe('删除常用地址')
      await show(false); await show(true)
      await act(async () => confirmation!.onConfirm()); await flush()
      expect(calls.some(c => c.method === 'delete')).toBe(false)
      expect(receiver(host).value).toBe('')
    } finally { _registerConfirmFn(() => {}) }
  })
})
