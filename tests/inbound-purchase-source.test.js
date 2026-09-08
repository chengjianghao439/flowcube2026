'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const p = path.join(__dirname, '../backend/src/modules/inbound-tasks/inbound-purchase-source.js')
const available = fs.existsSync(p)
const source = available ? require(p) : {}
const item = overrides => ({ id: 1, purchase_order_id: 1, purchase_item_id: 11, product_id: 8, source_item_id: 11, source_order_id: 1, source_product_id: 8, ...overrides })
test('来源校验模块存在', () => assert.equal(typeof source.validateSourceItems, 'function'))
for (const [name, rows] of [
  ['无明细', []], ['无采购', [item({ purchase_order_id: null })]],
  ['无采购明细', [item({ purchase_item_id: null })]], ['采购明细不存在', [item({ source_item_id: null })]],
  ['采购订单错配', [item({ source_order_id: 2 })]], ['商品错配', [item({ source_product_id: 9 })]],
  ['非法采购ID', [item({ purchase_order_id: -1 })]],
]) test(name + '拒绝而非静默跳过', { skip: !available }, () => {
  assert.throws(() => source.validateSourceItems(rows), { code: 'INBOUND_PURCHASE_SOURCE_INVALID', statusCode: 409 })
})
test('混单来源去重并按ID排序', { skip: !available }, () => {
  assert.deepEqual(source.validateSourceItems([item({ purchase_order_id: 2, source_order_id: 2 }), item(), item()]), [1, 2])
})
test('空ID直接调用也拒绝', { skip: !available }, async () => {
  await assert.rejects(source.assertPurchaseOrderOpen({ query: () => assert.fail('不得查询') }, null), { code: 'INBOUND_PURCHASE_SOURCE_INVALID' })
})
test('已取消采购仍被拒绝', { skip: !available }, async () => {
  await assert.rejects(source.assertPurchaseOrderOpen({ query: async () => [[{ id: 1, order_no: 'PO-1', status: 4 }]] }, 1), /已取消/)
})
