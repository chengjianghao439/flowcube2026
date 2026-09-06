const { pool } = require('../../config/db')
const { scopeFilter } = require('../../utils/warehouseScope')

/**
 * 库龄与呆滞报表（文档 09）。纯只读：直接聚合容器事实表 inventory_containers（status=1 ACTIVE），
 * 不读缓存、不写、不 FOR UPDATE，不碰任何库存扣减判定。全程接仓库数据权限 scopeFilter(c.warehouse_id)。
 *
 * 库龄 = NOW() − 容器 created_at（本仓落库起算；调拨/拆分新建容器会从头计，页面注明）。
 * 金额 = remaining_qty × COALESCE(NULLIF(avg_cost,0), NULLIF(cost_price,0), sale_price, 0)（估值展示，不作账）。
 * 呆滞 = 某商品×某仓 仍有在库 且 最后一次出库距今 > staleDays（inventory_logs type=2 按 product+warehouse 聚合）。
 */

// remaining_qty × 持有成本（avg_cost 优先，回落 cost_price / sale_price）
const VALUE_EXPR = 'c.remaining_qty * COALESCE(NULLIF(p.avg_cost,0), NULLIF(p.cost_price,0), p.sale_price, 0)'
const AGE_EXPR = 'DATEDIFF(NOW(), c.created_at)'

