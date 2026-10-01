// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, test, vi, expect } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { OrderFulfillmentPanel } from './OrderFulfillmentPanel'
import { getFulfillment, type DeliveryItem, type FulfillmentDocument, runFulfillmentCommand } from '@/api/fulfillment'
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
  vi.mocked(getFulfillment).mockResolvedValue(data)
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
  expect(host.textContent).not.toContain('显示已处理')
  expect(host.textContent).toContain('当前没有卡点')
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

test('已有人工问题仍可跟进，已处理记录按需查看', async () => {
  await renderSale([item()], true, { issues: [issue, { ...issue, id: 4, title: '旧问题', status: 'resolved' }] })
  expect(host.textContent).toContain('核对地址')
  expect(host.textContent).not.toContain('旧问题')
  const history = [...host.querySelectorAll('button')].find(b => b.textContent === '显示已处理')!
  await act(async () => history.click())
  expect(host.textContent).toContain('旧问题')
  const edit = [...host.querySelectorAll('button')].find(b => b.textContent === '处理')!
  await act(async () => edit.click())
  expect(host.querySelector('select[aria-label="如何处理"]')).not.toBeNull()
})

test('检测到尚未入列的问题时保留立即更新入口', async () => {
  vi.mocked(runFulfillmentCommand).mockResolvedValue({})
  await renderSale([item()], true, { detectedCount: 1 })
  const refresh = [...host.querySelectorAll('button')].find(b => b.textContent === '重新检测')!
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
  expect(host.querySelector('input[placeholder="yyyy-mm-dd"]')).not.toBeNull()
})

test('只有读取权限时不展示日期修改入口', async () => {
  await renderSale([item({ remaining: 2 })], false)
  expect([...host.querySelectorAll('button')].some(b => ['修改日期', '修改安排'].includes(b.textContent || ''))).toBe(false)
})

const automatic = (key: string) => ({ ...issue, source: 'auto' as const, source_key: key, action_path: 'https://evil.example/path', conditionActive: true })
test('缺货本页动作重读并展开对应商品，不新增采购或覆盖处理表单', async () => {
  await renderSale([item({ remaining: 5, shortage: 5, processingDays: 1 })], true, { issues: [automatic('shortage:1')] })
  const edit = [...host.querySelectorAll('button')].find(b => b.textContent === '处理')!
  await act(async () => edit.click())
  const textarea = host.querySelector('textarea')!
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, '待采购答复'); textarea.dispatchEvent(new Event('input', { bubbles: true })) })
  const before = vi.mocked(getFulfillment).mock.calls.length
  const action = [...host.querySelectorAll('button')].find(b => b.textContent === '安排缺少的货源')!
  expect(action).toBeDefined()
  await act(async () => action.click())
  expect(vi.mocked(getFulfillment).mock.calls.length).toBeGreaterThan(before)
  expect(host.querySelector<HTMLDetailsElement>('details')!.open).toBe(true)
  expect(host.querySelector('textarea')!.value).toBe('待采购答复')
  expect(host.querySelector<HTMLOptionElement>('option[value="resolve"]')!.disabled).toBe(true)
  expect(host.querySelector('a[href*="evil"]')).toBeNull()
})
test('面板使用相同采购动作与权限解释，未知路径安全留在原面板', async () => {
  await renderSale([item()], false, { issues: [automatic('purchase-delay:1:42'), { ...automatic('unknown'), id: 5 }] })
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)) })
  expect(host.querySelector('a[href="#/purchase/42?focus=fulfillment"]')?.textContent).toBe('核对采购到货日期')
  expect(host.querySelector('a[href*="evil"]')).toBeNull()
  expect([...host.querySelectorAll('button')].some(b => b.textContent === '查看原单事项')).toBe(true)
})
test('无采购查看权限提供原面板核对说明', async () => {
  access.purchase = false
  await renderSale([item()], false, { issues: [automatic('purchase-delay:1:42')] })
  expect(host.querySelector('a[href*="/purchase/"]')).toBeNull()
  expect(host.textContent).toContain('需有采购查看权限的同事核对到货日期')
})
test('缺少货源、到货日期未知与已知日期偏晚分别保留解释', async () => {
  await renderSale([
    item({ remaining: 5, shortage: 2, processingDays: 1, state: '供应未覆盖' }),
    item({ id: 2, remaining: 5, processingDays: 1, state: '依赖采购', sources: [{ quantity: 5, orderId: 9, orderNo: 'PO009', date: null, bound: true, stage: '待到货' }] }),
    item({ id: 3, remaining: 5, processingDays: 1, promisedDate: '2026-10-01', allDate: '2026-10-03', delayed: true }),
  ])
  const details = [...host.querySelectorAll('details')]
  expect(details[0].textContent).toContain('请先安排缺少的货源')
  expect(details[1].textContent).toContain('到货日期未确认')
  expect(details[2].textContent).toContain('可能延期')
  expect(details[2].textContent).toContain('预计发完：2026-10-03')
})
test('本页定位读取失败明确保留进展草稿，重试成功后继续填写', async () => {
  await renderSale([item({ remaining: 5, shortage: 5 })], true, { issues: [automatic('shortage:1')] })
  const data = await vi.mocked(getFulfillment).mock.results.at(-1)!.value
  await act(async () => [...host.querySelectorAll('button')].find(b => b.textContent === '处理')!.click())
  const textarea = host.querySelector('textarea')!
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, '原进展保留'); textarea.dispatchEvent(new Event('input', { bubbles: true })) })
  vi.mocked(getFulfillment).mockRejectedValue(new Error('网络故障'))
  await act(async () => [...host.querySelectorAll('button')].find(b => b.textContent === '安排缺少的货源')!.click())
  await act(async () => { await new Promise(r => setTimeout(r, 5)) })
  expect(host.textContent).toContain('已填写的进展和日期保留')
  vi.mocked(getFulfillment).mockResolvedValue(data)
  await act(async () => [...host.querySelectorAll('button')].find(b => b.textContent === '重新加载订单进度')!.click())
  await act(async () => { await new Promise(r => setTimeout(r, 5)) })
  expect(host.querySelector('textarea')!.value).toBe('原进展保留')
})
test('定位重读后原商品已移除时不打开旧DOM或声称已定位', async () => {
  await renderSale([item({ remaining: 5 })], false, { issues: [automatic('shortage:1')] })
  await act(async () => { await new Promise(r => setTimeout(r, 5)) })
  const data = await vi.mocked(getFulfillment).mock.results.at(-1)!.value
  vi.mocked(getFulfillment).mockResolvedValue({ ...data, delivery: { items: [], firstDate: null, allDate: null } })
  await act(async () => [...host.querySelectorAll('button')].find(b => b.textContent === '安排缺少的货源')!.click())
  await act(async () => { await new Promise(r => setTimeout(r, 5)) })
  expect(host.textContent).toContain('该商品明细已不在当前安排中')
  expect(host.textContent).not.toContain('已重新读取并定位当前安排')
})
