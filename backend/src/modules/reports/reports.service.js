const { pool } = require('../../config/db')
const { getInboundClosureThresholds } = require('../../utils/inboundThresholds')

function firstValue(row, key, fallback = 0) {
  if (!row || row[key] == null) return fallback
  const n = Number(row[key])
  return Number.isFinite(n) ? n : fallback
}

function mapWorkbenchItem(row) {
  return {
    id: row.id,
    title: row.title,
    subtitle: row.subtitle,
    path: row.path,
    badge: row.badge || null,
    hint: row.hint || null,
    createdAt: row.createdAt || null,
  }
}

async function fetchOne(sql, params = []) {
  const [[row]] = await pool.query(sql, params)
  return row || {}
}

async function fetchMany(sql, params = []) {
  const [rows] = await pool.query(sql, params)
  return rows || []
}

// 采购统计：按月汇总金额、单数，可按供应商细分
async function purchaseStats({ startDate, endDate, groupBy = 'month' }) {
  const dateCond = startDate && endDate
    ? 'AND DATE(o.created_at) BETWEEN ? AND ?'
    : startDate ? 'AND DATE(o.created_at) >= ?' : endDate ? 'AND DATE(o.created_at) <= ?' : ''
  const dateParams = [startDate, endDate].filter(Boolean)

  const byMonth = await pool.query(
    `SELECT DATE_FORMAT(o.created_at,'%Y-%m') AS month,
            COUNT(*) AS order_count,
            SUM(o.total_amount) AS total_amount,
            SUM(CASE WHEN o.status=3 THEN o.total_amount ELSE 0 END) AS received_amount
     FROM purchase_orders o
     WHERE o.deleted_at IS NULL AND o.status != 4 ${dateCond}
     GROUP BY month ORDER BY month ASC`,
    dateParams
  )

  const bySupplier = await pool.query(
    `SELECT o.supplier_name,
            COUNT(*) AS order_count,
            SUM(o.total_amount) AS total_amount,
            SUM(CASE WHEN o.status=3 THEN o.total_amount ELSE 0 END) AS received_amount
     FROM purchase_orders o
     WHERE o.deleted_at IS NULL AND o.status != 4 ${dateCond}
     GROUP BY o.supplier_id, o.supplier_name ORDER BY total_amount DESC LIMIT 20`,
    dateParams
  )

  const byProduct = await pool.query(
    `SELECT i.product_name, SUM(i.quantity) AS total_qty, SUM(i.amount) AS total_amount
     FROM purchase_order_items i
     JOIN purchase_orders o ON i.order_id = o.id
     WHERE o.deleted_at IS NULL AND o.status = 3 ${dateCond.replace(/o\.created_at/g, 'o.created_at')}
     GROUP BY i.product_id, i.product_name ORDER BY total_amount DESC LIMIT 20`,
    dateParams
  )

  return {
    byMonth: byMonth[0].map(r => ({ month: r.month, orderCount: +r.order_count, totalAmount: +r.total_amount, receivedAmount: +r.received_amount })),
    bySupplier: bySupplier[0].map(r => ({ supplierName: r.supplier_name, orderCount: +r.order_count, totalAmount: +r.total_amount, receivedAmount: +r.received_amount })),
    byProduct: byProduct[0].map(r => ({ productName: r.product_name, totalQty: +r.total_qty, totalAmount: +r.total_amount }))
  }
}

// 销售统计
async function saleStats({ startDate, endDate }) {
  const dateCond = startDate && endDate
    ? 'AND DATE(o.created_at) BETWEEN ? AND ?'
    : startDate ? 'AND DATE(o.created_at) >= ?' : endDate ? 'AND DATE(o.created_at) <= ?' : ''
  const dateParams = [startDate, endDate].filter(Boolean)

  const byMonth = await pool.query(
    `SELECT DATE_FORMAT(o.created_at,'%Y-%m') AS month,
            COUNT(*) AS order_count,
            SUM(o.total_amount) AS total_amount,
            SUM(CASE WHEN o.status=3 THEN o.total_amount ELSE 0 END) AS shipped_amount
     FROM sale_orders o
     WHERE o.deleted_at IS NULL AND o.status != 4 ${dateCond}
     GROUP BY month ORDER BY month ASC`,
    dateParams
  )

  const byCustomer = await pool.query(
    `SELECT o.customer_name,
            COUNT(*) AS order_count,
            SUM(o.total_amount) AS total_amount
     FROM sale_orders o
     WHERE o.deleted_at IS NULL AND o.status != 4 ${dateCond}
     GROUP BY o.customer_id, o.customer_name ORDER BY total_amount DESC LIMIT 20`,
    dateParams
  )

  const byProduct = await pool.query(
    `SELECT i.product_name, SUM(i.quantity) AS total_qty, SUM(i.amount) AS total_amount
     FROM sale_order_items i
     JOIN sale_orders o ON i.order_id = o.id
     WHERE o.deleted_at IS NULL AND o.status = 3 ${dateCond}
     GROUP BY i.product_id, i.product_name ORDER BY total_amount DESC LIMIT 20`,
    dateParams
  )

  return {
    byMonth: byMonth[0].map(r => ({ month: r.month, orderCount: +r.order_count, totalAmount: +r.total_amount, shippedAmount: +r.shipped_amount })),
    byCustomer: byCustomer[0].map(r => ({ customerName: r.customer_name, orderCount: +r.order_count, totalAmount: +r.total_amount })),
    byProduct: byProduct[0].map(r => ({ productName: r.product_name, totalQty: +r.total_qty, totalAmount: +r.total_amount }))
  }
}

