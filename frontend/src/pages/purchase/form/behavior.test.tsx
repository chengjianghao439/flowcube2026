// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import Page from './index'
import { TabPathContext } from '@/components/layout/TabPathContext'
import { useDirtyGuardStore } from '@/store/dirtyGuardStore'
import type { PurchaseOrder } from '@/types/purchase'
import type { ProductFinderResult } from '@/types/products'
import { PERMISSIONS as P } from '@/lib/permission-codes'

const state = vi.hoisted(() => ({ order: undefined as PurchaseOrder | undefined, error: null as unknown, allowed: null as Set<string> | null, refetch: vi.fn(), write: vi.fn() }))
vi.mock('@/hooks/usePurchase', () => ({
  usePurchaseDetail: () => ({ data: state.order, isLoading: false, isError: !!state.error, error: state.error, refetch: state.refetch }),
  ...Object.fromEntries(['useCreatePurchase', 'useUpdatePurchase', 'useConfirmPurchase', 'useWithdrawConfirmPurchase', 'useApprovePurchase', 'useRejectPurchase', 'useCancelPurchase'].map(k => [k, () => ({ mutate: state.write, mutateAsync: state.write, isPending: false })])),
}))
vi.mock('@/hooks/usePermission', () => ({ usePermission: () => ({ can: (code: string) => state.allowed == null || state.allowed.has(code) }) }))
vi.mock('@/hooks/useActiveWorkspaceTab', () => ({ useActiveWorkspaceTab: () => true }))
vi.mock('@/api/products', () => ({ getProductApi: async () => ({ units: [] }) }))
vi.mock('@/components/shared/OrderDetailSections', () => ({ OrderDetailSections: ({ children }: { children: React.ReactNode }) => <>{children}</> }))
vi.mock('@/components/shared/WarehouseSelect', () => ({ WarehouseSelect: () => <button>选择仓库</button> }))
vi.mock('@/components/finder', () => ({
  SupplierFinder: () => null,
  ProductFinder: ({ open, onClose, onConfirm }: { open: boolean; onClose: () => void; onConfirm: (p: ProductFinderResult) => void }) => open ? <div role="dialog"><button onClick={onClose}>取消选品</button><button onClick={() => { onConfirm({ id: 11, code: 'P11', name: '标准商品', unit: '个', costPrice: 2.55 } as ProductFinderResult); onClose() }}>选择标准商品</button></div> : null,
}))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let host: HTMLDivElement, root: ReturnType<typeof createRoot>
beforeEach(() => { state.order = undefined; state.error = null; state.allowed = null; vi.clearAllMocks(); host = document.createElement('div'); document.body.append(host); root = createRoot(host) })
afterEach(async () => { await act(async () => root.unmount()); host.remove(); useDirtyGuardStore.setState({ dirtyTabs: {}, pendingConfirm: null }); expect(state.write).not.toHaveBeenCalled(); vi.unstubAllGlobals() })
const render = async (path = '/purchase/new') => act(async () => root.render(<MemoryRouter><TabPathContext.Provider value={path}><Page /></TabPathContext.Provider></MemoryRouter>))
const button = (text: string) => [...document.querySelectorAll('button')].find(b => b.textContent === text)!
const click = async (text: string) => act(async () => button(text).click())
const numbers = () => host.querySelectorAll<HTMLInputElement>('input[data-entry-input]')
const setValue = (input: HTMLInputElement, value: string) => act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })) })
const order = (): PurchaseOrder => ({ id: 12, orderNo: 'PO12', status: 1, statusName: '草稿', supplierId: 1, supplierName: '供应商', warehouseId: 1, warehouseName: '仓库', totalAmount: 2.55, operatorId: 1, operatorName: '经办人', createdAt: '2026-10-09', items: [{ id: 1, productId: 11, productCode: 'P11', productName: '标准商品', unit: '个', quantity: 1, unitPrice: 2.55, amount: 2.55 }] })

