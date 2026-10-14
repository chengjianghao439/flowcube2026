const AppError = require('../../utils/AppError')
const { moneyUnits, moneyText } = require('../../utils/decimalMoney')

// Quantity hundredths × four-decimal price retains six-decimal contributions.
// Round only the persisted four-decimal average/price, never individual sources.
function qtyUnits(value) {
  const units = moneyUnits(value)
  if (units % 100n) throw new AppError('收货来源数量最多两位小数', 409, 'INBOUND_COST_SOURCE_INVALID')
  return units / 100n
}
const qtyNumber = units => Number(units) / 100
function roundRatio(numerator, denominator) {
  if (denominator <= 0n || numerator < 0n) throw new AppError('收货成本来源无效', 409, 'INBOUND_COST_SOURCE_INVALID')
  return (numerator + denominator / 2n) / denominator
}

function buildPutawayContributions(container, itemRows) {
  const qty = qtyUnits(container.remaining_qty)
  const productRows = itemRows.filter(row => Number(row.product_id) === Number(container.product_id))
  const byId = new Map(productRows.map(row => [Number(row.id), row]))
  const invalid = () => new AppError('收货箱来源量与收货明细不一致，请核对原收货事实', 409, 'INBOUND_COST_SOURCE_INVALID')
  let allocations
  if (container.inbound_source_quantities != null) {
    try {
      allocations = typeof container.inbound_source_quantities === 'string'
        ? JSON.parse(container.inbound_source_quantities) : container.inbound_source_quantities
    } catch { throw invalid() }
    if (!Array.isArray(allocations) || !allocations.length) throw invalid()
    const seen = new Set()
    allocations = allocations.map(part => {
      const id = Number(part.itemId), units = qtyUnits(part.qty)
      if (!Number.isSafeInteger(id) || !byId.has(id) || seen.has(id) || units <= 0n) throw invalid()
      seen.add(id)
      return { itemId: id, units }
    })
    if (allocations.reduce((sum, part) => sum + part.units, 0n) !== qty) throw invalid()
  } else {
    // A legacy owner denotes only the dominant line of a possibly mixed box.
    // All remaining capacity in one box establishes the complete source vector.
    // A single remaining source or equal prices also establish the actual cost.
    const available = productRows.map(row => ({ row, units: qtyUnits(row.received_qty) - qtyUnits(row.putaway_qty) }))
      .filter(part => part.units > 0n)
    const total = available.reduce((sum, part) => sum + part.units, 0n)
    if (total < qty) throw invalid()
    if (total === qty) {
      allocations = available.map(part => ({ itemId: Number(part.row.id), units: part.units }))
    } else {
      const prices = new Set(available.map(part => moneyUnits(part.row.unit_price).toString()))
      if (prices.size !== 1) {
        throw new AppError('历史收货箱未记录各采购来源量且来源价格不同，请先核对原箱来源', 409, 'INBOUND_COST_SOURCE_REVIEW_REQUIRED')
      }
      const ownerId = Number(container.inbound_task_item_id)
      const ordered = available.map(part => part.row).sort((a, b) => Number(a.id) - Number(b.id))
      const owner = ordered.find(row => Number(row.id) === ownerId)
      if (owner) {
        ordered.splice(ordered.indexOf(owner), 1)
        ordered.unshift(owner)
      }
      let left = qty
      allocations = []
      for (const row of ordered) {
        const cap = qtyUnits(row.received_qty) - qtyUnits(row.putaway_qty)
        const take = cap > left ? left : cap
        if (take > 0n) { allocations.push({ itemId: Number(row.id), units: take }); left -= take }
        if (left === 0n) break
      }
      if (left !== 0n) throw invalid()
    }
  }
  let costUnits = 0n
  for (const part of allocations) {
    const row = byId.get(part.itemId)
    const capacity = qtyUnits(row.received_qty) - qtyUnits(row.putaway_qty)
    const price = moneyUnits(row.unit_price)
    if (part.units > capacity || price < 0n) throw invalid()
    costUnits += part.units * price
  }
  return {
    allocations: allocations.map(part => ({ itemId: part.itemId, qty: qtyNumber(part.units) })),
    qtyUnits: qty, costUnits,
    // Existing all-zero source policy does not move the average or set a log price.
    purchasePrice: costUnits > 0n ? moneyText(roundRatio(costUnits, qty)) : null,
  }
}

function movingAverageCost({ globalQty, oldAverage, contribution }) {
  const previous = qtyUnits(globalQty) - contribution.qtyUnits
  const prevQty = previous > 0n ? previous : 0n
  return moneyText(roundRatio(prevQty * moneyUnits(oldAverage) + contribution.costUnits, prevQty + contribution.qtyUnits))
}

module.exports = { qtyUnits, qtyNumber, buildPutawayContributions, movingAverageCost }
