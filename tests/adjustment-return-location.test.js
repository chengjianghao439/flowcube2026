'use strict'

// INV-09: actual service orchestration + actual container primitives; closed,
// transactional SQL adapter only. No DB/env/app/listen or identity writes.
// Reverse proof: ADJUSTMENT_RETURN_SOURCE may point to an exact source copy in
// the evidence directory; the guard must fail against the original function.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const AppError = require('../backend/src/utils/AppError')
const qtyPrecision = require('../backend/src/utils/qtyPrecision')
const unitConversion = require('../backend/src/utils/unitConversion')

const root = path.resolve(__dirname, '..')
const source = process.env.ADJUSTMENT_RETURN_SOURCE || path.join(root, 'backend/src/modules/warehouse-tasks/warehouse-tasks.adjust.js')
function load(filename, dependencies) {
  const module = { exports: {} }
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module,
    require(id) {
      assert.ok(Object.hasOwn(dependencies, id), `Unexpected dependency: ${id}`)
      return dependencies[id]
    },
  }, { filename })
  return module.exports
}
const warehouseScope = load(path.join(root, 'backend/src/utils/warehouseScope.js'), {
  '../config/db': { pool: {} },
  './AppError': AppError,
})
const engine = load(path.join(root, 'backend/src/engine/containerEngine.js'), {
  '../utils/AppError': AppError,
  '../utils/logger': {},
  '../utils/codeGenerator': {},
  '../utils/expectedStock': {},
  '../utils/qtyPrecision': qtyPrecision,
  '../utils/unitConversion': unitConversion,
})
const helpers = load(path.join(root, 'backend/src/modules/warehouse-tasks/warehouse-tasks.helpers.js'), {
  '../../utils/AppError': AppError,
  '../../utils/warehouseScope': warehouseScope,
  '../../utils/codeGenerator': {},
  '../../constants/warehouseTaskStatus': {},
  '../../utils/logger': {},
})