// 库存统计：商品出入库量 + 当前库存
async function inventoryStats({ startDate, endDate }) {
  const dateCond = startDate && endDate
    ? 'AND DATE(l.created_at) BETWEEN ? AND ?'
    : startDate ? 'AND DATE(l.created_at) >= ?' : endDate ? 'AND DATE(l.created_at) <= ?' : ''
  const dateParams = [startDate, endDate].filter(Boolean)

  const turnover = await pool.query(
    `SELECT p.code, p.name, p.unit,
            SUM(CASE WHEN l.type=1 THEN l.quantity ELSE 0 END) AS inbound_qty,
            SUM(CASE WHEN l.type=2 THEN l.quantity ELSE 0 END) AS outbound_qty,
            COALESCE(s.total_qty, 0) AS current_qty
     FROM inventory_logs l
     JOIN product_items p ON l.product_id = p.id
     LEFT JOIN (
       SELECT product_id, SUM(quantity) AS total_qty FROM inventory_stock GROUP BY product_id
     ) s ON s.product_id = l.product_id
     WHERE p.deleted_at IS NULL ${dateCond}
     GROUP BY l.product_id, p.code, p.name, p.unit, s.total_qty
     ORDER BY outbound_qty DESC LIMIT 30`,
    dateParams
  )

  const byWarehouse = await pool.query(
    `SELECT w.name AS warehouse_name,
            SUM(s.quantity) AS total_qty,
            SUM(s.quantity * p.cost_price) AS total_value
     FROM inventory_stock s
     JOIN inventory_warehouses w ON s.warehouse_id = w.id
     JOIN product_items p ON s.product_id = p.id
     WHERE w.deleted_at IS NULL AND p.deleted_at IS NULL
     GROUP BY s.warehouse_id, w.name ORDER BY total_value DESC`
  )

  return {
    turnover: turnover[0].map(r => ({ code: r.code, name: r.name, unit: r.unit, inboundQty: +r.inbound_qty, outboundQty: +r.outbound_qty, currentQty: +r.current_qty })),
    byWarehouse: byWarehouse[0].map(r => ({ warehouseName: r.warehouse_name, totalQty: +r.total_qty, totalValue: +r.total_value }))
  }
}

/**
 * PDA 操作统计
 *
 * 返回：
 *   today      — 今日汇总（扫码次数、拣货数量）
 *   operators  — 按操作员分组（扫码次数、拣货数量）
 *   topOperator — 今日扫码 TOP1
 */
async function pdaPerformance() {
  const today = new Date().toISOString().slice(0, 10)

  // ── 今日汇总 ────────────────────────────────────────────────────────────
  const [[todaySummary]] = await pool.query(
    `SELECT
       COUNT(*)                     AS scan_count,
       COALESCE(SUM(qty), 0)        AS pick_qty
     FROM scan_logs
     WHERE DATE(scanned_at) = ?`,
    [today],
  )

  // ── 按操作员分组（今日）──────────────────────────────────────────────────
  const [byOperator] = await pool.query(
    `SELECT
       operator_id,
       operator_name,
       COUNT(*)              AS scan_count,
       COALESCE(SUM(qty), 0) AS pick_qty,
       MIN(scanned_at)       AS first_scan,
       MAX(scanned_at)       AS last_scan
     FROM scan_logs
     WHERE DATE(scanned_at) = ?
       AND operator_id IS NOT NULL
     GROUP BY operator_id, operator_name
     ORDER BY scan_count DESC`,
    [today],
  )

  // ── 近 7 天每日扫码量 ───────────────────────────────────────────────────
  const [daily] = await pool.query(
    `SELECT
       DATE(scanned_at)      AS date,
       COUNT(*)              AS scan_count,
       COALESCE(SUM(qty), 0) AS pick_qty
     FROM scan_logs
     WHERE scanned_at >= DATE_SUB(CURDATE(), INTERVAL 6 DAY)
     GROUP BY DATE(scanned_at)
     ORDER BY date ASC`,
  )

  const operators = byOperator.map(r => {
    const first = r.first_scan ? new Date(r.first_scan) : null
    const last  = r.last_scan  ? new Date(r.last_scan)  : null
    const avgMinutes = (first && last && r.scan_count > 1)
      ? Math.round((last - first) / 1000 / 60)
      : null
    return {
      operatorId:   r.operator_id,
      operatorName: r.operator_name || '未知',
      scanCount:    Number(r.scan_count),
      pickQty:      Number(r.pick_qty),
      avgMinutes,
    }
  })

  return {
    today: {
      scanCount: Number(todaySummary.scan_count),
      pickQty:   Number(todaySummary.pick_qty),
    },
    topOperator: operators[0] || null,
    operators,
    daily: daily.map(d => ({
      date:      d.date.toISOString ? d.date.toISOString().slice(0, 10) : String(d.date),
      scanCount: Number(d.scan_count),
      pickQty:   Number(d.pick_qty),
    })),
  }
}

