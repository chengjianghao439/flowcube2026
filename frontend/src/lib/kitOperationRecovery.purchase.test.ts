// @vitest-environment jsdom
import { beforeEach, expect, test, vi } from 'vitest'
import { KIT_QUERY_KEY, loadKitQuery, receiptMatches, saveKitQuery, type KitQueryRecord } from './kitOperationRecovery'
import { kitQuerySession } from './kitRecoveryIdentity'
import { useAuthStore } from '@/store/authStore'
vi.mock('@/api/client', () => ({ default: { defaults: { baseURL: '/a' } } }))
let record: KitQueryRecord
beforeEach(() => {
  sessionStorage.clear()
  useAuthStore.getState().login('fixture', null, { id: 5, roleId: 1, permissions: ['*'] } as never)
  record = { version: 1, draftId: 'mounted', scope: 'purchase-close-remaining', sessionId: kitQuerySession(), userId: 5, baseURL: '/a', requestKey: 'original-close', action: 'purchase.closeRemaining.80', kind: 'close-remaining', resourceType: 'purchase_order', resourceId: 80 }
})
test('only the exact purchase close identity roundtrips, with no persisted body', () => {
  saveKitQuery({ ...record, body: { secret: 'never persist' } } as KitQueryRecord)
  expect(loadKitQuery(record.scope)).toEqual(record)
  expect(sessionStorage.getItem(KIT_QUERY_KEY)).not.toContain('secret')
  expect(receiptMatches(record, { status: 'success', message: '', resourceType: 'purchase_order', resourceId: 80, data: {} })).toBe(true)
  expect(receiptMatches(record, { status: 'success', message: '', resourceType: 'sale_order', resourceId: 80, data: {} })).toBe(false)
  expect(receiptMatches(record, { status: 'success', message: '', resourceType: 'purchase_order', resourceId: 81, data: {} })).toBe(false)
})
test.each([
  { kind: 'cancel' }, { kind: 'create' }, { action: 'purchase.closeRemaining.81' },
  { action: 'purchase.closeRemaining:80' }, { resourceId: 0 }, { resourceId: 1.5 },
  { resourceId: undefined }, { resourceType: 'sale_order' }, { resourceType: 'purchase' },
  { version: 2 }, { context: { taskId: 80 } }, { context: null }, { context: false }, { context: '' }, { body: {} }, { payload: {} },
])('raw query record rejects a broadened variant %j', change => {
  sessionStorage.setItem(KIT_QUERY_KEY, JSON.stringify({ version: 1, records: [{ ...record, ...change }] }))
  expect(() => loadKitQuery(record.scope)).toThrow('历史查询记录无法核对归属')
})
test('a foreign scope cannot be loaded or replace another pending key', () => {
  saveKitQuery(record)
  expect(loadKitQuery('other-page')).toBeNull()
  expect(() => saveKitQuery({ ...record, requestKey: 'another-key' })).toThrow('另有原操作')
  expect(loadKitQuery(record.scope)).toEqual(record)
})
test.each([
  { resourceType: 'sale_order', kind: 'update', action: 'sale.update.80', resourceId: 80 },
  { resourceType: 'sale_return', kind: 'source-return-create', action: 'saleReturn.create', resourceId: undefined },
  { resourceType: 'warehouse_task', kind: 'cancel-return-box', action: 'scan-log.cancel-return-box.80', resourceId: 80, context: { taskId: 80, packageId: 9 } },
])('existing kit domains still roundtrip %j', identity => {
  saveKitQuery({ ...record, ...identity } as KitQueryRecord)
  expect(loadKitQuery(record.scope)).toMatchObject(JSON.parse(JSON.stringify(identity)))
})