function fixture({ container = {}, ret = {}, dim = {}, location = {}, failAfterReturnWrite = false } = {}) {
  let state = {
    container: { id: 101, barcode: 'INV09-SYNTHETIC', product_id: 11, warehouse_id: 3, location_id: null, remaining_qty: '2.00', status: 1, deleted_at: null, locked_by_task_id: 7, ...container },
    ret: { id: 13, adjustment_item_id: 12, source_container_id: 101, original_container_id: 100, qty: '2.00', status: 1, warehouse_task_id: 7, warehouse_id: 3, adjustment_product_id: 11, ...ret },
    reserved: '3.00',
    quantity: '3.00',
  }
  const target = { id: 21, code: 'INV09-SYNTHETIC-LOC', warehouse_id: 3, status: 1, deleted_at: null, ...location }
  const queries = [], lifecycle = []
  let before, active = false, releaseCount = 0
  const conn = {
    async beginTransaction() { lifecycle.push('begin'); before = structuredClone(state); active = true },
    async commit() { lifecycle.push('commit'); active = false },
    async rollback() { lifecycle.push('rollback'); state = structuredClone(before); active = false },
    release() { assert.equal(active, false, 'transaction must end before release'); releaseCount++; lifecycle.push('release') },
    async query(sql, params = []) {
      queries.push({ sql, params })
      if (sql.includes('FROM sale_order_adjustment_container_returns r') && sql.includes('wt.id AS warehouse_task_id')) return [[{ ...state.ret }]]
      if (sql.startsWith('SELECT product_id, warehouse_id FROM inventory_containers')) return [[{ product_id: state.container.product_id, warehouse_id: state.container.warehouse_id, ...dim }]]
      if (sql.includes('FROM product_items')) return [[{ id: 11, name: '合成商品', allow_decimal_qty: 1 }]]
      if (sql.includes('INSERT INTO inventory_stock')) return [{ affectedRows: 1 }]
      if (sql.startsWith('SELECT quantity FROM inventory_stock')) return [[{ quantity: state.quantity }]]
      if (sql.includes('FROM inventory_containers WHERE id=?') && sql.includes('FOR UPDATE')) {
        if (sql.includes('deleted_at IS NULL') && state.container.deleted_at != null) return [[]]
        return [[{ ...state.container }]]
      }
      if (sql.includes('FROM warehouse_locations')) {
        if (sql.startsWith('SELECT code')) return [[{ code: 'ORIGINAL' }]]
        const found = target.id === params[0] && (!sql.includes('deleted_at IS NULL') || target.deleted_at == null) && (!/status\s*=\s*1/.test(sql) || target.status === 1)
        return [found ? [{ ...target }] : []]
      }
      if (sql.startsWith('UPDATE inventory_containers')) {
        state.container.locked_by_task_id = null
        if (sql.includes('location_id = ?')) state.container.location_id = params[0]
        return [{ affectedRows: 1 }]
      }
      if (/^\s*UPDATE sale_order_adjustment_container_returns/.test(sql)) {
        state.ret.status = 2
        state.ret.target_location_id = params[1]
        if (failAfterReturnWrite) throw new Error('INV09_SYNTHETIC_AFTER_RETURN_WRITE')
        return [{ affectedRows: 1 }]
      }
      if (sql.includes('SELECT i.adjustment_id')) return [[{ adjustment_id: 10 }]]
      if (sql.startsWith('SELECT * FROM sale_order_adjustments')) return [[{ id: 10, status: 1, warehouse_task_id: 7, sale_order_id: 9 }]]
      if (sql.startsWith('SELECT * FROM sale_order_adjustment_items')) return [[{ id: 12, status: 1 }]]
      // A pending package confirmation keeps the original reservation until the
      // existing finalizer closes the complete item. DB acceptance covers that close.
      if (sql.includes('AS pendingVoids')) return [[{ pendingVoids: 1 }]]
      if (sql.includes('AS pendingReturns')) return [[{ pendingReturns: state.ret.status === 1 ? 1 : 0 }]]
      throw new Error(`Unexpected SQL: ${sql}`)
    },
  }
  const api = load(source, {
    '../fulfillment/fulfillment.refresh': { commitFulfillment: async connection => connection.commit() },
    '../../config/db': { pool: { getConnection: async () => conn } },
    '../../utils/AppError': AppError,
    '../../utils/statusTransition': {},
    '../../engine/reservationEngine': { partialReleaseByProduct: () => { throw new Error('must not release while package pending') } },
    '../../engine/containerEngine': engine,
    '../../constants/warehouseTaskStatus': {},
    './warehouse-task-events.service': {},
    './warehouse-tasks.helpers': helpers,
    '../../utils/warehouseScope': warehouseScope,
    './warehouse-tasks.handoff': {},
    '../../utils/unitConversion': unitConversion,
    '../../utils/qtyPrecision': qtyPrecision,
  })
  const initial = structuredClone(state)
  const run = (targetLocationId = 21, options = {}) => api.confirmContainerReturn(13, { targetLocationId, operator: { userId: 1, realName: '合成操作' }, scopeWarehouseIds: [3], pdaWarehouseId: 3, ...options })
  const runOmitted = () => api.confirmContainerReturn(13, { operator: { userId: 1, realName: '合成操作' }, scopeWarehouseIds: [3], pdaWarehouseId: 3 })
  return { run, runOmitted, initial, state: () => state, queries, lifecycle, releases: () => releaseCount }
}

async function unchangedRejection(f, target = 21, options) {
  await assert.rejects(() => f.run(target, options), error => error instanceof AppError && error.statusCode >= 400 && error.statusCode < 500)
  assert.deepEqual(f.state(), f.initial, 'no container/return/quantity/reservation changes')
  assert.deepEqual(f.lifecycle, ['begin', 'rollback', 'release'])
  assert.equal(f.releases(), 1)
}

