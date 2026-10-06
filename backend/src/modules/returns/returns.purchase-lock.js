const AppError = require('../../utils/AppError')
const { assertInScope } = require('../../utils/warehouseScope')
const { lockStatusRow } = require('../../utils/statusTransition')

const invalidSource = () => new AppError('采购退货来源缺失或不一致，请核对原采购单和明细', 409, 'PURCHASE_RETURN_SOURCE_INVALID')
const changedSource = () => new AppError('采购退货来源已变化，请刷新后核对', 409, 'PURCHASE_RETURN_SOURCE_CHANGED')
const validId = id => Number.isSafeInteger(Number(id)) && Number(id) > 0

// 只定位，调用方在begin之前读取；不能把这份数据当锁后的授权或执行事实。
async function peekPurchaseReturn(conn, id) {
  const [[row]] = await conn.query('SELECT id, purchase_order_id, purchase_order_no, supplier_id, warehouse_id FROM purchase_returns WHERE id=? AND deleted_at IS NULL', [id])
  if (!row) throw new AppError('采购退货单不存在', 404)
  return row
}

async function lockPurchaseReturn(conn, identity, scopeWarehouseIds = null) {
  let po = null
  if (identity.purchase_order_id != null) {
    if (!validId(identity.purchase_order_id)) throw invalidSource()
    const [[row]] = await conn.query('SELECT id, order_no, supplier_id, warehouse_id FROM purchase_orders WHERE id=? AND deleted_at IS NULL FOR SHARE', [identity.purchase_order_id])
    if (!row) throw invalidSource()
    po = row
    assertInScope(scopeWarehouseIds, po.warehouse_id, '原采购单')
  }
  const row = await lockStatusRow(conn, {
    table: 'purchase_returns', id: identity.id,
    columns: 'id, return_no, purchase_order_id, purchase_order_no, supplier_id, supplier_name, warehouse_id, warehouse_name, total_amount, status',
    entityName: '采购退货单',
  })
  if (Number(row.purchase_order_id || 0) !== Number(identity.purchase_order_id || 0)
    || row.purchase_order_no !== identity.purchase_order_no
    || Number(row.supplier_id) !== Number(identity.supplier_id)
    || Number(row.warehouse_id) !== Number(identity.warehouse_id)) throw changedSource()
  assertInScope(scopeWarehouseIds, row.warehouse_id, '采购退货单')
  if (po && (Number(po.supplier_id) !== Number(row.supplier_id)
    || Number(po.warehouse_id) !== Number(row.warehouse_id)
    || (row.purchase_order_no && po.order_no !== row.purchase_order_no))) throw invalidSource()
  const [items] = await conn.query(
    `SELECT pri.*, poi.id AS source_item_id, poi.order_id AS source_order_id, poi.product_id AS source_product_id
     FROM purchase_return_items pri LEFT JOIN purchase_order_items poi ON poi.id=pri.purchase_item_id
     WHERE pri.return_id=? ORDER BY pri.id FOR SHARE`, [row.id],
  )
  for (const item of items) {
    if (po) {
      if (!validId(item.purchase_item_id) || Number(item.source_item_id) !== Number(item.purchase_item_id)
        || Number(item.source_order_id) !== Number(po.id) || Number(item.source_product_id) !== Number(item.product_id)) throw invalidSource()
    } else if (item.purchase_item_id != null) throw invalidSource()
  }
  // 无准确PO且全部明细无来源的旧单（包括仅文本单号）保持原入口，不据文本猜原单或AP。
  return { row, items }
}

module.exports = { peekPurchaseReturn, lockPurchaseReturn }
