// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, test, vi, expect } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { OrderFulfillmentPanel } from './OrderFulfillmentPanel'
import { getFulfillment, type DeliveryItem, type FulfillmentDocument, runFulfillmentCommand } from '@/api/fulfillment'
vi.mock('@/api/fulfillment', () => ({ getFulfillment: vi.fn(), runFulfillmentCommand: vi.fn() }))
vi.mock('@/hooks/useActiveWorkspaceTab', () => ({ useActiveWorkspaceTab: () => true }))
let root: Root, host: HTMLDivElement
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); host = document.createElement('div'); document.body.append(host); root = createRoot(host) })
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

const item = (patch: Partial<DeliveryItem> = {}): DeliveryItem => ({
  id: 1, productId: 10, productCode: 'SKU0010', productName: '测试商品', articleNumber: null, spec: null, color: null,
  unit: 'pcs', warehouseId: 1, warehouseName: '北京主仓', actualShipDate: null, deliveryOutcome: '未设承诺',
  remaining: 0, physical: 0, boundQty: 0, shortage: 0, promisedDate: null, processingDays: null,
  firstDate: null, allDate: null, delayed: false, state: '已结束', sources: [], ...patch,
})
async function renderSale(items: DeliveryItem[], canManage = true, patch: Partial<FulfillmentDocument> = {}) {
  const data: FulfillmentDocument = { type: 'sale', id: 1, canManage, owners: [], commitments: [], expectedDate: null,
    issues: [], impacts: [], detectedCount: 0, delivery: { items, firstDate: null, allDate: null }, ...patch }
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  client.setQueryData(['fulfillment', 'sale', 1], data)
  await act(async () => root.render(<QueryClientProvider client={client}><OrderFulfillmentPanel type="sale" id={1} /></QueryClientProvider>))
}

test('没有剩余待发商品时收起明细，不再提示等待确认发货日期', async () => {
  await renderSale([item()])
  expect(host.textContent).toContain('无需继续发货')
  expect(host.textContent).not.toContain('待确认')
  expect(host.textContent).not.toContain('最早可发一批：')
  const history = host.querySelector<HTMLDetailsElement>('details')!
  expect(history).not.toBeNull()
  expect(history.open).toBe(false)
  expect(history.querySelector('summary')!.textContent).toContain('查看商品明细')
  expect(history.textContent).toContain('SKU0010')
})

test('仍需发货时显示白话字段和缺少仓库备货天数的原因', async () => {
  await renderSale([item({ remaining: 10, physical: 10, state: '有货待占库' })])
  expect(host.textContent).toContain('备货情况')
  expect(host.textContent).toContain('还需发货')
  expect(host.textContent).toContain('现货可供本单')
  expect(host.textContent).toContain('请填写仓库备货天数')
  expect(host.textContent).not.toContain('无需继续发货')
  expect(host.textContent).not.toContain('检查订单问题')
  expect(host.textContent).not.toContain('添加问题')
  expect(host.textContent).not.toContain('显示已解决')
  expect(host.textContent).toContain('暂无待处理问题')
  const headers = [...host.querySelectorAll('th')].map(node => node.textContent)
  expect(headers).not.toContain('最近发货日期')
  expect(headers).not.toContain('最早可发一批')
  expect(headers).toContain('详情')
})

test('混合明细区分已经结束与仍待发货，保留已知日期和采购未确认原因', async () => {
  await renderSale([item(), item({ id: 2, remaining: 10, physical: 4, processingDays: 1, firstDate: '2026-09-09', state: '候选供应待确认' })])
  expect(host.textContent).toContain('2026-09-09')
  expect(host.textContent).toContain('请确认采购安排和到货日期')
  expect(host.querySelectorAll('details')).toHaveLength(2)
  expect(host.textContent).toContain('无需继续发货')
})

test('空订单明细不当作已经发完', async () => {
  await renderSale([])
  expect(host.textContent).toContain('暂无商品明细')
  expect(host.textContent).not.toContain('无需继续发货')
})

const issue = { id: 3, document_type: 'sale' as const, document_id: 1, source: 'manual' as const, source_key: 'manual', title: '核对地址', reason: '客户地址变更', action_path: '/sale/1', owner_id: null, ownerName: null, status: 'open' as const, due_at: null, result: null, version: 1, overdue: 0, dueSoon: 0 }

test('已有人工问题仍可跟进，已解决记录按需查看', async () => {
  await renderSale([item()], true, { issues: [issue, { ...issue, id: 4, title: '旧问题', status: 'resolved' }] })
  expect(host.textContent).toContain('核对地址')
  expect(host.textContent).not.toContain('旧问题')
  const history = [...host.querySelectorAll('button')].find(b => b.textContent === '显示已解决')!
  await act(async () => history.click())
  expect(host.textContent).toContain('旧问题')
  const edit = [...host.querySelectorAll('button')].find(b => b.textContent === '处理')!
  await act(async () => edit.click())
  expect(host.querySelector('select[aria-label="如何处理"]')).not.toBeNull()
})

test('检测到尚未入列的问题时保留立即更新入口', async () => {
  vi.mocked(runFulfillmentCommand).mockResolvedValue({})
  await renderSale([item()], true, { detectedCount: 1 })
  const refresh = [...host.querySelectorAll('button')].find(b => b.textContent === '更新问题')!
  expect(refresh).toBeDefined()
  await act(async () => refresh.click())
  expect(runFulfillmentCommand).toHaveBeenCalledWith('sale', 1, { action: 'sync' }, expect.any(String))
})

test('商品详情保留采购跳转和明细日期编辑，读取权限不暴露写入口', async () => {
  await renderSale([item({ remaining: 2, sources: [{ quantity: 2, orderId: 9, orderNo: 'PO009', date: '2026-09-10', bound: true, stage: '待到货' }] })])
  const detail = host.querySelector<HTMLDetailsElement>('details')!
  expect(detail.open).toBe(false)
  expect(detail.querySelector('a')?.getAttribute('href')).toBe('#/purchase/9?focus=fulfillment')
  const edit = [...detail.querySelectorAll('button')].find(b => b.textContent === '修改日期')!
  await act(async () => edit.click())
  expect(host.textContent).toContain('修改商品 SKU0010')
  expect(host.querySelector('input[type="date"]')).not.toBeNull()
})

test('只有读取权限时不展示日期修改入口', async () => {
  await renderSale([item({ remaining: 2 })], false)
  expect([...host.querySelectorAll('button')].some(b => ['修改日期', '修改安排'].includes(b.textContent || ''))).toBe(false)
})