/**
 * 波次拣货效率报表
 *
 * 统计：每波次的 SKU 数、拣货数量、时长、效率（件/分钟）
 */
async function wavePerformance({ startDate = null, endDate = null } = {}) {
  const dateCond = startDate && endDate
    ? 'AND DATE(pw.created_at) BETWEEN ? AND ?'
    : startDate ? 'AND DATE(pw.created_at) >= ?' : endDate ? 'AND DATE(pw.created_at) <= ?' : ''
  const dateParams = [startDate, endDate].filter(Boolean)

  // ── 汇总统计（近 30 天） ────────────────────────────────────────────────
  const [[summary]] = await pool.query(
    `SELECT
       COUNT(*)                         AS total_waves,
       SUM(pw.status = 4)               AS completed_waves,
       AVG(
         TIMESTAMPDIFF(MINUTE, pw.created_at,
           (SELECT MAX(r.completed_at)
            FROM picking_wave_routes r WHERE r.wave_id = pw.id))
       )                                AS avg_duration_minutes,
       AVG(skus.sku_count)              AS avg_sku_count,
       SUM(skus.total_picked)           AS total_picked_qty
     FROM picking_waves pw
     LEFT JOIN (
       SELECT wave_id,
              COUNT(DISTINCT product_id) AS sku_count,
              SUM(picked_qty)            AS total_picked
       FROM picking_wave_items
       GROUP BY wave_id
     ) skus ON skus.wave_id = pw.id
     WHERE pw.status != 5
       AND pw.created_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)`,
  )

  // ── 每波次明细 ─────────────────────────────────────────────────────────
  const [rows] = await pool.query(
    `SELECT
       pw.id,
       pw.wave_no,
       pw.status,
       pw.task_count,
       pw.operator_name,
       pw.created_at,
       pw.updated_at,
       COUNT(DISTINCT pwi.product_id)               AS sku_count,
       COALESCE(SUM(pwi.total_qty), 0)              AS total_required_qty,
       COALESCE(SUM(pwi.picked_qty), 0)             AS total_picked_qty,
       COUNT(pwr.id)                                AS total_steps,
       SUM(pwr.status = 'completed')                AS completed_steps,
       MAX(pwr.completed_at)                        AS last_pick_at,
       TIMESTAMPDIFF(
         MINUTE, pw.created_at, MAX(pwr.completed_at)
       )                                            AS duration_minutes
     FROM picking_waves pw
     LEFT JOIN picking_wave_items  pwi ON pwi.wave_id = pw.id
     LEFT JOIN picking_wave_routes pwr ON pwr.wave_id = pw.id
     WHERE pw.status != 5 ${dateCond}
     GROUP BY pw.id, pw.wave_no, pw.status, pw.task_count,
              pw.operator_name, pw.created_at, pw.updated_at
     ORDER BY pw.created_at DESC
     LIMIT 100`,
    dateParams,
  )

  const STATUS_NAMES = { 1:'待拣货', 2:'拣货中', 3:'待分拣', 4:'已完成', 5:'已取消' }

  const waves = rows.map(r => {
    const dur   = r.duration_minutes != null ? Number(r.duration_minutes) : null
    const picked = Number(r.total_picked_qty)
    const efficiency = dur && dur > 0 ? +(picked / dur).toFixed(2) : null
    return {
      id:              r.id,
      waveNo:          r.wave_no,
      status:          r.status,
      statusName:      STATUS_NAMES[r.status] ?? String(r.status),
      taskCount:       Number(r.task_count),
      operatorName:    r.operator_name || '—',
      createdAt:       r.created_at,
      skuCount:        Number(r.sku_count),
      totalRequiredQty: Number(r.total_required_qty),
      totalPickedQty:  picked,
      totalSteps:      Number(r.total_steps),
      completedSteps:  Number(r.completed_steps),
      lastPickAt:      r.last_pick_at || null,
      durationMinutes: dur,
      efficiency,   // 件/分钟
    }
  })

  return {
    summary: {
      totalWaves:          Number(summary.total_waves),
      completedWaves:      Number(summary.completed_waves),
      avgDurationMinutes:  summary.avg_duration_minutes != null ? +Number(summary.avg_duration_minutes).toFixed(1) : null,
      avgSkuCount:         summary.avg_sku_count != null ? +Number(summary.avg_sku_count).toFixed(1) : null,
      totalPickedQty:      Number(summary.total_picked_qty ?? 0),
    },
    waves,
  }
}

/**
 * 仓库运营看板
 *
 * 一次请求返回所有看板所需数据：
 *   summary      — 今日核心指标
 *   byOperator   — 人员效率
 *   flowBottleneck — 流程瓶颈（各步骤任务数量）
 *   hourlyTrend  — 今日每小时出库量
 *   recentErrors — 最新错误列表
 */
