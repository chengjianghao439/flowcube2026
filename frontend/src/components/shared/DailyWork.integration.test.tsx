// @vitest-environment jsdom
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, useLocation, useNavigate, type NavigateFunction } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import DashboardPage from '@/pages/dashboard'
import { DailyWork } from './DailyWork'
import RoleWorkbenchPage from '@/pages/reports/role-workbench'
import { KeepAliveOutlet } from '@/components/layout/KeepAliveOutlet'
import { TabPathContext } from '@/components/layout/TabPathContext'
import { useAuthStore } from '@/store/authStore'
import { HOME_TAB, useWorkspaceStore } from '@/store/workspaceStore'
import { useDirtyGuardStore } from '@/store/dirtyGuardStore'
import { disposeWorkspaceHistoryGuard } from '@/router/workspaceHistoryGuard'
import { PERMISSIONS as P } from '@/lib/permission-codes'
import { hasPermission } from '@/lib/permissions'
import { isRegisteredErpRoute, resolveRoutePermission, resolveRouteTitle } from '@/router/routeDefinitions'
import { getDashboardLayoutApi, saveDashboardLayoutApi } from '@/api/dashboard'
import { WIDGETS, mergeLayout } from '@/components/dashboard/registry'
import type { DashboardLayout } from '@/types/dashboard'
import { getRoleWorkbenchApi, type RoleWorkbenchData } from '@/api/reports'
import { getNotificationsApi, type NotificationItem } from '@/api/notifications'

vi.mock('@/api/dashboard', async importOriginal => ({
  ...await importOriginal<typeof import('@/api/dashboard')>(),
  getDashboardLayoutApi: vi.fn(), saveDashboardLayoutApi: vi.fn(async (layout: DashboardLayout) => layout),
  getLowStockApi: vi.fn(async () => []),
  getDashboardSummaryApi: vi.fn(async () => ({ pendingSaleOrders: 3 })),
}))
vi.mock('@/api/reports', async importOriginal => ({
  ...await importOriginal<typeof import('@/api/reports')>(),
  getRoleWorkbenchApi: vi.fn(async () => ({ sections: [], summary: {}, topAlert: null })),
}))
vi.mock('@/api/notifications', () => ({ getNotificationsApi: vi.fn(async () => ({ items: [] })) }))
const retiredIssues = vi.hoisted(() => vi.fn(async () => ({ list: [], pagination: { total: 0 }, summary: {} })))
vi.mock('@/api/fulfillment', async importOriginal => ({
  ...await importOriginal<typeof import('@/api/fulfillment')>(),
  getFulfillmentIssues: retiredIssues,
}))
// KeepAlive 自身与 store 使用真实实现；只替换目的页业务体，观察内存筛选/草稿是否保留。
vi.mock('@/router/routeRegistry', async importOriginal => ({
  ...await importOriginal<typeof import('@/router/routeRegistry')>(),
  resolveRouteComponent: (path: string) => path === '/dashboard' ? DashboardPage : path === '/reports/role-workbench' ? RoleWorkbenchPage : DraftTarget,
}))

const sale = [P.DASHBOARD_VIEW, P.SALE_ORDER_VIEW, P.CUSTOMER_VIEW]
const warehouse = [P.DASHBOARD_VIEW, P.WAREHOUSE_TASK_VIEW, P.INVENTORY_VIEW, P.PRINT_JOB_VIEW]
const finance = [P.DASHBOARD_VIEW, P.PAYMENT_VIEW]
const candidates = ['/sale', '/purchase', '/inbound-tasks', '/picking-waves', '/inventory', '/payments/receivable', '/payments/payable', '/logistics', '/settings/barcode-print-query']
let host: HTMLDivElement, root: Root, qc: QueryClient, saved: DashboardLayout, navigate: NavigateFunction

