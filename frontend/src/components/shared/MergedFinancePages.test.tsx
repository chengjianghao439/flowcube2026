// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, useNavigate, type NavigateFunction } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { KeepAliveOutlet } from '@/components/layout/KeepAliveOutlet'
import { HOME_TAB, useWorkspaceStore } from '@/store/workspaceStore'
import { useAuthStore } from '@/store/authStore'
import { disposeWorkspaceHistoryGuard } from '@/router/workspaceHistoryGuard'
import { getAccountsApi, getActiveAccountsApi, getAccountTransactionsApi, createAccountApi } from '@/api/finance'
import { RegisterPaymentDialog } from '@/components/shared/payments/RegisterPaymentDialog'
import KeepAliveSection from './KeepAliveSection'
import { PERMISSIONS as P } from '@/lib/permission-codes'

vi.mock('@/api/finance', async importOriginal => ({
  ...await importOriginal<typeof import('@/api/finance')>(),
  getAccountsApi: vi.fn(async () => ({ list: [], summary: { totalBalance: 0, accountCount: 0 } })),
  getActiveAccountsApi: vi.fn(async () => []),
  getAccountTransactionsApi: vi.fn(async () => ({ list: [], summary: { inAmount: 0, outAmount: 0 }, pagination: { total: 0 } })),
  createAccountApi: vi.fn(),
}))
let root: Root, host: HTMLDivElement, qc: QueryClient, navigate: NavigateFunction
function RouterObserver() { navigate = useNavigate(); return null }
async function settle() {
  // 路由外壳与首次子页各一层lazy，逐次让Suspense提交后再等待下一层。
  for (let step = 0; step < 3; step++) await act(async () => { await vi.dynamicImportSettled(); await new Promise(resolve => setTimeout(resolve, 5)) })
}
async function click(label: string) {
  const button = [...document.querySelectorAll('button')].find(el => el.textContent?.trim() === label)
  expect(button, label).toBeTruthy()
  await act(async () => button!.click()); await settle()
}
async function change(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.clearAllMocks()
  useWorkspaceStore.setState({ tabs: [HOME_TAB], activeKey: HOME_TAB.key })
  useAuthStore.getState().login('offline', null, { id: 7, roleId: 5, username: 'offline', realName: '测试', roleName: '财务', permissions: [P.FINANCE_ACCOUNT_VIEW, P.FINANCE_ACCOUNT_UPDATE, P.PAYMENT_VIEW] })
  qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); qc.clear(); disposeWorkspaceHistoryGuard()
  useAuthStore.getState().logout()
})

test('真实资金表单切子页保持输入和未决提交；隐藏页不重新读，首次不取其余子页', async () => {
  let finish!: (result: { id: number; code: string }) => void
  vi.mocked(createAccountApi).mockImplementation(() => new Promise(resolve => { finish = resolve }))
  await act(async () => root.render(<QueryClientProvider client={qc}><MemoryRouter initialEntries={['/finance/accounts?keyword=old']}><RouterObserver /><KeepAliveOutlet /></MemoryRouter></QueryClientProvider>))
  await settle()
  expect(getAccountsApi).toHaveBeenCalledTimes(1)
  expect(getAccountTransactionsApi).not.toHaveBeenCalled()
  expect(getActiveAccountsApi).not.toHaveBeenCalled()
  await click('新建账户')
  await change(document.querySelector<HTMLInputElement>('input[placeholder="如：工商银行基本户"]')!, '未保存账户')
  const accountPage = [...host.querySelectorAll('h1')].find(el => el.textContent === '资金工作区')!.parentElement!
  await act(async () => navigate('/finance/transactions?keyword=other')); await settle()
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  await act(async () => { await qc.invalidateQueries({ queryKey: ['finance-accounts'] }) }); await settle()
  expect(getAccountsApi).toHaveBeenCalledTimes(1)
  await act(async () => navigate('/finance/accounts?keyword=old')); await settle()
  expect([...host.querySelectorAll('h1')].find(el => !el.closest('[hidden]'))!.parentElement).toBe(accountPage)
  expect(document.querySelector<HTMLInputElement>('input[placeholder="如：工商银行基本户"]')?.value).toBe('未保存账户')
  await click('保存')
  expect(createAccountApi).toHaveBeenCalledTimes(1)
  expect(createAccountApi).toHaveBeenCalledWith(expect.objectContaining({ name: '未保存账户' }))
  await act(async () => navigate('/finance/transactions?keyword=other')); await settle()
  await act(async () => navigate('/finance/accounts?keyword=old')); await settle()
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain('保存中…')
  expect(createAccountApi).toHaveBeenCalledTimes(1)
  await act(async () => finish({ id: 9, code: 'ACC-offline' })); await settle()
  expect(document.querySelector('[role="dialog"]')).toBeNull()
})

test('真实登记收款弹窗隐藏暂停账户读取，切回仍保留输入且不关闭业务', async () => {
  const closed = vi.fn()
  const record = { id: 11, type: 2 as const, typeName: '应收', orderNo: 'SO-offline', partyName: '脱敏客户', totalAmount: 20, paidAmount: 0, balance: 20, status: 1 as const, statusName: '未收', createdAt: '' }
  const draw = async (active: boolean) => {
    await act(async () => root.render(<QueryClientProvider client={qc}><KeepAliveSection active={active}><RegisterPaymentDialog open onClose={closed} type={2} record={record} /></KeepAliveSection></QueryClientProvider>)); await settle()
  }
  await draw(true)
  expect(getActiveAccountsApi).toHaveBeenCalledTimes(1)
  const input = document.querySelector<HTMLInputElement>('input[type="number"]')!
  await change(input, '12.34')
  await draw(false)
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  await act(async () => { await qc.invalidateQueries({ queryKey: ['finance-accounts', 'active'] }) }); await settle()
  expect(getActiveAccountsApi).toHaveBeenCalledTimes(1)
  await draw(true)
  expect(document.querySelector<HTMLInputElement>('input[type="number"]')?.value).toBe('12.34')
  expect(closed).not.toHaveBeenCalled()
})
