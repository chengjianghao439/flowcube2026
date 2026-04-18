const { pool } = require('../../config/db')
const { buildDateFilter } = require('./reports.helpers')

async function fetchOne(sql, params = []) {
  const [[row]] = await pool.query(sql, params)
  return row || {}
}

async function fetchMany(sql, params = []) {
  const [rows] = await pool.query(sql, params)
  return rows || []
}

async function fetchPurchaseStatsRows({ startDate, endDate }) {
  const dateCond = startDate && endDate
    ? 'AND DATE(o.created_at) BETWEEN ? AND ?'
    : startDate ? 'AND DATE(o.created_at) >= ?' : endDate ? 'AND DATE(o.created_at) <= ?' : ''
  const dateParams = [startDate, endDate].filter(Boolean)

  const byMonth = await fetchMany(
    `SELECT DATE_FORMAT(o.created_at,'%Y-%m') AS month,
            COUNT(*) AS order_count,
            SUM(o.total_amount) AS total_amount,
            SUM(CASE WHEN o.status=3 THEN o.total_amount ELSE 0 END) AS received_amount
     FROM purchase_orders o
     WHERE o.deleted_at IS NULL AND o.status != 4 ${dateCond}
     GROUP BY month ORDER BY month ASC`,
    dateParams,
  )

  const bySupplier = await fetchMany(
    `SELECT o.supplier_name,
            COUNT(*) AS order_count,
            SUM(o.total_amount) AS total_amount,
            SUM(CASE WHEN o.status=3 THEN o.total_amount ELSE 0 END) AS received_amount
     FROM purchase_orders o
     WHERE o.deleted_at IS NULL AND o.status != 4 ${dateCond}
     GROUP BY o.supplier_id, o.supplier_name ORDER BY total_amount DESC LIMIT 20`,
    dateParams,
  )

  const byProduct = await fetchMany(
    `SELECT i.product_name, SUM(i.quantity) AS total_qty, SUM(i.amount) AS total_amount
     FROM purchase_order_items i
     JOIN purchase_orders o ON i.order_id = o.id
     WHERE o.deleted_at IS NULL AND o.status = 3 ${dateCond.replace(/o\.created_at/g, 'o.created_at')}
     GROUP BY i.product_id, i.product_name ORDER BY total_amount DESC LIMIT 20`,
    dateParams,
  )

  return { byMonth, bySupplier, byProduct }
}

async function fetchSaleStatsRows({ startDate, endDate }) {
  const dateCond = startDate && endDate
    ? 'AND DATE(o.created_at) BETWEEN ? AND ?'
    : startDate ? 'AND DATE(o.created_at) >= ?' : endDate ? 'AND DATE(o.created_at) <= ?' : ''
  const dateParams = [startDate, endDate].filter(Boolean)

  const byMonth = await fetchMany(
    `SELECT DATE_FORMAT(o.created_at,'%Y-%m') AS month,
            COUNT(*) AS order_count,
            SUM(o.total_amount) AS total_amount,
            SUM(CASE WHEN o.status=3 THEN o.total_amount ELSE 0 END) AS shipped_amount
     FROM sale_orders o
     WHERE o.deleted_at IS NULL AND o.status != 4 ${dateCond}
     GROUP BY month ORDER BY month ASC`,
    dateParams,
  )

  const byCustomer = await fetchMany(
    `SELECT o.customer_name,
            COUNT(*) AS order_count,
            SUM(o.total_amount) AS total_amount
     FROM sale_orders o
     WHERE o.deleted_at IS NULL AND o.status != 4 ${dateCond}
     GROUP BY o.customer_id, o.customer_name ORDER BY total_amount DESC LIMIT 20`,
    dateParams,
  )

  const byProduct = await fetchMany(
    `SELECT i.product_name, SUM(i.quantity) AS total_qty, SUM(i.amount) AS total_amount
     FROM sale_order_items i
     JOIN sale_orders o ON i.order_id = o.id
     WHERE o.deleted_at IS NULL AND o.status = 3 ${dateCond}
     GROUP BY i.product_id, i.product_name ORDER BY total_amount DESC LIMIT 20`,
    dateParams,
  )

  return { byMonth, byCustomer, byProduct }
}

