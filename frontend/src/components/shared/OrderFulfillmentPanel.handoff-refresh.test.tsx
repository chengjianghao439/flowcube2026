// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query'
import { beforeEach, afterEach, test, expect, vi } from 'vitest'
import { OrderFulfillmentPanel } from './OrderFulfillmentPanel'
import { getFulfillment, type FulfillmentDocument, type FulfillmentType } from '@/api/fulfillment'
vi.mock('@/api/fulfillment', () => ({ getFulfillment: vi.fn(), runFulfillmentCommand: vi.fn() }))
vi.mock('@/hooks/usePermission', () => ({ usePermission: () => ({ can: () => true }) }))
vi.mock('@/hooks/useActiveWorkspaceTab', () => ({ useActiveWorkspaceTab: () => true }))
let host: HTMLDivElement, root: Root, qc: QueryClient
beforeEach(() => { vi.clearAllMocks(); onlineManager.setOnline(true); Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); host = document.createElement('div'); document.body.append(host); root = createRoot(host); qc = new QueryClient({ defaultOptions: { queries: { retry: false } } }) })
afterEach(() => { act(() => root.unmount()); qc.clear(); host.remove(); onlineManager.setOnline(true) })
const cached = (type: FulfillmentType, key: string): FulfillmentDocument => ({ type, id: 12, canManage: true, owners: [], commitments: [], expectedDate: null, impacts: [], detectedCount: 1,
  delivery: { firstDate: null, allDate: null, items: [{ id: 7, productId: 1, productCode: 'SKU1', productName: '商品', articleNumber: null, spec: null, color: null, unit: '个', warehouseId: 1, warehouseName: '本仓', actualShipDate: null, deliveryOutcome: '', remaining: 1, physical: 0, boundQty: 1, shortage: 0, promisedDate: null, processingDays: null, firstDate: null, allDate: null, delayed: false, state: '依赖采购', sources: [{ quantity: 1, date: null, orderId: 44, orderNo: 'PO44', bound: true, stage: '待到货' }] }] },
  issues: [{ id: 1, document_type: type, document_id: 12, source: 'auto', source_key: key, title: '原事项', reason: '原原因', action_path: '', status: 'open', owner_id: null, ownerName: null, due_at: null, result: null, version: 1, overdue: 0, dueSoon: 0 }] })
async function render(type: FulfillmentType) { await act(async () => root.render(<QueryClientProvider client={qc}><OrderFulfillmentPanel type={type} id={12} /></QueryClientProvider>)) }
const targets = [
  ['sale', 'purchase-delay:7:42', '#/purchase/42?focus=fulfillment'],
  ['sale', 'return:91', '#/sale/12?focus=progress&taskId=91'],
  ['inbound', 'print:9', '#/settings/barcode-print-query?category=inbound&inboundTaskId=12'],
] as const
test.each(targets)('旧缓存 %s/%s 挂起重读时禁止交接，保留普通详情和进展输入', async (type, key, href) => {
  const data = cached(type, key); qc.setQueryData(['fulfillment', type, 12], data)
  let finish!: (value: FulfillmentDocument) => void
  vi.mocked(getFulfillment).mockImplementation(() => new Promise(resolve => { finish = resolve }))
  await render(type)
  expect(qc.getQueryState(['fulfillment', type, 12])?.fetchStatus).toBe('fetching')
  expect(host.querySelector(`a[href="${href}"]`)).toBeNull()
  expect(host.textContent).toContain('正在重新读取事项，稍后再交接')
  expect(host.textContent).toContain('原原因')
  if (type === 'sale') expect(host.querySelector('a[href="#/purchase/44?focus=fulfillment"]')).not.toBeNull()
  await act(async () => [...host.querySelectorAll('button')].find(button => button.textContent === '处理')!.click())
  const textarea = host.querySelector('textarea')!
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, '未保存的进展'); textarea.dispatchEvent(new Event('input', { bubbles: true })) })
  await act(async () => finish(data)); await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)) })
  expect(host.querySelector(`a[href="${href}"]`)).not.toBeNull()
  expect(host.querySelector('textarea')!.value).toBe('未保存的进展')
})
test.each(targets)('旧缓存 %s/%s 重读失败不能继续交接', async (type, key, href) => {
  qc.setQueryData(['fulfillment', type, 12], cached(type, key))
  let fail!: (error: Error) => void
  vi.mocked(getFulfillment).mockImplementation(() => new Promise((_, reject) => { fail = reject }))
  await render(type)
  await act(async () => fail(new Error('重读失败'))); await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)) })
  expect(host.querySelector(`a[href="${href}"]`)).toBeNull()
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('重读失败')
  expect(host.textContent).toContain('已填写的进展和日期保留')
})

test.each(targets)('离线暂停的 %s/%s 不交接，恢复网络并重读后放开', async (type, key, href) => {
  const data = cached(type, key); qc.setQueryData(['fulfillment', type, 12], data)
  let finish!: (value: FulfillmentDocument) => void
  vi.mocked(getFulfillment).mockImplementation(() => new Promise(resolve => { finish = resolve }))
  onlineManager.setOnline(false)
  await render(type)
  expect(qc.getQueryState(['fulfillment', type, 12])?.fetchStatus).toBe('paused')
  expect(getFulfillment).not.toHaveBeenCalled()
  expect(host.querySelector(`a[href="${href}"]`)).toBeNull()
  expect(host.textContent).toContain('网络已暂停，等待恢复后重新读取事项')
  if (type === 'sale') expect(host.querySelector('a[href="#/purchase/44?focus=fulfillment"]')).not.toBeNull()
  await act(async () => [...host.querySelectorAll('button')].find(button => button.textContent === '处理')!.click())
  const textarea = host.querySelector('textarea')!
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, '离线期间的进展'); textarea.dispatchEvent(new Event('input', { bubbles: true })) })
  await act(async () => onlineManager.setOnline(true))
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)) })
  expect(qc.getQueryState(['fulfillment', type, 12])?.fetchStatus).toBe('fetching')
  expect(host.querySelector(`a[href="${href}"]`)).toBeNull()
  await act(async () => finish(data)); await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)) })
  expect(host.querySelector(`a[href="${href}"]`)).not.toBeNull()
  expect(host.querySelector('textarea')!.value).toBe('离线期间的进展')
})
