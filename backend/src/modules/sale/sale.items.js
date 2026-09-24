const SALE_ITEM_COLUMNS = 'order_id,warehouse_id,warehouse_name,product_id,product_code,product_name,unit,entry_unit,article_number,spec,color,quantity,entry_qty,conversion_rate,unit_price,amount,remark'

async function insertSaleItems(conn, orderId, warehouseId, warehouseName, items) {
  if (!items.length) return
  const rows = items.map(item => [
    orderId,
    item.warehouseId ? Number(item.warehouseId) : Number(warehouseId),
    item.warehouseName || warehouseName,
    item.productId, item.productCode, item.productName, item.unit, item.entryUnit,
    item.articleNumber || null, item.spec || null, item.color || null,
    item.quantity, item.entryQty, item.conversionRate, item.unitPrice, item.amount, item.remark || null,
  ])
  for (let start = 0; start < rows.length; start += 100) {
    await conn.query(`INSERT INTO sale_order_items (${SALE_ITEM_COLUMNS}) VALUES ?`, [rows.slice(start, start + 100)])
  }
}

module.exports = { insertSaleItems }
