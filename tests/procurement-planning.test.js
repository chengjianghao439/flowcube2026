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
test('coverage from plans, requisitions and PO drafts suppresses new demand only once', () => {
  const r = planning.calculateSupply({ confirmedDemand: 100, planCoverage: 30, requisitionCoverage: 40, draftCoverage: 30 })
  assert.equal(r.netRequirement, 0)
  assert.equal(r.suggestedQty, 0)
  assert.equal(planning.calculateSupply({ confirmedDemand: 100, planCoverage: 20, requisitionCoverage: 40, draftCoverage: 30 }).netRequirement, 10)
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
