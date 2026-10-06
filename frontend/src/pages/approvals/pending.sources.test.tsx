// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import clientApi, { setApiClientBaseURL } from '@/api/client'
import { useAuthStore } from '@/store/authStore'
import { PERMISSIONS as P } from '@/lib/permission-codes'
import { hasPermission } from '@/lib/permissions'
import { buildTopNavSections, getRouteByPath } from '@/router/routeDefinitions'
import { WIDGETS } from '@/components/dashboard/registry'
import { ListPendingApprovals } from '@/components/dashboard/widgets/ListWidgets'
import KeepAliveSection from '@/components/shared/KeepAliveSection'
import PendingPage from './pending'
import type { PendingApproval } from '@/types/approval'
import type { InternalAxiosRequestConfig } from 'axios'
vi.mock('@/lib/pdaRuntime', () => ({ syncPdaLabelPrinterBinding: vi.fn(async () => null) }))
vi.mock('@/api/pda-session', () => ({ ensureDeviceSession: vi.fn(), renewDeviceSession: vi.fn(async () => null) }))
vi.mock('@/lib/apiOrigin', () => ({ applyErpApiBaseFromStorage: vi.fn() }))
vi.mock('@/lib/toast', () => ({ toast: { error: vi.fn() } }))
const source = (no = 'PO-A'): PendingApproval => ({ sourceKind: 'document', entryKey: 'document:purchase_order:11:approve', instanceId: null, taskId: null, flowId: null, currentStep: null, bizType: 'purchase_order', bizId: 11, no, title: '审核原因', status: 5, applicantId: 3, applicantName: '制单人', amount: 19.1234, timeKind: 'created', createdAt: '2026-10-04 10:00:00', submittedAt: null })
const payload = (list = [source()], total = list.length) => ({ list, pagination: { page: 1, pageSize: 20, total } })
const originalAdapter = clientApi.defaults.adapter
let host: HTMLDivElement, root: Root, qc: QueryClient
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); setApiClientBaseURL('/api')
  useAuthStore.setState({ sessionGeneration: 1, user: { id: 7, username: 'fixture', realName: '测试', roleId: 5, roleName: '测试', permissions: [P.PURCHASE_ORDER_VIEW, P.PURCHASE_ORDER_APPROVE] } })
  qc = new QueryClient({ defaultOptions: { queries: { staleTime: 300000, retry: false } } }); host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); qc.clear(); host.remove(); clientApi.defaults.adapter = originalAdapter; setApiClientBaseURL('/api') })
async function flush() { await act(async () => { await new Promise(done => setTimeout(done, 35)) }) }
function draw(kind: 'page' | 'brief' = 'page', active = true) {
  act(() => root.render(<QueryClientProvider client={qc}><MemoryRouter initialEntries={[kind === 'page' ? '/approvals/pending' : '/dashboard']}><KeepAliveSection active={active}>{kind === 'page' ? <PendingPage /> : <ListPendingApprovals />}</KeepAliveSection></MemoryRouter></QueryClientProvider>))
}
function answer(config: InternalAxiosRequestConfig, data = payload()) {
  return { config, status: 200, statusText: 'OK', headers: {}, data: { success: true, data } }
}

