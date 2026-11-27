// @vitest-environment jsdom
import { act, useContext, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, useLocation, useNavigate, type NavigateFunction } from 'react-router-dom'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { resolveRouteComponent } from '@/router/routeRegistry'
import { TabPathContext } from '@/components/layout/TabPathContext'
import { useActiveWorkspaceTab } from '@/hooks/useActiveWorkspaceTab'
import { useAuthStore } from '@/store/authStore'
import { PERMISSIONS } from '@/lib/permission-codes'
import PageHeader from './PageHeader'
import { Suspense } from 'react'
import { HOME_TAB, useWorkspaceStore } from '@/store/workspaceStore'

function TestView() {
  const ownPath = useContext(TabPathContext)
  const active = useActiveWorkspaceTab()
  const [value, setValue] = useState('未筛选')
  return <div data-view={ownPath} data-active={String(active)}>
    <PageHeader title="原页标题" description="核对当前视图的记录。" actions={<button onClick={() => setValue('已筛选')}>查询</button>} />
    <p>{value}</p>
  </div>
}
vi.mock('@/pages/reports', () => ({ default: TestView }))
vi.mock('@/pages/reports/kpi', () => ({ default: TestView }))
vi.mock('@/pages/reports/profit-analysis', () => ({ default: TestView }))
vi.mock('@/pages/procurement', () => ({ default: TestView }))
vi.mock('@/pages/reports/replenishment', () => ({ default: TestView }))
vi.mock('@/pages/payments/receivable', () => ({ default: TestView }))
vi.mock('@/pages/reports/reconciliation-receivable', () => ({ default: TestView }))

let navigate: NavigateFunction
function Harness() {
  const location = useLocation()
  navigate = useNavigate()
  const Component = resolveRouteComponent(location.pathname)!
  return <TabPathContext.Provider value={location.pathname + location.search}>
    <Suspense fallback="加载"><Component /></Suspense>
  </TabPathContext.Provider>
}
let root: Root
let host: HTMLDivElement
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  useAuthStore.setState({ user: { roleId: 1, permissions: [] } as never })
  useWorkspaceStore.setState({ tabs: [HOME_TAB], activeKey: HOME_TAB.key })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove() })
async function render(path: string) {
  await act(async () => { root.render(<MemoryRouter initialEntries={[path]}><Harness /></MemoryRouter>) })
  await act(async () => { await vi.dynamicImportSettled() })
}
function view(path: string) { return host.querySelector(`[data-view="${path}"]`)! }

test('原合并路由直接挂载各自独立页面，不渲染合并标签栏', async () => {
  await render('/reports')
  expect(host.querySelector('h1')?.textContent).toBe('原页标题')
  expect(host.querySelector('[data-page-group]')).toBeNull()
  expect(host.querySelectorAll('[data-view]')).toHaveLength(1)
  expect(view('/reports').getAttribute('data-active')).toBe('true')

  await act(async () => navigate('/reports/kpi'))
  await act(async () => { await vi.dynamicImportSettled() })
  expect(view('/reports/kpi').getAttribute('data-active')).toBe('true')
})

test('只有报表权限时补货建议独立挂载，不挂载采购计划', async () => {
  useAuthStore.setState({ user: { roleId: 5, permissions: [PERMISSIONS.REPORT_VIEW] } as never })
  await render('/reports/replenishment')
  expect(host.querySelector('[data-view="/reports/replenishment"]')).toBeTruthy()
  expect(host.querySelector('[data-page-group]')).toBeNull()
  expect(host.querySelector('[data-view="/procurement"]')).toBeNull()
})

test('现结账款与月结对账各自独立挂载，不互相包裹', async () => {
  await render('/reports/reconciliation/receivable?partyId=7')
  expect(host.querySelector('[data-page-group]')).toBeNull()
  expect(view('/reports/reconciliation/receivable?partyId=7').getAttribute('data-active')).toBe('true')
  await act(async () => navigate('/payments/receivable?keyword=old'))
  await act(async () => { await vi.dynamicImportSettled() })
  expect(view('/payments/receivable?keyword=old').getAttribute('data-active')).toBe('true')
})
