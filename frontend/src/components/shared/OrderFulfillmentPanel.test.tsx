// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, test, vi, expect } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { OrderFulfillmentPanel } from './OrderFulfillmentPanel'
import { getFulfillment, type FulfillmentDocument, type FulfillmentIssue, runFulfillmentCommand } from '@/api/fulfillment'

vi.mock('@/hooks/usePermission', () => ({ usePermission: () => ({ can: () => true }) }))
vi.mock('@/api/fulfillment', () => ({ getFulfillment: vi.fn(), runFulfillmentCommand: vi.fn() }))
vi.mock('@/hooks/useActiveWorkspaceTab', () => ({ useActiveWorkspaceTab: () => true }))

let root: Root
let host: HTMLDivElement
let queryClient: QueryClient
beforeEach(() => {
  vi.resetAllMocks()
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
})
afterEach(() => {
  act(() => root.unmount())
  queryClient.clear()
  host.remove()
})

const delay: FulfillmentIssue = {
  id: 1, document_type: 'purchase', document_id: 1, source: 'auto', source_key: 'purchase-delay',
  title: '采购延期', reason: '供应商尚未确认', action_path: '/purchase/1', owner_id: null, ownerName: null,
  status: 'open', due_at: null, result: null, version: 1, overdue: 0, dueSoon: 0, conditionActive: true,
}
const purchase: FulfillmentDocument = {
  type: 'purchase', id: 1, canManage: true, owners: [], detectedCount: 1,
  expectedDate: '2026-11-25', commitments: [{ itemId: 0, originalDate: '2026-11-22', promisedDate: '2026-11-25', processingDays: null }],
  issues: [delay], impacts: [{ saleId: 5, orderNo: 'XS-005', itemId: 6, productCode: 'P01', productName: '合成商品', unit: '件', quantity: 4 }],
}

async function renderPurchase(data: FulfillmentDocument = purchase) {
  vi.mocked(getFulfillment).mockResolvedValue(data)
  await act(async () => root.render(<QueryClientProvider client={queryClient}><OrderFulfillmentPanel type="purchase" id={1} /></QueryClientProvider>))
  await vi.waitFor(() => expect(host.textContent).toContain('预计到货日期'))
}
const button = (title: string) => [...host.querySelectorAll('button')].find(item => item.textContent === title)

test('继续显示采购到货日期及真实关联订单，销售链接落订单信息', async () => {
  await renderPurchase()
  expect(getFulfillment).toHaveBeenCalledWith('purchase', 1, expect.any(AbortSignal))
  expect(host.textContent).toContain('预计到货日期：2026-11-25')
  expect(host.textContent).toContain('首次记录日期：2026-11-22')
  expect(host.textContent).toContain('等待到货数量')
  expect(host.querySelector('a[href="#/sale/5"]')?.textContent).toBe('XS-005')
  expect(host.textContent).not.toContain('约定发货日期')
  expect(host.querySelector('a[href*="focus=fulfillment"]')).toBeNull()
})

test('采购到货变更继续用采购日期命令和幂等键', async () => {
  vi.mocked(runFulfillmentCommand).mockResolvedValue({})
  await renderPurchase()
  await act(async () => button('修改到货日期')!.click())
  const input = host.querySelector<HTMLInputElement>('input[required]')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '供应商确认日期')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => button('保存')!.click())
  expect(runFulfillmentCommand).toHaveBeenCalledWith('purchase', 1, {
    action: 'dates', itemId: 0, date: '2026-11-25', processingDays: null, reason: '供应商确认日期',
  }, expect.any(String))
})

test('只有查看权限时保留事项解释并隐藏变更控制', async () => {
  await renderPurchase({ ...purchase, canManage: false })
  expect(host.textContent).toContain('供应商尚未确认')
  expect(host.textContent).toContain('负责人：待认领')
  expect(host.textContent).toContain('期限：未设置')
  for (const label of ['修改到货日期', '添加卡点', '重新检测', '认领', '处理']) {
    expect(button(label)).toBeUndefined()
  }
})

test('显示已处理记录，并继续限制仍存在的自动事项结案', async () => {
  await renderPurchase({ ...purchase, issues: [delay, { ...delay, id: 2, title: '旧事项', status: 'resolved' }] })
  expect(host.textContent).not.toContain('旧事项')
  await act(async () => button('显示已处理')!.click())
  expect(host.textContent).toContain('旧事项')
  await act(async () => button('处理')!.click())
  expect(host.querySelector<HTMLOptionElement>('option[value="resolve"]')?.disabled).toBe(true)
})
