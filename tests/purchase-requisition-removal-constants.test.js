const test = require('node:test')
const assert = require('node:assert/strict')
const { PERMISSIONS } = require('../backend/src/constants/permissions')
const { DOCUMENT_STATUS_RULES, assertStatusAction } = require('../backend/src/constants/documentStatusRules')
test('采购申请权限不再可授予，原采购及收货权限保留', () => {
  assert.equal(Object.values(PERMISSIONS).some(p => p.startsWith('purchase.requisition.')), false)
  assert.ok(PERMISSIONS.PURCHASE_ORDER_VIEW)
})
test('采购申请不再具备可执行状态机，共享采购状态机保留', () => {
  assert.equal(DOCUMENT_STATUS_RULES.purchaseRequisition, undefined)
  assert.throws(() => assertStatusAction('purchaseRequisition', 'approve', 2))
  assert.ok(assertStatusAction('purchase', 'approve', 5))
})
