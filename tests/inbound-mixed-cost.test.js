'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { createRequire } = require('node:module')
const cost = require('../backend/src/modules/inbound-tasks/inbound-tasks.cost')
const statusFile = path.resolve(__dirname, '../backend/src/modules/inbound-tasks/inbound-tasks.status.js')
const statusRequire = createRequire(statusFile)
const status = { exports: {} }
vm.runInNewContext(fs.readFileSync(statusFile, 'utf8'), { module: status, require: name => {
  if (name === '../print-jobs/print-jobs.service') return { isStalledErrorMessage: () => false }
  if (name === '../../utils/inboundThresholds') return { DEFAULT_INBOUND_THRESHOLDS: {} }
  return statusRequire(name)
} }, { filename: statusFile })
const allocate = status.exports.distributePackagesToLines
const row = (id, received, price, putaway = 0) => ({ id, product_id: 7, received_qty: received, putaway_qty: putaway, unit_price: price })
const box = (qty, parts, extra = {}) => ({ product_id: 7, remaining_qty: qty, inbound_source_quantities: parts, ...extra })
const sources = [{ itemId: 1, qty: 3 }, { itemId: 2, qty: 7 }]

test('合箱3×10+7×20的成本与明细来自同一份原箱贡献', () => {
  const c = cost.buildPutawayContributions(box(10, sources), [row(1, 3, 10), row(2, 7, 20)])
  assert.deepEqual(c.allocations, sources)
  assert.equal(c.purchasePrice, '17.0000')
  assert.equal(cost.movingAverageCost({ globalQty: 10, oldAverage: 10, contribution: c }), '17.0000')
  assert.equal(cost.movingAverageCost({ globalQty: 15, oldAverage: 8, contribution: c }), '14.0000')
})

test('分箱跨行贡献收货时保留，不因相反上架顺序改变', () => {
  const result = allocate([{ id: 1, productId: 7, receivedQty: 0, orderedQty: 3 }, { id: 2, productId: 7, receivedQty: 0, orderedQty: 7 }], 7, [{ lineNo: 1, qty: 5 }, { lineNo: 2, qty: 5 }])
  const facts = JSON.parse(JSON.stringify(result))
  assert.deepEqual(facts.assignments.map(a => a.sources), [[{ itemId: 1, qty: 3 }, { itemId: 2, qty: 2 }], [{ itemId: 2, qty: 5 }]])
  const first = cost.buildPutawayContributions(box(5, facts.assignments[0].sources), [row(1, 3, 10), row(2, 7, 20, 5)])
  assert.equal(first.purchasePrice, '14.0000')
  assert.equal(cost.movingAverageCost({ globalQty: 10, oldAverage: 20, contribution: first }), '17.0000')
})

test('合法两位数量按百分位分配，0.1+0.2不制造来源尾差', () => {
  const result = allocate([{ id: 1, productId: 7, receivedQty: 0.1, orderedQty: 0.3 }, { id: 2, productId: 7, receivedQty: 0, orderedQty: 0.1 }], 7, [{ lineNo: 1, qty: 0.3 }])
  assert.deepEqual(JSON.parse(JSON.stringify(result.updates)), [{ itemId: 1, add: 0.2 }, { itemId: 2, add: 0.1 }])
  assert.equal(cost.buildPutawayContributions(box('0.30', [{ itemId: 1, qty: 0.2 }, { itemId: 2, qty: 0.1 }]), [row(1, '0.30', '10.1234', '0.10'), row(2, '0.10', '20.5678')]).purchasePrice, '13.6049')
})

test('每项6位贡献保留到最终4位单价和均价；不先舍入微额', () => {
  const c = cost.buildPutawayContributions(box('0.03', [{ itemId: 1, qty: 0.01 }, { itemId: 2, qty: 0.02 }]), [row(1, '0.01', '0.0001'), row(2, '0.02', '0.0002')])
  assert.equal(c.costUnits, 5n)
  assert.equal(c.purchasePrice, '0.0002')
  assert.equal(cost.movingAverageCost({ globalQty: '0.04', oldAverage: '0.0001', contribution: c }), '0.0002')
})