function login(permissions: string[], id = 7, roleId = 5) {
  useAuthStore.getState().login('test-token', null, { id, username: `test-${id}`, realName: '测试岗位', roleId, roleName: '岗位', permissions })
}
function DraftTarget() {
  const [draft, setDraft] = useState('')
  return <input aria-label="原标签草稿" value={draft} onChange={e => setDraft(e.target.value)} />
}
function LocationObserver() {
  navigate = useNavigate()
  const location = useLocation()
  return <output>{location.pathname + location.search}</output>
}
const work = () => host.querySelector<HTMLElement>('nav[aria-label="常用工作"]')
const labels = () => [...(work()?.querySelectorAll('button') ?? [])].map(b => b.textContent)
const groups = () => [...(work()?.querySelectorAll('h3') ?? [])].map(h => h.textContent)
const button = (label: string) => [...host.querySelectorAll('button')].find(b => b.textContent?.trim() === label)
async function settle() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)) }) }
async function render(page: 'dashboard' | 'workbench' | 'daily' = 'daily', keepAlive = false, initial = '/dashboard') {
  const path = keepAlive || page !== 'workbench' ? initial : '/reports/role-workbench'
  await act(async () => root.render(<QueryClientProvider client={qc}><MemoryRouter initialEntries={[path]}><LocationObserver />{keepAlive ? <KeepAliveOutlet /> : <TabPathContext.Provider value={path}>{page === 'dashboard' ? <DashboardPage /> : page === 'workbench' ? <RoleWorkbenchPage /> : <DailyWork />}</TabPathContext.Provider>}</MemoryRouter></QueryClientProvider>))
  await settle()
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.clearAllMocks()
  vi.mocked(getRoleWorkbenchApi).mockResolvedValue({ sections: [], summary: { totalAlerts: 0, warehouseCount: 0, saleCount: 0, managementCount: 0 }, topAlert: null })
  vi.mocked(getNotificationsApi).mockResolvedValue({ items: [], total: 0, counts: {} })
  saved = { widgets: WIDGETS.map(w => ({ id: w.id, visible: false, w: w.defaultW })) }
  vi.mocked(getDashboardLayoutApi).mockImplementation(async () => saved)
  useWorkspaceStore.setState({ tabs: [HOME_TAB], activeKey: HOME_TAB.key })
  useDirtyGuardStore.setState({ dirtyTabs: {}, pendingConfirm: null })
  login(sale)
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount()); qc.clear(); host.remove()
  disposeWorkspaceHistoryGuard()
  useAuthStore.getState().logout()
  useWorkspaceStore.setState({ tabs: [HOME_TAB], activeKey: HOME_TAB.key })
})