async function fetchInventoryStatsRows({ startDate, endDate }) {
  const dateCond = startDate && endDate
    ? 'AND DATE(l.created_at) BETWEEN ? AND ?'
    : startDate ? 'AND DATE(l.created_at) >= ?' : endDate ? 'AND DATE(l.created_at) <= ?' : ''
  const dateParams = [startDate, endDate].filter(Boolean)

  const turnover = await fetchMany(
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
    dateParams,
  )

  const byWarehouse = await fetchMany(
    `SELECT w.name AS warehouse_name,
            SUM(s.quantity) AS total_qty,
            SUM(s.quantity * COALESCE(NULLIF(p.cost_price, 0), p.sale_price, 0)) AS total_value
     FROM inventory_stock s
     JOIN inventory_warehouses w ON s.warehouse_id = w.id
     JOIN product_items p ON s.product_id = p.id
     WHERE w.deleted_at IS NULL AND p.deleted_at IS NULL
     GROUP BY s.warehouse_id, w.name ORDER BY total_value DESC`,
  )

  return { turnover, byWarehouse }
}

async function fetchPdaPerformanceRows() {
  const today = new Date().toISOString().slice(0, 10)
  const todaySummary = await fetchOne(
    `SELECT COUNT(*) AS scan_count, COALESCE(SUM(qty), 0) AS pick_qty
     FROM scan_logs
     WHERE DATE(scanned_at) = ?`,
    [today],
  )
  const byOperator = await fetchMany(
    `SELECT
       operator_id,
       operator_name,
       COUNT(*) AS scan_count,
       COALESCE(SUM(qty), 0) AS pick_qty,
       MIN(scanned_at) AS first_scan,
       MAX(scanned_at) AS last_scan
     FROM scan_logs
     WHERE DATE(scanned_at) = ?
       AND operator_id IS NOT NULL
     GROUP BY operator_id, operator_name
     ORDER BY scan_count DESC`,
    [today],
  )
  const daily = await fetchMany(
    `SELECT
       DATE(scanned_at) AS date,
       COUNT(*) AS scan_count,
       COALESCE(SUM(qty), 0) AS pick_qty
     FROM scan_logs
     WHERE scanned_at >= DATE_SUB(CURDATE(), INTERVAL 6 DAY)
     GROUP BY DATE(scanned_at)
     ORDER BY date ASC`,
  )
  return { today, todaySummary, byOperator, daily }
}

async function fetchWavePerformanceRows({ startDate = null, endDate = null } = {}) {
  const dateCond = startDate && endDate
    ? 'AND DATE(pw.created_at) BETWEEN ? AND ?'
    : startDate ? 'AND DATE(pw.created_at) >= ?' : endDate ? 'AND DATE(pw.created_at) <= ?' : ''
  const dateParams = [startDate, endDate].filter(Boolean)

  const summary = await fetchOne(
    `SELECT
       COUNT(*) AS total_waves,
       SUM(pw.status = 4) AS completed_waves,
       AVG(
         TIMESTAMPDIFF(MINUTE, pw.created_at,
           (SELECT MAX(r.completed_at)
            FROM picking_wave_routes r WHERE r.wave_id = pw.id))
       ) AS avg_duration_minutes,
       AVG(skus.sku_count) AS avg_sku_count,
       SUM(skus.total_picked) AS total_picked_qty
     FROM picking_waves pw
     LEFT JOIN (
       SELECT wave_id,
              COUNT(DISTINCT product_id) AS sku_count,
              SUM(picked_qty) AS total_picked
       FROM picking_wave_items
       GROUP BY wave_id
     ) skus ON skus.wave_id = pw.id
     WHERE pw.status != 5
       AND pw.created_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)`,
  )

  const rows = await fetchMany(
    `SELECT
       pw.id,
       pw.wave_no,
       pw.status,
       pw.task_count,
       pw.operator_name,
       pw.created_at,
       pw.updated_at,
       COUNT(DISTINCT pwi.product_id) AS sku_count,
       COALESCE(SUM(pwi.total_qty), 0) AS total_required_qty,
       COALESCE(SUM(pwi.picked_qty), 0) AS total_picked_qty,
       COUNT(pwr.id) AS total_steps,
       SUM(pwr.status = 'completed') AS completed_steps,
       MAX(pwr.completed_at) AS last_pick_at,
       TIMESTAMPDIFF(MINUTE, pw.created_at, MAX(pwr.completed_at)) AS duration_minutes
     FROM picking_waves pw
     LEFT JOIN picking_wave_items pwi ON pwi.wave_id = pw.id
     LEFT JOIN picking_wave_routes pwr ON pwr.wave_id = pw.id
     WHERE pw.status != 5 ${dateCond}
     GROUP BY pw.id, pw.wave_no, pw.status, pw.task_count,
              pw.operator_name, pw.created_at, pw.updated_at
     ORDER BY pw.created_at DESC
     LIMIT 100`,
    dateParams,
  )

  return { summary, rows }
}