test('同价/单一来源NULL历史成本可确定，保留owner优先原回写', () => {
  const c = cost.buildPutawayContributions(box(3, null, { inbound_task_item_id: 2 }), [row(1, 2, 10), row(2, 2, 10)])
  assert.deepEqual(c.allocations, [{ itemId: 2, qty: 2 }, { itemId: 1, qty: 1 }])
  assert.equal(c.purchasePrice, '10.0000')
})

test('混价NULL历史多箱原贡献不可证明，拒绝而非按dominant owner猜价', () => {
  assert.throws(() => cost.buildPutawayContributions(box(5, null, { inbound_task_item_id: 2 }), [row(1, 3, 10), row(2, 7, 20)]), { code: 'INBOUND_COST_SOURCE_REVIEW_REQUIRED' })
})

test('NULL旧箱总量等于全部未兑现容量，3/7来源向量数学唯一可加权', () => {
  const c = cost.buildPutawayContributions(box(10, null, { inbound_task_item_id: 2 }), [row(1, 3, 10), row(2, 7, 20)])
  assert.deepEqual(c.allocations, sources)
  assert.equal(c.purchasePrice, '17.0000')
})

test('NULL旧箱只剩一条正容量来源时，无视已全上架旧行价格可确定成本', () => {
  const c = cost.buildPutawayContributions(box(5, null, { inbound_task_item_id: 1 }), [row(1, 3, 10, 3), row(2, 7, 20)])
  assert.deepEqual(c.allocations, [{ itemId: 2, qty: 5 }])
  assert.equal(c.purchasePrice, '20.0000')
})

test('贡献合计、源商品、重复来源和已兑现容量不合法时拒绝', () => {
  for (const parts of [[{ itemId: 1, qty: 9 }], [{ itemId: 3, qty: 10 }], [{ itemId: 1, qty: 3 }, { itemId: 1, qty: 7 }], sources]) {
    assert.throws(() => cost.buildPutawayContributions(box(10, parts), [row(1, 3, 10, 1), row(2, 7, 20)]), { code: 'INBOUND_COST_SOURCE_INVALID' })
  }
})

test('全零来源不动原均价，混合零价来源仍计入加权分母', () => {
  assert.equal(cost.buildPutawayContributions(box(1, [{ itemId: 1, qty: 1 }]), [row(1, 1, 0)]).purchasePrice, null)
  const mixed = cost.buildPutawayContributions(box(10, sources), [row(1, 3, 0), row(2, 7, 20)])
  assert.equal(mixed.purchasePrice, '14.0000')
})

test('改回单一owner成本会破坏3/7混价行为断言（实际helper反证）', () => {
  const file = path.resolve(__dirname, '../backend/src/modules/inbound-tasks/inbound-tasks.cost.js')
  const original = fs.readFileSync(file, 'utf8')
  const changed = original.replace('costUnits += part.units * price', 'costUnits = qty * price')
  assert.notEqual(changed, original)
  const mutated = { exports: {} }, local = createRequire(file)
  vm.runInNewContext(changed, { module: mutated, require: local }, { filename: file })
  const price = mutated.exports.buildPutawayContributions(box(10, sources), [row(1, 3, 10), row(2, 7, 20)]).purchasePrice
  assert.throws(() => assert.equal(price, '17.0000'), { code: 'ERR_ASSERTION' })
})

test('新增289贡献迁移重复执行有信息结构门；历史数量、成本与来源均不回填', () => {
  const sql = fs.readFileSync(path.resolve(__dirname, '../backend/src/database/289_inbound_container_source_quantities.sql'), 'utf8').replace(/^\s*--.*$/gm, '')
  assert.match(sql, /information_schema\.COLUMNS/)
  assert.match(sql, /JSON NULL/)
  assert.doesNotMatch(sql, /\b(?:UPDATE|DELETE)\s+(?:inventory_containers|product_items|inbound_task_items)\b/i)
})
