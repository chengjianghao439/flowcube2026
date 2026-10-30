const test = require('node:test')
const assert = require('node:assert/strict')
const planning = require('../backend/src/modules/procurement/procurement.planning')

test('confirmed orders consume forecast, reservations and expected bindings are not subtracted twice', () => {
  const r = planning.calculateSupply({ forecastDemand: 100, confirmedDemand: 80, reserved: 80, onHand: 20, inTransit: 50, expectedBound: 50, safetyStock: 10 })
  assert.equal(r.residualForecast, 20)
  assert.equal(r.grossDemand, 100)
  assert.equal(r.netRequirement, 40)
})
test('new product without history includes all unshipped demand', () => {
  assert.equal(planning.calculateSupply({ confirmedDemand: 73 }).netRequirement, 73)
})
test('73 net, 12 pack and 100 MOQ orders 108, with 35 additional units', () => {
  const r = planning.calculateSupply({ confirmedDemand: 73, packMultiple: 12, minimumOrderQty: 100 })
  assert.equal(r.suggestedQty, 108)
  assert.equal(r.excessQty, 35)
})
test('retired requisitions do not cover demand; active plans and PO drafts still do', () => {
  const r = planning.calculateSupply({ confirmedDemand: 100, planCoverage: 30, requisitionCoverage: 40, draftCoverage: 30 })
  assert.equal(r.netRequirement, 40)
  assert.equal(r.suggestedQty, 40)
  assert.equal(planning.calculateSupply({ confirmedDemand: 100, planCoverage: 20, requisitionCoverage: 40, draftCoverage: 30 }).netRequirement, 50)
})
test('transfer candidate protects source demand, reservation and safety and does not reduce purchase recommendation', () => {
  assert.equal(planning.transferSurplus({ onHand: 150, confirmedDemand: 90, forecastDemand: 100, reserved: 110, safetyStock: 20 }), 20)
  assert.equal(planning.transferSurplus({ onHand: 20, confirmedDemand: 30, inTransit: 100 }), 0)
  assert.equal(planning.calculateSupply({ confirmedDemand: 73, transferCandidates: [{ quantity: 50 }] }).suggestedQty, 73)
})
test('fractional multiples retain inventory precision and reject invalid packaging', () => {
  assert.equal(planning.roundPurchase(0.73, 0.12, 1), 1.08)
  assert.equal(planning.roundPurchase(0, 12, 100), 0)
  assert.throws(() => planning.roundPurchase(2, -1, 0))
})

// Exercise the coverage reader with a strict connection; retired tables must never
// enter its SQL, while plan exclusion bindings and draft POs remain intact.
test('coverage SQL reads only live plans and purchase drafts', async () => {
  const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path')
  const filename = path.join(__dirname, '../backend/src/modules/inventory/inventory.procurement.js')
  const module = { exports: {} }
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module, require(name) {
    if (name.endsWith('runtimeLifecycle')) return { lifecycle: { startTask() {} } }
    if (name.endsWith('procurement.snapshots')) return { createProcurementSnapshots: () => ({}) }
    return {}
  } }, { filename })
  const calls = []
  const conn = { async query(sql, params) {
    calls.push({ sql, params })
    return [[{ product_id: 7, warehouse_id: 8, kind: 'plan', quantity: 20 }, { product_id: 7, warehouse_id: 8, kind: 'draft', quantity: 30 }]]
  } }
  const coverage = await module.exports.getCoverage(conn, [{ productId: 7, warehouseId: 8 }], { excludePlanItemIds: [11] })
  assert.equal(calls.length, 1)
  assert.doesNotMatch(calls[0].sql, /purchase_requisition/)
  assert.match(calls[0].sql, /purchase_order_items/)
  assert.deepEqual(Array.from(calls[0].params), [7, 8, 11, 7, 8])
  assert.equal(coverage.get('7:8').planCoverage, 20)
  assert.equal(coverage.get('7:8').draftCoverage, 30)
  assert.equal(Object.hasOwn(coverage.get('7:8'), 'requisitionCoverage'), false)
})

test('plan conversion HTTP body accepts purchase drafts and rejects a retired target', () => {
  const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path')
  const posts = new Map(), router = { use() {}, get() {}, put() {}, post(route, ...handlers) { posts.set(route, handlers) } }
  const module = { exports: {} }, filename = path.join(__dirname, '../backend/src/modules/procurement/procurement.routes.js')
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module, require(name) {
    if (name === 'express') return { Router: () => router }
    if (name === 'zod') return require('../backend/node_modules/zod')
    if (name.endsWith('auth')) return { authMiddleware() {}, requirePermission() {} }
    if (name.endsWith('permissions')) return { PERMISSIONS: {} }
    if (name.endsWith('/route')) return { validateBody: schema => ({ schema }) }
    if (name.endsWith('qtyPrecision')) return { hasTooManyDecimals: () => false }
    return {}
  } }, { filename })
  const schema = posts.get('/plans/:id/convert').find(handler => handler?.schema).schema
  assert.equal(schema.safeParse({ itemIds: [1], target: 'purchase' }).success, true)
  assert.equal(schema.safeParse({ itemIds: [1] }).success, true)
  assert.equal(schema.safeParse({ itemIds: [1], target: 'requisition' }).success, false)
})
