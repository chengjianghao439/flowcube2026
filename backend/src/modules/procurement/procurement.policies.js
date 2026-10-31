const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const { resolveConversionRate } = require('../../utils/unitConversion')
const { assertQtyScale, assertQtyPrecision } = require('../../utils/qtyPrecision')
const { lockPlanning } = require('./procurement.planning')

async function getPolicy(productId, supplierId, conn = pool) {
  const [[p]] = await conn.query('SELECT id,unit,is_active FROM product_items WHERE id=? AND deleted_at IS NULL', [productId])
  if (!p || !p.is_active) throw new AppError('商品不存在或已停用', 400)
  const [[policy]] = await conn.query('SELECT * FROM supplier_product_purchase_policies WHERE product_id=? AND supplier_id=?', [productId, supplierId || 0])
  // 旧包装规则以原配置换算成基本量只读回显；保存时只接受商品固定单位。
  let legacyRate = 1
  if (policy?.entry_unit && policy.entry_unit !== p.unit) {
    const [[legacy]] = await conn.query('SELECT conversion_rate FROM product_units WHERE product_id=? AND unit_name=?', [productId, policy.entry_unit])
    legacyRate = Number(legacy?.conversion_rate)
    if (!(legacyRate > 0)) throw new AppError('原采购包装规则的单位信息不完整，请核对原配置', 409, 'PURCHASE_POLICY_UNIT_INVALID')
  }
  return { productId: Number(productId), supplierId: supplierId ? Number(supplierId) : null, baseUnit: p.unit, entryUnit: p.unit, conversionRate: 1, packMultiple: Number(policy?.pack_multiple || 0) * legacyRate, minimumOrderQty: Number(policy?.minimum_order_qty || 0) * legacyRate }

}
async function savePolicy({ productId, supplierId, entryUnit, packMultiple = 0, minimumOrderQty = 0 }) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    await lockPlanning(conn)
    const [[supplier]] = await conn.query('SELECT id FROM supply_suppliers WHERE id=? AND is_active=1 AND deleted_at IS NULL', [supplierId])
    if (!supplier) throw new AppError('供应商不存在或已停用', 400)
    const [[product]] = await conn.query('SELECT id,unit,is_active FROM product_items WHERE id=? AND deleted_at IS NULL FOR SHARE', [productId])
    if (!product || !product.is_active) throw new AppError('商品不存在或已停用', 400)
    const policy = { baseUnit: product.unit }
    const rate = await resolveConversionRate(conn, productId, entryUnit, policy.baseUnit)
    const quantities = []
    for (const [q, label] of [[packMultiple, '包装倍数'], [minimumOrderQty, '起订量']]) {
      assertQtyScale(q, label)
      if (Number(q) < 0) throw new AppError('包装倍数或起订量无效', 400)
      const baseQty = Number(q) * rate
      assertQtyScale(baseQty, `${label}折算数量`)
      quantities.push({ productId, qty: q, label })
      quantities.push({ productId, qty: baseQty, label: `${label}折算数量` })
    }
    await assertQtyPrecision(conn, quantities)
    await conn.query(`INSERT INTO supplier_product_purchase_policies (product_id,supplier_id,entry_unit,pack_multiple,minimum_order_qty) VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE entry_unit=VALUES(entry_unit),pack_multiple=VALUES(pack_multiple),minimum_order_qty=VALUES(minimum_order_qty)`, [productId, supplierId, policy.baseUnit, packMultiple, minimumOrderQty])
    await conn.commit()
    return getPolicy(productId, supplierId)
  } catch (e) { await conn.rollback(); throw e } finally { conn.release() }
}
module.exports = { getPolicy, savePolicy }
