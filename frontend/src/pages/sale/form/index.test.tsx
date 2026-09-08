// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { TabPathContext } from '@/components/layout/TabPathContext'
import { useSectionActive } from '@/components/layout/SectionVisibilityContext'
import type { SaleOrder } from '@/types/sale'
import SaleFormPage from './index'

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
function render() {
  act(() => root.render(<MemoryRouter><QueryClientProvider client={client}><TabPathContext.Provider value="/sale/12"><SaleFormPage /></TabPathContext.Provider></QueryClientProvider></MemoryRouter>))
}
function tab(label: string) { return [...host.querySelectorAll<HTMLButtonElement>('button[aria-pressed]')].find(button => button.textContent === label)! }
function navigate(id: number) {
  act(() => { window.history.replaceState({}, '', `/#/sale/${id}?focus=fulfillment`); window.dispatchEvent(new HashChangeEvent('hashchange')) })
}

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
  render()
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
  expect(tab('发货安排')?.getAttribute('aria-pressed')).toBe('true')
})