async function warehouseOps() {
  const today = new Date().toISOString().slice(0, 10)

  // 1. 今日核心指标
  const [[todayShipped]] = await pool.query(
    `SELECT COUNT(*) AS shipped_count
     FROM warehouse_tasks
     WHERE status = 5 AND DATE(updated_at) = ?`,
    [today]
  ).catch(() => [[{ shipped_count: 0 }]])

  const [[todayPicking]] = await pool.query(
    `SELECT COUNT(*) AS picking_count
     FROM warehouse_tasks WHERE status IN (2,3,4)`,
  ).catch(() => [[{ picking_count: 0 }]])

  const [[todayInbound]] = await pool.query(
    `SELECT COUNT(*) AS inbound_count
     FROM inbound_tasks
     WHERE status = 3 AND DATE(updated_at) = ?`,
    [today]
  ).catch(() => [[{ inbound_count: 0 }]])

  const [[scanSummary]] = await pool.query(
    `SELECT COUNT(*) AS scan_count, COALESCE(SUM(qty),0) AS pick_qty
     FROM scan_logs WHERE DATE(scanned_at) = ?`,
    [today]
  ).catch(() => [[{ scan_count: 0, pick_qty: 0 }]])

  const [[errSummary]] = await pool.query(
    `SELECT COUNT(*) AS error_count
     FROM pda_error_logs WHERE DATE(created_at) = ?`,
    [today]
  ).catch(() => [[{ error_count: 0 }]])

  const [[undoSummary]] = await pool.query(
    `SELECT COUNT(*) AS undo_count
     FROM pda_undo_logs WHERE DATE(created_at) = ?`,
    [today]
  ).catch(() => [[{ undo_count: 0 }]])

  const totalScans = Number(scanSummary.scan_count)
  const totalErrors = Number(errSummary.error_count)
  const errorRate = totalScans > 0
    ? (totalErrors / totalScans * 100).toFixed(1) + '%'
    : '0%'

  // 2. 人员效率（今日）
  const [byOperator] = await pool.query(
    `SELECT
       sl.operator_id   AS operatorId,
       sl.operator_name AS operatorName,
       COUNT(*)              AS scanCount,
       COALESCE(SUM(sl.qty), 0) AS pickQty,
       MIN(sl.scanned_at)    AS firstScan,
       MAX(sl.scanned_at)    AS lastScan
     FROM scan_logs sl
     WHERE DATE(sl.scanned_at) = ? AND sl.operator_id IS NOT NULL
     GROUP BY sl.operator_id, sl.operator_name
     ORDER BY scanCount DESC LIMIT 20`,
    [today]
  ).catch(() => [[]])

  const [errByOp] = await pool.query(
    `SELECT operator_id AS operatorId, COUNT(*) AS errCount
     FROM pda_error_logs WHERE DATE(created_at) = ?
     GROUP BY operator_id`,
    [today]
  ).catch(() => [[]])
  const errOpMap = Object.fromEntries(errByOp.map(r => [r.operatorId, Number(r.errCount)]))

  const operators = byOperator.map(r => {
    const first = r.firstScan ? new Date(r.firstScan) : null
    const last  = r.lastScan  ? new Date(r.lastScan)  : null
    const durationMin = (first && last) ? Math.round((last - first) / 60000) : null
    const sc = Number(r.scanCount)
    const ec = errOpMap[r.operatorId] ?? 0
    return {
      operatorId:   r.operatorId,
      operatorName: r.operatorName || '未知',
      scanCount:    sc,
      pickQty:      Number(r.pickQty),
      errorCount:   ec,
      errorRate:    sc > 0 ? (ec / sc * 100).toFixed(1) + '%' : '0%',
      durationMin,
      efficiency:   (durationMin && durationMin > 0) ? (Number(r.pickQty) / durationMin).toFixed(1) : null,
    }
  })

  // 3. 流程瓶颈（各状态任务堆积量）
  const [flowRows] = await pool.query(
    `SELECT status, COUNT(*) AS cnt
     FROM warehouse_tasks
     WHERE status IN (1,2,3,4,5)
     GROUP BY status`
  ).catch(() => [[]])
  const STATUS_LABEL = { 1:'待拣货', 2:'拣货中', 3:'待复核', 4:'打包中', 5:'已完成' }
  const flowBottleneck = [1,2,3,4,5].map(s => ({
    status: s,
    label:  STATUS_LABEL[s],
    count:  Number(flowRows.find(r => r.status === s)?.cnt ?? 0),
  }))

  // 4. 今日每小时出库量
  const [hourlyRows] = await pool.query(
    `SELECT HOUR(scanned_at) AS hr, COUNT(*) AS cnt
     FROM scan_logs
     WHERE DATE(scanned_at) = ?
     GROUP BY HOUR(scanned_at) ORDER BY hr ASC`,
    [today]
  ).catch(() => [[]])
  const hourlyTrend = Array.from({ length: 24 }, (_, h) => ({
    hour:  `${String(h).padStart(2,'0')}:00`,
    count: Number(hourlyRows.find(r => r.hr === h)?.cnt ?? 0),
  })).filter((_, h) => h >= 6 && h <= 22) // 只显示 06:00-22:00

  // 5. 最新错误（最近 10 条）
  const [recentErrors] = await pool.query(
    `SELECT id, task_id AS taskId, barcode, reason, operator_name AS operatorName, created_at AS createdAt
     FROM pda_error_logs
     ORDER BY created_at DESC LIMIT 10`
  ).catch(() => [[]])

  return {
    summary: {
      shippedToday:  Number(todayShipped.shipped_count),
      pickingNow:    Number(todayPicking.picking_count),
      inboundToday:  Number(todayInbound.inbound_count),
      scanCount:     totalScans,
      pickQty:       Number(scanSummary.pick_qty),
      errorCount:    totalErrors,
      undoCount:     Number(undoSummary.undo_count),
      errorRate,
    },
    operators,
    flowBottleneck,
    hourlyTrend,
    recentErrors: recentErrors.map(r => ({
      id:           r.id,
      taskId:       r.taskId,
      barcode:      r.barcode,
      reason:       r.reason,
      operatorName: r.operatorName,
      createdAt:    r.createdAt,
    })),
  }
}

