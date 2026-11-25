import { expect, test } from 'vitest'
import type { FulfillmentIssue } from '@/api/fulfillment'
import { explainFulfillmentAction, fulfillmentDocumentPath } from './fulfillmentAction'
import { PERMISSIONS, type PermissionCode } from './permission-codes'

const issue = (key: string, patch: Partial<FulfillmentIssue> = {}): FulfillmentIssue => ({
  id: 1, document_type: 'sale', document_id: 123, source: 'auto', source_key: key,
  title: '历史事项', reason: '历史原因', action_path: '/sale/9', status: 'open', owner_id: null,
  ownerName: null, due_at: null, result: null, version: 1, overdue: 0, dueSoon: 0, ...patch,
})
const all = () => true

test.each(['shortage:8', 'delay:8', 'purchase-delay:8:42', 'return:91x'])('历史销售事项 %s 回订单信息', key => {
  expect(explainFulfillmentAction(issue(key), all)).toEqual({ path: '/sale/123', label: '查看原单事项' })
})

test.each([['return:91', 91, '查看拣货退回任务'], ['adjust:92', 92, '查看改单确认任务']])('仍可查看 %s 对应的仓库作业', (key, taskId, label) => {
  expect(explainFulfillmentAction(issue(key), all)).toEqual({ path: `/sale/123?focus=progress&taskId=${taskId}`, label })
})

test('人工及已关闭事项依旧落原单', () => {
  expect(explainFulfillmentAction(issue('return:91', { source: 'manual' }), all).path).toBe('/sale/123')
  expect(explainFulfillmentAction(issue('return:91', { status: 'resolved' }), all).path).toBe('/sale/123')
})

test('采购到货、调拨及收货继续链接现有分区', () => {
  expect(explainFulfillmentAction(issue('purchase-delay', { document_type: 'purchase' }), all)).toEqual({
    path: '/purchase/123?focus=fulfillment', label: '核对采购到货日期',
  })
  expect(fulfillmentDocumentPath(issue('transfer', { document_type: 'transfer' }))).toBe('/transfer/123?focus=fulfillment')
  expect(explainFulfillmentAction(issue('putaway:8', { document_type: 'inbound' }), all).path).toBe('/inbound-tasks/123?focus=waiting-putaway')
})

test('打印和超额放行继续按各自查看权限给出去向', () => {
  const print = issue('print:9', { document_type: 'inbound' })
  const printOnly = (permission: PermissionCode) => permission === PERMISSIONS.PRINT_JOB_VIEW
  expect(explainFulfillmentAction(print, printOnly).path).toBe('/settings/barcode-print-query?category=inbound&inboundTaskId=123')
  expect(explainFulfillmentAction(print, () => false)).toMatchObject({ path: '/inbound-tasks/123?focus=fulfillment', note: expect.stringContaining('需有打印查看权限') })
  expect(explainFulfillmentAction(issue('credit:5'), printOnly)).toMatchObject({ path: '/sale/123', note: expect.stringContaining('需有超额放行查看权限') })
  expect(explainFulfillmentAction(issue('credit:5'), all).path).toBe('/credit-overrides')
})
