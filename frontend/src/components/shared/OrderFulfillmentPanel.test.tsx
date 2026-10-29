// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, test, vi, expect } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { OrderFulfillmentPanel } from './OrderFulfillmentPanel'
import { getFulfillment, type FulfillmentDocument, runFulfillmentCommand } from '@/api/fulfillment'
const access = vi.hoisted(() => ({ purchase: true }))
vi.mock('@/hooks/usePermission', () => ({ usePermission: () => ({ can: () => access.purchase }) }))
vi.mock('@/api/fulfillment', () => ({ getFulfillment: vi.fn(), runFulfillmentCommand: vi.fn() }))
vi.mock('@/hooks/useActiveWorkspaceTab', () => ({ useActiveWorkspaceTab: () => true }))
let root: Root, host: HTMLDivElement
beforeEach(() => { access.purchase = true; Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); host = document.createElement('div'); document.body.append(host); root = createRoot(host) })
afterEach(() => { act(() => root.unmount()); host.remove() })
test('没有处理权限时保留原因、责任人、期限，不提供变更按钮', async () => {
  vi.mocked(getFulfillment).mockResolvedValue({ type: 'purchase', id: 1, canManage: false, owners: [], commitments: [], expectedDate: null, delivery: null, impacts: [], detectedCount: 1,
    issues: [{ id: 1, document_type: 'purchase', document_id: 1, source: 'auto', source_key: 'delay', title: '采购延期', reason: '供应商尚未确认', action_path: '/purchase/1', owner_id: null, ownerName: null, status: 'open', due_at: null, result: null, version: 1, overdue: 0, dueSoon: 0, conditionActive: true }] })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  await act(async () => { root.render(<QueryClientProvider client={client}><OrderFulfillmentPanel type="purchase" id={1} /></QueryClientProvider>); await new Promise(r => setTimeout(r, 30)) })
  await act(async () => { await new Promise(r => setTimeout(r, 30)) })
  expect(host.textContent).toContain('供应商尚未确认')
  expect(host.textContent).toContain('待认领')
  expect(host.textContent).not.toContain('添加问题')
  expect(host.textContent).not.toContain('修改到货日期')
})

const purchase = (patch: Partial<FulfillmentDocument> = {}): FulfillmentDocument => ({
  type: 'purchase', id: 1, canManage: true, owners: [], commitments: [], expectedDate: '2026-11-01',
  delivery: null, issues: [], impacts: [], detectedCount: 0, ...patch,
})
async function renderPurchase(data = purchase()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  vi.mocked(getFulfillment).mockResolvedValue(data)
  client.setQueryData(['fulfillment', 'purchase', 1], data)
  await act(async () => root.render(<QueryClientProvider client={client}><OrderFulfillmentPanel type="purchase" id={1} /></QueryClientProvider>))
}
test('采购保留到货日期编辑，不显示销售发货安排', async () => {
  await renderPurchase()
  expect(host.textContent).toContain('2026-11-01')
  const edit = [...host.querySelectorAll('button')].find(b => b.textContent === '修改到货日期')!
  await act(async () => edit.click())
  expect(host.textContent).toContain('修改采购到货日期')
  expect(host.querySelector('input[placeholder="yyyy-mm-dd"]')).not.toBeNull()
  expect(host.textContent).not.toContain('仓库备货天数')
  expect(host.textContent).not.toContain('发货安排')
})
test('采购关联销售进入订单本身，不提供约定发货日期列', async () => {
  await renderPurchase(purchase({ impacts: [{ saleId: 7, itemId: 8, orderNo: 'XS7', productCode: 'P1', productName: '商品', quantity: 2, unit: '件', promisedDate: null, expectedDate: '2026-11-01' }] }))
  expect(host.querySelector('a[href="#/sale/7"]')).not.toBeNull()
  expect(host.textContent).not.toContain('约定发货日期')
})
test('采购重新检测仍调用原单并使用请求键', async () => {
  vi.mocked(runFulfillmentCommand).mockResolvedValue({})
  await renderPurchase(purchase({ detectedCount: 1 }))
  await act(async () => [...host.querySelectorAll('button')].find(b => b.textContent === '重新检测')!.click())
  expect(runFulfillmentCommand).toHaveBeenCalledWith('purchase', 1, { action: 'sync' }, expect.any(String))
})
