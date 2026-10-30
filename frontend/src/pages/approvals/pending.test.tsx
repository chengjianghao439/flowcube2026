// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { beforeEach, afterEach, expect, test, vi } from 'vitest'
import ApprovalPendingPage from './pending'
import { useAuthStore } from '@/store/authStore'
import { useWorkspaceStore } from '@/store/workspaceStore'
import type { PendingApproval } from '@/types/approval'
const api = vi.hoisted(() => ({ list: vi.fn() }))
vi.mock('@/api/approvals', () => ({ listPendingApprovalsApi: api.list }))
let host: HTMLDivElement, root: Root, client: QueryClient
const row = (bizType = 'purchase_order', id = 91): PendingApproval => ({ instanceId: id, taskId: id, bizType, bizId: id, no: `单-${id}`, title: '申请事由', status: 2, applicantId: 3, applicantName: '申请人', amount: 18, currentStep: 1, flowId: 1, createdAt: '2026-10-04 12:00:00' })
const page = (list: PendingApproval[], total = list.length, current = 1) => ({ list, pagination: { page: current, pageSize: 20, total } })
function Path() { const location = useLocation(); return <output>{location.pathname}{location.search}</output> }
async function flush() { await act(async () => { await new Promise(done => setTimeout(done, 30)) }) }
async function render() { act(() => root.render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/approvals/pending']}><ApprovalPendingPage /><Path /></MemoryRouter></QueryClientProvider>)); await flush() }
function click(label: string) { act(() => [...host.querySelectorAll('button')].find(b => b.textContent === label)!.click()) }
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); useAuthStore.setState({ sessionGeneration: 1, user: { id: 7, username: 'tester', realName: '测试人', roleId: 1, roleName: '测试' } }); useWorkspaceStore.setState({ tabs: [] }); api.list.mockReset(); client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); host = document.createElement('div'); document.body.append(host); root = createRoot(host) })
afterEach(() => { act(() => root.unmount()); client.clear(); host.remove() })
test('本列表显式取齐模式显示第21条原单，不再提供可见翻页', async () => {
  api.list.mockResolvedValue(page(Array.from({ length: 21 }, (_, index) => row('purchase_order', index + 1))))
  await render(); expect(host.textContent).toContain('21')
  expect(api.list).toHaveBeenLastCalledWith({ page: 1, pageSize: 200 }, false, expect.objectContaining({ baseURL: '/api', _authSessionGeneration: 1, _erpApiFallbackTried: true })); expect(host.textContent).toContain('单-21'); expect(host.textContent).toContain('单-1')
  expect(host.textContent).not.toMatch(/上一页|下一页/)
})
test.each([
  ['purchase_order', '/purchase/91'],
  ['sale_credit_override', '/credit-overrides?detailId=91'], ['product_price', '/price-change?detailId=91'],
  ['inventory_disposal', '/disposals?detailId=91'], ['expense_claim', '/finance/expenses?detailId=91'],
])('单据号准确进入原业务 %s', async (bizType, path) => { api.list.mockResolvedValue(page([row(bizType)])); await render(); click('单-91'); expect(host.querySelector('output')?.textContent).toBe(path) })
test('未知类型禁用原单入口且明确提示', async () => { api.list.mockResolvedValue(page([row('unknown')])); await render(); expect(host.textContent).toContain('暂不支持此单据类型'); expect([...host.querySelectorAll('button')].find(b => b.textContent === '去审批')?.disabled).toBe(true) })
test('审批后总数缩小，重新取齐当前结果而不保留已失效末条', async () => {
  let total = 21
  api.list.mockImplementation(() => Promise.resolve(page(Array.from({ length: total }, (_, index) => row('purchase_order', index + 1)))))
  await render(); expect(host.textContent).toContain('单-21'); total = 1
  await act(async () => { await client.invalidateQueries({ queryKey: ['approval-pending'] }) }); await flush()
  await flush()
  expect(api.list).toHaveBeenLastCalledWith({ page: 1, pageSize: 200 }, false, expect.objectContaining({ baseURL: '/api', _authSessionGeneration: 1, _erpApiFallbackTried: true })); expect(host.textContent).toContain('单-1'); expect(host.textContent).not.toContain('单-21')
})
test('复用已打开原业务页时只更新定位，保留原查询条件', async () => {
  useWorkspaceStore.getState().addTab({ key: '/credit-overrides', path: '/credit-overrides?keyword=原查询&status=2&detailId=81', title: '超额放行申请' })
  api.list.mockResolvedValue(page([row('sale_credit_override')]))
  await render(); click('单-91')
  const target = new URL(`https://test${host.querySelector('output')!.textContent}`)
  expect(target.pathname).toBe('/credit-overrides'); expect(target.searchParams.get('detailId')).toBe('91')
  expect(target.searchParams.get('keyword')).toBe('原查询'); expect(target.searchParams.get('status')).toBe('2')
})
test('空待办与读取失败分别呈现，失败可重试', async () => {
  api.list.mockRejectedValueOnce(new Error('离线')).mockResolvedValueOnce(page([]))
  await render(); expect(host.textContent).toContain('审批待办读取失败'); click('重试'); await flush()
  expect(host.textContent).toContain('没有待你审批的单据'); expect([...host.querySelectorAll('button')].find(b => b.textContent === '下一页')).toBeUndefined()
})
test('原单级来源不显示伪造第null级，采购创建与报销提交时间/处置估值准确', async () => {
  api.list.mockResolvedValue(page([
    { ...row('purchase_order', 1), sourceKind: 'document', entryKey: 'document:purchase_order:1:approve', instanceId: null, taskId: null, flowId: null, currentStep: null, timeKind: 'created' },
    { ...row('expense_claim', 2), sourceKind: 'document', entryKey: 'document:expense_claim:2:approve', instanceId: null, taskId: null, flowId: null, currentStep: null, timeKind: 'submitted', submittedAt: '2026-10-04 13:00:00' },
    { ...row('inventory_disposal', 3), sourceKind: 'document', entryKey: 'document:inventory_disposal:3:approve', instanceId: null, taskId: null, flowId: null, currentStep: null, timeKind: 'created' },
  ]))
  await render()
  expect(host.textContent).toContain('业务单级审核'); expect(host.textContent).not.toContain('第 null 级')
  expect(host.textContent).toContain('创建时间'); expect(host.textContent).toContain('13:00'); expect(host.textContent).toContain('参考估值')
  expect(host.querySelectorAll('tbody tr')).toHaveLength(3)
  click('单-2'); expect(host.querySelector('output')?.textContent).toBe('/finance/expenses?detailId=2')
})
