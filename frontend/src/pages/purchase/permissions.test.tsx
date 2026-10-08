// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import Page from './index'
import { useAuthStore } from '@/store/authStore'
import { HOME_TAB, useWorkspaceStore } from '@/store/workspaceStore'
import { PERMISSIONS as P } from '@/lib/permission-codes'

vi.mock('@/api/purchase', async original => ({ ...await original<typeof import('@/api/purchase')>(), getPurchaseListApi: async () => ({ list: [], pagination: { total: 0 } }) }))
vi.mock('@/components/print/OrderPrintOverlay', () => ({ OrderPrintOverlay: () => null }))
vi.mock('./PurchaseQueryDialog', () => ({ default: () => null }))
function Location() { return <output data-location>{useLocation().pathname}</output> }
beforeEach(() => useWorkspaceStore.setState({ tabs: [HOME_TAB], activeKey: HOME_TAB.key }))
afterEach(() => { useAuthStore.setState({ user: null, token: null }); useWorkspaceStore.getState().closeAll(); localStorage.clear() })

test.each([false, true])('采购新建入口按 purchase.order.create 开放：$0', async canCreate => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  useAuthStore.setState({ token: 'offline-fixture', user: { id: 9, username: 'fixture', realName: 'fixture', roleId: 2, roleName: 'fixture', permissions: [P.PURCHASE_ORDER_VIEW, ...(canCreate ? [P.PURCHASE_ORDER_CREATE] : [])] } })
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host), cache = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  try {
    await act(async () => root.render(<QueryClientProvider client={cache}><MemoryRouter initialEntries={['/purchase']}><Page /><Location /></MemoryRouter></QueryClientProvider>))
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) })
    const create = [...host.querySelectorAll('button')].find(button => button.textContent === '+ 新建采购单')
    expect(!!create).toBe(canCreate)
    if (create) {
      await act(async () => create.click())
      expect(host.querySelector('[data-location]')?.textContent).toBe('/purchase/new')
      expect(useWorkspaceStore.getState().tabs.some(tab => tab.path === '/purchase/new')).toBe(true)
    } else {
      expect(host.querySelector('[data-location]')?.textContent).toBe('/purchase')
      expect(useWorkspaceStore.getState().tabs.some(tab => tab.path === '/purchase/new')).toBe(false)
    }
  } finally { await act(async () => root.unmount()); cache.clear(); host.remove() }
})
