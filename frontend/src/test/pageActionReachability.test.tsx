// @vitest-environment jsdom
import { act, type ComponentType } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, expect, test, vi } from 'vitest'
import { getByRole, queryByRole } from '@testing-library/dom'
import SaleReturnFormPage from '@/pages/returns/sale/form'
import PurchaseReturnFormPage from '@/pages/returns/purchase/form'
import HandlingScrapPage from '@/pages/disposal/HandlingScrapPage'
import SupplierRefundCreatePage from '@/pages/supplier-refunds/CreateRefundPage'
import { TabPathContext } from '@/components/layout/TabPathContext'
import { useAuthStore } from '@/store/authStore'
import { useWorkspaceStore, HOME_TAB } from '@/store/workspaceStore'
import { useDirtyGuardStore } from '@/store/dirtyGuardStore'
import { buildWorkspaceTabRegistrationFromPath } from '@/router/workspaceRouteMeta'
import { setApiClientBaseURL } from '@/api/client'
import { PERMISSIONS as P } from '@/lib/permission-codes'
import { WorkspaceListReturnButton } from '@/components/shared/WorkspaceListReturnButton'

const mocks = vi.hoisted(() => ({ detail: vi.fn(), write: vi.fn() }))
vi.mock('@/api/returns', () => ({ getSaleReturnDetailApi: mocks.detail, getPurchaseReturnDetailApi: mocks.detail, createSaleReturnApi: mocks.write, createPurchaseReturnApi: mocks.write }))
vi.mock('@/components/finder', () => ({ CustomerFinder: () => null, SupplierFinder: () => null, ProductFinder: () => null }))
vi.mock('@/components/shared/WarehouseSelect', () => ({ WarehouseSelect: () => null }))
vi.mock('@/hooks/useProductQtyPolicies', () => ({ useProductQtyPolicies: () => () => true }))

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  localStorage.clear(); sessionStorage.clear(); vi.clearAllMocks()
  setApiClientBaseURL('/t07-fixture')
  useAuthStore.getState().login('fixture', null, { id: 9, username: 'fixture', realName: '合成账号', roleId: 5, roleName: '合成角色', permissions: [P.RETURN_ORDER_VIEW, P.RETURN_ORDER_CREATE, P.INVENTORY_DISPOSAL_VIEW, P.SUPPLIER_REFUND_VIEW] })
  useWorkspaceStore.setState({ tabs: [HOME_TAB], activeKey: HOME_TAB.key })
  useDirtyGuardStore.setState({ dirtyTabs: {}, pendingConfirm: null, bypassNextBlock: false })
  mocks.detail.mockRejectedValue(new Error('fixture missing'))
})

function Location() { const location = useLocation(); return <output aria-label="当前位置">{location.pathname + location.search}</output> }
async function mount(Page: ComponentType, path: string, listPath: string) {
  const list = buildWorkspaceTabRegistrationFromPath(listPath), draft = buildWorkspaceTabRegistrationFromPath(path)
  useWorkspaceStore.setState({ tabs: [HOME_TAB, { ...list, title: '原列表', closable: true }, { ...draft, title: '当前页', closable: true }], activeKey: draft.key })
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host), cache = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  async function render() { await act(async () => { root.render(<QueryClientProvider client={cache}><MemoryRouter initialEntries={[path]}><Location /><TabPathContext.Provider value={path}><Page /></TabPathContext.Provider></MemoryRouter></QueryClientProvider>) }) }
  await render()
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)) })
  return { host, draft, render, close: () => { act(() => root.unmount()); cache.clear(); host.remove() } }
}
async function click(host: HTMLElement, name: string) { await act(async () => getByRole(host, 'button', { name }).click()) }

for (const [kind, Page] of [['sale', SaleReturnFormPage], ['purchase', PurchaseReturnFormPage]] as const) {
  test(`${kind} new return requires dirty confirmation and returns to the original filtered list without creating`, async () => {
    const listPath = `/returns/${kind}?keyword=KEEP&status=1`, path = `/returns/${kind}/new`
    const view = await mount(Page, path, listPath)
    try {
      const order = view.host.querySelector<HTMLInputElement>('input[placeholder="输入原单号"]')!
      await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(order, '未保存原单'); order.dispatchEvent(new Event('input', { bubbles: true })) })
      await click(view.host, '返回列表')
      expect(useDirtyGuardStore.getState().pendingConfirm).not.toBeNull()
      expect(getByRole(view.host, 'status', { name: '当前位置' }).textContent).toBe(path)
      expect(useWorkspaceStore.getState().tabs.some(tab => tab.key === view.draft.key)).toBe(true)
      await act(async () => useDirtyGuardStore.getState().resolveConfirm(false))
      expect(order.value).toBe('未保存原单')
      await click(view.host, '返回列表')
      await act(async () => useDirtyGuardStore.getState().resolveConfirm(true))
      expect(getByRole(view.host, 'status', { name: '当前位置' }).textContent).toBe(listPath)
      expect(useWorkspaceStore.getState().tabs.some(tab => tab.key === view.draft.key)).toBe(false)
      expect(mocks.write).not.toHaveBeenCalled()
    } finally { view.close() }
  })
  test.each(['new?handlingSourceId=bad', 'bad', '11'])(`${kind} unavailable %s has a standard heading and permitted original-list exit`, async suffix => {
    const listPath = `/returns/${kind}?keyword=KEEP`
    const view = await mount(Page, `/returns/${kind}/${suffix}`, listPath)
    try {
      expect(getByRole(view.host, 'heading', { level: 1 })).toBeTruthy()
      await click(view.host, '返回列表')
      expect(getByRole(view.host, 'status', { name: '当前位置' }).textContent).toBe(listPath)
      expect(mocks.write).not.toHaveBeenCalled()
    } finally { view.close() }
  })
  test(`${kind} create-only account gets no list exit`, async () => {
    useAuthStore.getState().updateUser({ permissions: [P.RETURN_ORDER_CREATE] })
    for (const suffix of ['new', 'bad', 'new?handlingSourceId=bad']) {
      const view = await mount(Page, `/returns/${kind}/${suffix}`, `/returns/${kind}?keyword=KEEP`)
      try { expect(queryByRole(view.host, 'button', { name: '返回列表' })).toBeNull() } finally { view.close() }
    }
  })
}

