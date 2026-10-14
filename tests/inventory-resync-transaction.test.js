'use strict'

// Actual narrow service helper plus actual lock/sync engine functions, with a
// transactional SQL double. Real MySQL concurrency is evidenced separately.
const test = require('node:test'), assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm')
const { createRequire } = require('node:module')
const root = path.resolve(__dirname, '..')
const qty = require('../backend/src/utils/qtyPrecision'), units = require('../backend/src/utils/unitConversion')
function load(file, mocks, source = null) {
  const filename = path.join(root, file), real = createRequire(filename), module = { exports: {} }
  vm.runInNewContext(source ?? fs.readFileSync(filename, 'utf8'), { module, exports: module.exports, require: name => Object.hasOwn(mocks, name) ? mocks[name] : real(name) }, { filename })
  return module.exports
}
const helperFile = 'backend/src/modules/inventory/inventory.resync.js'
function harness({ fault = null, rollbackFails = false, quantity = 10, reserved = 4, allowDecimal = 0, reservedCandidates = [{ productId: 7, warehouseId: 8, cacheReserved: 3, ledgerReserved: 4 }], helperSource = null } = {}) {
  const events = [], connections = [], cache = new Map()
  const cacheFor = key => { if (!cache.has(key)) cache.set(key, { quantity: 9, reserved: 3 }); return cache.get(key) }
  const pool = {
    async query(sql) {
      events.push({ label: 'pool-read', sql })
      assert(sql.includes('AS cacheReserved'), 'business sync/lock SQL must use the transaction connection')
      return [sql.includes('AND 1=0') ? [] : reservedCandidates]
    },
    async getConnection() {
      let active = false, dimension, staged
      const conn = {
        async beginTransaction() { events.push({ label: 'begin' }); active = true },
        async commit() {
          events.push({ label: 'commit', dimension })
          if (fault === 'commit') throw new Error('injected commit failure')
          cache.set(dimension, { ...staged }); active = false
        },
        async rollback() {
          events.push({ label: 'rollback', dimension })
          if (rollbackFails) throw new Error('injected rollback failure')
          active = false
        },
        release() { assert.equal(active, false, 'active transaction returned to pool'); events.push({ label: 'release', dimension }) },
        destroy() { active = false; events.push({ label: 'destroy', dimension }) },
        async query(sql, params) {
          assert.equal(active, true, 'business read/write must be within BEGIN')
          if (sql.includes('allow_decimal_qty')) {
            events.push({ label: 'product-policy', productId: params[0][0] })
            return [params[0].map(id => ({ id, name: '合成商品', allow_decimal_qty: allowDecimal }))]
          }
          if (sql.includes('ON DUPLICATE KEY UPDATE product_id = product_id')) {
            dimension = `${params[0]}:${params[1]}`; staged = { ...cacheFor(dimension) }
            events.push({ label: 'dimension-lock', dimension }); return [{}]
          }
          if (sql.includes('SELECT quantity FROM inventory_stock')) return [[{ quantity: staged.quantity }]]
          if (sql.includes('SUM(remaining_qty)')) { events.push({ label: 'container-sum', dimension }); return [[{ total: quantity }]] }
          if (sql.includes('SUM(qty)')) { events.push({ label: 'ledger-sum', dimension }); return [[{ total: reserved }]] }
          if (sql.includes('ON DUPLICATE KEY UPDATE quantity=?')) { events.push({ label: 'quantity-write', dimension }); staged.quantity = params[3]; return [{}] }
          if (sql.includes('ON DUPLICATE KEY UPDATE reserved=?')) {
            events.push({ label: 'reserved-write', dimension })
            if (fault === 'reserved') throw new Error('injected reserved write failure')
            staged.reserved = params[3]; return [{}]
          }
          throw new Error('Unexpected SQL: ' + sql)
        },
      }
      connections.push(conn); return conn
    },
  }
  const scopes = load('backend/src/utils/warehouseScope.js', { '../config/db': { pool } })
  const engines = load('backend/src/engine/containerEngine.js', { '../utils/logger': {}, '../utils/codeGenerator': {}, '../utils/expectedStock': {}, '../utils/qtyPrecision': qty, '../utils/unitConversion': units })
  const reservations = load('backend/src/engine/reservationEngine.js', { '../utils/logger': {}, '../utils/expectedStock': {}, './containerEngine': engines, '../utils/qtyPrecision': qty, '../utils/unitConversion': units })
  const helper = load(helperFile, { '../../engine/containerEngine': engines, '../../engine/reservationEngine': reservations, '../../utils/qtyPrecision': qty, '../../utils/warehouseScope': scopes }, helperSource)
  return { helper, pool, cache, cacheFor, events, connections }
}
test('one dimension: product policy → dimension → container/ledger, both cache writes in one commit', async () => {
  const h = harness()
  const result = await h.helper.repairDimension(h.pool, 7, 8, [8])
  assert.deepEqual({ ...result }, { quantity: 10, reserved: 4 })
  assert.deepEqual(h.cacheFor('7:8'), { quantity: 10, reserved: 4 })
  const labels = h.events.map(e => e.label)
  assert(labels.indexOf('product-policy') < labels.indexOf('dimension-lock'))
  assert(labels.indexOf('dimension-lock') < labels.indexOf('container-sum'))
  assert(labels.indexOf('container-sum') < labels.indexOf('ledger-sum'))
  assert(labels.lastIndexOf('product-policy') > labels.indexOf('ledger-sum'))
  assert(labels.lastIndexOf('product-policy') < labels.indexOf('reserved-write'))
  assert.deepEqual(labels.slice(-2), ['commit', 'release'])
  assert.equal(h.connections.length, 1)
  assert.equal(labels.filter(x => x === 'commit').length, 1)
  assert.equal(labels.includes('pool-read'), false)
})
for (const fault of ['reserved', 'commit']) {
  test(`${fault} failure rolls back both caches and releases its connection`, async () => {
    const h = harness({ fault })
    await assert.rejects(h.helper.repairDimension(h.pool, 7, 8, [8]), /injected/)
    assert.deepEqual(h.cacheFor('7:8'), { quantity: 9, reserved: 3 })
    assert.deepEqual(h.events.slice(-2).map(e => e.label), ['rollback', 'release'])
  })
}
test('uncertain rollback destroys only this borrowed connection and preserves the original error', async () => {
  const h = harness({ fault: 'reserved', rollbackFails: true })
  await assert.rejects(h.helper.repairDimension(h.pool, 7, 8, [8]), /injected reserved write failure/)
  assert.deepEqual(h.events.slice(-2).map(e => e.label), ['rollback', 'destroy'])
  assert.equal(h.events.some(e => e.label === 'release'), false)
  assert.deepEqual(h.cacheFor('7:8'), { quantity: 9, reserved: 3 })
})
test('current warehouse scope rejects before loaning or locking a connection', async () => {
  const h = harness()
  await assert.rejects(h.helper.repairDimension(h.pool, 7, 8, []), { statusCode: 403, code: 'WAREHOUSE_SCOPE_DENIED' })
  assert.equal(h.connections.length, 0)
})
test('integer quantity policy also guards the derived reserved cache without partial commit', async () => {
  const h = harness({ reserved: 1.5 })
  await assert.rejects(h.helper.repairDimension(h.pool, 7, 8, [8]), { code: 'QTY_INTEGER_REQUIRED' })
  assert.equal(h.events.some(e => e.label === 'reserved-write'), false, 'invalid derived quantity must be rejected before the cache write')
  assert.deepEqual(h.cacheFor('7:8'), { quantity: 9, reserved: 3 })
})
test('decimal policy keeps legal hundredths; it does not round integer products or change prices', async () => {
  const h = harness({ allowDecimal: 1, quantity: 0.3, reserved: 0.2 })
  await h.helper.repairDimension(h.pool, 7, 8, [8])
  assert.deepEqual(h.cacheFor('7:8'), { quantity: 0.3, reserved: 0.2 })
})
test('empty facts zero both caches via existing sync entrypoints', async () => {
  const h = harness({ quantity: 0, reserved: 0 })
  await h.helper.repairDimension(h.pool, 7, 8, [8])
  assert.deepEqual(h.cacheFor('7:8'), { quantity: 0, reserved: 0 })
})
test('quantity/reserved candidate union deduplicates and orders dimensions, preserving old response fields', async () => {
  const h = harness({ reservedCandidates: [{ productId: 7, warehouseId: 8, cacheReserved: 3 }, { productId: 5, warehouseId: 9, cacheReserved: 1 }] })
  const result = await h.helper.resyncDimensions(h.pool, [{ productId: 7, warehouseId: 8, cacheQty: 9 }, { productId: 7, warehouseId: 9, cacheQty: 2 }], [8, 9])
  assert.deepEqual(h.events.filter(e => e.label === 'dimension-lock').map(e => e.dimension), ['5:9', '7:8', '7:9'])
  assert.equal(h.connections.length, 3)
  assert.equal(result.fixed, 2); assert.equal(result.total, 2); assert.equal(result.reservedFixed, 2)
  assert.deepEqual(Array.from(result.rows, r => r.before), [9, 2])
  assert.deepEqual(Array.from(result.reservedRows, r => r.before), [3, 1])
  assert.deepEqual(Array.from(result.rows, r => r.after), [10, 10])
})
test('empty candidates and scope run no transaction or cache write', async () => {
  const h = harness()
  const result = await h.helper.resyncDimensions(h.pool, [], [])
  assert.equal(result.fixed, 0); assert.equal(result.reservedFixed, 0)
  assert.equal(h.connections.length, 0)
})
test('mutating the real cache sync to pool instead of conn fails the transactional SQL guard', async () => {
  const source = fs.readFileSync(path.join(root, helperFile), 'utf8')
  const mutant = source.replace('syncStockFromContainers(conn, productId, warehouseId)', 'syncStockFromContainers(pool, productId, warehouseId)')
  assert.notEqual(mutant, source)
  const h = harness({ helperSource: mutant })
  await assert.rejects(h.helper.repairDimension(h.pool, 7, 8, [8]), /business sync\/lock SQL must use the transaction connection/)
  assert.deepEqual(h.events.slice(-2).map(e => e.label), ['rollback', 'release'])
})
test('deleting the real BEGIN is caught before any cache SQL can run', async () => {
  const source = fs.readFileSync(path.join(root, helperFile), 'utf8')
  const mutant = source.replace('await conn.beginTransaction()', '')
  assert.notEqual(mutant, source)
  const h = harness({ helperSource: mutant })
  await assert.rejects(h.helper.repairDimension(h.pool, 7, 8, [8]), /business read\/write must be within BEGIN/)
})
