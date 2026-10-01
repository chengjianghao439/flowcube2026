'use strict'
const AppError = require('../../utils/AppError')
const { assertQtyPrecisionWith, assertQtyScale } = require('../../utils/qtyPrecision')
const { roundQty, round8 } = require('../../utils/unitConversion')
const MAX_QTY = 9999999999.99
const MAX_PRICE = 99999999.9999
// Existing sale order/item amounts are DECIMAL(14,4); two-place preview amounts must fit.
const MAX_AMOUNT_CENTS = 999999999999

function assertPrice(value, label = '价格', scale = 4) {
  const n = Number(value)
  const units = n * 10 ** scale
  if (value == null || typeof value === 'boolean' || String(value).trim() === '' || !Number.isFinite(n) || n < 0 || n > MAX_PRICE || (n !== 0 && Math.round(units) === 0) || Math.abs(units - Math.round(units)) > Number.EPSILON * Math.max(1, Math.abs(units)) * 2) {
    throw new AppError(`${label}必须是非负数且最多 ${scale} 位小数`, 400, 'KIT_PRICE_INVALID')
  }
  return n
}
function assertPositiveQty(value) {
  assertQtyScale(value)
  if (typeof value === 'boolean' || Number(value) <= 0 || Number(value) > MAX_QTY) throw new AppError('数量须大于零且在存储范围内', 400, 'QTY_INVALID')
  return Number(value)
}
/** New commercial preview only: price4 × quantity2, exact half-up to cents. */
function amountFromPriceQuantity(unitPrice, quantity) {
  const price = assertPrice(unitPrice)
  assertQtyScale(quantity)
  const qty = Number(quantity)
  if (typeof quantity === 'boolean' || qty < 0 || qty > MAX_QTY) throw new AppError('数量超出存储范围', 400, 'QTY_INVALID')
  const cents = (BigInt(Math.round(price * 10000)) * BigInt(Math.round(qty * 100)) + 5000n) / 10000n
  if (cents > BigInt(MAX_AMOUNT_CENTS)) throw new AppError('商业行金额超出金额存储范围', 400, 'KIT_AMOUNT_OVERFLOW')
  return Number(cents) / 100
}
function snapshotComponents(input, products) {
  if (!Array.isArray(input) || input.length === 0 || input.length > 50) throw new AppError('套件须包含 1 至 50 个组件', 400, 'KIT_COMPONENT_LIMIT')
  const ids = input.map(c => Number(c.productId))
  if (new Set(ids).size !== ids.length) throw new AppError('套件组件不能重复', 400, 'KIT_COMPONENT_DUPLICATE')
  const explicitCount = input.filter(c => c.amountWeight !== undefined).length
  if (explicitCount && explicitCount !== input.length) throw new AppError('显式权重须为全部组件提供，不能与默认权重混用', 400, 'KIT_WEIGHT_POLICY_MIXED')
  const result = input.map((c, index) => {
    const product = products.get(Number(c.productId))
    if (!product) throw new AppError('套件只能引用真实商品', 400, 'KIT_COMPONENT_MISSING')
    const baseQty = assertPositiveQty(c.baseQty)
    assertQtyPrecisionWith({ name: product.name, allowDecimal: product.allow_decimal_qty == null || Number(product.allow_decimal_qty) === 1 }, c.baseQty)
    const referencePrice = assertPrice(product.sale_price_a ?? 0, '组件参考A价')
    // A价四位 × 基本量两位，快照权重保留六位，不把小权重舍成零。
    const microWeight = explicitCount ? BigInt(Math.round(assertPrice(c.amountWeight, '组件权重') * 10000)) * 100n : BigInt(Math.round(referencePrice * 10000)) * BigInt(Math.round(baseQty * 100))
    const amountWeight = `${microWeight / 1000000n}.${String(microWeight % 1000000n).padStart(6, '0')}`
    if (microWeight > 99999999999999999999n) throw new AppError('组件权重超出存储范围', 400, 'KIT_WEIGHT_INVALID')
    return { productId: Number(c.productId), baseQty, referencePrice, amountWeight, weightSource: explicitCount ? 'explicit' : 'product_a', sortNo: index }
  })
  if (!result.some(c => c.amountWeight > 0)) throw new AppError('组件参考金额全为零，请填写有效的显式权重', 400, 'KIT_WEIGHTS_ZERO')
  return result
}
function orderedComponents(components) {
  return [...components].sort((a, b) => Number(a.sortNo) - Number(b.sortNo) || Number(a.id ?? a.productId) - Number(b.id ?? b.productId))
}
function allocateCents(amount, components) {
  const cents = Math.round(amount * 100)
  if (!Number.isSafeInteger(cents)) throw new AppError('套件行金额超出安全范围', 400, 'KIT_AMOUNT_OVERFLOW')
  // Decimal weights become exact integer micro-units; floating division never determines cents.
  const weights = components.map(c => {
    const raw = String(c.amountWeight)
    if (!/^\d+(?:\.\d{1,6})?$/.test(raw)) throw new AppError('版本组件权重无效', 409, 'KIT_WEIGHT_INVALID')
    const [whole, fraction = ''] = raw.split('.')
    return BigInt(whole) * 1000000n + BigInt(fraction.padEnd(6, '0'))
  })
  const total = weights.reduce((s, w) => s + w, 0n)
  if (!total) throw new AppError('版本组件权重全为零', 409, 'KIT_WEIGHTS_ZERO')
  const allocations = weights.map(w => Number(BigInt(cents) * w / total))
  let remainder = cents - allocations.reduce((s, v) => s + v, 0)
  // Tail cents go to positive-weight components in fixed sort/id order. Zero weights stay zero.
  for (let i = 0; remainder > 0; i = (i + 1) % weights.length) {
    if (weights[i] > 0n) { allocations[i]++; remainder-- }
  }
  return allocations.map(v => v / 100)
}
function expandCommercialGroups(groups) {
  if (!Array.isArray(groups) || !groups.length || groups.length > 200) throw new AppError('商业行须为 1 至 200 行', 400, 'KIT_GROUP_LIMIT')
  if (new Set(groups.map(g => g.lineKey)).size !== groups.length) throw new AppError('商业行标识不能重复', 400, 'KIT_LINE_KEY_DUPLICATE')
  const physical = new Map()
  const commercialGroups = groups.map(g => {
    if (g.kind === 'kit' && (!Number.isSafeInteger(Number(g.quantity)) || Number(g.quantity) <= 0)) throw new AppError('套数须为正整数', 400, 'KIT_QUANTITY_INTEGER')
    const quantity = assertPositiveQty(g.quantity)
    const unitPrice = assertPrice(g.unitPrice)
    const amount = amountFromPriceQuantity(unitPrice, quantity)
    if (!Number.isSafeInteger(Math.round(amount * 100))) throw new AppError('商业行金额超出金额存储范围', 400, 'KIT_AMOUNT_OVERFLOW')
    const ordered = g.kind === 'kit' ? orderedComponents(g.components) : [{ productId: g.productId, baseQty: 1, sortNo: 0 }]
    const allocated = g.kind === 'kit' ? allocateCents(amount, ordered) : [amount]
    const components = ordered.map((c, i) => {
      const componentQty = roundQty(c.baseQty * quantity)
      if (componentQty > MAX_QTY) throw new AppError('组件需求数量超出存储范围', 400, 'QTY_INVALID')
      const row = { ...c, quantity: componentQty, amount: allocated[i] }
      const key = `${c.productId}:${g.warehouseId}`
      const item = physical.get(key) || { productId: c.productId, warehouseId: g.warehouseId, quantity: 0, amountCents: 0, commercialLineKeys: [] }
      item.quantity = roundQty(item.quantity + componentQty)
      if (item.quantity > MAX_QTY) throw new AppError('物理需求数量超出存储范围', 400, 'QTY_INVALID')
      item.amountCents += Math.round(row.amount * 100)
      if (!Number.isSafeInteger(item.amountCents) || item.amountCents > MAX_AMOUNT_CENTS) throw new AppError('物理行金额超出安全范围', 400, 'KIT_AMOUNT_OVERFLOW')
      item.commercialLineKeys.push(g.lineKey)
      physical.set(key, item)
      return row
    })
    return { ...g, unitPrice, quantity, amount, components }
  })
  if (physical.size > 200) throw new AppError('展开后的物理需求不能超过 200 行', 400, 'KIT_PHYSICAL_LIMIT')
  const physicalItems = [...physical.values()].sort((a, b) => a.productId - b.productId || a.warehouseId - b.warehouseId).map(({ amountCents, ...p }) => ({ ...p, amount: amountCents / 100, unitPrice: round8(amountCents / 100 / p.quantity) }))
  const amountCents = physicalItems.reduce((s, p) => s + Math.round(p.amount * 100), 0)
  if (!Number.isSafeInteger(amountCents) || amountCents > MAX_AMOUNT_CENTS) throw new AppError('总金额超出安全范围', 400, 'KIT_AMOUNT_OVERFLOW')
  return { commercialGroups, physicalItems, amount: amountCents / 100 }
}
module.exports = { amountFromPriceQuantity, assertPrice, assertPositiveQty, snapshotComponents, expandCommercialGroups }
