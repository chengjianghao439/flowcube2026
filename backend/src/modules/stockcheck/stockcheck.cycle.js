const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const { scopeFilter } = require('../../utils/warehouseScope')

// 帕累托经典切点（服务端常量，可后续暴露配置）
const A_THRESHOLD = 0.80
const B_THRESHOLD = 0.95

// 循环盘频率规则的行业常见起点（seed 与本兜底保持一致：A 月盘 / B 季盘 / C 年盘）
const VALID_ABC = ['A', 'B', 'C']
const DEFAULT_INTERVAL = { A: 30, B: 90, C: 365 }
const DEFAULT_BATCH_LIMIT = 200

/**
 * 重算某仓 ABC 分类（文档 08）。默认 sold_value：近 windowDays 天出库消耗金额=picked_qty×avg_cost，
 * 帕累托排序累计≤80%→A、≤95%→B、其余→C。整仓覆盖 upsert。纯只读聚合、绝不碰库存写。
 */
async function recomputeAbc({ warehouseId, metricType = 'sold_value', windowDays = 90 }) {
  const wid = Number(warehouseId)
  const N = Math.max(1, Number(windowDays) || 90)
  let rows
  if (metricType === 'stock_value') {
    ;[rows] = await pool.query(
      `SELECT c.product_id, SUM(c.remaining_qty * COALESCE(NULLIF(p.avg_cost,0), NULLIF(p.cost_price,0), 0)) AS metric_value
       FROM inventory_containers c JOIN product_items p ON p.id=c.product_id AND p.deleted_at IS NULL
       WHERE c.warehouse_id=? AND c.status=1 AND c.deleted_at IS NULL
       GROUP BY c.product_id HAVING metric_value > 0 ORDER BY metric_value DESC`,
      [wid],
    )
  } else {
    ;[rows] = await pool.query(
      `SELECT wti.product_id, SUM(wti.picked_qty * COALESCE(NULLIF(p.avg_cost,0), NULLIF(p.cost_price,0), 0)) AS metric_value
       FROM warehouse_tasks wt JOIN warehouse_task_items wti ON wti.task_id=wt.id
       JOIN product_items p ON p.id=wti.product_id AND p.deleted_at IS NULL
       WHERE wt.warehouse_id=? AND wt.task_type='sale_out' AND wt.status=7
         AND wt.shipped_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
       GROUP BY wti.product_id HAVING metric_value > 0 ORDER BY metric_value DESC`,
      [wid, N],
    )
  }
  const total = rows.reduce((s, r) => s + Number(r.metric_value), 0)
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    await conn.query('DELETE FROM product_abc_classes WHERE warehouse_id=?', [wid])   // 整仓覆盖
    let cum = 0
    for (const r of rows) {
      const mv = Number(r.metric_value)
      cum += mv
      const pct = total > 0 ? cum / total : 1
      const cls = pct <= A_THRESHOLD ? 'A' : (pct <= B_THRESHOLD ? 'B' : 'C')
      await conn.query(
        `INSERT INTO product_abc_classes (warehouse_id,product_id,abc_class,metric_type,metric_value,cumulative_pct,window_days)
         VALUES (?,?,?,?,?,?,?)`,
        [wid, r.product_id, cls, metricType, mv, Math.round(pct * 1e6) / 1e6, N],
      )
    }
    await conn.commit()
    return { warehouseId: wid, metricType, windowDays: N, classified: rows.length, totalMetric: Math.round(total * 100) / 100 }
  } catch (e) { await conn.rollback(); throw e } finally { conn.release() }
}

/** ABC 分类结果列表（只读，带 scopeFilter） */
async function listAbc({ warehouseId = null, abcClass = null, scopeWarehouseIds = null }) {
  const conds = ['1=1']
  const params = []
  if (warehouseId) { conds.push('a.warehouse_id=?'); params.push(Number(warehouseId)) }
  if (abcClass) { conds.push('a.abc_class=?'); params.push(abcClass) }
  const scope = scopeFilter(scopeWarehouseIds, 'a.warehouse_id')
  const [rows] = await pool.query(
    `SELECT a.warehouse_id, w.name AS warehouse_name, a.product_id, p.code AS product_code, p.name AS product_name,
            a.abc_class, a.metric_type, a.metric_value, a.cumulative_pct, a.window_days, a.computed_at
     FROM product_abc_classes a
     JOIN product_items p ON p.id=a.product_id
     JOIN inventory_warehouses w ON w.id=a.warehouse_id
     WHERE ${conds.join(' AND ')}${scope.sql}
     ORDER BY a.warehouse_id, a.metric_value DESC LIMIT 1000`,
    [...params, ...scope.params],
  )
  return rows.map(r => ({
    warehouseId: r.warehouse_id, warehouseName: r.warehouse_name,
    productId: r.product_id, productCode: r.product_code, productName: r.product_name,
    abcClass: r.abc_class, metricType: r.metric_type, metricValue: Number(r.metric_value),
    cumulativePct: Number(r.cumulative_pct), windowDays: r.window_days, computedAt: r.computed_at,
  }))
}

/**
 * 生成抽盘候选商品 id（文档 08）。三模式：
 *   abc: 某 ABC 类 + 到期未盘(coverage) + batch_limit，缺口最久排前
 *   zone: 某库区/货架的 ACTIVE 容器涉及商品
 *   manual: 直接用传入 productIds
 */
