// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { expect, test, vi } from 'vitest'
import RefundsPage from './index'
import FinanceAccountsPage from '../finance/accounts'

vi.mock('@/api/refund', async original => ({ ...await original<typeof import('@/api/refund')>(), getRefundListApi: async () => ({ list: [], pagination: { total: 0 } }) }))
vi.mock('@/api/finance', async original => ({ ...await original<typeof import('@/api/finance')>(), getActiveAccountsApi: async () => [], getAccountsApi: async () => ({ list: [], pagination: { total: 0 } }) }))
vi.mock('@/hooks/usePermission', () => ({ usePermission: () => ({ can: () => true }) }))

test.each([
  { Component: RefundsPage, action: '+ 新建退款单', labels: ['销售单号 *', '退款金额 *', '退款账户', '退款日期', '备注'] },
  { Component: FinanceAccountsPage, action: '新建账户', labels: ['账户名称 *', '类型 *', '账号', '开户行', '户名', '期初余额', '备注'] },
  { Component: FinanceAccountsPage, action: '查询', labels: ['关键字', '账户类型', '状态'] },
])('$action 每个可见字段标签都关联实际输入控件', async ({ Component, action, labels }) => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host), cache = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  try {
    await act(async () => root.render(<QueryClientProvider client={cache}><MemoryRouter><Component /></MemoryRouter></QueryClientProvider>))
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) })
    const trigger = [...host.querySelectorAll('button')].find(button => button.textContent === action)
    expect(trigger).toBeTruthy()
    await act(async () => trigger!.click())
    for (const text of labels) {
      const label = [...document.querySelectorAll('label')].find(label => label.textContent === text)!
      expect(label, text).toBeTruthy()
      expect(label.htmlFor, text).not.toBe('')
      expect(document.getElementById(label.htmlFor)?.matches('input,button,textarea'), text).toBe(true)
    }
  } finally { await act(async () => root.unmount()); cache.clear(); host.remove() }
})
