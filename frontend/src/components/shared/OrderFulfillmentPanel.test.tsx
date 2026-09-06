// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, test, vi, expect } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { OrderFulfillmentPanel } from './OrderFulfillmentPanel'
import { getFulfillment } from '@/api/fulfillment'
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
  expect(host.textContent).not.toContain('登记异常')
  expect(host.textContent).not.toContain('更新交期')
})