async function getCycleCandidates({ warehouseId, scopeType, scopeValue, productIds = null }) {
  const wid = Number(warehouseId)
  if (scopeType === 'manual') {
    const ids = [...new Set((productIds || []).map(Number).filter(n => n > 0))]
    return { productIds: ids, scopeType: 'manual', scopeValue: 'manual' }
  }
  if (scopeType === 'zone') {
    const [rows] = await pool.query(
      `SELECT DISTINCT c.product_id
       FROM inventory_containers c JOIN warehouse_locations l ON l.id=c.location_id
       WHERE c.warehouse_id=? AND c.status=1 AND c.deleted_at IS NULL AND (l.zone=? OR l.rack=?)`,
      [wid, scopeValue, scopeValue],
    )
    return { productIds: rows.map(r => Number(r.product_id)), scopeType: 'zone', scopeValue }
  }
  // abc（默认）
  const cls = String(scopeValue || 'A').toUpperCase()
  const [[rule]] = await pool.query(
    `SELECT interval_days, batch_limit FROM inventory_cycle_rules
     WHERE abc_class=? AND enabled=1 AND warehouse_id IN (?, 0) ORDER BY warehouse_id DESC LIMIT 1`,
    [cls, wid],
  )
  const intervalDays = rule ? Number(rule.interval_days) : 90
  const batchLimit = rule ? Number(rule.batch_limit) : 200
  const [rows] = await pool.query(
    `SELECT s.product_id
     FROM (SELECT DISTINCT c.product_id FROM inventory_containers c
           WHERE c.warehouse_id=? AND c.status=1 AND c.deleted_at IS NULL) s
     JOIN product_abc_classes a ON a.warehouse_id=? AND a.product_id=s.product_id AND a.abc_class=?
     LEFT JOIN inventory_count_coverage cov ON cov.warehouse_id=? AND cov.product_id=s.product_id
     WHERE cov.last_counted_at IS NULL OR cov.last_counted_at < DATE_SUB(NOW(), INTERVAL ? DAY)
     ORDER BY COALESCE(cov.last_counted_at, '1970-01-01') ASC
     LIMIT ?`,
    [wid, wid, cls, wid, intervalDays, batchLimit],
  )
  return { productIds: rows.map(r => Number(r.product_id)), scopeType: 'abc', scopeValue: cls }
}

/**
 * 读取某仓生效的循环盘频率规则（A/B/C 各一条，本仓 override 优先于 warehouse_id=0 全局默认，
 * 缺行按行业默认兜底）。warehouseId 省略/0 即读全局默认。纯只读配置。
 */
async function getCycleRules({ warehouseId = 0 }) {
  const wid = Number(warehouseId) || 0
  const [rows] = await pool.query(
    `SELECT warehouse_id, abc_class, interval_days, batch_limit, enabled
     FROM inventory_cycle_rules WHERE warehouse_id IN (?, 0)`,
    [wid],
  )
  const byClass = {}
  for (const r of rows) {
    // 本仓 override 覆盖全局默认；同类只保留优先级更高的一条
    if (!byClass[r.abc_class] || Number(r.warehouse_id) === wid) byClass[r.abc_class] = r
  }
  return {
    warehouseId: wid,
    rules: VALID_ABC.map(cls => {
      const r = byClass[cls]
      return {
        abcClass: cls,
        intervalDays: r ? Number(r.interval_days) : DEFAULT_INTERVAL[cls],
        batchLimit: r ? Number(r.batch_limit) : DEFAULT_BATCH_LIMIT,
        enabled: r ? Number(r.enabled) === 1 : true,
        // 该行是否为本仓自身覆盖（true）还是继承自全局默认（false）——供前端标注
        isOverride: !!(r && Number(r.warehouse_id) === wid && wid !== 0),
      }
    }),
  }
}

/**
 * upsert 循环盘频率规则。warehouseId=0 编辑全局默认，>0 为本仓 override（COALESCE 生效）。
 * 只写配置表 inventory_cycle_rules，不碰库存/盘点执行。
 */
async function saveCycleRules({ warehouseId = 0, rules }) {
  const wid = Number(warehouseId) || 0
  if (!Array.isArray(rules) || !rules.length) throw new AppError('规则不能为空', 400)
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    for (const r of rules) {
      const cls = String(r.abcClass || '').toUpperCase()
      if (!VALID_ABC.includes(cls)) throw new AppError(`无效 ABC 类：${r.abcClass}`, 400)
      const interval = Number(r.intervalDays)
      const limit = Number(r.batchLimit)
      if (!Number.isFinite(interval) || interval <= 0) throw new AppError(`${cls} 类盘点周期必须大于 0 天`, 400)
      if (!Number.isFinite(limit) || limit <= 0) throw new AppError(`${cls} 类单次上限必须大于 0`, 400)
      await conn.query(
        `INSERT INTO inventory_cycle_rules (warehouse_id, abc_class, interval_days, batch_limit, enabled)
         VALUES (?,?,?,?,?)
         ON DUPLICATE KEY UPDATE interval_days=VALUES(interval_days), batch_limit=VALUES(batch_limit), enabled=VALUES(enabled)`,
        [wid, cls, interval, limit, r.enabled === false ? 0 : 1],
      )
    }
    await conn.commit()
  } catch (e) { await conn.rollback(); throw e } finally { conn.release() }
  return getCycleRules({ warehouseId: wid })
}

module.exports = { recomputeAbc, listAbc, getCycleCandidates, getCycleRules, saveCycleRules }