test.each([
  ['销售', sale, ['销售订单'], ['采购与销售']],
  ['仓库', warehouse, ['库存管理', '条码打印查询'], ['仓库作业', '物流与打印']],
  ['财务', finance, ['客户往来', '供应商往来'], ['财务往来']],
] as const)('%s常用工作组件沿用当前岗位的列表权限', async (_, permissions, expected, expectedGroups) => {
  login([...permissions]); await render()
  expect(labels()).toEqual(expected); expect(groups()).toEqual(expectedGroups)
  expect(hasPermission([...permissions], resolveRoutePermission('/reports/role-workbench')!, 5)).toBe(false)
  expect(work()?.textContent).not.toMatch(/会计|人事|设置|采购跟进|PDA/)
})
test('当前多岗位权限合并，每个候选使用已注册标题及权限', async () => {
  const permissions = [P.DASHBOARD_VIEW, P.SALE_ORDER_VIEW, P.PURCHASE_ORDER_VIEW, P.INBOUND_ORDER_VIEW, P.PICKING_WAVE_VIEW, P.INVENTORY_VIEW, P.PAYMENT_VIEW, P.REPORT_VIEW, P.LOGISTICS_VIEW, P.PRINT_JOB_VIEW]
  login(permissions); await render()
  expect(labels()).toEqual(candidates.map(resolveRouteTitle))
  expect(groups()).toHaveLength(4)
  for (const path of candidates) {
    expect(isRegisteredErpRoute(path)).toBe(true)
    expect(hasPermission(permissions, resolveRoutePermission(path)!, 5)).toBe(true)
    await act(async () => button(resolveRouteTitle(path)!)!.click())
    expect(useWorkspaceStore.getState().tabs.find(tab => tab.path === path)?.title).toBe(resolveRouteTitle(path))
    expect(host.querySelector('output')?.textContent).toBe(path)
  }
})
test('只有仓库任务查看不代替批次拣货或收货权限，撤权实时移除空组', async () => {
  login(warehouse); await render()
  expect(labels()).not.toContain('批次拣货'); expect(labels()).not.toContain('收货订单')
  await act(async () => useAuthStore.getState().updateUser({ permissions: [P.DASHBOARD_VIEW, P.PICKING_WAVE_VIEW, P.INBOUND_ORDER_VIEW] }))
  expect(labels()).toEqual(['收货订单', '批次拣货']); expect(groups()).toEqual(['仓库作业'])
  await act(async () => useAuthStore.getState().updateUser({ permissions: [P.DASHBOARD_VIEW] }))
  expect(work()).toBeNull()
})
test('退出及切换账号不留下旧权限入口，超级管理员退出后也为空', async () => {
  login([], 1, 1); await render(); expect(labels()).toHaveLength(candidates.length + 1)
  await act(async () => useAuthStore.getState().logout()); expect(work()).toBeNull()
  await act(async () => login(finance, 8)); expect(labels()).toEqual(['客户往来', '供应商往来'])
  await act(async () => login(sale, 9)); expect(labels()).toEqual(['销售订单'])
})
test('待办中心保留常用工作且仍保留自身REPORT_VIEW门槛', async () => {
  login([...warehouse, P.REPORT_VIEW]); await render('workbench')
  expect(labels()).toEqual(['库存管理', '客户往来', '供应商往来', '条码打印查询'])
  expect(host.textContent).not.toContain('订单履约待办'); expect(host.textContent).toContain('财务与系统提醒')
  expect(retiredIssues).not.toHaveBeenCalled()
  expect(resolveRoutePermission('/reports/role-workbench')).toBe(P.REPORT_VIEW)
})
test('仪表盘移除常用工作后保留卡片顺序、隐藏偏好与保存载荷', async () => {
  saved.widgets = [{ id: 'kpi-pending-sale', visible: true, w: 3 }, { id: 'kpi-pending-purchase', visible: false, w: 2 }, ...saved.widgets.filter(w => !['kpi-pending-sale', 'kpi-pending-purchase'].includes(w.id))]
  await render('dashboard'); expect(work()).toBeNull()
  expect([...host.querySelectorAll('[data-widget-id]')].map(el => el.getAttribute('data-widget-id'))).toEqual(['kpi-pending-sale'])
  await act(async () => button('编辑仪表盘')!.click()); expect(work()).toBeNull()
  expect(button('保存')!.disabled).toBe(true)
  const narrower = host.querySelector<HTMLButtonElement>('[aria-label="减小待处理销售宽度"]')!
  await act(async () => narrower.click())
  await act(async () => button('保存')!.click()); await settle()
  const expected = mergeLayout(saved)
  expect(saveDashboardLayoutApi).toHaveBeenCalledWith({
    widgets: expected.widgets.map(widget => widget.id === 'kpi-pending-sale' ? { ...widget, w: 2 } : widget),
  })
  expect(work()).toBeNull()
})
test('待办常用入口通过真实工作区保留原标签query、筛选草稿及其他单据', async () => {
  const existing = { key: '/sale', path: '/sale?keyword=old', title: '销售订单', closable: true }
  const detail = { key: '/sale/33', path: '/sale/33?focus=progress', title: 'SO-33', closable: true }
  const workbench = { key: '/reports/role-workbench', path: '/reports/role-workbench', title: '待办中心', closable: true }
  login([...sale, P.REPORT_VIEW])
  useWorkspaceStore.setState({ tabs: [HOME_TAB, workbench, existing, detail], activeKey: '/sale' })
  await render('workbench', true, existing.path)
  const input = host.querySelector<HTMLInputElement>('input[aria-label="原标签草稿"]')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '未保存的数量')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => navigate('/reports/role-workbench')); await settle()
  expect(labels()).toContain('销售订单')
  await act(async () => button('销售订单')!.click()); await settle()
  expect(host.querySelector('output')?.textContent).toBe('/sale?keyword=old')
  expect(useWorkspaceStore.getState().tabs).toEqual([HOME_TAB, workbench, existing, detail])
  expect(input.value).toBe('未保存的数量'); expect(input.isConnected).toBe(true)
})

const payable: NotificationItem = { type: 'danger', icon: '!', text: '2 笔应付账款未结清', path: '/payments/payable', category: 'finance', priority: 12 }
const queue: RoleWorkbenchData = {
  sections: [{ key: 'warehouse', title: '仓库角色', description: '收货、上架和补打', priorityRank: 10, cards: [
    { key: 'warehouse-pending-receive', title: '待收货', description: '待收货订单', count: 0, path: '/inbound-tasks', actionLabel: '查看收货订单', accent: 'blue', priorityRank: 10, priorityLabel: 'P1', items: [] },
    { key: 'warehouse-print', title: '打印失败待补打', description: '收货打印异常', count: 2, path: '/inbound-tasks/12', actionLabel: '打开首单', accent: 'rose', priorityRank: 40, priorityLabel: 'P4', items: [
      { id: 1, title: 'IN-12', subtitle: '箱码 A', path: '/inbound-tasks/12', badge: '失败' },
      { id: 2, title: 'IN-12', subtitle: '箱码 B', path: '/inbound-tasks/12', badge: '超时待确认' },
    ] },
  ] }], summary: { totalAlerts: 2, warehouseCount: 2, saleCount: 0, managementCount: 0 }, topAlert: null,
}
function workbenchWithData() {
  login([P.DASHBOARD_VIEW, P.REPORT_VIEW, P.INBOUND_ORDER_VIEW, P.PAYMENT_VIEW])
  vi.mocked(getRoleWorkbenchApi).mockResolvedValue(queue)
  vi.mocked(getNotificationsApi).mockResolvedValue({ items: [payable], total: 1, counts: {} })
}
async function refreshWorkbench() {
  const refresh = button('立即刷新')!
  await act(async () => refresh.click())
  await settle()
}

