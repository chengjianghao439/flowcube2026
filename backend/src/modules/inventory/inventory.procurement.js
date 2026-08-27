const { pool } = require('../../config/db')
const { scopeFilter } = require('../../utils/warehouseScope')
const { beijingYmdAddDays } = require('../../utils/backendTime')

/**
 * 采购计划预测（文档 11 · MVP 只读报表版）。纯只读：基于历史出库趋势预测未来需求，
 * 套 MRP 净需求公式给出建议采购量。不写库存、不建单据、不转采购（单据化/转采购留 Phase 2）。
 *
 * 与补货建议(01)的区别：01 被动看"现在跌破补货点没"；本报表主动看"按卖货趋势未来该买多少"。
 * 驱动集用"近 N 天有 sale_out 出库的 商品×仓库"——这样"没库存但在卖"的急需品也进计划
 * （补货建议以 inventory_stock 为主表，会漏掉没库存的）。
 *
 * 口径全部复用 01：可用=GREATEST(0,quantity-reserved)（缓存投影）；在途=已提交PO下单量−已上架；
 * 安全库存=COALESCE(本仓policy,默认,0)；日均销量=近N天 warehouse_tasks(sale_out,status=7) picked_qty / N。
 */

// 在途采购子查询（防 fan-out，同 replenishment）：每个 PO 行先 GREATEST(0,下单−已上架) 再按仓库×商品求和
const IN_TRANSIT_SQL = `(
  SELECT warehouse_id, product_id, SUM(leg) AS in_transit FROM (
    SELECT po.warehouse_id, oi.product_id, GREATEST(0, oi.ordered - COALESCE(recv.putaway_qty, 0)) AS leg
    FROM purchase_orders po
    JOIN (SELECT order_id, product_id, SUM(quantity) AS ordered FROM purchase_order_items GROUP BY order_id, product_id) oi ON oi.order_id = po.id
    LEFT JOIN (SELECT iti.purchase_order_id, iti.product_id, SUM(iti.putaway_qty) AS putaway_qty
               FROM inbound_task_items iti JOIN inbound_tasks it ON it.id = iti.task_id AND it.deleted_at IS NULL
               WHERE iti.purchase_order_id IS NOT NULL GROUP BY iti.purchase_order_id, iti.product_id) recv
           ON recv.purchase_order_id = po.id AND recv.product_id = oi.product_id
    WHERE po.deleted_at IS NULL AND po.status = 2
  ) legs GROUP BY warehouse_id, product_id
)`

function addDays(days) {
  // 北京时间的今天 + days 天（此前 d.setDate + toISOString 是 UTC 截断，+08 午夜前会回退一天）
  return beijingYmdAddDays(Number(days || 0))
}

