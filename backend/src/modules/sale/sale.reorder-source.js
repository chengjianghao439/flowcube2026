const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const { assertInScope } = require('../../utils/warehouseScope')
const invalid = () => { throw new AppError('原单商品或套定义身份无法核对，请保留来源并人工核对', 409, 'SALE_REORDER_SOURCE_INVALID') }
const positiveId = value => Number.isSafeInteger(Number(value)) && Number(value) > 0
/** 只投影已授权原单身份，当前主档/报价由各原接口核对；不读取价格或资金快照。 */
async function findReorderSource(rawId, scopeWarehouseIds = null) {
  if (!['number', 'string'].includes(typeof rawId) || !/^[1-9]\d*$/.test(String(rawId)) || !positiveId(rawId)) throw new AppError('来源销售单ID无效', 400, 'SALE_REORDER_SOURCE_INVALID')
  const id = Number(rawId), conn = await pool.getConnection()
  try {
    await conn.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ')
    await conn.query('START TRANSACTION READ ONLY')
    const [[head]] = await conn.query('SELECT id,order_no,customer_id,warehouse_id,commercial_model FROM sale_orders WHERE id=? AND deleted_at IS NULL', [id])
    if (!head) throw new AppError('来源销售单不存在', 404)
    assertInScope(scopeWarehouseIds, head.warehouse_id, '来源销售单')
    const [items] = await conn.query('SELECT id,product_id,warehouse_id,unit,quantity FROM sale_order_items WHERE order_id=? ORDER BY id', [id])
    const [groups] = await conn.query(
      `SELECT g.id,g.kind,g.warehouse_id,g.kit_version_id,g.target_qty,g.superseded,v.kit_id,
              c.id AS component_id,c.product_id,c.sale_item_id,c.unit AS component_unit,i.unit
       FROM sale_commercial_groups g LEFT JOIN kit_definition_versions v ON v.id=g.kit_version_id
       LEFT JOIN sale_commercial_components c ON c.group_id=g.id
       LEFT JOIN sale_order_items i ON i.id=c.sale_item_id AND i.order_id=g.order_id
       WHERE g.order_id=? ORDER BY g.id,c.id`, [id])
    for (const row of [...items, ...groups]) assertInScope(scopeWarehouseIds, row.warehouse_id ?? head.warehouse_id, '来源销售单')
    if (!positiveId(head.customer_id)) invalid()
    const model = head.commercial_model == null ? 'ordinary' : head.commercial_model
    if (!['ordinary', 'kit-v1'].includes(model)) invalid()
    let identities
    if (model === 'ordinary') identities = items.map(row => {
      if (!positiveId(row.product_id) || !row.unit || !Number.isFinite(Number(row.quantity))) invalid()
      return { kind: 'ordinary', productId: Number(row.product_id), baseUnit: row.unit, baseQty: Number(row.quantity) }
    })
    else {
      const current = new Map()
      for (const row of groups) if (!Number(row.superseded)) {
        const rows = current.get(Number(row.id)) || []
        rows.push(row); current.set(Number(row.id), rows)
      }
      identities = [...current.values()].map(rows => {
        const row = rows[0], components = rows.filter(r => positiveId(r.component_id) && positiveId(r.product_id))
        if (row.kind === 'kit') {
          if (!positiveId(row.kit_id) || !positiveId(row.kit_version_id) || !components.length) invalid()
          return { kind: 'kit', kitId: Number(row.kit_id), originalKitVersionId: Number(row.kit_version_id), quantity: Number(row.target_qty) }
        }
        if (row.kind !== 'ordinary' || components.length !== 1 || rows.length !== 1 || !(row.component_unit || row.unit)) invalid()
        return { kind: 'ordinary', productId: Number(row.product_id), baseUnit: row.component_unit || row.unit, baseQty: Number(row.target_qty) }
      })
    }
    if (!identities.length || identities.length > 200) invalid()
    const data = { id, orderNo: head.order_no, model, customerId: Number(head.customer_id), items: identities }
    await conn.commit()
    return data
  } catch (error) { await conn.rollback(); throw error }
  finally { conn.release() }
}
module.exports = { findReorderSource }
