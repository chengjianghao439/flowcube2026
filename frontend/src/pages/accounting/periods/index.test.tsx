// @vitest-environment jsdom
import { chooseTableAction } from '@/test/chooseTableAction'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { expect, test, vi } from 'vitest'
import AccountingPeriodsPage from './index'
import { closePeriodApi } from '@/api/accounting'
import { ApiClientError } from '@/api/client'

vi.mock('@/hooks/usePermission', () => ({ usePermission: () => ({ can: () => true }) }))

vi.mock('@/api/accounting', () => ({
  getPeriodsApi: async () => [{ period: '202612', closed: false, closingStatus: 'not_required', yearClosingStatus: 'missing' }],
  generateClosingVouchersApi: vi.fn(),
  closePeriodApi: vi.fn(),
  reopenPeriodApi: vi.fn(),
}))

test('结账失败在确认弹窗内保留接口给出的原因和下一步', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const reason = '期间 202611 尚不能结账：损益结转凭证未生成。请先生成结转凭证'
  vi.mocked(closePeriodApi).mockRejectedValue(new ApiClientError({
    message: reason,
    status: 409,
    code: 'ACCT_CLOSING_VOUCHER_REQUIRED',
  }))
  const button = (label: string, within: ParentNode) => [...within.querySelectorAll('button')].find(b => b.textContent?.trim() === label)!
  try {
    await act(async () => root.render(<QueryClientProvider client={client}><AccountingPeriodsPage /></QueryClientProvider>))
    await vi.waitFor(() => expect(button('生成结转', host)).toBeDefined())
    await chooseTableAction('2026 年 12 月', '结账')
    const dialog = document.querySelector('[role="dialog"]')!
    expect(dialog.querySelector('.fc-form-dialog-body')).toBeNull()
    const footer = dialog.querySelector('.fc-dialog-footer')!
    await act(async () => button('确认结账', footer).click())
    await vi.waitFor(() => expect(dialog.querySelector('[role="alert"]')?.textContent).toBe(reason))
    expect(dialog.querySelector('.fc-form-dialog-body [role="alert"]')?.textContent).toBe(reason)
    expect(dialog.querySelector('.fc-form-dialog-body')?.nextElementSibling).toBe(footer)
    expect(closePeriodApi).toHaveBeenCalledOnce()
    expect(host.textContent).toContain('未结账')
  } finally {
    await act(async () => root.unmount())
    client.clear()
    host.remove()
  }
})
