// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import CloseReceivingDialog from './CloseReceivingDialog'
import { useAuthStore } from '@/store/authStore'
const api = vi.hoisted(() => ({ close: vi.fn(), query: vi.fn(), defaults: { baseURL: '/api' } }))
vi.mock('@/api/inbound-tasks', () => ({ closeReceivingInboundApi: api.close }))
vi.mock('@/api/operation-requests', () => ({ getOperationRequestStatusApi: api.query }))
vi.mock('@/api/client', () => ({ default: { defaults: api.defaults } }))
vi.mock('@/lib/toast', () => ({ toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() } }))
let host: HTMLDivElement, root: Root, qc: QueryClient
const onClose = vi.fn()
async function render(taskId: number | null) {
  await act(async () => root.render(<QueryClientProvider client={qc}><CloseReceivingDialog taskId={taskId} onClose={onClose} /></QueryClientProvider>))
}
async function click(label: string) {
  const button = [...document.querySelectorAll('button')].find(b => b.textContent === label)
  expect(button).toBeTruthy()
  await act(async () => { button!.click() })
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.clearAllMocks()
  useAuthStore.setState({ sessionGeneration: 1, user: { id: 1, roleId: 1 } as never, token: 'fixture' })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host); qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
})
afterEach(async () => { await act(async () => root.unmount()); qc.clear(); host.remove() })
test('超时后真实确认弹窗退出覆盖，原结果查询/重试可点击；切另一单不误关', async () => {
  api.close.mockRejectedValue({ status: 504 }); api.query.mockResolvedValue({ status: 'success', resourceType: 'inbound_task', resourceId: 7, data: { taskId: 7, status: 4 } })
  await render(7); await click('确定结束收货')
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  expect(host.textContent).toContain('结果未确认')
  await render(8); await click('查询原提交结果')
  expect(onClose).not.toHaveBeenCalled()
  expect(document.body.textContent).toContain('确定结束收货')
})
test('原目标收到有效stage3回执才关闭并刷新；没有自动重新提交', async () => {
  api.close.mockRejectedValue({ status: 504 }); api.query.mockResolvedValue({ status: 'success', resourceType: 'inbound_task', resourceId: 7, data: { taskId: 7, status: 3 } })
  await render(7); await click('确定结束收货'); await click('查询原提交结果')
  expect(onClose).toHaveBeenCalledTimes(1); expect(api.close).toHaveBeenCalledTimes(1)
})
