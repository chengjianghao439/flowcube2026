// @vitest-environment jsdom
import { expect, test } from 'vitest'
import { buildWorkspaceTabRegistrationFromPath, resolveWorkspaceEntryPath } from './workspaceRouteMeta'
import { buildTopNavSections, resolveRoutePermission } from './routeDefinitions'
import { hasPermission } from '@/lib/permissions'
import { PERMISSIONS } from '@/lib/permission-codes'
import { HOME_TAB, useWorkspaceStore } from '@/store/workspaceStore'

test.each([
  ['/procurement', '/reports/replenishment'],
  ['/reports', '/reports/kpi', '/reports/profit-analysis'],
  ['/reports/warehouse-ops', '/reports/wave-performance', '/reports/pda-anomaly'],
  ['/payments/receivable', '/reports/reconciliation/receivable'],
  ['/payments/payable', '/reports/reconciliation/payable'],
  ['/finance/dashboard', '/finance/accounts', '/finance/transactions'],
])('合并视图复用 %s 工作区，旧地址和查询参数保留', (...paths) => {
  const keys = paths.map(path => buildWorkspaceTabRegistrationFromPath(`${path}?warehouseId=3`).key)
  expect(new Set(keys).size).toBe(1)
  for (const path of paths) expect(buildWorkspaceTabRegistrationFromPath(`${path}?warehouseId=3`).path).toBe(`${path}?warehouseId=3`)
})

test('切换报表视图只更新一个工作区标签', () => {
  useWorkspaceStore.setState({ tabs: [HOME_TAB], activeKey: HOME_TAB.key })
  for (const path of ['/reports', '/reports/kpi', '/reports/profit-analysis']) {
    useWorkspaceStore.getState().syncFromLocation(path, '报表中心')
  }
  expect(useWorkspaceStore.getState().tabs).toHaveLength(2)
  expect(useWorkspaceStore.getState().tabs[1].path).toBe('/reports/profit-analysis')
})

test('旧快捷入口和已保存标签改用子页名（不再一律显示组合名）', async () => {
  useWorkspaceStore.setState({ tabs: [HOME_TAB], activeKey: HOME_TAB.key })
  useWorkspaceStore.getState().addTab({ key: '/reports/kpi', path: '/reports/kpi', title: '经营 KPI' })
  expect(useWorkspaceStore.getState().tabs[1].title).toBe('经营概览')
  localStorage.setItem('flowcube-workspace', JSON.stringify({ version: 0, state: { tabs: [
    { key: '/reports', path: '/reports', title: '报表中心' },
    { key: '/reports/kpi', path: '/reports/kpi', title: '经营 KPI' },
    { key: '/reports/role-workbench', path: '/reports/role-workbench', title: '岗位工作台' },
  ] } }))
  await useWorkspaceStore.persist.rehydrate()
  expect(useWorkspaceStore.getState().tabs.map(tab => tab.title)).toEqual(['仪表盘', '经营概览', '待办中心'])
})

test('合并菜单先过滤权限，只有补货权限仍有采购建议入口', () => {
  // 只持「报表查看」的用户看菜单：can 走真实的 hasPermission（权限位可能是单个码、
  // 也可能是「任一」的数组），别在这里手写 === 比较——那会把数组形态判成不通过。
  const nav = buildTopNavSections((perm) => hasPermission([PERMISSIONS.REPORT_VIEW], perm))
  const purchase = nav.find(section => section.label === '采购')
  expect(purchase?.kind).toBe('menu')
  if (purchase?.kind !== 'menu') throw new Error('采购菜单缺失')
  expect(purchase.children.map(item => [item.label, item.path])).toEqual([['采购建议', '/reports/replenishment']])
})

test('各组合并成一个菜单入口，原页面权限保持原样', () => {
  const menus = buildTopNavSections().flatMap(section => section.kind === 'menu' ? section.children : [])
  for (const label of ['采购建议', '报表中心', '仓库运营']) expect(menus.filter(item => item.label === label)).toHaveLength(1)
  expect(resolveRoutePermission('/procurement')).toBe(PERMISSIONS.PROCUREMENT_PLAN_VIEW)
  expect(resolveRoutePermission('/reports/replenishment')).toBe(PERMISSIONS.REPORT_VIEW)
  expect(buildWorkspaceTabRegistrationFromPath('/payments/receivable').key).toBe(buildWorkspaceTabRegistrationFromPath('/reports/reconciliation/receivable').key)
})

test('财务菜单逐子页授权，撤权后使用合法原上下文且保留隐藏偏好', () => {
  const can = (permission: Parameters<typeof hasPermission>[1]) => hasPermission([PERMISSIONS.REPORT_VIEW], permission)
  const finance = buildTopNavSections(can).find(section => section.label === '财务')
  if (finance?.kind !== 'menu') throw new Error('财务菜单缺失')
  expect(finance.children.map(item => [item.label, item.path])).toEqual([
    ['供应商往来', '/reports/reconciliation/payable'], ['客户往来', '/reports/reconciliation/receivable'],
  ])
  const existing = { path: '/payments/receivable?keyword=hidden', viewPaths: {
    '/payments/receivable': '/payments/receivable?keyword=hidden',
    '/reports/reconciliation/receivable': '/reports/reconciliation/receivable?partyId=7',
  } }
  expect(resolveWorkspaceEntryPath('/reports/reconciliation/receivable', existing, can)).toBe('/reports/reconciliation/receivable?partyId=7')
  expect(existing.viewPaths['/payments/receivable']).toBe('/payments/receivable?keyword=hidden')
  expect(resolveWorkspaceEntryPath('/payments/receivable', existing, requirement => hasPermission([PERMISSIONS.PAYMENT_VIEW], requirement))).toBe(existing.path)
  expect(buildWorkspaceTabRegistrationFromPath('/payments').path).toBe('/payments/payable')
  expect(buildWorkspaceTabRegistrationFromPath('/reports/reconciliation').path).toBe('/reports/reconciliation/payable')
  expect(buildWorkspaceTabRegistrationFromPath('/payments/ledger/customer/7?keyword=old').key).not.toBe('/payments/receivable')
})
