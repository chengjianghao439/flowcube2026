'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const p = path.join(__dirname, '../backend/scripts/repair-legacy-purchases-20260908.cjs')
const available = fs.existsSync(p)
const repair = available ? require(p) : {}
const { fixture } = require('./helpers/legacyPurchaseFixture')
test('采购定向修复实现存在', () => assert.equal(typeof repair.buildPlan, 'function'))
test('只归一历史收货并作废未入库记录，不改采购/应付/在库数量', { skip: !available }, () => {
  const plan = repair.buildPlan(fixture())
  assert.deepEqual(plan.completeTaskIds, [1]); assert.deepEqual(plan.cancelTaskIds, [2, 3, 4])
  assert.deepEqual(plan.voidContainerIds, [102, 103, 104, 105]); assert.equal(plan.payable, 33.13)
})
for (const [name, mutate] of [
  ['已有收款/付款', s => s.dependencies.entries.push({ id: 1 })],
  ['活跃销售预计绑定', s => s.dependencies.bindings.push({ id: 1 })],
  ['待作废容器已上架', s => { s.containers[1].status = 1 }],
  ['旧在库容器被消耗', s => { s.containers[0].remaining_qty = 0 }],
  ['容器已被锁定', s => { s.containers[1].locked_by_task_id = 7 }],
  ['缺少原入库流水', s => { s.logs = [] }],
  ['采购状态变化', s => { s.purchases[1].status = 2 }],
  ['采购金额变化', s => { s.purchases[0].total_amount = 40 }],
  ['新增收货行', s => s.items.push({ ...s.items[0], id: 9 })],
  ['关联已被他人修改', s => { s.items[0].purchase_item_id = 99 }],
]) test(name + '时停止', { skip: !available }, () => {
  const s = fixture(); mutate(s); assert.throws(() => repair.buildPlan(s), /REPAIR_GUARD/)
})
