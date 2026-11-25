// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { expect, test, vi } from 'vitest'
import { ApiClientError } from '@/api/client'
import { PERMISSIONS as P } from '@/lib/permission-codes'
import { useAuthStore } from '@/store/authStore'
import FinanceAccountsPage from './index'

const api = vi.hoisted(() => ({ list: vi.fn(), adjust: vi.fn(), remove: vi.fn() }))
vi.mock('@/api/finance', () => ({
  getAccountsApi: api.list,
  adjustAccountApi: api.adjust,
  deleteAccountApi: api.remove,
}))
function setPermissions(...permissions: string[]) {
  useAuthStore.setState({ user: { id: 9, roleId: 2, username: 'fixture', realName: '测试角色', roleName: '测试角色', permissions } })
}

test('余额冲突后保留目标，展示反向差额并等待再次确认', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  setPermissions(P.FINANCE_ACCOUNT_VIEW, P.FINANCE_ACCOUNT_ADJUST)
  const account = { id: 7, name: '测试银行账户', currentBalance: 100, openingBalance: 100, isActive: true, type: 1, code: 'FA7' }
  api.list.mockResolvedValue({ list: [account] })
  api.adjust.mockRejectedValueOnce(new ApiClientError({
    message: '账户余额已变化，请核对新余额后再次确认',
    status: 409,
    code: 'FINANCE_ACCOUNT_BALANCE_CHANGED',
    data: { currentBalance: 130 },
  })).mockResolvedValueOnce({ id: 7, balance: 120, diff: -10 })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(['finance-accounts', { keyword: '', type: '', isActive: '' }], { list: [account] })
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  try {
    await act(async () => root.render(<QueryClientProvider client={client}><FinanceAccountsPage /></QueryClientProvider>))
    const menu = host.querySelector<HTMLButtonElement>('[aria-label="更多操作"]')!
    await act(async () => menu.click())
    const adjustment = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(el => el.textContent === '余额调整')!
    await act(async () => adjustment.click())
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!
    const target = dialog.querySelector<HTMLInputElement>('input[type="number"]')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(target, '120')
      target.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const confirm = [...dialog.querySelectorAll('button')].find(el => el.textContent === '确认调整')!
    expect(dialog.textContent).toContain('+¥20.00')
    expect(dialog.querySelector('.fc-form-dialog-body')?.nextElementSibling?.contains(confirm)).toBe(true)
    await act(async () => confirm.click())
    expect(api.adjust.mock.calls[0]?.slice(0, 2)).toEqual([7, expect.objectContaining({ expectedBalance: 100, targetBalance: 120 })])
    expect(dialog.querySelector('[role="alert"]')?.textContent).toContain('再次确认')
    expect(dialog.textContent).toContain('-¥10.00')
    expect(target.value).toBe('120')
    expect(api.adjust).toHaveBeenCalledTimes(1)

    await act(async () => confirm.click())
    expect(api.adjust.mock.calls[1]?.slice(0, 2)).toEqual([7, expect.objectContaining({ expectedBalance: 130, targetBalance: 120 })])
  } finally {
    await act(async () => root.unmount())
    client.clear()
    host.remove()
    useAuthStore.setState({ user: null })
  }
})


test('资金账户只读角色可以查流水，删除权限撤回即关闭确认', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const account = { id: 9, name: '合成账户', openingBalance: 0, currentBalance: 0 }
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  api.list.mockResolvedValue({ list: [account] })
  client.setQueryData(['finance-accounts', { keyword: '', type: '', isActive: '' }], { list: [account] })
  const host = document.body.appendChild(document.createElement('div'))
  const root = createRoot(host)
  const render = async () => act(async () => root.render(<QueryClientProvider client={client}><FinanceAccountsPage /></QueryClientProvider>))
  const menu = () => host.querySelector<HTMLButtonElement>('[aria-label="更多操作"]')
  try {
    await act(async () => setPermissions(P.FINANCE_ACCOUNT_VIEW))
    await render()
    expect(host.textContent).toContain('流水')
    expect(menu()).toBeNull()

    await act(async () => setPermissions(P.FINANCE_ACCOUNT_VIEW, P.FINANCE_ACCOUNT_DELETE))
    await render()
    const chooseDelete = async () => {
      await act(async () => { menu()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })) })
      const remove = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(el => el.textContent === '删除')!
      await act(async () => remove.click())
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
    }
    await chooseDelete()
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('合成账户')

    await act(async () => setPermissions(P.FINANCE_ACCOUNT_VIEW))
    await render()
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(api.remove).not.toHaveBeenCalled()
    await act(async () => setPermissions(P.FINANCE_ACCOUNT_VIEW, P.FINANCE_ACCOUNT_DELETE))
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    await chooseDelete()
    api.remove.mockResolvedValue(undefined)
    const confirm = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(button => button.textContent === '确认')!
    await act(async () => confirm.click())
    expect(api.remove).toHaveBeenCalledExactlyOnceWith(9)
  } finally {
    await act(async () => root.unmount())
    client.clear()
    host.remove()
    useAuthStore.setState({ user: null })
  }
})
