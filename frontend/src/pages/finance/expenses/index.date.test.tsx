// @vitest-environment jsdom
import { act } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { expect, test, vi } from 'vitest'
import ExpenseClaimsPage from './index'

const api = vi.hoisted(() => ({ list: vi.fn(), detail: vi.fn(), categories: vi.fn(), update: vi.fn() }))
vi.mock('@/api/finance', () => ({
  getExpenseClaimsApi: api.list, getExpenseClaimApi: api.detail,
  getExpenseCategoriesApi: api.categories, updateExpenseClaimApi: api.update,
}))
vi.mock('@/hooks/usePermission', () => ({ usePermission: () => ({ can: () => true }) }))

test.each(['2026-11-01', '2026-10-31T16:00:00.000Z'])('保存报销草稿时保留北京业务日：%s', async happenedAt => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const claim = { id: 7, claimNo: 'OFFLINE-EX-7', title: '合成草稿', status: 1, statusName: '草稿', totalAmount: 5 }
  api.list.mockResolvedValue({ list: [claim], pagination: { total: 1 } })
  api.detail.mockResolvedValue({ ...claim, items: [{ categoryId: 1, amount: 5, happenedAt }] })
  api.categories.mockResolvedValue([{ id: 1, name: '合成费用' }])
  api.update.mockReset().mockResolvedValue(undefined)
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  try {
    await act(async () => root.render(<QueryClientProvider client={qc}><MemoryRouter><ExpenseClaimsPage /></MemoryRouter></QueryClientProvider>))
    const menu = () => host.querySelector<HTMLButtonElement>('button[aria-label="更多操作"]')
    await vi.waitFor(() => expect(menu()).not.toBeNull())
    await act(async () => menu()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })))
    const edit = () => [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(el => el.textContent === '编辑')
    await vi.waitFor(() => expect(edit()).toBeDefined())
    await act(async () => edit()!.click())
    const save = () => [...document.querySelectorAll('button')].find(el => el.textContent?.startsWith('保存修改'))
    await vi.waitFor(() => expect(save()?.disabled).toBe(false))
    await act(async () => save()!.click())
    await vi.waitFor(() => expect(api.update).toHaveBeenCalledWith(7, expect.objectContaining({
      items: [expect.objectContaining({ happenedAt: '2026-11-01' })],
    })))
  } finally {
    await act(async () => root.unmount())
    qc.clear()
    host.remove()
  }
})