async function fetchWarehouseOpsRows() {
  const today = new Date().toISOString().slice(0, 10)
  const todayShipped = await fetchOne(
    `SELECT COUNT(*) AS shipped_count
     FROM warehouse_tasks
     WHERE status = 5 AND DATE(updated_at) = ?`,
    [today],
  ).catch(() => ({ shipped_count: 0 }))
  const todayPicking = await fetchOne(
    `SELECT COUNT(*) AS picking_count
     FROM warehouse_tasks WHERE status IN (2,3,4)`,
  ).catch(() => ({ picking_count: 0 }))
  const todayInbound = await fetchOne(
    `SELECT COUNT(*) AS inbound_count
     FROM inbound_tasks
     WHERE status = 3 AND DATE(updated_at) = ?`,
    [today],
  ).catch(() => ({ inbound_count: 0 }))
  const scanSummary = await fetchOne(
    `SELECT COUNT(*) AS scan_count, COALESCE(SUM(qty),0) AS pick_qty
     FROM scan_logs WHERE DATE(scanned_at) = ?`,
    [today],
  ).catch(() => ({ scan_count: 0, pick_qty: 0 }))
  const errSummary = await fetchOne(
    `SELECT COUNT(*) AS error_count
     FROM pda_error_logs WHERE DATE(created_at) = ?`,
    [today],
  ).catch(() => ({ error_count: 0 }))
  const undoSummary = await fetchOne(
    `SELECT COUNT(*) AS undo_count
     FROM pda_undo_logs WHERE DATE(created_at) = ?`,
    [today],
  ).catch(() => ({ undo_count: 0 }))
  const byOperator = await fetchMany(
    `SELECT
       sl.operator_id AS operatorId,
       sl.operator_name AS operatorName,
       COUNT(*) AS scanCount,
       COALESCE(SUM(sl.qty), 0) AS pickQty,
       MIN(sl.scanned_at) AS firstScan,
       MAX(sl.scanned_at) AS lastScan
     FROM scan_logs sl
     WHERE DATE(sl.scanned_at) = ? AND sl.operator_id IS NOT NULL
     GROUP BY sl.operator_id, sl.operator_name
     ORDER BY scanCount DESC LIMIT 20`,
    [today],
  ).catch(() => [])
  const errByOp = await fetchMany(
    `SELECT operator_id AS operatorId, COUNT(*) AS errCount
     FROM pda_error_logs WHERE DATE(created_at) = ?
     GROUP BY operator_id`,
    [today],
  ).catch(() => [])
  const flowRows = await fetchMany(
    `SELECT status, COUNT(*) AS cnt
     FROM warehouse_tasks
     WHERE status IN (1,2,3,4,5)
     GROUP BY status`,
  ).catch(() => [])
  const hourlyRows = await fetchMany(
    `SELECT HOUR(scanned_at) AS hr, COUNT(*) AS cnt
     FROM scan_logs
     WHERE DATE(scanned_at) = ?
     GROUP BY HOUR(scanned_at) ORDER BY hr ASC`,
    [today],
  ).catch(() => [])
  const recentErrors = await fetchMany(
    `SELECT id, task_id AS taskId, barcode, reason, operator_name AS operatorName, created_at AS createdAt
     FROM pda_error_logs
     ORDER BY created_at DESC LIMIT 10`,
  ).catch(() => [])
  return {
    today,
    todayShipped,
    todayPicking,
    todayInbound,
    scanSummary,
    errSummary,
    undoSummary,
    byOperator,
    errByOp,
    flowRows,
    hourlyRows,
    recentErrors,
  }
}