test('invalid scrap and refund sources expose only permitted destinations and preserve their queries', async () => {
  const cases = [
    { Page: HandlingScrapPage, path: '/disposals/new?handlingSourceId=bad', list: '/disposals?keyword=KEEP', label: '返回报废处理', permission: P.INVENTORY_DISPOSAL_VIEW },
    { Page: SupplierRefundCreatePage, path: '/supplier-refunds/new?purchaseReturnId=bad', list: '/supplier-refunds?detailId=61', label: '返回供应商退款', permission: P.SUPPLIER_REFUND_VIEW },
  ]
  for (const c of cases) {
    useAuthStore.getState().updateUser({ permissions: [c.permission, P.RETURN_ORDER_VIEW] })
    const view = await mount(c.Page, c.path, c.list)
    try {
      expect(getByRole(view.host, 'heading', { level: 1 })).toBeTruthy()
      expect(view.host.querySelector('[role="alert"]')).toBeTruthy()
      await click(view.host, c.label)
      expect(getByRole(view.host, 'status', { name: '当前位置' }).textContent).toBe(c.list)
      await act(async () => useAuthStore.getState().updateUser({ permissions: [] }))
      expect(queryByRole(view.host, 'button', { name: c.label })).toBeNull()
      expect(queryByRole(view.host, 'button', { name: '返回采购退货' })).toBeNull()
    } finally { view.close() }
  }
})

test('refund invalid source can return to purchase returns independently of refund-list permission', async () => {
  useAuthStore.getState().updateUser({ permissions: [P.RETURN_ORDER_VIEW] })
  const view = await mount(SupplierRefundCreatePage, '/supplier-refunds/new?purchaseReturnId=bad', '/returns/purchase?keyword=ORIGINAL')
  try {
    expect(queryByRole(view.host, 'button', { name: '返回供应商退款' })).toBeNull()
    await click(view.host, '返回采购退货')
    expect(getByRole(view.host, 'status', { name: '当前位置' }).textContent).toBe('/returns/purchase?keyword=ORIGINAL')
  } finally { view.close() }
})

test('permission revoked during dirty confirmation cannot open the list or close the draft', async () => {
  const path = '/returns/sale/new'
  const view = await mount(SaleReturnFormPage, path, '/returns/sale?keyword=KEEP')
  try {
    await act(async () => useDirtyGuardStore.getState().setDirty(view.draft.key, true))
    await click(view.host, '返回列表')
    await act(async () => useAuthStore.getState().updateUser({ permissions: [P.RETURN_ORDER_CREATE] }))
    await act(async () => useDirtyGuardStore.getState().resolveConfirm(true))
    expect(getByRole(view.host, 'status', { name: '当前位置' }).textContent).toBe(path)
    expect(useWorkspaceStore.getState().tabs.some(tab => tab.key === view.draft.key)).toBe(true)
    expect(useDirtyGuardStore.getState().bypassNextBlock).toBe(false)
    expect(mocks.write).not.toHaveBeenCalled()
  } finally { view.close() }
})

test.each(['session', 'server', 'reused-tab', 'busy'] as const)('pending leave loses eligibility after %s changes without bypassing the next dirty guard', async change => {
  const path = '/returns/sale/new', key = buildWorkspaceTabRegistrationFromPath(path).key
  let busy = false
  function Page() { return <WorkspaceListReturnButton listPath="/returns/sale" permission={P.RETURN_ORDER_VIEW} tabKey={key} disabled={busy} /> }
  const view = await mount(Page, path, '/returns/sale?keyword=KEEP')
  try {
    await act(async () => useDirtyGuardStore.getState().setDirty(key, true))
    await click(view.host, '返回列表')
    expect(useDirtyGuardStore.getState().pendingConfirm).not.toBeNull()
    await act(async () => {
      if (change === 'session') useAuthStore.getState().login('new-fixture', null, useAuthStore.getState().user!)
      if (change === 'server') setApiClientBaseURL('/t07-other-server')
      if (change === 'reused-tab') useWorkspaceStore.setState(state => ({ tabs: state.tabs.map(tab => tab.key === key ? { ...tab, title: '同键新草稿' } : tab) }))
      if (change === 'busy') busy = true
    })
    await view.render()
    await act(async () => useDirtyGuardStore.getState().resolveConfirm(true))
    expect(getByRole(view.host, 'status', { name: '当前位置' }).textContent).toBe(path)
    expect(useWorkspaceStore.getState().tabs.some(tab => tab.key === key)).toBe(true)
    expect(useDirtyGuardStore.getState().bypassNextBlock).toBe(false)
  } finally { view.close() }
})