async function roleWorkbench() {
  const thresholds = await getInboundClosureThresholds()
  const highRiskWindowHours = 24

  // ── 仓库角色 ─────────────────────────────────────────────────────────────
  const pendingReceiveCount = await fetchOne(
    `SELECT COUNT(*) AS count
     FROM inbound_tasks
     WHERE deleted_at IS NULL AND status IN (1, 2)`,
  )
  const pendingReceiveRows = await fetchMany(
    `SELECT t.id,
            t.task_no AS title,
            CONCAT(COALESCE(t.supplier_name, '未知供应商'), ' · ', COALESCE(t.purchase_order_no, '混合采购')) AS subtitle,
            CONCAT('/inbound-tasks/', t.id) AS path,
            CASE WHEN t.status = 1 THEN '待收货' ELSE '收货中' END AS badge,
            CONCAT('创建于 ', DATE_FORMAT(t.created_at, '%m-%d %H:%i')) AS hint,
            t.created_at AS createdAt
     FROM inbound_tasks t
     WHERE t.deleted_at IS NULL AND t.status IN (1, 2)
     ORDER BY t.created_at ASC
     LIMIT 5`,
  )

  const waitingPutawayCount = await fetchOne(
    `SELECT COUNT(*) AS count
     FROM inventory_containers
     WHERE deleted_at IS NULL
       AND status = 0
       AND inbound_task_id IS NOT NULL`,
  )
  const waitingPutawayRows = await fetchMany(
    `SELECT c.id,
            c.container_code AS title,
            CONCAT(COALESCE(t.task_no, '收货任务'), ' · ', COALESCE(c.source_ref_no, '待上架')) AS subtitle,
            CONCAT('/inbound-tasks/', c.inbound_task_id) AS path,
            CASE
              WHEN c.putaway_deadline_at IS NOT NULL AND c.putaway_deadline_at < NOW() THEN '超时'
              ELSE '待上架'
            END AS badge,
            CONCAT('库存条码 · ', DATE_FORMAT(c.created_at, '%m-%d %H:%i')) AS hint,
            c.created_at AS createdAt
     FROM inventory_containers c
     LEFT JOIN inbound_tasks t ON t.id = c.inbound_task_id
     WHERE c.deleted_at IS NULL
       AND c.status = 0
       AND c.inbound_task_id IS NOT NULL
     ORDER BY COALESCE(c.putaway_deadline_at, c.created_at) ASC
     LIMIT 5`,
  )

  const pendingAuditCount = await fetchOne(
    `SELECT COUNT(*) AS count
     FROM inbound_tasks
     WHERE deleted_at IS NULL
       AND status = 4
       AND audit_status = 0`,
  )
  const pendingAuditRows = await fetchMany(
    `SELECT t.id,
            t.task_no AS title,
            CONCAT(COALESCE(t.supplier_name, '未知供应商'), ' · ', COALESCE(t.warehouse_name, '未知仓库')) AS subtitle,
            CONCAT('/inbound-tasks/', t.id) AS path,
            '待审核' AS badge,
            CONCAT('上架后 ', DATE_FORMAT(t.updated_at, '%m-%d %H:%i')) AS hint,
            t.updated_at AS createdAt
     FROM inbound_tasks t
     WHERE t.deleted_at IS NULL
       AND t.status = 4
       AND t.audit_status = 0
     ORDER BY t.updated_at ASC
     LIMIT 5`,
  )

  const printFailureCount = await fetchOne(
    `SELECT COUNT(*) AS count
     FROM print_jobs j
     INNER JOIN inventory_containers c ON c.id = j.ref_id AND j.ref_type = 'inventory_container'
     WHERE c.inbound_task_id IS NOT NULL
       AND (
         (j.status = 3 AND IFNULL(j.error_message, '') <> 'no printer available')
         OR (j.status IN (0, 1) AND TIMESTAMPDIFF(MINUTE, j.updated_at, NOW()) >= ?)
         OR (j.status = 3 AND IFNULL(j.error_message, '') = 'no printer available')
       )`,
    [Number(thresholds.printTimeoutMinutes)],
  )
  const printFailureRows = await fetchMany(
    `SELECT c.inbound_task_id AS id,
            COALESCE(t.task_no, '收货任务') AS title,
            CONCAT(COALESCE(c.container_code, '库存条码'), ' · ', COALESCE(j.status, 'queued')) AS subtitle,
            CONCAT('/inbound-tasks/', c.inbound_task_id) AS path,
            CASE
              WHEN j.status = 3 THEN '失败'
              WHEN j.status IN (0, 1) THEN '超时待确认'
              ELSE '打印中'
            END AS badge,
            CONCAT('补打入口 · ', DATE_FORMAT(j.updated_at, '%m-%d %H:%i')) AS hint,
            j.updated_at AS createdAt
     FROM print_jobs j
     INNER JOIN inventory_containers c ON c.id = j.ref_id AND j.ref_type = 'inventory_container'
     LEFT JOIN inbound_tasks t ON t.id = c.inbound_task_id
     WHERE c.inbound_task_id IS NOT NULL
       AND (
         (j.status = 3 AND IFNULL(j.error_message, '') <> 'no printer available')
         OR (j.status IN (0, 1) AND TIMESTAMPDIFF(MINUTE, j.updated_at, NOW()) >= ?)
         OR (j.status = 3 AND IFNULL(j.error_message, '') = 'no printer available')
       )
     ORDER BY j.updated_at DESC
     LIMIT 5`,
    [Number(thresholds.printTimeoutMinutes)],
  )

  // ── 销售/客服角色 ───────────────────────────────────────────────────────
  const pendingShipCount = await fetchOne(
    `SELECT COUNT(*) AS count
     FROM sale_orders
     WHERE deleted_at IS NULL AND status IN (2, 3)`,
  )
  const pendingShipRows = await fetchMany(
    `SELECT o.id,
            o.order_no AS title,
            CONCAT(COALESCE(o.customer_name, '未知客户'), ' · ', COALESCE(o.warehouse_name, '未知仓库')) AS subtitle,
            CONCAT('/sale/', o.id) AS path,
            CASE WHEN o.status = 2 THEN '待出库' ELSE '出库中' END AS badge,
            CONCAT('创建于 ', DATE_FORMAT(o.created_at, '%m-%d %H:%i')) AS hint,
            o.created_at AS createdAt
     FROM sale_orders o
     WHERE o.deleted_at IS NULL AND o.status IN (2, 3)
     ORDER BY o.created_at ASC
     LIMIT 5`,
  )

  const saleAnomalyCount = await fetchOne(
    `SELECT COUNT(DISTINCT related_id) AS count
     FROM system_health_logs
     WHERE created_at >= NOW() - INTERVAL ? HOUR
       AND severity IN ('high', 'danger')
       AND related_table = 'sale_orders'`,
    [highRiskWindowHours],
  )
  const saleAnomalyRows = await fetchMany(
    `SELECT id,
            related_id AS saleId,
            CONCAT(check_type, IF(related_id IS NULL, '', CONCAT(' #', related_id))) AS title,
            message AS subtitle,
            CASE
              WHEN related_id IS NOT NULL THEN CONCAT('/sale/', related_id)
              ELSE '/reports/exception-workbench'
            END AS path,
            severity AS badge,
            DATE_FORMAT(created_at, '%m-%d %H:%i') AS hint,
            created_at AS createdAt
     FROM system_health_logs
     WHERE created_at >= NOW() - INTERVAL ? HOUR
       AND severity IN ('high', 'danger')
       AND related_table = 'sale_orders'
     ORDER BY created_at DESC
     LIMIT 5`,
    [highRiskWindowHours],
  )

  const belowCostCount = await fetchOne(
    `SELECT COUNT(DISTINCT o.id) AS count
     FROM sale_orders o
     INNER JOIN sale_order_items soi ON soi.order_id = o.id
     INNER JOIN product_items p ON p.id = soi.product_id
     WHERE o.deleted_at IS NULL
       AND o.status != 5
       AND p.cost_price IS NOT NULL
       AND p.cost_price > 0
       AND soi.unit_price < p.cost_price`,
  )
  const belowCostRows = await fetchMany(
    `SELECT o.id,
            o.order_no AS title,
            CONCAT(COALESCE(o.customer_name, '未知客户'), ' · 低于进价 ', COUNT(*) , ' 行') AS subtitle,
            CONCAT('/sale/', o.id) AS path,
            '低于进价' AS badge,
            CONCAT('潜在损失 ¥', FORMAT(SUM((p.cost_price - soi.unit_price) * soi.quantity), 2)) AS hint,
            o.created_at AS createdAt
     FROM sale_orders o
     INNER JOIN sale_order_items soi ON soi.order_id = o.id
     INNER JOIN product_items p ON p.id = soi.product_id
     WHERE o.deleted_at IS NULL
       AND o.status != 5
       AND p.cost_price IS NOT NULL
       AND p.cost_price > 0
       AND soi.unit_price < p.cost_price
     GROUP BY o.id, o.order_no, o.customer_name, o.created_at
     ORDER BY SUM((p.cost_price - soi.unit_price) * soi.quantity) DESC
     LIMIT 5`,
  )

  // ── 管理角色 ─────────────────────────────────────────────────────────────
  const auditCount = pendingAuditCount

  const inventoryAnomalyCount = await fetchOne(
    `SELECT COUNT(*) AS count
     FROM (
       SELECT CONCAT('neg_on_hand-', s.id) AS issue_key
       FROM inventory_stock s
       WHERE s.quantity < 0
       UNION ALL
       SELECT CONCAT('neg_reserved-', s.id)
       FROM inventory_stock s
       WHERE s.reserved < 0
       UNION ALL
       SELECT CONCAT('reserved_exceeds-', s.id)
       FROM inventory_stock s
       WHERE s.quantity < s.reserved
     ) x`,
  )
  const inventoryAnomalyRows = await fetchMany(
    `SELECT * FROM (
       SELECT s.id,
              p.name AS title,
              CONCAT('实际库存 ', s.quantity, '，预占 ', s.reserved) AS subtitle,
              '/inventory/overview' AS path,
              '库存异常' AS badge,
              '实际库存为负' AS hint,
              s.updated_at AS createdAt,
              1 AS sort_rank
       FROM inventory_stock s
       INNER JOIN product_items p ON p.id = s.product_id
       WHERE s.quantity < 0
       UNION ALL
       SELECT s.id,
              p.name AS title,
              CONCAT('实际库存 ', s.quantity, '，预占 ', s.reserved) AS subtitle,
              '/inventory/overview' AS path,
              '库存异常' AS badge,
              '预占数量为负' AS hint,
              s.updated_at AS createdAt,
              2 AS sort_rank
       FROM inventory_stock s
       INNER JOIN product_items p ON p.id = s.product_id
       WHERE s.reserved < 0
       UNION ALL
       SELECT s.id,
              p.name AS title,
              CONCAT('实际库存 ', s.quantity, '，预占 ', s.reserved) AS subtitle,
              '/inventory/overview' AS path,
              '库存异常' AS badge,
              '可用库存为负' AS hint,
              s.updated_at AS createdAt,
              3 AS sort_rank
       FROM inventory_stock s
       INNER JOIN product_items p ON p.id = s.product_id
       WHERE s.quantity < s.reserved
     ) t
     ORDER BY sort_rank ASC, createdAt DESC
     LIMIT 5`,
  )

  const highRiskCount = await fetchOne(
    `SELECT COUNT(*) AS count
     FROM system_health_logs
     WHERE created_at >= NOW() - INTERVAL ? HOUR
       AND severity IN ('high', 'danger', 'fix_failed')`,
    [highRiskWindowHours],
  )
  const highRiskRows = await fetchMany(
    `SELECT id,
            CONCAT(check_type, IF(related_id IS NULL, '', CONCAT(' #', related_id))) AS title,
            message AS subtitle,
            CASE
              WHEN related_table = 'sale_orders' AND related_id IS NOT NULL THEN CONCAT('/sale/', related_id)
              WHEN related_table = 'inbound_tasks' AND related_id IS NOT NULL THEN CONCAT('/inbound-tasks/', related_id)
              WHEN related_table = 'warehouse_tasks' AND related_id IS NOT NULL THEN '/reports/exception-workbench'
              WHEN related_table = 'inventory_stock' THEN '/inventory/overview'
              ELSE '/reports/exception-workbench'
            END AS path,
            severity AS badge,
            DATE_FORMAT(created_at, '%m-%d %H:%i') AS hint,
            created_at AS createdAt
     FROM system_health_logs
     WHERE created_at >= NOW() - INTERVAL ? HOUR
       AND severity IN ('high', 'danger', 'fix_failed')
     ORDER BY created_at DESC
     LIMIT 5`,
    [highRiskWindowHours],
  )

  const sections = [
    {
      key: 'warehouse',
      title: '仓库角色',
      description: '收货、上架、审核和补打，聚焦一线仓库收口。',
      cards: [
        {
          key: 'warehouse-pending-receive',
          title: '待收货',
          description: '已建但尚未进入收货闭环的收货订单。',
          count: firstValue(pendingReceiveCount, 'count'),
          path: pendingReceiveRows[0] ? `/inbound-tasks/${pendingReceiveRows[0].id}` : '/inbound-tasks',
          actionLabel: pendingReceiveRows[0] ? '打开首单' : '查看收货订单',
          accent: 'blue',
          items: pendingReceiveRows.map(mapWorkbenchItem),
        },
        {
          key: 'warehouse-putaway',
          title: '待上架',
          description: '已打印库存条码但尚未完成上架的容器。',
          count: firstValue(waitingPutawayCount, 'count'),
          path: waitingPutawayRows[0]?.path ?? '/inbound-tasks',
          actionLabel: waitingPutawayRows[0] ? '打开首条' : '查看收货订单',
          accent: 'amber',
          items: waitingPutawayRows.map(mapWorkbenchItem),
        },
        {
          key: 'warehouse-audit',
          title: '待复核',
          description: '已上架但还未完成审核的收货订单。',
          count: firstValue(pendingAuditCount, 'count'),
          path: pendingAuditRows[0]?.path ?? '/inbound-tasks',
          actionLabel: pendingAuditRows[0] ? '打开首单' : '查看收货订单',
          accent: 'emerald',
          items: pendingAuditRows.map(mapWorkbenchItem),
        },
        {
          key: 'warehouse-print',
          title: '打印失败待补打',
          description: '收货库存条码打印异常或超时待确认。',
          count: firstValue(printFailureCount, 'count'),
          path: printFailureRows[0]?.path ?? '/settings/barcode-print-query?category=inbound&status=failed',
          actionLabel: printFailureRows[0] ? '打开首单' : '打开补打中心',
          accent: 'rose',
          items: printFailureRows.map(mapWorkbenchItem),
        },
      ],
    },
    {
      key: 'sale',
      title: '销售/客服',
      description: '出库推进、价格风险和销售异常，优先看影响业务结果的单据。',
      cards: [
        {
          key: 'sale-pending-ship',
          title: '待出库',
          description: '已确认或已进入出库流程的销售单。',
          count: firstValue(pendingShipCount, 'count'),
          path: pendingShipRows[0]?.path ?? '/sale',
          actionLabel: pendingShipRows[0] ? '打开首单' : '查看销售单',
          accent: 'blue',
          items: pendingShipRows.map(mapWorkbenchItem),
        },
        {
          key: 'sale-anomaly',
          title: '异常销售单',
          description: '近期命中的销售相关高风险巡检问题。',
          count: firstValue(saleAnomalyCount, 'count'),
          path: saleAnomalyRows[0]?.path ?? '/reports/exception-workbench',
          actionLabel: saleAnomalyRows[0] ? '查看首条' : '打开异常工作台',
          accent: 'rose',
          items: saleAnomalyRows.map(mapWorkbenchItem),
        },
        {
          key: 'sale-below-cost',
          title: '低于进价单据',
          description: '存在低于成本价销售行的销售单。',
          count: firstValue(belowCostCount, 'count'),
          path: belowCostRows[0]?.path ?? '/sale',
          actionLabel: belowCostRows[0] ? '打开首单' : '查看销售单',
          accent: 'amber',
          items: belowCostRows.map(mapWorkbenchItem),
        },
      ],
    },
    {
      key: 'management',
      title: '管理角色',
      description: '看收口进度、异常任务和高风险问题，优先盯住会拖慢闭环的点。',
      cards: [
        {
          key: 'management-audit',
          title: '待审核收货单',
          description: '完成上架后等待管理审核的收货订单。',
          count: firstValue(auditCount, 'count'),
          path: pendingAuditRows[0]?.path ?? '/inbound-tasks',
          actionLabel: pendingAuditRows[0] ? '打开首单' : '查看收货订单',
          accent: 'emerald',
          items: pendingAuditRows.map(mapWorkbenchItem),
        },
        {
          key: 'management-anomaly-task',
          title: '异常任务',
          description: '销售/仓库流程中的巡检异常与任务延迟。',
          count: Math.max(firstValue(saleAnomalyCount, 'count'), firstValue(highRiskCount, 'count')),
          path: '/reports/exception-workbench',
          actionLabel: '打开异常工作台',
          accent: 'rose',
          items: highRiskRows.map(mapWorkbenchItem),
        },
        {
          key: 'management-stock',
          title: '库存异常',
          description: '负库存、负预占和可用库存为负的风险项。',
          count: firstValue(inventoryAnomalyCount, 'count'),
          path: '/inventory/overview',
          actionLabel: '查看库存总览',
          accent: 'amber',
          items: inventoryAnomalyRows.map(mapWorkbenchItem),
        },
        {
          key: 'management-high-risk',
          title: '近期高风险问题',
          description: '最近 24 小时内的高风险巡检结果。',
          count: firstValue(highRiskCount, 'count'),
          path: '/reports/exception-workbench',
          actionLabel: '打开异常工作台',
          accent: 'slate',
          items: highRiskRows.map(mapWorkbenchItem),
        },
      ],
    },
  ]

  const summary = {
    totalAlerts:
      sections.reduce((sum, section) => sum + section.cards.reduce((cardSum, card) => cardSum + card.count, 0), 0),
    warehouseCount: sections[0].cards.reduce((sum, card) => sum + card.count, 0),
    saleCount: sections[1].cards.reduce((sum, card) => sum + card.count, 0),
    managementCount: sections[2].cards.reduce((sum, card) => sum + card.count, 0),
  }

  return {
    summary,
    sections,
  }
}

module.exports = { purchaseStats, saleStats, inventoryStats, pdaPerformance, wavePerformance, warehouseOps, roleWorkbench }