/** 库龄分布：概览分桶（0-30/30-60/60-90/90+）+ 明细列表（每「商品×仓库」一行，含呆滞标记） */
async function getInventoryAging({ page = 1, pageSize = 20, keyword = '', warehouseId = null, staleDays = 90, scopeWarehouseIds = null }) {
  const conds = ['c.status = 1', 'c.remaining_qty > 0', 'c.deleted_at IS NULL', 'p.deleted_at IS NULL']
  const params = []
  if (keyword) { conds.push('(p.code LIKE ? OR p.name LIKE ?)'); params.push(`%${keyword}%`, `%${keyword}%`) }
  if (warehouseId) { conds.push('c.warehouse_id = ?'); params.push(warehouseId) }
  const scope = scopeFilter(scopeWarehouseIds, 'c.warehouse_id')
  const where = conds.join(' AND ') + scope.sql
  const whereParams = [...params, ...scope.params]

  const baseJoin = `
    FROM inventory_containers c
    JOIN product_items p        ON p.id = c.product_id AND p.deleted_at IS NULL
    JOIN inventory_warehouses w ON w.id = c.warehouse_id AND w.deleted_at IS NULL
    WHERE ${where}`

  // 概览分桶
  const [bucketRows] = await pool.query(
    `SELECT CASE
              WHEN ${AGE_EXPR} < 30 THEN '0-30'
              WHEN ${AGE_EXPR} < 60 THEN '30-60'
              WHEN ${AGE_EXPR} < 90 THEN '60-90'
              ELSE '90+' END AS age_bucket,
            COUNT(DISTINCT c.product_id) AS sku_count,
            SUM(c.remaining_qty)         AS total_qty,
            SUM(${VALUE_EXPR})           AS total_value
     ${baseJoin}
     GROUP BY age_bucket`,
    whereParams,
  )
  const bucketMap = Object.fromEntries(bucketRows.map(b => [b.age_bucket, b]))
  const buckets = ['0-30', '30-60', '60-90', '90+'].map(k => ({
    bucket: k,
    skuCount: bucketMap[k] ? Number(bucketMap[k].sku_count) : 0,
    totalQty: bucketMap[k] ? Number(bucketMap[k].total_qty) : 0,
    totalValue: bucketMap[k] ? Number(bucketMap[k].total_value) : 0,
  }))

  // 明细列表（分页）
  const offset = (page - 1) * pageSize
  const [rows] = await pool.query(
    `SELECT c.product_id, p.code AS product_code, p.name AS product_name, p.unit,
            p.article_number, p.spec, p.color,
            c.warehouse_id, w.name AS warehouse_name,
            SUM(CASE WHEN ${AGE_EXPR} < 30 THEN c.remaining_qty ELSE 0 END)               AS qty_0_30,
            SUM(CASE WHEN ${AGE_EXPR} BETWEEN 30 AND 59 THEN c.remaining_qty ELSE 0 END)   AS qty_30_60,
            SUM(CASE WHEN ${AGE_EXPR} BETWEEN 60 AND 89 THEN c.remaining_qty ELSE 0 END)   AS qty_60_90,
            SUM(CASE WHEN ${AGE_EXPR} >= 90 THEN c.remaining_qty ELSE 0 END)               AS qty_90p,
            SUM(c.remaining_qty)                                                            AS total_qty,
            ROUND(SUM(c.remaining_qty * ${AGE_EXPR}) / NULLIF(SUM(c.remaining_qty),0), 1)   AS avg_age_days,
            MAX(${AGE_EXPR})                                                                AS max_age_days,
            SUM(${VALUE_EXPR})                                                              AS total_value,
            lo.last_outbound_at
     FROM inventory_containers c
     JOIN product_items p        ON p.id = c.product_id AND p.deleted_at IS NULL
     JOIN inventory_warehouses w ON w.id = c.warehouse_id AND w.deleted_at IS NULL
     LEFT JOIN (SELECT product_id, warehouse_id, MAX(created_at) AS last_outbound_at
                FROM inventory_logs WHERE type = 2 GROUP BY product_id, warehouse_id) lo
            ON lo.product_id = c.product_id AND lo.warehouse_id = c.warehouse_id
     WHERE ${where}
     GROUP BY c.product_id, p.code, p.name, p.unit, c.warehouse_id, w.name, lo.last_outbound_at
     ORDER BY total_value DESC, c.product_id ASC, c.warehouse_id ASC LIMIT ? OFFSET ?`,
    [...whereParams, pageSize, offset],
  )

  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) AS total FROM (
       SELECT 1 ${baseJoin} GROUP BY c.product_id, c.warehouse_id
     ) t`,
    whereParams,
  )

  const now = Date.now()
  const list = rows.map(r => {
    const lastOut = r.last_outbound_at ? new Date(r.last_outbound_at).getTime() : null
    const daysSinceOutbound = lastOut != null ? Math.floor((now - lastOut) / 86400000) : null
    const isStale = daysSinceOutbound == null || daysSinceOutbound > Number(staleDays)
    return {
      id: `${r.product_id}-${r.warehouse_id}`,
      productId: r.product_id,
      productCode: r.product_code,
      productName: r.product_name,
      unit: r.unit,
      articleNumber: r.article_number || null,
      spec: r.spec || null,
      color: r.color || null,
      warehouseId: r.warehouse_id,
      warehouseName: r.warehouse_name,
      qty0_30: Number(r.qty_0_30),
      qty30_60: Number(r.qty_30_60),
      qty60_90: Number(r.qty_60_90),
      qty90p: Number(r.qty_90p),
      totalQty: Number(r.total_qty),
      avgAgeDays: r.avg_age_days != null ? Number(r.avg_age_days) : 0,
      maxAgeDays: r.max_age_days != null ? Number(r.max_age_days) : 0,
      totalValue: Number(r.total_value),
      lastOutboundAt: r.last_outbound_at,
      daysSinceOutbound,
      isStale,
    }
  })

  return { buckets, list, pagination: { page, pageSize, total }, staleDays: Number(staleDays) }
}

/** 效期预警：批次商品（batch_managed=1）容器 exp_date 临期（≤ warnDays）或已过期 */
async function getExpiryAlerts({ warehouseId = null, warnDays = 30, scopeWarehouseIds = null }) {
  const conds = ['c.status = 1', 'c.remaining_qty > 0', 'c.deleted_at IS NULL', 'c.exp_date IS NOT NULL']
  const params = []
  if (warehouseId) { conds.push('c.warehouse_id = ?'); params.push(warehouseId) }
  const scope = scopeFilter(scopeWarehouseIds, 'c.warehouse_id')
  const wd = Number(warnDays)

  const [rows] = await pool.query(
    `SELECT c.product_id, p.code AS product_code, p.name AS product_name, p.unit,
            p.article_number, p.spec, p.color,
            c.warehouse_id, w.name AS warehouse_name, c.batch_no, c.exp_date, c.remaining_qty,
            DATEDIFF(c.exp_date, NOW()) AS days_to_expiry,
            CASE WHEN c.exp_date < NOW() THEN 'expired'
                 WHEN DATEDIFF(c.exp_date, NOW()) <= ? THEN 'near_expiry'
                 ELSE 'ok' END AS expiry_state
     FROM inventory_containers c
     JOIN product_items p        ON p.id = c.product_id AND p.batch_managed = 1 AND p.deleted_at IS NULL
     JOIN inventory_warehouses w ON w.id = c.warehouse_id AND w.deleted_at IS NULL
     WHERE ${conds.join(' AND ')}${scope.sql}
       AND c.exp_date <= DATE_ADD(NOW(), INTERVAL ? DAY)
     ORDER BY c.exp_date ASC
     LIMIT 500`,
    [wd, ...params, ...scope.params, wd],
  )

  return {
    warnDays: wd,
    list: rows.map((r, idx) => ({
      id: `${r.product_id}-${r.warehouse_id}-${idx}`,
      productId: r.product_id,
      productCode: r.product_code,
      productName: r.product_name,
      unit: r.unit,
      articleNumber: r.article_number || null,
      spec: r.spec || null,
      color: r.color || null,
      warehouseId: r.warehouse_id,
      warehouseName: r.warehouse_name,
      batchNo: r.batch_no,
      expDate: r.exp_date,
      remainingQty: Number(r.remaining_qty),
      daysToExpiry: r.days_to_expiry != null ? Number(r.days_to_expiry) : null,
      expiryState: r.expiry_state,
    })),
  }
}

module.exports = { getInventoryAging, getExpiryAlerts }
