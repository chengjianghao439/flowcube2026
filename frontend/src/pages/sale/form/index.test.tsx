// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { TabPathContext } from '@/components/layout/TabPathContext'
import { useSectionActive } from '@/components/layout/SectionVisibilityContext'
import type { SaleOrder } from '@/types/sale'
import SaleFormPage from './index'
import { useAuthStore } from '@/store/authStore'
import { PERMISSIONS } from '@/lib/permission-codes'
import { useWorkspaceStore, HOME_TAB, MAX_WORKSPACE_TABS } from '@/store/workspaceStore'
import { buildWorkspaceTabRegistration } from '@/router/workspaceRouteMeta'

vi.mock('@/components/shared/OrderFulfillmentPanel', () => ({ OrderFulfillmentPanel: () => {
  const active = useSectionActive()
  return <div data-testid="arrangements" data-active={String(active)}>备货情况<input aria-label="待保存的安排" defaultValue="" />待处理问题</div>
} }))

let host: HTMLDivElement, root: Root, client: QueryClient
const order: SaleOrder = { id: 12, orderNo: 'XS-12', customerId: 1, customerName: '示例客户', warehouseId: 1, warehouseName: '示例仓库', status: 1, statusName: '草稿', totalAmount: 0, operatorId: 1, operatorName: '经办人', createdAt: '2026-09-08', items: [] }
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  window.history.replaceState({}, '', '/#/sale/12')
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } })
  client.setQueryData(['sale', 12], order)
})
afterEach(() => { act(() => root.unmount()); client.clear(); host.remove(); window.history.replaceState({}, '', '/') })
function CurrentRoute() { const location = useLocation(); return <output data-route>{location.pathname + location.search}</output> }
function render(path = '/sale/12') {
  act(() => root.render(<MemoryRouter><CurrentRoute /><QueryClientProvider client={client}><TabPathContext.Provider value={path}><SaleFormPage /></TabPathContext.Provider></QueryClientProvider></MemoryRouter>))
}
function tab(label: string) { return [...host.querySelectorAll<HTMLButtonElement>('button[aria-pressed]')].find(button => button.textContent === label)! }
function navigate(id: number) {
  act(() => { window.history.replaceState({}, '', `/#/sale/${id}?focus=fulfillment`); window.dispatchEvent(new HashChangeEvent('hashchange')) })
}

test('普通详情合并商品身份列，保留换算、分仓、已发进度、低价风险及全单金额', () => {
  client.setQueryData(['sale', 12], {
    ...order, status: 3, isMultiWarehouse: true, shippedTotalQty: 6,
    totalAmount: 240, discountAmount: 20,
    items: [{ id: 1, productCode: 'P-LONG', articleNumber: '供应商型号完整值', spec: '长规格完整值',
      productName: '长商品名称完整值', color: '本色', unit: '个', entryUnit: '箱', entryQty: 2,
      quantity: 12, unitPrice: 20, amount: 240, shippedQty: 6, warehouseName: '第二仓', belowCost: true, costPrice: 22, remark: '按箱分装' }],
  })
  render()
  const table = host.querySelector<HTMLTableElement>('table')!
  expect([...table.querySelectorAll('th')].map(th => th.textContent?.replace(/调整.*列宽/g, ''))).toEqual(['商品', '单位', '发货仓库', '数量', '已发/应发', '单价', '金额', '备注'])
  expect(table.textContent).toContain('按箱分装')
  const row = table.querySelector('tbody tr')!
  for (const fact of ['P-LONG', '供应商型号完整值', '长规格完整值', '长商品名称完整值', '本色', '第二仓', '2 箱', '12 个', '6/12', '¥120.00/箱', '低于进价 ¥22.00']) expect(row.textContent).toContain(fact)
  expect(table.closest('[data-sale-detail-items]')?.textContent).toContain('订单金额¥220.00')
  expect(host.textContent).not.toContain('订单汇总')
})

test('发货安排独立于作业进度，切换后保留输入并暂停隐藏区块', () => {
  render()
  expect(tab('发货安排')).toBeTruthy()
  act(() => tab('作业进度').click())
  expect(host.textContent).toContain('尚未创建仓库任务')
  expect(host.querySelector('[data-testid="arrangements"]')).toBeNull()
  act(() => tab('发货安排').click())
  const input = host.querySelector<HTMLInputElement>('input[aria-label="待保存的安排"]')!
  input.value = '等待客户确认'
  expect(input.closest('[hidden]')).toBeNull()
  act(() => tab('作业进度').click())
  expect(input.closest('[hidden]')).not.toBeNull()
  expect(host.querySelector('[data-testid="arrangements"]')!.getAttribute('data-active')).toBe('false')
  act(() => tab('发货安排').click())
  expect(input.value).toBe('等待客户确认')
  expect(input.closest('[hidden]')).toBeNull()
})