async function fetchRoleWorkbenchRows({ thresholds, highRiskWindowHours }) {
  return {
    pendingReceiveCount: await fetchOne(
      `SELECT COUNT(*) AS count
       FROM inbound_tasks
       WHERE deleted_at IS NULL AND status IN (1, 2)`,
    ),
    pendingReceiveRows: await fetchMany(
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
    ),
    waitingPutawayCount: await fetchOne(
      `SELECT COUNT(*) AS count
       FROM inventory_containers
       WHERE deleted_at IS NULL
         AND status = 0
         AND inbound_task_id IS NOT NULL`,
    ),
    waitingPutawayRows: await fetchMany(
      `SELECT c.id,
              c.barcode AS title,
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
    ),
    pendingAuditCount: await fetchOne(
      `SELECT COUNT(*) AS count
       FROM inbound_tasks
       WHERE deleted_at IS NULL
         AND status = 4
         AND audit_status = 0`,
    ),
    pendingAuditRows: await fetchMany(
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
    ),
    printFailureCount: await fetchOne(
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
    ),
    printFailureRows: await fetchMany(
      `SELECT c.inbound_task_id AS id,
              COALESCE(t.task_no, '收货任务') AS title,
              CONCAT(COALESCE(c.barcode, '库存条码'), ' · ', COALESCE(j.status, 'queued')) AS subtitle,
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
    ),
    pendingShipCount: await fetchOne(
      `SELECT COUNT(*) AS count
       FROM sale_orders
       WHERE deleted_at IS NULL AND status IN (2, 3)`,
    ),
    pendingShipRows: await fetchMany(
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
    ),
    saleAnomalyCount: await fetchOne(
      `SELECT COUNT(DISTINCT related_id) AS count
       FROM system_health_logs
       WHERE created_at >= NOW() - INTERVAL ? HOUR
         AND severity IN ('high', 'danger')
         AND related_table = 'sale_orders'`,
      [highRiskWindowHours],
    ),
    saleAnomalyRows: await fetchMany(
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
    ),
    belowCostCount: await fetchOne(
      `SELECT COUNT(DISTINCT o.id) AS count
       FROM sale_orders o
       INNER JOIN sale_order_items soi ON soi.order_id = o.id
       INNER JOIN product_items p ON p.id = soi.product_id
       WHERE o.deleted_at IS NULL
         AND o.status != 5
         AND p.cost_price IS NOT NULL
         AND p.cost_price > 0
         AND soi.unit_price < p.cost_price`,
    ),
    belowCostRows: await fetchMany(
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
    ),
    inventoryAnomalyCount: await fetchOne(
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
    ),
    inventoryAnomalyRows: await fetchMany(
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
    ),
    highRiskCount: await fetchOne(
      `SELECT COUNT(*) AS count
       FROM system_health_logs
       WHERE created_at >= NOW() - INTERVAL ? HOUR
         AND severity IN ('high', 'danger', 'fix_failed')`,
      [highRiskWindowHours],
    ),
    highRiskRows: await fetchMany(
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
    ),
  }
}

