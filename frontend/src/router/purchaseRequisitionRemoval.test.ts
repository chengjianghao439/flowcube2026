import { expect, test } from 'vitest'
import { routeRegistry, routePatterns, buildTopNavSections } from './routeDefinitions'
import { PERMISSIONS } from '@/lib/permission-codes'
import { approvalSource } from '@/lib/approvalBusiness'

test('采购申请列表、新建与详情直链不再注册，采购与收货保留', () => {
  for (const path of ['/purchase-requisitions', '/purchase-requisitions/new', '/purchase-requisitions/42']) {
    expect(routeRegistry.find(route => route.path === path)).toBeUndefined()
    expect(routePatterns.find(route => route.pattern.test(path))).toBeUndefined()
  }
  for (const path of ['/purchase', '/inbound-tasks', '/procurement']) expect(routeRegistry.some(route => route.path === path)).toBe(true)
  expect(JSON.stringify(buildTopNavSections())).not.toContain('/purchase-requisitions')
  expect(Object.values(PERMISSIONS).some(code => code.startsWith('purchase.requisition.'))).toBe(false)
})

test('旧申请审批概要不能导航到已移除页面', () => { expect(approvalSource('purchase_requisition', 42, () => true).path).toBeNull() })
