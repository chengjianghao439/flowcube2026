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
    <PageHeader title="原页标题" actions={<button onClick={() => setValue('已筛选')}>查询</button>} />
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
async function click(label: string) {
  const link = Array.from(host.querySelectorAll('a,button')).find(node => node.textContent === label) as HTMLElement
  expect(link, label).toBeTruthy()
  await act(async () => link.click())
  await act(async () => { await vi.dynamicImportSettled() })
}

test('标题下切换合并视图，保留筛选且隐藏视图不再活动', async () => {
  await render('/reports')
  expect(host.querySelector('h1')?.textContent).toBe('报表中心')
  expect(host.querySelectorAll('[data-view]')).toHaveLength(1)
  await click('查询')
  await click('经营概览')
  expect(view('/reports').textContent).toContain('已筛选')
  expect(view('/reports').getAttribute('data-active')).toBe('false')
  expect(view('/reports/kpi').getAttribute('data-active')).toBe('true')
  await act(async () => navigate(-1))
  expect(view('/reports').getAttribute('data-active')).toBe('true')
  expect(view('/reports').textContent).toContain('已筛选')
})

test('只有报表权限时采购建议不挂载采购计划，直达无权地址也不能渲染业务', async () => {
  useAuthStore.setState({ user: { roleId: 5, permissions: [PERMISSIONS.REPORT_VIEW] } as never })
  await render('/reports/replenishment')
  expect(host.textContent).toContain('采购建议')
  expect(host.textContent).not.toContain('采购计划')
  expect(host.querySelectorAll('[data-view]')).toHaveLength(1)
  await act(async () => navigate('/procurement'))
  expect(host.textContent).toContain('无访问权限')
  expect(host.querySelectorAll('[data-view][data-active="true"]')).toHaveLength(0)
  expect(host.querySelector('[data-view="/procurement"]')).toBeNull()
})

test('财务组从持久child上下文打开，首次访问才挂载，切回保留同实例筛选', async () => {
  useWorkspaceStore.getState().addTab({ key: '/payments/receivable', path: '/payments/receivable?keyword=old', title: '旧页' })
  useWorkspaceStore.getState().syncFromLocation('/reports/reconciliation/receivable?partyId=7')
  await render('/reports/reconciliation/receivable?partyId=7')
  expect(host.querySelector('h1')?.textContent).toBe('客户往来')
  expect(host.querySelectorAll('[data-view]')).toHaveLength(1)
  expect(host.querySelector('a[href="/payments/receivable?keyword=old"]')).toBeTruthy()
  await click('现结账款'); await click('查询')
  const original = view('/payments/receivable?keyword=old')
  await click('月结对账'); await click('现结账款')
  expect(view('/payments/receivable?keyword=old')).toBe(original)
  expect(original.textContent).toContain('已筛选')
})
