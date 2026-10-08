// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, expect, test, vi } from 'vitest'
import Page from './index'
import { useAuthStore } from '@/store/authStore'
import { PERMISSIONS as P } from '@/lib/permission-codes'

vi.mock('@/api/customers', async original => ({ ...await original<typeof import('@/api/customers')>(), getCustomersApi: async () => ({ list: [{ id: 7, code: 'C7', name: '合成客户', settlementType: 1, isActive: true }], pagination: { total: 1 } }) }))
afterEach(() => { useAuthStore.setState({ user: null, token: null }); localStorage.clear() })
test.each([
  { extra: [], expected: [] },
  { extra: [P.CUSTOMER_UPDATE], expected: ['编辑'] },
  { extra: [P.CUSTOMER_DELETE], expected: ['删除'] },
  { extra: [P.PRICE_LIST_UPDATE], expected: ['绑定价格'] },
  { extra: [P.PAYMENT_VIEW], expected: ['往来明细'] },
])('客户操作仅按真实动作权限开放 $extra，往来查看独立', async ({ extra, expected }) => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  useAuthStore.setState({ token: 'offline-fixture', user: { id: 9, username: 'fixture', realName: 'fixture', roleId: 2, roleName: 'fixture', permissions: [P.CUSTOMER_VIEW, ...extra] } })
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host), cache = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  try {
    await act(async () => root.render(<QueryClientProvider client={cache}><MemoryRouter><Page /></MemoryRouter></QueryClientProvider>))
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) })
    for (const action of ['编辑', '删除', '绑定价格', '往来明细']) {
      const visible = [...document.querySelectorAll('button,[role="menuitem"]')].some(element => element.textContent?.trim() === action)
      expect(visible, action).toBe(expected.includes(action))
    }
    expect(host.querySelector('button[aria-label="更多操作"]')).toBeNull()
  } finally { await act(async () => root.unmount()); cache.clear(); host.remove() }
})