test('非零业务先显示，零类别可展开，重复首单动作隐藏且打印任务以条计数', async () => {
  workbenchWithData()
  await render('workbench')
  const page = host.textContent ?? ''
  expect(page.indexOf('打印失败待补打')).toBeLessThan(page.indexOf('常用工作'))
  expect(page).toContain('2 条打印任务')
  expect(page).not.toContain('当前显示 2 条')
  expect(button('打开首单')).toBeUndefined()
  expect([...host.querySelectorAll('button')].filter(button => button.textContent?.includes('IN-12'))).toHaveLength(2)
  const quiet = [...host.querySelectorAll('details')].find(element => element.textContent?.includes('待收货'))
  expect(quiet?.open).toBe(false)
  expect(quiet?.querySelector('summary')?.textContent).toContain('零待办类别')
})

test('岗位数量大于可见明细时说明当前显示数', async () => {
  workbenchWithData()
  const section = queue.sections[0]
  const [receive, print] = section.cards
  vi.mocked(getRoleWorkbenchApi).mockResolvedValue({
    ...queue,
    sections: [{ ...section, cards: [receive, { ...print, count: 4 }] }],
  })
  await render('workbench')
  expect(host.textContent).toContain('4 条打印任务')
  expect(host.textContent).toContain('当前显示 2 条')
})

test('财务提醒以类别计数并用可读的紧急程度，首读失败保留旁区', async () => {
  workbenchWithData()
  vi.mocked(getNotificationsApi).mockRejectedValueOnce(new Error('合成通知读取失败'))
  await render('workbench')
  expect(host.textContent).toContain('打印失败待补打')
  expect(host.textContent).toContain('财务与系统提醒加载失败')
  expect(host.textContent).not.toContain('暂无待提醒事项')
  await refreshWorkbench()
  expect(host.textContent).toContain('1 类提醒')
  expect(host.textContent).toContain('2 笔应付账款未结清')
  expect(host.textContent).toContain('优先处理')
  expect(host.textContent).not.toContain('P12')
})

test('岗位和提醒的刷新失败都保留上次已读内容、最后更新时间和各自重试', async () => {
  workbenchWithData()
  await render('workbench')
  vi.mocked(getRoleWorkbenchApi).mockRejectedValueOnce(new Error('合成岗位刷新失败'))
  vi.mocked(getNotificationsApi).mockRejectedValueOnce(new Error('合成提醒刷新失败'))
  await refreshWorkbench()
  expect(vi.mocked(getRoleWorkbenchApi)).toHaveBeenCalledTimes(2)
  expect(vi.mocked(getNotificationsApi)).toHaveBeenCalledTimes(2)
  expect(retiredIssues).not.toHaveBeenCalled()
  expect(host.textContent).toContain('打印失败待补打')
  expect(host.textContent).toContain('2 笔应付账款未结清')
  expect(host.querySelectorAll('time[datetime]')).toHaveLength(2)
  expect(host.textContent).toContain('显示上次读取的内容')
  const retry = [...host.querySelectorAll('button')].find(button => button.getAttribute('aria-label') === '重试岗位待办')!
  await act(async () => retry.click()); await settle()
  expect(vi.mocked(getRoleWorkbenchApi)).toHaveBeenCalledTimes(3)
  expect(vi.mocked(getNotificationsApi)).toHaveBeenCalledTimes(2)
})

test('仪表盘待处理与关注沿用岗位动作，无已退役的履约摘要或读取', async () => {
  workbenchWithData()
  saved.widgets = saved.widgets.map(widget => widget.id === 'board-workbench' ? { ...widget, visible: true } : widget)
  await render('dashboard')
  await vi.waitFor(() => expect(host.textContent).toContain('打印失败待补打'))
  expect(button('进入待办中心')).toBeTruthy()
  expect(host.textContent).not.toContain('履约事项')
  expect(retiredIssues).not.toHaveBeenCalled()
})
