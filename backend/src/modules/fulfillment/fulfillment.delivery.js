const { dateOnly } = require('./fulfillment.rules')
const { can, definitions } = require('./fulfillment.access')

async function commitments(conn, type, id) {
  const [rows] = await conn.query('SELECT * FROM order_delivery_commitments WHERE document_type=? AND document_id=? ORDER BY item_id', [type, id])
  return rows.map(r => ({ itemId: Number(r.item_id), promisedDate: dateOnly(r.promised_date), originalDate: dateOnly(r.original_date), processingDays: r.processing_days == null ? null : Number(r.processing_days) }))
}
async function purchaseImpacts(conn, id, user) {
  if (!can(user, definitions.sale.view)) return []
  const [rows] = await conn.query(`SELECT b.sale_order_id AS saleId,s.order_no AS orderNo,s.warehouse_id,
    b.warehouse_id AS itemWarehouseId,b.sale_order_item_id AS itemId,b.qty AS quantity,i.product_code AS productCode,i.product_name AS productName,i.unit,
    NULL AS promisedDate,p.expected_date AS expectedDate
    FROM sale_order_expected_bindings b JOIN sale_orders s ON s.id=b.sale_order_id
    JOIN sale_order_items i ON i.id=b.sale_order_item_id JOIN purchase_orders p ON p.id=b.purchase_order_id
    WHERE b.purchase_order_id=? AND b.released_at IS NULL AND s.deleted_at IS NULL AND s.status NOT IN (4,5)
    ${Array.isArray(user.warehouseIds) ? 'AND NOT EXISTS(SELECT 1 FROM sale_order_items other WHERE other.order_id=s.id AND COALESCE(other.warehouse_id,s.warehouse_id) NOT IN (?))' : ''}
    ORDER BY s.id,i.id,b.id`, [id, ...(Array.isArray(user.warehouseIds) ? [user.warehouseIds.length ? user.warehouseIds : [-1]] : [])])
  return rows.filter(r => !Array.isArray(user.warehouseIds) || (user.warehouseIds.includes(Number(r.warehouse_id)) && user.warehouseIds.includes(Number(r.itemWarehouseId))))
    .map(r => ({ ...r, quantity: Number(r.quantity), promisedDate: dateOnly(r.promisedDate), expectedDate: dateOnly(r.expectedDate) }))
}
module.exports = { commitments, purchaseImpacts }
