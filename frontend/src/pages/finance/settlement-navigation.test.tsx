// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import api from '@/api/client'
import { useAuthStore } from '@/store/authStore'
import { useWorkspaceStore } from '@/store/workspaceStore'
import { PERMISSIONS as P } from '@/lib/permission-codes'
import FinanceDashboardPage from './dashboard'
import PaymentsView from '@/pages/payments/PaymentsView'

vi.mock('@/lib/toast', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
const originalAdapter = api.defaults.adapter
const originalAuth = useAuthStore.getState(), originalWorkspace = useWorkspaceStore.getState()
let host: HTMLDivElement, root: Root, client: QueryClient
const side = { total: 0, totalCount: 0, overdueAmount: 0, overdueCount: 0, buckets: [], topParties: [] }
const granted = [P.FINANCE_ACCOUNT_VIEW, P.PAYMENT_VIEW, P.REPORT_VIEW]
function RouteState() { return <output data-route>{useLocation().pathname}</output> }
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  useAuthStore.setState({ token: 'synthetic-navigation', user: { id: 312, username: 'navigation-fixture', realName: '财务', roleId: 81, roleName: '财务', permissions: granted } })
  api.defaults.adapter = async config => {
    const data = config.url === '/finance/dashboard'
      ? { summary: { totalBalance: 0, accountCount: 0, inAmount: 0, outAmount: 0, netAmount: 0 }, pending: { approveCount: 0, payCount: 0 }, monthly: [], accounts: [], expenseByCategory: [], byBizType: [] }
      : config.url === '/payments/aging' ? { asOf: '2026-10-21', receivable: side, payable: side }
        : config.url === '/payments' ? { list: [], summary: { totalAmount: 0, paidAmount: 0, balance: 0 }, pagination: { page: 1, pageSize: 200, total: 0 } }
          : undefined
    if (!data) throw new Error(`未允许的测试端点：${config.url}`)
    return { config, status: 200, statusText: 'OK', headers: {}, data: { success: true, data } }
  }
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount()); await client.cancelQueries(); client.clear(); host.remove()
  api.defaults.adapter = originalAdapter; useAuthStore.setState(originalAuth, true); useWorkspaceStore.setState(originalWorkspace, true)
})
async function render(path: string, cashType?: 1 | 2) {
  await act(async () => root.render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[path]}>{cashType ? <PaymentsView type={cashType} /> : <FinanceDashboardPage />}<RouteState /></MemoryRouter></QueryClientProvider>))
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 15)) })
}
function button(label: string) { return [...host.querySelectorAll<HTMLButtonElement>('button')].find(el => el.textContent === label && !el.closest('[hidden]')) }
test('资金账龄明确包含现结月结，并提供两种真实账款入口', async () => {
  await render('/finance/dashboard')
  expect(host.textContent).toContain('包含现结和月结账款')
  for (const label of ['现结客户账款', '月结客户账款', '现结供应商账款', '月结供应商账款']) expect(button(label), label).toBeTruthy()
  await act(async () => button('月结客户账款')!.click())
  expect(host.querySelector('[data-route]')?.textContent).toBe('/reports/reconciliation/receivable')
})
test('没有报表查看权时资金卡片不提供月结报表入口，撤权实时生效', async () => {
  await render('/finance/dashboard')
  await act(async () => useAuthStore.getState().updateUser({ permissions: [P.FINANCE_ACCOUNT_VIEW, P.PAYMENT_VIEW] }))
  expect(button('月结客户账款')).toBeUndefined()
  expect(button('月结供应商账款')).toBeUndefined()
  expect(button('现结客户账款')).toBeTruthy()
})
test.each([1, 2] as const)('现结%s空列表明确显示范围并可进入月结账款', async type => {
  const sidePath = type === 1 ? 'payable' : 'receivable'
  await render(`/payments/${sidePath}`, type)
  expect(host.textContent).toContain('本页仅显示现结账款')
  expect(button('查看月结账款')).toBeTruthy()
  await act(async () => button('查看月结账款')!.click())
  expect(host.querySelector('[data-route]')?.textContent).toBe(`/reports/reconciliation/${sidePath}`)
})
test('现结页月结入口同样遵守报表权限', async () => {
  useAuthStore.getState().updateUser({ permissions: [P.PAYMENT_VIEW] })
  await render('/payments/receivable', 2)
  expect(button('查看月结账款')).toBeUndefined()
  expect(host.textContent).toContain('本页仅显示现结账款')
})
