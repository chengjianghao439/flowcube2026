const AppError = require('./AppError')

/**
 * 多计量单位折算（文档03 · 方案A）——采购/销售建单落库前把「录入单位口径」折算成「基本单位口径」。
 * 单一权威口径：库存事实层永远只用基本单位记数，换算只发生在这一步（进入库存/账款链路之前）。
 * 铁律：entry_* 三列（entry_unit/entry_qty/conversion_rate）只用于回显/打印/审计，**绝不参与库存/账款计算**。
 */

const round2 = n => Math.round((Number(n) || 0) * 100) / 100
const round4 = n => Math.round((Number(n) || 0) * 10000) / 10000
const round8 = n => Math.round((Number(n) || 0) * 1e8) / 1e8

/**
 * 取 (商品, 录入单位) 的权威换算率：录入单位缺省/等于基本单位 → 1（不查表）；辅助单位查 product_units；
 * 非法单位报错。前端传的率只作呈现，不采信（守 CLAUDE.md 第13/17节前端不复制后端业务规则）。
 */
async function resolveConversionRate(conn, productId, entryUnit, baseUnit) {
  if (!entryUnit || (baseUnit && entryUnit === baseUnit)) return 1
  const [rows] = await conn.query('SELECT unit_name, conversion_rate FROM product_units WHERE product_id = ?', [productId])
  if (!rows.length) {
    if (baseUnit && entryUnit && entryUnit !== baseUnit) throw new AppError(`商品未配置多计量单位，无法按「${entryUnit}」录入`, 400, 'UNIT_NOT_CONFIGURED')
    return 1
  }
  const match = rows.find(r => r.unit_name === entryUnit)
  if (!match) throw new AppError(`「${entryUnit}」不是该商品的有效计量单位`, 400, 'UNIT_INVALID')
  const rate = Number(match.conversion_rate)
  if (!(rate > 0)) throw new AppError(`商品单位「${entryUnit}」换算率非法`, 400, 'UNIT_RATE_INVALID')
  return rate
}

/**
 * 把一条明细录入折算成基本单位口径。约定：入参 item.quantity/item.unitPrice 一律是**录入单位**下的
 * 数量/单价（entryUnit 缺省=商品基本单位 item.unit）。折算：
 *   quantity(基本单位) = entryQty × rate；unit_price(每基本单位,高精度) = entryUnitPrice / rate；
 *   amount = entryQty × entryUnitPrice（金额以录入口径为权威、零截断，§5.2）。
 * 向后兼容：不传 entryUnit → entryUnit=基本单位 → rate=1 → 基本单位量=录入量，行为完全不变。
 * @returns 原 item 上补齐 { quantity, unitPrice(基本单位), amount, entryUnit, entryQty, conversionRate }
 */
async function foldEntryItem(conn, item) {
  const entryUnit = item.entryUnit || item.unit || null
  const rate = await resolveConversionRate(conn, item.productId, entryUnit, item.unit)
  const entryQty = Number(item.quantity) || 0
  const entryUnitPrice = Number(item.unitPrice) || 0
  const quantity = round4(entryQty * rate)
  if (!(quantity > 0)) {
    throw new AppError('数量折算后小于库存最小精度 0.0001，请调整录入数量或单位换算率', 400, 'QUANTITY_BELOW_MIN_PRECISION')
  }
  return {
    ...item,
    quantity,
    unitPrice: round8(entryUnitPrice / rate),
    amount: round2(entryQty * entryUnitPrice),
    entryUnit,
    entryQty,
    conversionRate: rate,
  }
}

/** 便捷：批量折算一组明细（顺序 await，含 product_units 查询）。 */
async function foldEntryItems(conn, items) {
  const out = []
  for (const item of items) out.push(await foldEntryItem(conn, item))
  return out
}

module.exports = { round2, round4, round8, resolveConversionRate, foldEntryItem, foldEntryItems }
