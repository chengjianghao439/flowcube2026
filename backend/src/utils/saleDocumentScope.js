const AppError = require('./AppError')
const { assertInScope } = require('./warehouseScope')
const { assertSqlColumnList } = require('./sqlIdentifier')

/** 销售关联领域的整单范围：头仓及全部保存明细，NULL行仓沿头仓。 */
function saleDocumentScopeFilter(scopeWarehouseIds, orderLink) {
  assertSqlColumnList(orderLink, 'orderLink')
  if (!/^[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*$/.test(orderLink)) {
    throw new AppError('Invalid sale order link', 500, 'INTERNAL_CONFIG')
  }
  if (!Array.isArray(scopeWarehouseIds)) return { sql: '', params: [] }
  if (!scopeWarehouseIds.length) return { sql: ' AND 1=0', params: [] }
  return {
    sql: ` AND EXISTS (SELECT 1 FROM sale_orders scope_order WHERE scope_order.id=${orderLink}
      AND scope_order.warehouse_id IN (?)
      AND NOT EXISTS (SELECT 1 FROM sale_order_items scope_item WHERE scope_item.order_id=scope_order.id
        AND COALESCE(scope_item.warehouse_id, scope_order.warehouse_id) NOT IN (?)))`,
    params: [scopeWarehouseIds, scopeWarehouseIds],
  }
}

async function assertSaleDocumentInScope(db, scopeWarehouseIds, saleOrderId, { entityName = '销售单', currentRead = false } = {}) {
  if (!Array.isArray(scopeWarehouseIds)) return
  if (!scopeWarehouseIds.length) throw new AppError(`无权访问该${entityName}`, 403, 'WAREHOUSE_SCOPE_DENIED')
  const lock = currentRead ? ' FOR SHARE' : ''
  const [[sale]] = await db.query(`SELECT id, warehouse_id FROM sale_orders WHERE id=?${lock}`, [Number(saleOrderId)])
  if (!sale) throw new AppError(`${entityName}关联销售单不存在，无法校验仓库范围`, 403, 'WAREHOUSE_SCOPE_DENIED')
  assertInScope(scopeWarehouseIds, sale.warehouse_id, entityName)
  const [items] = await db.query(`SELECT warehouse_id FROM sale_order_items WHERE order_id=? ORDER BY id${lock}`, [Number(saleOrderId)])
  for (const item of items) assertInScope(scopeWarehouseIds, item.warehouse_id ?? sale.warehouse_id, entityName)
}

module.exports = { saleDocumentScopeFilter, assertSaleDocumentInScope }
