const AppError = require('./AppError')
const { assertQtyPrecision, assertQtyScale } = require('./qtyPrecision')  // 商品级数量精度开关（迁移 254）

/** 新业务只使用商品固定单位；entry_* 保留为历史单据回显和审计快照。 */

const round2 = n => Math.round((Number(n) || 0) * 100) / 100
/** 数量取整：系统最小库存精度 0.01（与数量列 DECIMAL(*,2) 一致） */
const roundQty = round2
const round8 = n => Math.round((Number(n) || 0) * 1e8) / 1e8

/** 不再读取商品辅助单位配置。旧客户端提交非固定单位时明确拒绝。 */
async function resolveConversionRate(conn, productId, entryUnit, baseUnit) {
  if (!entryUnit || (baseUnit && entryUnit === baseUnit)) return 1
  throw new AppError('商品多单位功能已删除，请按商品固定单位重新录入', 400, 'PRODUCT_MULTI_UNIT_REMOVED')
}

/**
 * 把一条明细录入折算成基本单位口径。约定：入参 item.quantity/item.unitPrice 一律是**录入单位**下的
 * 数量/单价（entryUnit 缺省=商品基本单位 item.unit）。折算：
 *   quantity(基本单位) = entryQty × rate；unit_price(每基本单位,高精度) = entryUnitPrice / rate；
 *   amount = entryQty × entryUnitPrice（金额以录入口径为权威、零截断，§5.2）。
 * 向后兼容：不传 entryUnit → entryUnit=基本单位 → rate=1 → 基本单位量=录入量，行为完全不变。
 * @returns 原 item 上补齐 { quantity, unitPrice(基本单位), amount, entryUnit, entryQty, conversionRate }
 */
function foldEntryItemWithRate(item, rate) {
  assertQtyScale(item.quantity, '录入数量')
  const entryUnit = item.entryUnit || item.unit || null
  const entryQty = Number(item.quantity) || 0
  const entryUnitPrice = (Number(item.unitPrice) || 0) * (item.priceIsBase ? rate : 1)
  assertQtyScale(entryQty * rate, '折算后的基本单位数量')
  const quantity = roundQty(entryQty * rate)
  if (!(quantity > 0)) {
    throw new AppError('数量折算后小于库存最小精度 0.01，请调整录入数量或单位换算率', 400, 'QUANTITY_BELOW_MIN_PRECISION')
  }
  return {
    ...item,
    quantity,
    unitPrice: round8(entryUnitPrice / rate),
    amount: round2(entryQty * entryUnitPrice),
    entryUnit,
    entryQty,
    conversionRate: rate,
    entryUnitPrice,
  }
}

async function foldEntryItem(conn, item) {
  const rate = await resolveConversionRate(conn, item.productId, item.entryUnit || item.unit, item.unit)
  return foldEntryItemWithRate(item, rate)
}

/** 新业务的基本单位来自主档；有源退货的单位随后由原单校验器核对。 */
async function assertFixedProductUnits(conn, items, sourceUnits = false) {
  for (const item of items) {
    if (item.entryUnit && item.entryUnit !== item.unit) throw new AppError('商品多单位功能已删除，请按商品固定单位重新录入', 400, 'PRODUCT_MULTI_UNIT_REMOVED')
  }
  if (sourceUnits) return
  const ids = [...new Set(items.map(item => Number(item.productId)))].sort((a, b) => a - b)
  const [products] = ids.length ? await conn.query('SELECT id,unit FROM product_items WHERE id IN (?) AND deleted_at IS NULL ORDER BY id FOR SHARE', [ids]) : [[]]
  const byId = new Map(products.map(product => [Number(product.id), product]))
  for (const item of items) {
    const product = byId.get(Number(item.productId))
    if (!product) throw new AppError('商品不存在或已删除', 400)
    if (item.unit !== product.unit) throw new AppError('商品单位已变化，请重新选择商品并核对数量和单价', 409, 'PRODUCT_UNIT_MISMATCH')
  }
}

async function foldEntryItemsBatch(conn, items) {
  await assertQtyPrecision(conn, items.map((item, n) => ({ productId: item.productId, qty: item.quantity, label: `第 ${n + 1} 行录入数量` })))
  await assertFixedProductUnits(conn, items)
  const out = items.map(item => {
    const rate = 1
    return foldEntryItemWithRate(item, rate)
  })
  await assertQtyPrecision(conn, out.map((item, n) => ({ productId: item.productId, qty: item.quantity, label: `第 ${n + 1} 行数量` })))
  return out
}

async function foldEntryItems(conn, items, { sourceUnits = false } = {}) {
  await assertQtyPrecision(conn, items.map((item, n) => ({ productId: item.productId, qty: item.quantity, label: `第 ${n + 1} 行录入数量` })))
  await assertFixedProductUnits(conn, items, sourceUnits)
  const out = []
  for (const item of items) out.push(await foldEntryItem(conn, item))
  await assertQtyPrecision(conn, out.map((item, index) => ({
    productId: item.productId,
    qty: item.quantity,
    label: `第 ${index + 1} 行数量`,
  })))
  return out
}

module.exports = { round2, roundQty, round8, resolveConversionRate, foldEntryItem, foldEntryItems, foldEntryItemsBatch, foldEntryItemWithRate }
