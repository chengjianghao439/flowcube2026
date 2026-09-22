'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { WT_STATUS } = require('../backend/src/constants/warehouseTaskStatus')
const AppError = require('../backend/src/utils/AppError')
const qtyPrecision = require('../backend/src/utils/qtyPrecision')
const unitConversion = require('../backend/src/utils/unitConversion')
const noop = () => {}

function fixture({ mode = 'pick', required = 0.3, picked = 0.1, checked = 0, remaining = 0.3, scanned = 0.1, pickSum = 0.2, checkSum = 0 } = {}) {
  const writes = []
  let completed = false
  const conn = {
    beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release: noop,
    async query(sql, params) {
      if (sql.includes('CREATE TABLE')) { writes.push({ sql, params }); return [[]] }
      if (/^\s*(INSERT|UPDATE)/.test(sql)) { writes.push({ sql, params }); return [{ insertId: 12, affectedRows: 1 }] }
      if (sql.includes('allow_decimal_qty')) return [[{ id: 7, name: '小数商品', allow_decimal_qty: 1 }]]
      if (sql.includes('FROM warehouse_tasks')) return [[{ id: 1, warehouse_id: 1, status: mode === 'pick' ? WT_STATUS.PICKING : WT_STATUS.CHECKING }]]
      if (sql.includes('FROM inventory_containers')) return [[{ id: 3, barcode: 'B3', product_id: 7, warehouse_id: 1, status: 1, remaining_qty: remaining, locked_by_task_id: 1 }]]
      if (sql.includes('GROUP BY item_id')) return [[{ item_id: 2, pick_sum: pickSum }]]
      if (sql.includes(' AS scanned')) return [[{ scanned }]]
      if (sql.includes(' AS s FROM scan_logs')) return [[{ s: checkSum }]]
      if (sql.includes('scanned_at > NOW()')) return [[]]
      if (sql.includes('SELECT picked_qty, checked_qty')) return [[{ picked_qty: picked, checked_qty: picked }]]
      if (sql.includes('FROM warehouse_task_items')) return [[{ id: 2, product_id: 7, required_qty: required, picked_qty: picked, checked_qty: checked }]]
      throw new Error(`Unexpected SQL: ${sql}`)
    },
  }
  const mocks = {
    '../../config/db': { pool: { ...conn, getConnection: async () => conn } },
    '../../utils/qtyPrecision': qtyPrecision,
    '../../utils/unitConversion': unitConversion,
    '../../utils/AppError': AppError,
    '../../utils/warehouseScope': { assertInScope: noop },
    '../../engine/containerEngine': { lockContainer: async () => {}, CONTAINER_STATUS: { ACTIVE: 1 } },
    '../../constants/warehouseTaskStatus': { WT_STATUS },
    '../../utils/operationRequest': { beginResourceOperationRequest: async () => ({}), completeOperationRequest: async () => {} },
    '../warehouse-tasks/warehouse-tasks.service': { checkDoneWithinTransaction: async () => { completed = true } },
    '../../utils/logger': { warn: noop },
  }
  const module_ = { exports: {} }
  const filename = path.resolve(__dirname, '../backend/src/modules/scan-logs/scan-logs.service.js')
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module: module_, require: id => mocks[id] || {},
  }, { filename })
  return { service: module_.exports, writes, completed: () => completed }
}

const pick = { taskId: 1, itemId: 2, containerId: 3, barcode: 'B3', productId: 7, qty: 0.2, scanMode: '散件', requestKey: 'pick' }
test('pick accepts the exact decimal remainder 0.3 - 0.1 = 0.2', async () => {
  const f = fixture()
  await f.service.createScanLog(pick)
  assert.equal(f.writes.find(w => w.sql.includes('INSERT INTO scan_logs')).params[5], 0.2)
})
test('pick accepts cumulative 0.1 + 0.2 = 0.3 and normalizes floating noise', async () => {
  const f = fixture({ required: 1, picked: 0 })
  await f.service.createScanLog(pick)
  const exact = fixture({ required: 0.3, picked: 0, scanned: 0 })
  await exact.service.createScanLog({ ...pick, qty: 0.1 + 0.2 })
  assert.equal(exact.writes.find(w => w.sql.includes('INSERT INTO scan_logs')).params[5], 0.3)
})
test('pick still rejects over-demand and cumulative over-container quantities', async () => {
  for (const options of [{}, { required: 1, picked: 0 }]) {
    const f = fixture(options)
    await assert.rejects(() => f.service.createScanLog({ ...pick, qty: 0.21 }), error => error.statusCode === 400)
    assert.equal(f.writes.length, 0)
  }
})
test('pick rejects real overprecision before writes', async () => {
  const f = fixture()
  await assert.rejects(() => f.service.createScanLog({ ...pick, qty: 0.201 }), error => error.code === 'QTY_DECIMALS_EXCEEDED')
  assert.equal(f.writes.length, 0)
})
test('check accepts 0.1 already checked plus 0.2 and closes the task', async () => {
  const f = fixture({ mode: 'check', picked: 0.3, checked: 0.1 })
  const result = await f.service.createCheckScanLog({ taskId: 1, barcode: 'B3', requestKey: 'check' })
  assert.equal(result.qty, 0.2)
  assert.equal(result.allChecked, true)
  assert.equal(f.completed(), true)
})
test('check normalizes the derived remainder before recording it', async () => {
  const f = fixture({ mode: 'check', picked: 0.3, checked: 0.1, pickSum: 0.3, checkSum: 0.1 })
  const result = await f.service.createCheckScanLog({ taskId: 1, barcode: 'B3', requestKey: 'check' })
  assert.equal(result.qty, 0.2)
  assert.equal(f.writes.find(w => w.sql.includes('INSERT INTO scan_logs')).params[5], 0.2)
})
test('check still rejects an actual cumulative excess', async () => {
  const f = fixture({ mode: 'check', picked: 0.3, checked: 0.1, pickSum: 0.21 })
  await assert.rejects(() => f.service.createCheckScanLog({ taskId: 1, barcode: 'B3', requestKey: 'check' }), error => error.statusCode === 400)
  assert.equal(f.writes.length, 0)
})
test('undo rejects raw overprecision outside the optional logging catch', async () => {
  for (const field of ['prevQty', 'newQty']) {
    const f = fixture()
    await assert.rejects(() => f.service.logUndo({ taskId: 1, prevQty: 1, newQty: 0, [field]: 0.001 }), error => error.code === 'QTY_DECIMALS_EXCEEDED')
    assert.equal(f.writes.length, 0)
  }
})
test('undo retains legitimate two-decimal audit quantities', async () => {
  const f = fixture()
  await f.service.logUndo({ taskId: 1, prevQty: 1.25, newQty: 0.5 })
  const record = f.writes.find(w => w.sql.includes('INSERT INTO pda_undo_logs'))
  assert.equal(record.params[3], 1.25)
  assert.equal(record.params[4], 0.5)
})
