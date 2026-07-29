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

/**
 * 到货看板：按采购单 expected_date 聚合"今日待到货"、"本周待到货"、"已逾期未到货"。
 * 只统计仍有未收清明细的采购单（status IN 1,2 且非已取消/已完成），
 * 用 total_ordered_qty - total_received_qty 判断是否还有余量（同 purchase.service 口径）。
 */
async function getIncomingPurchases() {
  const [rows] = await pool.query(
    `SELECT po.id, po.order_no, po.supplier_name, po.expected_date,
            po.total_amount,
            COALESCE(recv.received, 0) AS received_qty,
            ordered.ordered AS ordered_qty
     FROM purchase_orders po
     JOIN (
       SELECT order_id, SUM(quantity) AS ordered
       FROM purchase_order_items GROUP BY order_id
     ) ordered ON ordered.order_id = po.id
     LEFT JOIN (
       SELECT iti.purchase_order_id AS order_id, SUM(iti.received_qty) AS received
       FROM inbound_task_items iti
       JOIN inbound_tasks it ON it.id = iti.task_id
       WHERE it.deleted_at IS NULL AND it.status <> 5
       GROUP BY iti.purchase_order_id
     ) recv ON recv.order_id = po.id
     WHERE po.deleted_at IS NULL AND po.status IN (1,2)
       AND po.expected_date IS NOT NULL
       AND COALESCE(recv.received, 0) < ordered.ordered
     ORDER BY po.expected_date ASC`,
  )
  const today = new Date().toISOString().slice(0, 10)
  const weekLater = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10)
  const mapRow = r => ({
    id: Number(r.id), orderNo: r.order_no, supplierName: r.supplier_name,
    expectedDate: r.expected_date, totalAmount: Number(r.total_amount),
  })
  return {
    dueToday: rows.filter(r => String(r.expected_date).slice(0, 10) === today).map(mapRow),
    dueThisWeek: rows.filter(r => {
      const d = String(r.expected_date).slice(0, 10)
      return d > today && d <= weekLater
    }).map(mapRow),
    overdue: rows.filter(r => String(r.expected_date).slice(0, 10) < today).map(mapRow),
  }
}

/**
 * 读取用户仪表盘个性化布局。缺行（从未个性化）返回 null，由前端回落到默认布局。
 * MySQL JSON 列经 mysql2 返回时已是解析好的 JS 对象，无需再 JSON.parse。
 */
async function getLayout(userId) {
  const [[row]] = await pool.query('SELECT layout FROM dashboard_layouts WHERE user_id=?', [userId])
  return row ? row.layout : null
}

/**
 * 保存（upsert）用户仪表盘布局。layout 已由路由层 zod 校验过结构。
 * JSON 列写入必须 JSON.stringify，否则 mysql2 会把对象当成参数列表报错。
 */
async function saveLayout(userId, layout) {
  await pool.query(
    `INSERT INTO dashboard_layouts (user_id, layout) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE layout=VALUES(layout), updated_at=CURRENT_TIMESTAMP`,
    [userId, JSON.stringify(layout)]
  )
  return layout
}

module.exports = { getSummary, getLowStock, getRecentTrend, getTopStockByValue, getIncomingPurchases, getLayout, saveLayout }