test('新增选择器取消前后均不插入草稿空行或虚增数量', async () => {
  await render(); await click('添加商品'); expect(numbers()).toHaveLength(0)
  await click('取消选品'); expect(numbers()).toHaveLength(0); expect(host.textContent).not.toContain('合计数量：1')
  await click('添加商品'); await click('选择标准商品'); expect(numbers()).toHaveLength(2)
  await click('添加商品'); await click('取消选品'); expect(numbers()).toHaveLength(2)
})
test('替换取消保留原商品、数量和价格', async () => {
  await render(); await click('添加商品'); await click('选择标准商品')
  setValue(numbers()[0], '7'); setValue(numbers()[1], '3.4567')
  await click('标准商品'); await click('取消选品')
  expect(numbers()[0].value).toBe('7'); expect(numbers()[1].value).toBe('3.4567')
})
test('新建取消入口使用现有防丢稿确认', async () => {
  await render(); await click('添加商品'); await click('选择标准商品')
  expect(button('取消')).toBeTruthy(); await click('取消')
  expect(useDirtyGuardStore.getState().pendingConfirm).not.toBeNull()
  expect(numbers()[0].value).toBe('1')
})
test.each([403, 404, 503])('采购详情读取状态区分 %s，失败不伪装不存在', async status => {
  state.error = { status, message: '读取故障' }; await render('/purchase/12')
  if (status === 403) expect(host.textContent).toContain('没有权限查看采购单')
  else if (status === 404) expect(host.textContent).toContain('采购单不存在或已删除')
  else { expect(host.textContent).toContain('采购单加载失败'); expect(host.textContent).not.toContain('不存在或已删除'); await click('重试'); expect(state.refetch).toHaveBeenCalledTimes(1) }
})
test('后台刷新失败保留原订单并提供重试', async () => {
  state.order = order(); state.error = { status: 503, message: '服务暂不可用' }; await render('/purchase/12')
  expect(host.textContent).toContain('PO12'); expect(host.textContent).toContain('标准商品'); expect(host.textContent).toContain('刷新失败')
  await click('重试'); expect(state.refetch).toHaveBeenCalledTimes(1)
})
test('编辑草稿在刷新失败和恢复后不被重建覆盖', async () => {
  state.order = order(); await render('/purchase/12'); await click('编辑'); setValue(numbers()[0], '9')
  state.error = { status: 503 }; await render('/purchase/12'); expect(numbers()[0].value).toBe('9'); expect(host.textContent).toContain('刷新失败')
  state.error = null; await render('/purchase/12'); expect(numbers()[0].value).toBe('9')
})

test.each([403, 404])('编辑中读取%s暂停展示但不销毁未保存输入', async status => {
  state.order = order(); await render('/purchase/12'); await click('编辑'); setValue(numbers()[0], '9')
  state.error = { status }; await render('/purchase/12')
  expect(numbers()[0].value).toBe('9')
  expect(numbers()[0].closest('[hidden]')).not.toBeNull()
  expect(button('保存修改').disabled).toBe(true)
  expect(host.textContent).toContain('未保存编辑内容已保留')
  await click('重试'); expect(state.refetch).toHaveBeenCalledTimes(1)
  state.error = null; await render('/purchase/12')
  expect(numbers()[0].value).toBe('9'); expect(numbers()[0].closest('[hidden]')).toBeNull()
})

test.each(['permission', 'status'])('编辑中%s变化暂停保存并保留草稿', async change => {
  state.order = order(); await render('/purchase/12'); await click('编辑'); setValue(numbers()[0], '9')
  if (change === 'permission') state.allowed = new Set([P.PURCHASE_ORDER_VIEW])
  else state.order = { ...state.order, status: 2 }
  await render('/purchase/12'); expect(numbers()[0].value).toBe('9')
  expect(numbers()[0].closest('[hidden]')).not.toBeNull(); expect(button('保存修改').disabled).toBe(true)
  await click('保存修改'); expect(state.write).not.toHaveBeenCalled()
})

