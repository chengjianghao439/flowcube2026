'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { existsSync } = require('node:fs')
const repairPath = '../backend/scripts/repair-legacy-receivables-20260908.cjs'
const available = existsSync(require('node:path').join(__dirname, repairPath))
const repair = available ? require(repairPath) : {}

const { fixture } = require('./helpers/legacyReceivableFixture')

test('修复实现可调用', () => assert.equal(typeof repair.buildPlan, 'function'))
test('仅生成两行已发数量和两笔应收的定向调整', { skip: !available }, () => {
  const plan = repair.buildPlan(fixture())
  assert.deepEqual(plan.shipped, [{ id: 1, before: 0, after: 1 }, { id: 2, before: 0, after: 1 }])
  assert.deepEqual(plan.payments.map(p => [p.id, p.before, p.after]), [[1, 379.8, 358.43], [2, 122.27, 0]])
})
for (const [name, change] of [
  ['新增收款', s => s.dependencies.entries.push({ id: 1 })],
  ['已有发票', s => s.dependencies.invoices.push({ id: 1 })],
  ['来源单号变化', s => { s.orders[0].order_no = 'SO-OTHER' }],
  ['金额已变化', s => { s.payments[0].total_amount = '380' }],
  ['新增同商品行', s => s.items.push({ ...s.items[0], id: 9 })],
  ['仓库不匹配', s => { s.items[0].warehouse_id = 2 }],
  ['并未完成出库', s => { s.tasks[0].status = 6 }],
  ['取消单存在出库', s => s.tasks.push({ ...s.tasks[0], id: 9, sale_order_id: 2 })],
  ['实拣数量不足', s => { s.taskItems[0].picked_qty = 0.5 }],
  ['未知账款事件', s => s.paymentEvents.push({ request_id: 'other' })],
]) test(name + '时拒绝修复', { skip: !available }, () => {
  const snapshot = fixture(); change(snapshot)
  assert.throws(() => repair.buildPlan(snapshot), /REPAIR_GUARD/)
})
test('摘要涵盖来源变化', { skip: !available }, () => {
  const a = fixture(); const b = fixture(); b.items[0].quantity = 2
  assert.notEqual(repair.digest(a), repair.digest(b))
})
