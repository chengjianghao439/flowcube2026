const AppError = require('../../utils/AppError')
const { round4 } = require('../../utils/unitConversion')

const nonnegative = n => Math.max(0, Number(n) || 0)

/** Base-unit arithmetic; package rounding follows MOQ, so MOQ 100 with packs of 12 yields 108. */
function roundPurchase(net, multiple = 0, minimum = 0) {
  if (![net, multiple, minimum].every(n => Number.isFinite(Number(n)) && Number(n) >= 0)) throw new AppError('净需求、包装倍数和起订量必须为非负数', 400)
  const required = Math.ceil(Number(net) * 10000 - 1e-7)
  if (!required) return 0
  const pack = Math.round(Number(multiple) * 10000)
  const floor = Math.max(required, Math.ceil(Number(minimum) * 10000 - 1e-7))
  return (pack > 0 ? Math.ceil(floor / pack) * pack : floor) / 10000
}

function calculateSupply(input = {}) {
  const confirmedDemand = nonnegative(input.confirmedDemand)
  const forecastDemand = nonnegative(input.forecastDemand)
  const residualForecast = Math.max(0, forecastDemand - confirmedDemand)
  // Reservations are already represented by sales. Preserve any larger reservation floor
  // (e.g. physical return pending after a sales reduction), never add them to demand twice.
  const grossDemand = Math.max(confirmedDemand + residualForecast, nonnegative(input.reserved))
  const provisionalCoverage = nonnegative(input.planCoverage) + nonnegative(input.requisitionCoverage) + nonnegative(input.draftCoverage)
  const physicalNet = Math.max(0, grossDemand + nonnegative(input.safetyStock) - nonnegative(input.onHand) - nonnegative(input.inTransit))
  const netRequirement = round4(Math.max(0, physicalNet - provisionalCoverage))
  const suggestedQty = roundPurchase(netRequirement, input.packMultiple || 0, input.minimumOrderQty || 0)
  return { confirmedDemand, forecastDemand: round4(forecastDemand), residualForecast: round4(residualForecast), grossDemand: round4(grossDemand), provisionalCoverage: round4(provisionalCoverage), physicalNet: round4(physicalNet), netRequirement, suggestedQty, suggestQty: suggestedQty, excessQty: round4(suggestedQty - netRequirement) }
}

function transferSurplus(input = {}) {
  return round4(Math.max(0, nonnegative(input.onHand) - Math.max(nonnegative(input.confirmedDemand), nonnegative(input.forecastDemand), nonnegative(input.reserved)) - nonnegative(input.safetyStock)))
}

/** All plan/requisition mutations take this first, before document locks. No inventory is reserved. */
async function lockPlanning(conn) {
  await conn.query('SELECT id FROM procurement_planning_lock WHERE id=1 FOR UPDATE')
}

module.exports = { calculateSupply, roundPurchase, transferSurplus, lockPlanning }
