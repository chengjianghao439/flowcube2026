'use strict'
const AppError = require('../../utils/AppError')
const { computeTierPrices } = require('../../utils/priceLevels')
const { assertPrice } = require('./kits.composition')

function assertCost(value) {
  const price = assertPrice(value, '进价')
  if (price <= 0) throw new AppError('进价必须大于 0', 400, 'KIT_PRICE_INVALID')
  return price
}
function resolvePrices(input, previous = null, rates) {
  const cost = input.costPrice === undefined ? null : assertCost(input.costPrice)
  const auto = cost === null ? null : computeTierPrices(cost, rates)
  const alias = input.referenceUnitPrice === undefined ? undefined : assertPrice(input.referenceUnitPrice, '价格 A')
  const requestedA = input.salePriceA == null ? input.salePriceA : assertPrice(input.salePriceA, '价格 A')
  if (alias !== undefined && requestedA !== undefined && requestedA !== null && alias !== requestedA) throw new AppError('参考价与价格 A 必须一致', 400, 'KIT_PRICE_ALIAS_CONFLICT')
  const result = {}
  for (const field of ['salePriceA', 'salePriceB', 'salePriceC', 'salePriceD']) {
    if (input[field] === null && auto === null) throw new AppError('空售价按加价率计算时必须提供有效进价', 400, 'KIT_PRICE_REQUIRED')
    const supplied = field === 'salePriceA' && input.salePriceA === undefined && alias !== undefined ? alias : input[field]
    let value
    // Omission on edit retains the immutable version. Explicit null requests calculation.
    if (supplied === undefined && previous) value = field === 'salePriceA' ? previous.referenceUnitPrice : previous[field] ?? null
    else if (supplied == null) value = auto?.[field] ?? (field === 'salePriceA' ? previous?.referenceUnitPrice : null)
    else value = supplied
    if (field === 'salePriceA' && value == null) throw new AppError('请提供进价或价格 A', 400, 'KIT_PRICE_REQUIRED')
    result[field] = value == null ? null : assertPrice(value, field === 'salePriceA' ? '价格 A' : `价格 ${field.slice(-1)}`)
  }
  if (alias !== undefined && alias !== result.salePriceA) throw new AppError('参考价与价格 A 必须一致', 400, 'KIT_PRICE_ALIAS_CONFLICT')
  return { referenceUnitPrice: result.salePriceA, ...result }
}
function effectivePrices(version) {
  const a = Number(version.referenceUnitPrice)
  return { salePriceA: a, salePriceB: Number(version.salePriceB ?? a), salePriceC: Number(version.salePriceC ?? a), salePriceD: Number(version.salePriceD ?? a) }
}
function profileValues(input, previous = {}) {
  return {
    categoryId: input.categoryId === undefined ? previous.category_id ?? null : input.categoryId,
    supplierId: input.supplierId === undefined ? previous.supplier_id ?? null : input.supplierId,
    unit: input.unit === undefined ? previous.unit ?? '套' : input.unit,
    spec: input.spec === undefined ? previous.spec ?? null : input.spec,
    color: input.color === undefined ? previous.color ?? null : input.color,
    articleNumber: input.articleNumber === undefined ? previous.article_number ?? null : input.articleNumber || null,
    costPrice: input.costPrice === undefined ? previous.cost_price ?? null : assertCost(input.costPrice),
    remark: input.remark === undefined ? previous.remark ?? null : input.remark || null,
  }
}
function profileView(row) {
  return {
    categoryId: row.category_id == null ? null : Number(row.category_id), categoryName: row.category_name ?? null,
    supplierId: row.supplier_id == null ? null : Number(row.supplier_id), supplierName: row.supplier_name ?? null,
    unit: row.unit ?? '套', spec: row.spec ?? null, color: row.color ?? null,
    articleNumber: row.article_number ?? null, costPrice: row.cost_price == null ? null : Number(row.cost_price), remark: row.remark ?? null,
  }
}
async function validateReferences(conn, input) {
  if (input.categoryId != null) {
    const [[row]] = await conn.query('SELECT id,status,deleted_at FROM product_categories WHERE id=? FOR SHARE', [input.categoryId])
    if (!row || Number(row.status) !== 1 || row.deleted_at != null) throw new AppError('商品分类不存在、已停用或删除', 400, 'KIT_CATEGORY_UNAVAILABLE')
  }
  if (input.supplierId != null) {
    const [[row]] = await conn.query('SELECT id,is_active,deleted_at FROM supply_suppliers WHERE id=? FOR SHARE', [input.supplierId])
    if (!row || Number(row.is_active) !== 1 || row.deleted_at != null) throw new AppError('供应商不存在、已停用或删除', 400, 'KIT_SUPPLIER_UNAVAILABLE')
  }
}
module.exports = { resolvePrices, effectivePrices, profileValues, profileView, validateReferences }
