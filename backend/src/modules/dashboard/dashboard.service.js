const { pool } = require('../../config/db')
const { getInventoryDisplayProjectionSql, getProductInventoryProjectionSql } = require('../inventory/inventoryProjection')

async function getSummary() {
  const inventoryDisplayProjectionSql = getInventoryDisplayProjectionSql()
  const productInventoryProjectionSql = getProductInventoryProjectionSql()
  const [[{ totalSkus }]] = await pool.query(
    `SELECT COUNT(*) AS totalSkus
     FROM ${productInventoryProjectionSql} ip
     WHERE ip.quantity > 0`
  )
  const [[{ totalQty }]] = await pool.query(`SELECT COALESCE(SUM(ip.quantity),0) AS totalQty FROM ${inventoryDisplayProjectionSql} ip`)
  const [[{ totalValue }]] = await pool.query(
    `SELECT COALESCE(SUM(ip.quantity * COALESCE(NULLIF(p.cost_price, 0), p.sale_price, 0)),0) AS totalValue
     FROM ${inventoryDisplayProjectionSql} ip
     JOIN product_items p ON ip.product_id=p.id
     WHERE p.deleted_at IS NULL`
  )
  const [[{ purchaseOrders }]] = await pool.query("SELECT COUNT(*) AS purchaseOrders FROM purchase_orders WHERE deleted_at IS NULL AND status IN (1,2)")
  const [[{ saleOrders }]] = await pool.query("SELECT COUNT(*) AS saleOrders FROM sale_orders WHERE deleted_at IS NULL AND status IN (1,2,3)")
  return {
    totalSkus: Number(totalSkus),
    totalQty: Number(totalQty),
    totalValue: Number(totalValue),
    pendingPurchaseOrders: Number(purchaseOrders),
    pendingSaleOrders: Number(saleOrders)
  }
}

async function getLowStock(threshold = 10) {
  const inventoryDisplayProjectionSql = getInventoryDisplayProjectionSql()
  const [rows] = await pool.query(
    `SELECT p.id, p.code, p.name, p.unit, w.name AS warehouse_name, ip.quantity
     FROM ${inventoryDisplayProjectionSql} ip
     JOIN product_items p ON ip.product_id=p.id
     JOIN inventory_warehouses w ON ip.warehouse_id=w.id
     WHERE ip.quantity <= ? AND p.deleted_at IS NULL AND w.deleted_at IS NULL
     ORDER BY ip.quantity ASC LIMIT 20`,
    [threshold]
  )
  return rows.map(r=>({ id:r.id, code:r.code, name:r.name, unit:r.unit, warehouseName:r.warehouse_name, quantity:Number(r.quantity) }))
}

async function getRecentTrend(days = 7) {
  const [rows] = await pool.query(
    `SELECT DATE(created_at) AS date,
            SUM(CASE WHEN type=1 THEN quantity ELSE 0 END) AS inbound,
            SUM(CASE WHEN type=2 THEN quantity ELSE 0 END) AS outbound
     FROM inventory_logs
     WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
     GROUP BY DATE(created_at)
     ORDER BY date ASC`,
    [days]
  )
  return rows.map(r=>({ date:r.date, inbound:Number(r.inbound), outbound:Number(r.outbound) }))
}

async function getTopStockByValue(limit = 10) {
  const productInventoryProjectionSql = getProductInventoryProjectionSql()
  const [rows] = await pool.query(
    `SELECT p.code, p.name, p.unit, ip.quantity AS qty, ip.quantity * COALESCE(NULLIF(p.cost_price, 0), p.sale_price, 0) AS value
     FROM ${productInventoryProjectionSql} ip
     JOIN product_items p ON ip.product_id=p.id
     WHERE p.deleted_at IS NULL
     ORDER BY value DESC LIMIT ?`,
    [limit]
  )
  return rows.map(r=>({ code:r.code, name:r.name, unit:r.unit, qty:Number(r.qty), value:Number(r.value) }))
}

module.exports = { getSummary, getLowStock, getRecentTrend, getTopStockByValue }
