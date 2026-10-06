// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, expect, test, vi } from 'vitest'
import PurchaseFormPage from './index'
import { TabPathContext } from '@/components/layout/TabPathContext'
import { useAuthStore } from '@/store/authStore'
import { PERMISSIONS } from '@/lib/permission-codes'
import { useWorkspaceStore, HOME_TAB } from '@/store/workspaceStore'
function CurrentRoute() { const location = useLocation(); return <output data-route>{location.pathname + location.search}</output> }
const mocks = vi.hoisted(() => ({ write: vi.fn() }))
vi.mock('@/api/purchase', () => ({ confirmPurchaseApi: mocks.write, cancelPurchaseApi: mocks.write, updatePurchaseApi: mocks.write, createPurchaseApi: mocks.write }))
vi.mock('@/components/shared/OrderDetailSections', () => ({ OrderDetailSections: ({ children }: { children: React.ReactNode }) => <>{children}</> }))
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); vi.resetAllMocks(); useWorkspaceStore.setState({ tabs: [HOME_TAB], activeKey: HOME_TAB.key }) })
test.each([true, false])('采购原单退货入口只按共享创建权限导航，头状态与累计收货不能代替来源规则：%s', async allowed => {
  useAuthStore.setState({ token: 'fixture', user: { id: 5, roleId: 5, permissions: allowed ? [PERMISSIONS.RETURN_ORDER_CREATE] : [] } as never })
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host)
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } })
  client.setQueryData(['purchase', 12], { id: 12, orderNo: 'PO12', status: 1, totalReceivedQty: 0, supplierName: '供应商', warehouseName: '仓库', createdAt: '2026-10-01', items: [] })
  try {
    await act(async () => root.render(<MemoryRouter><CurrentRoute /><QueryClientProvider client={client}><TabPathContext.Provider value="/purchase/12"><PurchaseFormPage /></TabPathContext.Provider></QueryClientProvider></MemoryRouter>))
    const button = [...host.querySelectorAll('button')].find(b => b.textContent === '发起退货')
    if (!allowed) expect(button).toBeUndefined()
    else { expect(button).toBeTruthy(); await act(async () => button!.click()); expect(useWorkspaceStore.getState().activeKey).toBe('/returns/purchase/new?sourceId=12&sourceNo=PO12'); expect(host.querySelector('[data-route]')?.textContent).toBe('/returns/purchase/new?sourceId=12&sourceNo=PO12') }
    expect(mocks.write).not.toHaveBeenCalled()
  } finally { act(() => root.unmount()); client.clear(); host.remove() }
})