test.each([P.APPROVAL_TASK_VIEW, P.PURCHASE_ORDER_APPROVE, P.INVENTORY_DISPOSAL_APPROVE, P.FINANCE_EXPENSE_APPROVE])('任一岗位%s菜单/路由/两首页卡片与hook入口一致', async permission => {
  const permissions = [permission]
  const route = getRouteByPath('/approvals/pending')!
  expect(hasPermission(permissions, route.permission, 5)).toBe(true)
  expect(JSON.stringify(buildTopNavSections(required => hasPermission(permissions, required, 5)))).toContain('/approvals/pending')
  for (const id of ['kpi-approval-count', 'list-pending-approvals']) expect(hasPermission(permissions, WIDGETS.find(w => w.id === id)!.permission!, 5)).toBe(true)
  useAuthStore.getState().updateUser({ permissions })
  const transport = vi.fn(async config => answer(config, payload([], 0))); clientApi.defaults.adapter = transport
  draw(); await flush(); await flush(); expect(transport).toHaveBeenCalledOnce()
  expect(transport.mock.calls[0]?.[0].url).toBe('/approvals/pending')
})
test('只有VIEW没有任何原审核/引擎查看权时不读取来源，撤权即时清理旧概要', async () => {
  const transport = vi.fn(async config => answer(config)); clientApi.defaults.adapter = transport
  draw(); await flush(); await flush(); expect(host.textContent).toContain('PO-A')
  act(() => useAuthStore.getState().updateUser({ permissions: [P.PURCHASE_ORDER_VIEW] })); await flush()
  expect(host.textContent).not.toContain('PO-A'); expect(transport).toHaveBeenCalledOnce()
  expect(hasPermission([P.PURCHASE_ORDER_VIEW], getRouteByPath('/approvals/pending')!.permission, 5)).toBe(false)
})
test.each(['page', 'brief'] as const)('%s已显示A后合法server切换无需draw，隐藏A再fresh，账号晚响应不串单', async kind => {
  let resolve!: (value: ReturnType<typeof answer>) => void
  const transport = vi.fn(async config => answer(config)); clientApi.defaults.adapter = transport
  draw(kind); await flush(); await flush(); expect(host.textContent).toContain('PO-A')
  transport.mockImplementationOnce(_config => new Promise(done => { resolve = done })).mockImplementation(async config => answer(config, payload([source('PO-C')])))
  act(() => setApiClientBaseURL('/server-b/api')); await flush()
  expect(host.textContent).not.toContain('PO-A'); expect(host.querySelector('button')?.textContent).not.toBe('PO-A')
  const configB = transport.mock.calls[1]![0]
  expect(configB.baseURL).toBe('/server-b/api'); expect(configB._erpApiFallbackTried).toBe(true)
  act(() => useAuthStore.setState({ sessionGeneration: 2, user: { id: 9, username: 'next', realName: '测试', roleId: 5, roleName: '测试', permissions: [P.PURCHASE_ORDER_VIEW, P.PURCHASE_ORDER_APPROVE] } }))
  await flush(); await flush(); await act(async () => { resolve(answer(configB, payload([source('PO-B晚到')]))); await new Promise(done => setTimeout(done, 35)) })
  expect(host.textContent).toContain('PO-C'); expect(host.textContent).not.toContain('PO-B晚到')
})
test.each(['page', 'brief'] as const)('%s KeepAlive隐藏停止读取、取消旧请求，重新激活读取中不显示旧缓存', async kind => {
  const transport = vi.fn(async config => answer(config)); clientApi.defaults.adapter = transport
  draw(kind); await flush(); await flush()
  let resolve!: (value: ReturnType<typeof answer>) => void
  transport.mockImplementationOnce(_config => new Promise(done => { resolve = done }))
  await act(async () => { void qc.invalidateQueries({ queryKey: [kind === 'page' ? 'approval-pending' : 'dash-pending-approvals'] }); await new Promise(done => setTimeout(done, 35)) })
  const oldConfig = transport.mock.calls.at(-1)![0]
  draw(kind, false); await flush(); expect(oldConfig.signal?.aborted).toBe(true)
  const calls = transport.mock.calls.length
  await act(async () => { await qc.invalidateQueries(); }); expect(transport.mock.calls.length).toBe(calls)
  transport.mockImplementation(async config => answer(config, payload([source('PO-恢复')])))
  draw(kind); expect(host.textContent).not.toContain('PO-A'); await flush(); await flush()
  await act(async () => { resolve(answer(oldConfig, payload([source('PO-迟到')]))); await new Promise(done => setTimeout(done, 35)) })
  expect(host.textContent).toContain('PO-恢复'); expect(host.textContent).not.toContain('PO-迟到')
})
test('首页混合多张null任务原单与引擎，行键不冲突、来源/时间/原始估值文案清楚', async () => {
  const documents: PendingApproval[] = [source(), { ...source('DIS-A'), bizType: 'inventory_disposal', entryKey: 'document:inventory_disposal:11:approve' }, { ...source('EXP-A'), bizType: 'expense_claim', entryKey: 'document:expense_claim:11:approve', submittedAt: '2026-10-04 11:00:00', timeKind: 'submitted' }, { ...source('ENGINE-A'), sourceKind: 'engine', instanceId: 1, taskId: 9, flowId: 1, currentStep: 2, entryKey: 'engine:purchase_order:11:2:9' }]
  clientApi.defaults.adapter = async config => answer(config, payload(documents, 24))
  const errors = vi.spyOn(console, 'error')
  try {
    draw('brief'); await flush(); await flush()
    expect(host.textContent).toContain('24 件待办'); expect(host.textContent).toContain('业务单级审核'); expect(host.textContent).toContain('第 2 级待审'); expect(host.textContent).toContain('参考估值'); expect(host.textContent).toContain('创建时间')
    expect(host.querySelectorAll('button')).toHaveLength(4)
    expect(errors.mock.calls.flat().some(value => String(value).includes('same key'))).toBe(false)
  } finally { errors.mockRestore() }
})
