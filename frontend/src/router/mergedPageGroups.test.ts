// @vitest-environment jsdom
import { expect, test } from 'vitest'
import { MERGED_PAGE_GROUPS } from './mergedPageGroups'
import { buildWorkspaceTabRegistrationFromPath } from './workspaceRouteMeta'
import { buildTopNavSections, resolveRoutePermission } from './routeDefinitions'
import { hasPermission } from '@/lib/permissions'
import { PERMISSIONS } from '@/lib/permission-codes'

test('已取消页内合并 Tab，所有原合并视图均作为独立路由与独立菜单项存在', () => {
  expect(MERGED_PAGE_GROUPS).toHaveLength(0)
  const paths = [
    '/procurement', '/reports/replenishment',
    '/payments/receivable', '/reports/reconciliation/receivable',
    '/payments/payable', '/reports/reconciliation/payable',
    '/finance/dashboard', '/finance/accounts', '/finance/transactions',
    '/reports', '/reports/kpi', '/reports/profit-analysis',
    '/reports/warehouse-ops', '/reports/wave-performance', '/reports/pda-anomaly',
  ]
  const keys = paths.map(path => buildWorkspaceTabRegistrationFromPath(`${path}?warehouseId=3`).key)
  expect(new Set(keys).size).toBe(paths.length)
})

test('会计菜单已精简移除，发票管理保留在财务菜单下', () => {
  const sections = buildTopNavSections()
  expect(sections.find(s => s.label === '会计')).toBeUndefined()
  const finance = sections.find(s => s.label === '财务')
  expect(finance?.kind).toBe('menu')
  if (finance?.kind !== 'menu') throw new Error('财务菜单缺失')
  expect(finance.children.some(item => item.path === '/accounting/invoices' && item.label === '发票管理')).toBe(true)
})

test('原菜单权限保持原样，仅持报表查看权限时展示对应独立入口', () => {
  const can = (permission: Parameters<typeof hasPermission>[1]) => hasPermission([PERMISSIONS.REPORT_VIEW], permission)
  const purchase = buildTopNavSections(can).find(section => section.label === '采购')
  expect(purchase?.kind).toBe('menu')
  if (purchase?.kind !== 'menu') throw new Error('采购菜单缺失')
  expect(purchase.children.map(item => [item.label, item.path])).toEqual([['补货建议', '/reports/replenishment']])
  expect(resolveRoutePermission('/procurement')).toBe(PERMISSIONS.PROCUREMENT_PLAN_VIEW)
  expect(resolveRoutePermission('/reports/replenishment')).toBe(PERMISSIONS.REPORT_VIEW)
})
