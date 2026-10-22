import { expect, test } from 'vitest'
import { resolveErpLoginDestination } from './erpLoginDestination'
import { hasPermission } from '@/lib/permissions'
import { resolveRoutePermission } from './routeDefinitions'

const noPermissions = { roleId: 99, permissions: [] }
const paymentOnly = { roleId: 99, permissions: ['payment.view'] }

test.each([undefined, '/dashboard', '/dashboard?range=all', '/reports/role-workbench', '/missing', '/403', '/login', '//outside.invalid', 'https://outside.invalid', '/pda', 42])(
  '零权限账号的来源 %s 不能退回无权仪表盘', requested => {
    const destination = resolveErpLoginDestination(noPermissions, requested)
    expect(destination).not.toBe('/dashboard')
    expect(destination).toBe('/no-access')
  },
)

test.each([undefined, '/dashboard', '/dashboard?range=all', '/reports/role-workbench', '/missing', '/403', '/login', '//outside.invalid', 'https://outside.invalid', '/pda', 42])(
  '仅 payment.view 的来源 %s 落到供应商往来', requested => {
    expect(resolveErpLoginDestination(paymentOnly, requested)).toBe('/payments/payable')
  },
)

test.each([null, undefined, { roleId: 99 }])('缺少账号或权限集合时不猜测有仪表盘权限：%s', user => {
  expect(resolveErpLoginDestination(user)).toBe('/no-access')
})

test.each([
  { permissions: ['report.view', 'dashboard.view', 'payment.view'], expected: '/reports/role-workbench' },
  { permissions: ['dashboard.view', 'payment.view'], expected: '/dashboard' },
  { permissions: ['purchase.order.view', 'payment.view'], expected: '/purchase' },
  { permissions: ['sale.order.view', 'payment.view'], expected: '/sale' },
  { permissions: ['location.view'], expected: '/locations' },
  { permissions: ['warehouse.task.assign'], expected: '/sorting-bins' },
])('按既有优先级找首个有权页面：$expected', ({ permissions, expected }) => {
  const user = { roleId: 99, permissions }
  const destination = resolveErpLoginDestination(user)
  expect(destination).toBe(expected)
  expect(hasPermission(permissions, resolveRoutePermission(destination)!, user.roleId)).toBe(true)
})

test('仅有账款查看权时，有权来源优先于默认供应商往来并保留查询条件', () => {
  expect(resolveErpLoginDestination(paymentOnly, '/payments/receivable?keyword=keep')).toBe('/payments/receivable?keyword=keep')
  expect(resolveErpLoginDestination(paymentOnly, '/payments?keyword=keep')).toBe('/payments/payable?keyword=keep')
})

test('管理员继续沿用原权限豁免进入待办中心', () => {
  expect(resolveErpLoginDestination({ roleId: 1, permissions: [] })).toBe('/reports/role-workbench')
})