async function fetchReconciliationRows({ type = 1, startDate = null, endDate = null, keyword = '', status = null, page = 1, pageSize = 20 } = {}) {
  const typeNum = Number(type) === 2 ? 2 : 1
  const dateFilter = buildDateFilter('pr.created_at', startDate, endDate)
  const conds = ['pr.type = ?']
  const params = [typeNum]
  if (status) {
    conds.push('pr.status = ?')
    params.push(Number(status))
  }
  if (keyword && String(keyword).trim()) {
    conds.push('(pr.order_no LIKE ? OR pr.party_name LIKE ?)')
    const like = `%${String(keyword).trim()}%`
    params.push(like, like)
  }
  if (dateFilter.sql) {
    conds.push(dateFilter.sql.replace(/^ AND /, '').trim())
    params.push(...dateFilter.params)
  }
  const where = `WHERE ${conds.join(' AND ')}`
  const pageNum = Math.max(1, Number(page) || 1)
  const pageSizeNum = Math.max(1, Math.min(200, Number(pageSize) || 20))
  const offset = (pageNum - 1) * pageSizeNum

  const summaryRow = await fetchOne(
    `SELECT
       COUNT(*) AS totalRecords,
       COALESCE(SUM(pr.total_amount), 0) AS totalAmount,
       COALESCE(SUM(pr.paid_amount), 0) AS paidAmount,
       COALESCE(SUM(pr.balance), 0) AS balance,
       COALESCE(SUM(CASE WHEN pr.status IN (1,2) AND pr.due_date IS NOT NULL AND pr.due_date < CURDATE() THEN 1 ELSE 0 END), 0) AS overdueCount,
       COALESCE(SUM(CASE WHEN pr.status IN (1,2) THEN 1 ELSE 0 END), 0) AS pendingCount
     FROM payment_records pr
     ${where}`,
    params,
  )

  const countRow = await fetchOne(`SELECT COUNT(*) AS total FROM payment_records pr ${where}`, params)

  const rows = await fetchMany(
    `SELECT
       pr.id,
       pr.type,
       pr.order_id,
       pr.order_no,
       pr.party_name,
       pr.total_amount,
       pr.paid_amount,
       pr.balance,
       pr.status,
       pr.due_date,
       pr.remark,
       pr.created_at,
       CASE pr.type WHEN 1 THEN '供应商对账单' ELSE '客户对账单' END AS statement_name,
       CASE pr.status WHEN 1 THEN '未付' WHEN 2 THEN '部分付' WHEN 3 THEN '已付清' ELSE '未知' END AS status_name,
       CASE
         WHEN pr.type = 1 AND po.id IS NOT NULL THEN po.id
         WHEN pr.type = 2 AND so.id IS NOT NULL THEN so.id
         ELSE NULL
       END AS source_order_id,
       CASE
         WHEN pr.type = 1 AND po.id IS NOT NULL THEN po.order_no
         WHEN pr.type = 2 AND so.id IS NOT NULL THEN so.order_no
         ELSE pr.order_no
       END AS source_order_no,
       CASE
         WHEN pr.type = 1 AND po.id IS NOT NULL THEN CONCAT('/purchase/', po.id)
         WHEN pr.type = 2 AND so.id IS NOT NULL THEN CONCAT('/sale/', so.id)
         ELSE NULL
       END AS source_path,
       lt.id AS receipt_task_id,
       lt.task_no AS receipt_task_no,
       CASE WHEN pr.type = 1 AND lt.id IS NOT NULL THEN CONCAT('/inbound-tasks/', lt.id) ELSE NULL END AS receipt_path
     FROM payment_records pr
     LEFT JOIN purchase_orders po
       ON pr.type = 1
      AND po.id = pr.order_id
      AND po.deleted_at IS NULL
     LEFT JOIN sale_orders so
       ON pr.type = 2
      AND so.id = pr.order_id
      AND so.deleted_at IS NULL
     LEFT JOIN (
       SELECT purchase_order_id, MAX(id) AS task_id
       FROM inbound_tasks
       WHERE deleted_at IS NULL AND purchase_order_id IS NOT NULL
       GROUP BY purchase_order_id
     ) task_map ON pr.type = 1 AND task_map.purchase_order_id = pr.order_id
     LEFT JOIN inbound_tasks lt ON lt.id = task_map.task_id
     ${where}
     ORDER BY
       CASE WHEN pr.status IN (1, 2) THEN 0 ELSE 1 END ASC,
       CASE WHEN pr.status IN (1, 2) AND pr.due_date IS NOT NULL AND pr.due_date < CURDATE() THEN 0 ELSE 1 END ASC,
       CASE WHEN pr.due_date IS NULL THEN 1 ELSE 0 END ASC,
       pr.due_date ASC,
       pr.created_at DESC,
       pr.id DESC
     LIMIT ? OFFSET ?`,
    [...params, pageSizeNum, offset],
  )

  return { typeNum, pageNum, pageSizeNum, summaryRow, countRow, rows }
}