test('首次从待办进入打开本单发货安排', () => {
  window.history.replaceState({}, '', '/#/sale/12?focus=fulfillment')
  render(buildWorkspaceTabRegistration('/sale/12', '?focus=fulfillment').path)
  expect(tab('发货安排')?.getAttribute('aria-pressed')).toBe('true')
  expect(host.querySelector('[data-testid="arrangements"]')).not.toBeNull()
})

test('已打开订单从待办返回定位发货安排，其他订单的链接不影响本单', () => {
  window.history.replaceState({}, '', '/#/sale/13?focus=fulfillment')
  render()
  expect(tab('订单信息').getAttribute('aria-pressed')).toBe('true')
  navigate(13)
  expect(tab('订单信息').getAttribute('aria-pressed')).toBe('true')
  navigate(12)
  expect(tab('订单信息').getAttribute('aria-pressed')).toBe('true')
  render(buildWorkspaceTabRegistration('/sale/12', '?focus=fulfillment').path)
  expect(tab('发货安排')?.getAttribute('aria-pressed')).toBe('true')
})

test('隐藏另一单的全局hash不改变本标签已经选择的区域', () => {
  render()
  act(() => tab('作业进度').click())
  navigate(12)
  expect(tab('作业进度').getAttribute('aria-pressed')).toBe('true')
  expect(host.querySelector('[data-testid="arrangements"]')).toBeNull()
})
test('已经打开的交接收到重复参数后拒绝任务定位并回本单信息', () => {
  render(buildWorkspaceTabRegistration('/sale/12', '?focus=progress&taskId=91').path)
  expect(tab('作业进度').getAttribute('aria-pressed')).toBe('true')
  render(buildWorkspaceTabRegistration('/sale/12', '?focus=progress&taskId=91&taskId=').path)
  expect(host.textContent).toContain('交接参数无效')
  expect(tab('订单信息').getAttribute('aria-pressed')).toBe('true')
})

test.each([true, false])('原普通销售发起退货按共享创建权限导航：%s', allowed => {
  useAuthStore.setState({ token: 'fixture', user: { id: 5, roleId: 5, permissions: allowed ? [PERMISSIONS.RETURN_ORDER_CREATE] : [] } as never })
  useWorkspaceStore.setState({ tabs: [HOME_TAB], activeKey: HOME_TAB.key })
  render()
  const button = [...host.querySelectorAll('button')].find(b => b.textContent === '发起退货')
  if (!allowed) { expect(button).toBeUndefined(); return }
  expect(button).toBeTruthy(); act(() => button!.click())
  expect(useWorkspaceStore.getState().activeKey).toBe('/returns/sale/new?sourceId=12&sourceNo=XS-12')
  expect(host.querySelector('[data-route]')?.textContent).toBe('/returns/sale/new?sourceId=12&sourceNo=XS-12')
})
test('原单退货入口达到标签上限先提示，不驱逐现有草稿', () => {
  useAuthStore.setState({ token: 'fixture', user: { id: 5, roleId: 5, permissions: [PERMISSIONS.RETURN_ORDER_CREATE] } as never })
  const tabs = [HOME_TAB, ...Array.from({ length: MAX_WORKSPACE_TABS - 1 }, (_, i) => ({ key: `/sale/${i + 1}`, path: `/sale/${i + 1}`, title: '草稿', closable: true }))]
  useWorkspaceStore.setState({ tabs, activeKey: '/sale/12' }); render()
  const button = [...host.querySelectorAll('button')].find(b => b.textContent === '发起退货')!
  expect(button).toBeTruthy(); const before = useWorkspaceStore.getState().tabs; act(() => button.click())
  expect(useWorkspaceStore.getState().tabs).toEqual(before)
  expect(useWorkspaceStore.getState().activeKey).toBe('/sale/12')
})

test.each([false, true])('普通详情与成套沿同一现有权限显示编辑、取消、占库：%s', allowed => {
  useAuthStore.setState({ token: 'fixture', user: { id: 5, roleId: 5, permissions: allowed ? [PERMISSIONS.SALE_ORDER_VIEW, PERMISSIONS.SALE_ORDER_UPDATE, PERMISSIONS.SALE_ORDER_CANCEL, PERMISSIONS.SALE_ORDER_RESERVE] : [PERMISSIONS.SALE_ORDER_VIEW] } as never })
  render()
  const labels = [...host.querySelectorAll('button')].map(button => button.textContent)
  for (const label of ['编辑', '取消订单', '占用库存']) expect(labels.includes(label)).toBe(allowed)
  expect(labels).not.toContain('读取最新订单')
  expect(labels).not.toContain('刷新订单')
})