test.each([1, 2, 3, 4, 5] as const)('状态%s的只读权限不暴露写操作', async status => {
  state.order = { ...order(), status }; state.allowed = new Set([P.PURCHASE_ORDER_VIEW])
  await render('/purchase/12?edit=1')
  for (const label of ['编辑', '提交', '取消', '撤回确认', '审批通过', '驳回', '保存修改']) expect(button(label)).toBeUndefined()
  expect(host.textContent).toContain('PO12')
})
test('一次性编辑入口等待采购读取成功，取消后不自动重入', async () => {
  state.order = order(); state.error = { status: 503 }
  await render('/purchase/12?edit=1'); expect(numbers()).toHaveLength(0)
  state.error = null; await render('/purchase/12?edit=1'); expect(numbers()).toHaveLength(2)
  await click('取消编辑'); expect(numbers()).toHaveLength(0)
  await render('/purchase/12?edit=1'); expect(numbers()).toHaveLength(0)
})
test('录入Enter和Shift Enter按完整字段顺序，Tab及输入法保留原生行为', async () => {
  state.order = order(); await render('/purchase/12'); await click('编辑')
  const send = (input: HTMLInputElement, init: KeyboardEventInit) => act(() => { input.focus(); input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })) })
  send(numbers()[0], { key: 'Enter' }); expect(document.activeElement).toBe(numbers()[1])
  send(numbers()[1], { key: 'Enter', shiftKey: true }); expect(document.activeElement).toBe(numbers()[0])
  send(numbers()[1], { key: 'Enter' }); expect(document.activeElement).toBe(button('添加商品'))
  send(numbers()[0], { key: 'Enter', isComposing: true }); expect(document.activeElement).toBe(numbers()[0])
  send(numbers()[0], { key: 'Tab' }); expect(document.activeElement).toBe(numbers()[0])
})
test('四位采购报价回显不由已取分的金额反推', async () => {
  state.order = { ...order(), totalAmount: 3.70, items: [{ ...order().items![0], quantity: 3, unitPrice: 1.2345, amount: 3.70 }] }
  await render('/purchase/12'); await click('编辑')
  expect(numbers()[1].value).toBe('1.2345'); expect(host.textContent).toContain('¥3.70')
})
test('未知辅助换算保留原量与原金额参考，不猜价并阻止保存', async () => {
  state.order = { ...order(), items: [{ ...order().items![0], quantity: 24, entryQty: 2, entryUnit: '箱', conversionRate: undefined, amount: 6.91, unitPrice: 0.28805833 }] }
  await render('/purchase/12'); await click('编辑')
  expect(numbers()[0].value).toBe('2'); expect(numbers()[1].value).toBe(''); expect(host.textContent).toContain('基本量待核对'); expect(host.textContent).toContain('原行金额 ¥6.91')
  await click('保存修改'); expect(state.write).not.toHaveBeenCalled()
})


test('操作单元格沿销售与表头一起滚动，不单独吸附遮挡相邻列', async () => {
  state.order = order(); await render('/purchase/12'); await click('编辑')
  const action = host.querySelector('[data-purchase-entry-table] tbody tr td:last-child')!
  expect(action.classList.contains('sticky')).toBe(false)
  expect(action.querySelector('[aria-label="删除该行商品"]')).not.toBeNull()
})


test('长明细汇总使用整单800行与原采购总额，不随虚拟挂载行缩减', async () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  const items = Array.from({ length: 800 }, (_, index) => ({
    ...order().items![0], id: index + 1, productId: index % 2 ? 12 : 11,
    productName: index % 2 ? '型材' : '标准商品', unit: index % 2 ? '米' : '个',
    quantity: index % 2 ? 2 : 1,
  }))
  state.order = { ...order(), items, totalAmount: 123456.78 }
  await render('/purchase/12')
  const scroll = host.querySelector('[aria-label="采购商品明细"]')!
  expect(scroll).not.toBeNull()
  expect(scroll.getAttribute('tabindex')).toBe('0')
  const summary = host.querySelector('[aria-label="采购商品明细汇总"]')!
  expect(summary.textContent).toContain('800 行')
  expect(summary.textContent).toContain('¥123,456.78')
  expect(summary.textContent).toContain('400 个')
  expect(summary.textContent).toContain('800 米')
  expect(scroll.querySelector('table')!.getAttribute('aria-rowcount')).toBe('801')
  expect(scroll.querySelectorAll('tbody tr[data-index]').length).toBeLessThan(800)
})

test('空采购明细仍显示整单0行与原总额，金额口径不由明细重算', async () => {
  state.order = { ...order(), items: [], totalAmount: 17.89 }
  await render('/purchase/12')
  const summary = host.querySelector('[aria-label="采购商品明细汇总"]')!
  expect(summary).not.toBeNull()
  expect(summary.textContent).toContain('0 行')
  expect(summary.textContent).toContain('¥17.89')
  expect(host.textContent).toContain('暂无商品明细')
})


test('旧辅助单位草稿不能直接保存，重新选品后须重新填写基本数量', async () => {
  state.order = order()
  state.order.items = [{ ...state.order.items![0], quantity: 12, unitPrice: 10, amount: 120, entryUnit: '箱', entryQty: 2, conversionRate: 6 }]
  await render('/purchase/12'); await click('编辑')
  expect(numbers()[0].value).toBe('2')
  expect(host.querySelector('select[aria-label="标准商品录入单位"]')).toBeNull()
  await click('保存修改'); expect(state.write).not.toHaveBeenCalled()
  await click('标准商品'); await click('选择标准商品')
  expect(numbers()[0].value).toBe('0')
  await click('保存修改'); expect(state.write).not.toHaveBeenCalled()
})