for (const value of [null, 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '21', true, NaN]) {
  test(`NULL original location rejects non-positive/non-safe target ${String(value)}`, async () => unchangedRejection(fixture(), value))
}
test('NULL original location rejects an omitted target', async () => {
  const f = fixture()
  await assert.rejects(f.runOmitted, error => error instanceof AppError && error.statusCode === 400)
  assert.deepEqual(f.state(), f.initial)
  assert.deepEqual(f.lifecycle, ['begin', 'rollback', 'release'])
})
for (const [name, location] of [
  ['other warehouse', { warehouse_id: 4 }],
  ['inactive', { status: 2 }],
  ['deleted', { deleted_at: '2026-10-14 00:00:00' }],
  ['nonexistent', { id: 22 }],
]) test(`NULL original location rejects ${name} target without side effects`, async () => unchangedRejection(fixture({ location })))

test('valid same-warehouse target relocates exact returned container; keeps stock and pending reservation', async () => {
  const f = fixture()
  const result = await f.run()
  assert.equal(result.finalized, false)
  assert.equal(f.state().container.location_id, 21)
  assert.equal(f.state().container.locked_by_task_id, null)
  assert.equal(f.state().container.remaining_qty, '2.00')
  assert.equal(f.state().quantity, '3.00')
  assert.equal(f.state().reserved, '3.00')
  assert.equal(f.state().ret.status, 2)
  assert.deepEqual(f.lifecycle, ['begin', 'commit', 'release'])
  const dimension = f.queries.findIndex(q => q.sql.startsWith('SELECT quantity FROM inventory_stock'))
  const container = f.queries.findIndex(q => q.sql.includes('FROM inventory_containers') && q.sql.includes('FOR UPDATE'))
  const location = f.queries.findIndex(q => q.sql.includes('FROM warehouse_locations'))
  assert.ok(dimension >= 0 && dimension < container && container < location)
  assert.match(f.queries[location].sql, /FOR (?:SHARE|UPDATE)/, 'current locked location read in the same transaction')
})
test('original location remains mandatory', async () => unchangedRejection(fixture({ container: { location_id: 23 } })))
test('matching original location preserves existing inactive-history policy', async () => {
  const f = fixture({ container: { location_id: 21 }, location: { status: 2 } })
  await f.run()
  assert.equal(f.state().container.location_id, 21)
})
for (const [name, container, ret, dim] of [
  ['wrong current task lock', { locked_by_task_id: 8 }],
  ['already unlocked', { locked_by_task_id: null }],
  ['not ACTIVE', { status: 3 }],
  ['deleted container', { deleted_at: '2026-10-14 00:00:00' }],
  ['wrong warehouse', { warehouse_id: 4 }],
  ['wrong product', { product_id: 12 }],
  ['remaining does not match returned part', { remaining_qty: '3.00' }],
  ['zero remaining', { remaining_qty: '0.00' }],
  ['non-positive return quantity', {}, { qty: '0.00' }],
  ['dimension changed while waiting', {}, {}, { product_id: 12 }],
]) test(`locked current facts reject ${name}`, async () => unchangedRejection(fixture({ container, ret, dim })))
test('scope and PDA warehouse rejection stay before container actions', async () => {
  for (const options of [{ scopeWarehouseIds: [4] }, { pdaWarehouseId: 4 }]) {
    const f = fixture()
    await unchangedRejection(f, 21, options)
    assert.equal(f.queries.some(q => q.sql.includes('FROM inventory_containers')), false)
  }
})
test('already confirmed return remains a rejection with no second unlock/release', async () => unchangedRejection(fixture({ ret: { status: 2 } })))
test('failure after actual return write rolls back container unlock, location and return status', async () => {
  const f = fixture({ failAfterReturnWrite: true })
  await assert.rejects(f.run, /INV09_SYNTHETIC_AFTER_RETURN_WRITE/)
  assert.deepEqual(f.state(), f.initial)
  assert.deepEqual(f.lifecycle, ['begin', 'rollback', 'release'])
})
