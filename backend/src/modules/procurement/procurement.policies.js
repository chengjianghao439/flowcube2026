const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const { resolveConversionRate, round4 } = require('../../utils/unitConversion')
const { lockPlanning } = require('./procurement.planning')

async function getPolicy(productId, supplierId, conn = pool) {
  const [[p]] = await conn.query('SELECT id,unit,is_active FROM product_items WHERE id=? AND deleted_at IS NULL', [productId])
  if (!p || !p.is_active) throw new AppError('商品不存在或已停用', 400)
  const [[policy]] = await conn.query('SELECT * FROM supplier_product_purchase_policies WHERE product_id=? AND supplier_id=?', [productId, supplierId || 0])
  const [units] = await conn.query('SELECT unit_name AS unitName,conversion_rate AS conversionRate FROM product_units WHERE product_id=? AND is_active=1 ORDER BY sort_order,id', [productId])
  const entryUnit = policy?.entry_unit || p.unit
  const conversionRate = await resolveConversionRate(conn, productId, entryUnit, p.unit)
  return { productId: Number(productId), supplierId: supplierId ? Number(supplierId) : null, baseUnit: p.unit, entryUnit, conversionRate, packMultiple: Number(policy?.pack_multiple || 0), minimumOrderQty: Number(policy?.minimum_order_qty || 0), units: [{ unitName: p.unit, conversionRate: 1 }, ...units.filter(u => u.unitName !== p.unit).map(u => ({ ...u, conversionRate: Number(u.conversionRate) }))] }
}
async function savePolicy({ productId, supplierId, entryUnit, packMultiple = 0, minimumOrderQty = 0 }) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    await lockPlanning(conn)
    const [[supplier]] = await conn.query('SELECT id FROM supply_suppliers WHERE id=? AND is_active=1 AND deleted_at IS NULL', [supplierId])
    if (!supplier) throw new AppError('供应商不存在或已停用', 400)
    const policy = await getPolicy(productId, supplierId, conn)
    const rate = await resolveConversionRate(conn, productId, entryUnit, policy.baseUnit)
    for (const q of [packMultiple, minimumOrderQty]) {
      if (!Number.isFinite(Number(q)) || Number(q) < 0 || (Number(q) > 0 && round4(Number(q) * rate) <= 0)) throw new AppError('包装倍数或起订量无效', 400)
    }
    await conn.query(`INSERT INTO supplier_product_purchase_policies (product_id,supplier_id,entry_unit,pack_multiple,minimum_order_qty) VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE entry_unit=VALUES(entry_unit),pack_multiple=VALUES(pack_multiple),minimum_order_qty=VALUES(minimum_order_qty)`, [productId, supplierId, entryUnit, packMultiple, minimumOrderQty])
    await conn.commit()
    return getPolicy(productId, supplierId)
  } catch (e) { await conn.rollback(); throw e } finally { conn.release() }
}
module.exports = { getPolicy, savePolicy }