async function getProcurementPlan({ window = 30, horizon = 30, keyword = '', warehouseId = null, defaultLeadTime = 7, scopeWarehouseIds = null, forecastMethod = 'sma' }) {
  const N = Math.max(1, Number(window) || 30)
  const P = Math.max(1, Number(horizon) || 30)
  const defLead = Math.max(0, Number(defaultLeadTime) || 0)
  const method = String(forecastMethod || 'sma').toLowerCase() === 'wma' ? 'wma' : 'sma'
  // WMA 把窗口均分两段：近半程权重 2、远半程权重 1（近因加权）
  const halfN = Math.max(1, Math.round(N / 2))

  const conds = ['p.deleted_at IS NULL', 'p.is_active = 1']
  const params = [N, N]   // sold 子查询的两个 INTERVAL：全窗口 + 近半程
  if (keyword) { conds.push('(p.code LIKE ? OR p.name LIKE ?)'); params.push(`%${keyword}%`, `%${keyword}%`) }
  if (warehouseId) { conds.push('sold.warehouse_id = ?'); params.push(warehouseId) }
  const scope = scopeFilter(scopeWarehouseIds, 'sold.warehouse_id')
  const where = conds.join(' AND ') + scope.sql

  const [rows] = await pool.query(
    `SELECT sold.product_id, sold.warehouse_id, sold.total_sold, sold.recent_sold,
            p.code AS product_code, p.name AS product_name, p.unit, p.article_number, p.spec, p.color,
            w.name AS warehouse_name,
            GREATEST(0, COALESCE(ip.quantity, 0) - COALESCE(ip.reserved, 0)) AS available,
            COALESCE(pt.in_transit, 0)                                       AS in_transit,
            COALESCE(sp_wh.safety_stock, sp_def.safety_stock, 0)             AS safety_stock,
            sup.id AS supplier_id, sup.name AS supplier_name,
            COALESCE(sup.lead_time_days, 0)                                  AS supplier_lead_time
     FROM (SELECT wt.warehouse_id, wti.product_id, SUM(wti.picked_qty) AS total_sold,
                  COALESCE(SUM(CASE WHEN wt.shipped_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY) THEN wti.picked_qty ELSE 0 END), 0) AS recent_sold
           FROM warehouse_tasks wt
           JOIN warehouse_task_items wti ON wti.task_id = wt.id
           WHERE wt.task_type = 'sale_out' AND wt.status = 7
             AND wt.shipped_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
           GROUP BY wt.warehouse_id, wti.product_id) sold
     JOIN product_items p        ON p.id = sold.product_id AND p.deleted_at IS NULL
     JOIN inventory_warehouses w ON w.id = sold.warehouse_id AND w.deleted_at IS NULL
     LEFT JOIN (SELECT product_id, warehouse_id, quantity, reserved FROM inventory_stock) ip
            ON ip.product_id = sold.product_id AND ip.warehouse_id = sold.warehouse_id
     LEFT JOIN supply_suppliers sup ON sup.id = p.supplier_id AND sup.deleted_at IS NULL
     LEFT JOIN product_stock_policies sp_wh  ON sp_wh.product_id = sold.product_id AND sp_wh.warehouse_id = sold.warehouse_id
     LEFT JOIN product_stock_policies sp_def ON sp_def.product_id = sold.product_id AND sp_def.warehouse_id = 0
     LEFT JOIN ${IN_TRANSIT_SQL} pt ON pt.warehouse_id = sold.warehouse_id AND pt.product_id = sold.product_id
     WHERE ${where}`,
    [...params, ...scope.params],
  )

  const list = []
  for (const r of rows) {
    // ADU 口径：sma = 全窗口均值；wma = (近半程×2 + 远半程×1) / (半程天×3)，
    // 近半程权重更高反映近期趋势（文档11 Phase2）。
    const adu = method === 'wma'
      ? (Number(r.recent_sold) * 2 + (Number(r.total_sold) - Number(r.recent_sold)) * 1) / (halfN * 3)
      : Number(r.total_sold) / N
    const leadTime = Number(r.supplier_lead_time) > 0 ? Number(r.supplier_lead_time) : defLead
    const available = Number(r.available)
    const inTransit = Number(r.in_transit)
    const safetyStock = Number(r.safety_stock)
    const forecastDemand = adu * (leadTime + P)                                  // 毛需求 = 日均 ×(提前期+覆盖周期)
    const suggestedQty = Math.max(0, forecastDemand + safetyStock - available - inTransit)
    if (suggestedQty <= 0) continue                                             // 只列真正需要采购的
    list.push({
      id: `${r.product_id}-${r.warehouse_id}`,
      productId: r.product_id,
      productCode: r.product_code,
      productName: r.product_name,
      articleNumber: r.article_number || null,
      spec: r.spec || null,
      color: r.color || null,
      unit: r.unit,
      warehouseId: r.warehouse_id,
      warehouseName: r.warehouse_name,
      adu: Math.round(adu * 100) / 100,
      forecastDemand: Math.round(forecastDemand * 100) / 100,
      safetyStock,
      available,
      inTransit,
      leadTimeDays: leadTime,
      suggestedQty: Math.round(suggestedQty * 100) / 100,
      expectedArrival: addDays(leadTime),
      supplierId: r.supplier_id != null ? Number(r.supplier_id) : null,
      supplierName: r.supplier_name || null,
    })
  }
  list.sort((a, b) => b.suggestedQty - a.suggestedQty)

  return { list, params: { window: N, horizon: P, defaultLeadTime: defLead, forecastMethod: method } }
}

module.exports = { getProcurementPlan }
