import { expect, test } from 'vitest'
import { canOpenWorkbenchPath, visibleWorkbench } from './workbench'
import type { RoleWorkbenchData, WorkbenchCard } from '@/api/reports'
import { PERMISSIONS } from './permission-codes'
import { normalizeNotifications } from './notifications'

const canAll = () => true
function card(key: string, path: string, count = 2): WorkbenchCard {
  return { key, path, count, title: key, description: '', actionLabel: '查看', accent: 'blue', priorityRank: 10, priorityLabel: 'P1', items: [{ id: 1, title: '原单', path, subtitle: '' }] }
}
function data(cards: WorkbenchCard[]): RoleWorkbenchData {
  return { summary: { totalAlerts: 99, warehouseCount: 0, saleCount: 99, managementCount: 0 }, topAlert: null, sections: [{ key: 'sale', title: '销售', description: '', priorityRank: 20, cards }] }
}
test('旧异常卡片不复活，未知路由与回到待办自身的链接不可作为处理入口', () => {
  for (const path of ['/reports/exception-workbench', '/reports/role-workbench?focus=x', '/not-a-page', 'https://example.com']) expect(canOpenWorkbenchPath(path, canAll)).toBe(false)
  expect(canOpenWorkbenchPath('/sale/12?focus=fulfillment', canAll)).toBe(true)
  const result = visibleWorkbench(data([card('sale-anomaly', '/sale/12'), card('sale-pending-ship', '/sale/12'), card('management-anomaly-task', '/reports/exception-workbench')]), canAll)
  expect(result.sections[0].cards.map(c => c.key)).toEqual(['sale-pending-ship'])
  expect(result.summary.totalAlerts).toBe(2)
})
test('目标权限与真实路由共同决定入口，摘要只统计可访问卡片', () => {
  const result = visibleWorkbench(data([card('sale-pending-ship', '/sale/12'), card('warehouse-putaway', '/inbound-tasks/9')]), permission => permission === PERMISSIONS.SALE_ORDER_VIEW)
  expect(result.sections[0].cards.map(c => c.key)).toEqual(['sale-pending-ship'])
  expect(result.summary.totalAlerts).toBe(2)
  expect(canOpenWorkbenchPath('/payments/receivable', () => false)).toBe(false)
})
test('旧通知缓存中的巡检提醒移除，真实财务提醒保留', () => {
  const items = normalizeNotifications([
    { code: 'SYSTEM_HEALTH_ANOMALY', type: 'warning', icon: '', text: '巡检异常', path: '/reports/pda-anomaly', category: 'system' },
    { code: 'UNPAID_RECEIVABLE', type: 'warning', icon: '', text: '未收款', path: '/payments/receivable', category: 'finance' },
  ])
  expect(items.map(i => i.code)).toEqual(['UNPAID_RECEIVABLE'])
})