async function fetchProfitAnalysisRows({ startDate = null, endDate = null } = {}) {
  const saleDate = buildDateFilter('so.created_at', startDate, endDate)
  const saleWhere = `WHERE so.deleted_at IS NULL AND so.status = 4${saleDate.sql}`

  const summaryRow = await fetchOne(
    `SELECT
       COALESCE(SUM(so.total_amount), 0) AS saleAmount,
       COALESCE(SUM(soi.quantity * COALESCE(NULLIF(p.cost_price, 0), p.sale_price, 0)), 0) AS costAmount
     FROM sale_orders so
     INNER JOIN sale_order_items soi ON soi.order_id = so.id
     INNER JOIN product_items p ON p.id = soi.product_id
     ${saleWhere}`,
    saleDate.params,
  )

  const saleRows = await fetchMany(
    `SELECT
       so.id,
       so.order_no,
       so.customer_name,
       so.warehouse_name,
       so.total_amount,
       COALESCE(SUM(soi.quantity * COALESCE(NULLIF(p.cost_price, 0), p.sale_price, 0)), 0) AS cost_amount,
       COALESCE(SUM(soi.amount), 0) - COALESCE(SUM(soi.quantity * COALESCE(NULLIF(p.cost_price, 0), p.sale_price, 0)), 0) AS gross_profit
     FROM sale_orders so
     INNER JOIN sale_order_items soi ON soi.order_id = so.id
     INNER JOIN product_items p ON p.id = soi.product_id
     ${saleWhere}
     GROUP BY so.id, so.order_no, so.customer_name, so.warehouse_name, so.total_amount
     ORDER BY gross_profit DESC, so.created_at DESC
     LIMIT 20`,
    saleDate.params,
  )

  const productRows = await fetchMany(
    `SELECT
       p.id,
       p.code,
       p.name,
       p.unit,
       COALESCE(SUM(soi.quantity), 0) AS total_qty,
       COALESCE(SUM(soi.amount), 0) AS revenue_amount,
       COALESCE(SUM(soi.quantity * COALESCE(NULLIF(p.cost_price, 0), p.sale_price, 0)), 0) AS cost_amount,
       COALESCE(SUM(soi.amount), 0) - COALESCE(SUM(soi.quantity * COALESCE(NULLIF(p.cost_price, 0), p.sale_price, 0)), 0) AS gross_profit
     FROM sale_orders so
     INNER JOIN sale_order_items soi ON soi.order_id = so.id
     INNER JOIN product_items p ON p.id = soi.product_id
     ${saleWhere}
     GROUP BY p.id, p.code, p.name, p.unit
     ORDER BY gross_profit DESC, revenue_amount DESC
     LIMIT 20`,
    saleDate.params,
  )

  const stockRows = await fetchMany(
    `SELECT
       p.id,
       p.code,
       p.name,
       p.unit,
       w.name AS warehouse_name,
       SUM(s.quantity) AS total_qty,
       SUM(s.quantity * COALESCE(NULLIF(p.cost_price, 0), p.sale_price, 0)) AS total_value
     FROM inventory_stock s
     INNER JOIN product_items p ON p.id = s.product_id
     INNER JOIN inventory_warehouses w ON w.id = s.warehouse_id
     WHERE p.deleted_at IS NULL AND w.deleted_at IS NULL
     GROUP BY p.id, p.code, p.name, p.unit, w.name
     ORDER BY total_value DESC
     LIMIT 30`,
  )

  const slowRows = await fetchMany(
    `SELECT
       p.id,
       p.code,
       p.name,
       p.unit,
       COALESCE(st.qty, 0) AS current_qty,
       COALESCE(st.value, 0) AS stock_value,
       lo.last_outbound_at,
       COALESCE(lo.outbound_90d, 0) AS outbound_90d
     FROM product_items p
     LEFT JOIN (
       SELECT s.product_id,
              SUM(s.quantity) AS qty,
              SUM(s.quantity * COALESCE(NULLIF(p.cost_price, 0), p.sale_price, 0)) AS value
       FROM inventory_stock s
       INNER JOIN product_items p ON p.id = s.product_id
       GROUP BY s.product_id
     ) st ON st.product_id = p.id
     LEFT JOIN (
       SELECT
         product_id,
         MAX(created_at) AS last_outbound_at,
         SUM(CASE WHEN created_at >= DATE_SUB(CURDATE(), INTERVAL 90 DAY) THEN quantity ELSE 0 END) AS outbound_90d
       FROM inventory_logs
       WHERE type = 2
       GROUP BY product_id
     ) lo ON lo.product_id = p.id
     WHERE p.deleted_at IS NULL
       AND COALESCE(st.qty, 0) > 0
       AND (lo.last_outbound_at IS NULL OR lo.last_outbound_at < DATE_SUB(CURDATE(), INTERVAL 90 DAY))
     ORDER BY stock_value DESC, current_qty DESC
     LIMIT 30`,
  )

  return { summaryRow, saleRows, productRows, stockRows, slowRows }
}

module.exports = {
  fetchOne,
  fetchMany,
  fetchPurchaseStatsRows,
  fetchSaleStatsRows,
  fetchInventoryStatsRows,
  fetchPdaPerformanceRows,
  fetchWavePerformanceRows,
  fetchWarehouseOpsRows,
  fetchRoleWorkbenchRows,
  fetchReconciliationRows,
  fetchProfitAnalysisRows,
}
