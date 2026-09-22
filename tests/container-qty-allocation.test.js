'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const qtyPrecision = require('../backend/src/utils/qtyPrecision')
const unitConversion = require('../backend/src/utils/unitConversion')
const AppError = require('../backend/src/utils/AppError')

const filename = path.resolve(__dirname, '../backend/src/engine/containerEngine.js')
const module_ = { exports: {} }
vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
  module: module_,
  require(id) {
    if (id === '../utils/qtyPrecision') return qtyPrecision
    if (id === '../utils/unitConversion') return unitConversion
    if (id === '../utils/AppError') return AppError
    return {}
  },
}, { filename })

function fixture(quantities) {
  const writes = []
  const selects = []
  const conn = {
    async query(sql, params) {
      if (sql.startsWith('UPDATE inventory_containers')) {
        writes.push({ qty: params[0], status: params[1], id: params[2] })
        return [{ affectedRows: 1 }]
      }
      selects.push(sql)
      if (sql.includes('AS lockedQty')) return [[{ lockedQty: 0 }]]
      assert.match(sql, /FROM inventory_containers/)
      assert.match(sql, /FOR UPDATE/)
      return [quantities.map((qty, index) => ({ id: index + 1, barcode: `B${index + 1}`, remaining_qty: qty, unit: '个' }))]
    },
  }
  return { conn, writes, selects }
}

for (const functionName of ['deductFromContainers', 'deductFromTaskLockedContainers']) {
  const deduct = module_.exports[functionName]
  const input = { productId: 7, warehouseId: 1, taskId: 3 }
  test(`${functionName}: exact decimal exhaustion marks both containers EMPTY`, async () => {
    const f = fixture([0.1, 0.2])
    const result = await deduct(f.conn, { ...input, qty: 0.3 })
    assert.deepEqual(f.writes, [{ qty: 0, status: 2, id: 1 }, { qty: 0, status: 2, id: 2 }])
    assert.equal(result[0].taken, 0.1)
    assert.equal(result[1].taken, 0.2)
    assert.equal(result[1].remainingAfter, 0)
    assert.match(f.selects[0], functionName === 'deductFromContainers' ? /locked_by_task_id IS NULL/ : /locked_by_task_id = \?/)
  })
  test(`${functionName}: availability sum and legal input noise do not cause shortage`, async () => {
    for (const [stock, qty] of [[[0.1, 0.7], 0.8], [[0.3], 0.1 + 0.2]]) {
      const f = fixture(stock)
      await deduct(f.conn, { ...input, qty })
      assert.ok(f.writes.every(row => row.qty === 0 && row.status === 2))
    }
  })
  test(`${functionName}: partial deduction has exact two-decimal remainder`, async () => {
    const f = fixture([0.2, 0.2])
    const result = await deduct(f.conn, { ...input, qty: 0.3 })
    assert.deepEqual(f.writes, [{ qty: 0, status: 2, id: 1 }, { qty: 0.1, status: 1, id: 2 }])
    assert.equal(result[1].taken, 0.1)
    assert.equal(result[1].remainingAfter, 0.1)
  })
  test(`${functionName}: actual shortage is rejected before any deduction`, async () => {
    const f = fixture([0.1, 0.2])
    await assert.rejects(() => deduct(f.conn, { ...input, qty: 0.31 }), error => error.statusCode === 400)
    assert.equal(f.writes.length, 0)
  })
  test(`${functionName}: overprecision is rejected before querying or writing`, async () => {
    const f = fixture([1])
    await assert.rejects(() => deduct(f.conn, { ...input, qty: 0.301 }), error => error.code === 'QTY_DECIMALS_EXCEEDED')
    assert.equal(f.selects.length, 0)
    assert.equal(f.writes.length, 0)
  })
}

function returnFixture(quantities) {
  const selects = []
  const rows = quantities.map((qty, index) => ({
    id: index + 1, barcode: `B${index + 1}`, product_id: 7, warehouse_id: 1,
    remaining_qty: qty, status: 1, locked_by_task_id: 3,
  }))
  const conn = {
    async query(sql, params) {
      // Every requested return in these fixtures is a whole original container.
      // A write here is evidence that floating residue incorrectly split one.
      assert.doesNotMatch(sql, /^\s*(INSERT|UPDATE)/, 'whole-container return must preserve original container identity')
      selects.push(sql)
      if (sql.includes('SELECT id FROM inventory_containers')) return [rows.map(row => ({ id: row.id }))]
      if (sql.includes('FROM inventory_containers WHERE id') || sql.includes('WHERE id = ?')) {
        return [[rows.find(row => row.id === params[0])]]
      }
      throw new Error(`Unexpected SQL: ${sql}`)
    },
  }
  return { conn, selects }
}

test('return allocation of 0.3 across 0.1/0.2 keeps both original containers whole', async () => {
  const f = returnFixture([0.1, 0.2])
  const result = await module_.exports.reserveTaskLockedContainersForReturn(f.conn, { taskId: 3, productId: 7, qty: 0.3 })
  assert.equal(result.length, 2)
  assert.equal(result[0].containerId, 1)
  assert.equal(result[1].containerId, 2)
  assert.equal(result[0].wholeContainer, true)
  assert.equal(result[1].wholeContainer, true)
  assert.equal(result[1].qty, 0.2)
})
test('direct whole-container return accepts legal floating noise without splitting', async () => {
  const f = returnFixture([0.3])
  const result = await module_.exports.splitTaskLockedContainerForReturn(f.conn, { taskId: 3, containerId: 1, qty: 0.1 + 0.2 })
  assert.equal(result.containerId, 1)
  assert.equal(result.wholeContainer, true)
  assert.equal(result.qty, 0.3)
})
test('return allocation still rejects genuine insufficiency', async () => {
  const f = returnFixture([0.1, 0.2])
  await assert.rejects(() => module_.exports.reserveTaskLockedContainersForReturn(f.conn, { taskId: 3, productId: 7, qty: 0.31 }), error => error.statusCode === 409)
  const single = returnFixture([0.3])
  await assert.rejects(() => module_.exports.splitTaskLockedContainerForReturn(single.conn, { taskId: 3, containerId: 1, qty: 0.31 }), error => error.statusCode === 400)
})
test('return allocation rejects genuine third decimals before selecting stock', async () => {
  for (const name of ['reserveTaskLockedContainersForReturn', 'splitTaskLockedContainerForReturn']) {
    const f = returnFixture([0.3])
    await assert.rejects(() => module_.exports[name](f.conn, { taskId: 3, productId: 7, containerId: 1, qty: 0.301 }), error => error.code === 'QTY_DECIMALS_EXCEEDED')
    assert.equal(f.selects.length, 0)
  }
})
