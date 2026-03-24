const { pool } = require('../../config/db')

async function getSummary() {
  const [[{ totalSkus }]] = await pool.query('SELECT COUNT(*) AS totalSkus FROM inventory_stock WHERE quantity > 0')
  const [[{ totalQty }]] = await pool.query('SELECT COALESCE(SUM(s.quantity),0) AS totalQty FROM inventory_stock s')
  const [[{ totalValue }]] = await pool.query('SELECT COALESCE(SUM(s.quantity*p.cost_price),0) AS totalValue FROM inventory_stock s JOIN product_items p ON s.product_id=p.id WHERE p.deleted_at IS NULL')
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
  const [rows] = await pool.query(
    `SELECT p.id, p.code, p.name, p.unit, w.name AS warehouse_name, s.quantity
     FROM inventory_stock s
     JOIN product_items p ON s.product_id=p.id
     JOIN inventory_warehouses w ON s.warehouse_id=w.id
     WHERE s.quantity <= ? AND p.deleted_at IS NULL AND w.deleted_at IS NULL
     ORDER BY s.quantity ASC LIMIT 20`,
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
  const [rows] = await pool.query(
    `SELECT p.code, p.name, p.unit, SUM(s.quantity) AS qty, SUM(s.quantity*p.cost_price) AS value
     FROM inventory_stock s
     JOIN product_items p ON s.product_id=p.id
     WHERE p.deleted_at IS NULL
     GROUP BY p.id, p.code, p.name, p.unit
     ORDER BY value DESC LIMIT ?`,
    [limit]
  )
  return rows.map(r=>({ code:r.code, name:r.name, unit:r.unit, qty:Number(r.qty), value:Number(r.value) }))
}

module.exports = { getSummary, getLowStock, getRecentTrend, getTopStockByValue }
