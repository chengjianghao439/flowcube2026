/**
 * System Health Check Service — 系统健康巡检服务
 *
 * 每次调用 runAllChecks() 将：
 *  1. 生成一个本次巡检的唯一 run_id（UUID v4）
 *  2. 依次执行 6 项数据一致性检查
 *  3. 将所有发现的异常写入 system_health_logs
 *  4. 返回本次巡检摘要（总数 / 按严重等级分布 / 明细列表）
 *
 * 设计原则：
 *  - 只读，不修改任何业务数据
 *  - 单条检查失败不阻断后续检查（catch 独立处理）
 *  - 检查使用独立查询，不占用连接池事务
 */

const { pool } = require('../../config/db')
const { v4: uuidv4 } = require('uuid')
const { getInboundClosureThresholds } = require('../../utils/inboundThresholds')

// ─── 检查项定义 ───────────────────────────────────────────────────────────────

/**
 * CHECK-01  on_hand < 0
 * 实际库存为负数，属于严重数据损坏
 */
async function checkNegativeOnHand(conn, issues) {
  const [rows] = await conn.query(`
    SELECT s.id, s.product_id, s.warehouse_id,
           s.quantity AS on_hand,
           p.name     AS product_name,
           w.name     AS warehouse_name
    FROM inventory_stock s
    JOIN product_items        p ON p.id = s.product_id
    JOIN inventory_warehouses w ON w.id = s.warehouse_id
    WHERE s.quantity < 0
  `)
  for (const r of rows) {
    issues.push({
      checkType:    'NEGATIVE_ON_HAND',
      severity:     'high',
      relatedId:    r.id,
      relatedTable: 'inventory_stock',
      message:      `商品「${r.product_name}」在仓库「${r.warehouse_name}」的实际库存为 ${r.on_hand}（负数），数据异常。`,
    })
  }
}

/**
 * CHECK-02  reserved < 0
 * 预占数量为负数，说明 reserved 字段被错误扣减
 */
async function checkNegativeReserved(conn, issues) {
  const [rows] = await conn.query(`
    SELECT s.id, s.product_id, s.warehouse_id,
           s.reserved,
           p.name AS product_name,
           w.name AS warehouse_name
    FROM inventory_stock s
    JOIN product_items        p ON p.id = s.product_id
    JOIN inventory_warehouses w ON w.id = s.warehouse_id
    WHERE s.reserved < 0
  `)
  for (const r of rows) {
    issues.push({
      checkType:    'NEGATIVE_RESERVED',
      severity:     'high',
      relatedId:    r.id,
      relatedTable: 'inventory_stock',
      message:      `商品「${r.product_name}」在仓库「${r.warehouse_name}」的预占数量为 ${r.reserved}（负数），预占引擎存在 BUG。`,
    })
  }
}

/**
 * CHECK-03  on_hand < reserved（可用库存为负）
 * 实际库存不足以覆盖已预占量，表示预占与实体库存发生漂移
 */
async function checkReservedExceedsOnHand(conn, issues) {
  const [rows] = await conn.query(`
    SELECT s.id, s.product_id, s.warehouse_id,
           s.quantity  AS on_hand,
           s.reserved,
           (s.quantity - s.reserved) AS available,
           p.name AS product_name,
           w.name AS warehouse_name
    FROM inventory_stock s
    JOIN product_items        p ON p.id = s.product_id
    JOIN inventory_warehouses w ON w.id = s.warehouse_id
    WHERE s.quantity < s.reserved
  `)
  for (const r of rows) {
    issues.push({
      checkType:    'RESERVED_EXCEEDS_ON_HAND',
      severity:     'high',
      relatedId:    r.id,
      relatedTable: 'inventory_stock',
      message:
        `商品「${r.product_name}」在仓库「${r.warehouse_name}」库存漂移：` +
        `实际库存 ${r.on_hand}，已预占 ${r.reserved}，可用库存 ${r.available}（负数）。` +
        `受影响的已确认销售单将无法正常出库。`,
    })
  }
}

/**
 * CHECK-04  sale_orders.status IN (2,3)（已确认/待出库）但无活跃预占记录
 * 销售单已确认或已备货完成，按设计应在 stock_reservations 中有 status=1 的记录
 * 若缺失，说明该批货物未被锁定，存在超卖风险
 */
async function checkConfirmedSaleWithoutReservation(conn, issues) {
  const [rows] = await conn.query(`
    SELECT o.id, o.order_no, o.customer_name, o.total_amount, o.created_at
    FROM sale_orders o
    WHERE o.status IN (2, 3)
      AND o.deleted_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM stock_reservations sr
        WHERE sr.ref_type = 'sale_order'
          AND sr.ref_id   = o.id
          AND sr.status   = 1
      )
  `)
  for (const r of rows) {
    issues.push({
      checkType:    'CONFIRMED_SALE_NO_RESERVATION',
      severity:     'high',
      relatedId:    r.id,
      relatedTable: 'sale_orders',
      message:
        `销售单「${r.order_no}」（客户：${r.customer_name}）状态为已确认，` +
        `但在 stock_reservations 中找不到任何活跃预占记录。` +
        `对应库存未被锁定，存在超卖风险。`,
    })
  }
}

/**
 * CHECK-05  stock_reservations.status=1 但关联的 sale_orders 不存在或已取消
 * 预占记录处于活跃状态，但销售单已消失或已取消，属于"幽灵预占"
 * 会导致可用库存被永久锁占
 */
async function checkOrphanedReservations(conn, issues) {
  const [rows] = await conn.query(`
    SELECT sr.id, sr.ref_id AS sale_order_id, sr.ref_no,
           sr.product_id, sr.warehouse_id, sr.qty,
           o.status AS sale_status,
           p.name   AS product_name,
           w.name   AS warehouse_name
    FROM stock_reservations sr
    LEFT JOIN sale_orders           o ON o.id = sr.ref_id
    LEFT JOIN product_items         p ON p.id = sr.product_id
    LEFT JOIN inventory_warehouses  w ON w.id = sr.warehouse_id
    WHERE sr.ref_type = 'sale_order'
      AND sr.status   = 1
      AND (o.id IS NULL OR o.status = 5)
  `)
  for (const r of rows) {
    const reason = r.sale_status === null ? '销售单不存在' : `销售单已取消（status=5）`
    issues.push({
      checkType:    'ORPHANED_RESERVATION',
      severity:     'medium',
      relatedId:    r.id,
      relatedTable: 'stock_reservations',
      message:
        `预占记录 #${r.id}（销售单 ${r.ref_no}）仍处于活跃状态，但${reason}。` +
        `商品「${r.product_name ?? r.product_id}」在仓库「${r.warehouse_name ?? r.warehouse_id}」` +
        `有 ${r.qty} 件库存被无效锁占。`,
    })
  }
}

/**
 * CHECK-07  LONG_PENDING_RESERVATION（预占超过 7 天未履行）
 * stock_reservations.status=1 且 created_at 超过 7 天
 * 正常业务中 7 天内应完成出库；超期意味着销售单长期卡在已确认状态
 */
async function checkLongPendingReservations(conn, issues) {
  const [rows] = await conn.query(`
    SELECT sr.id, sr.ref_no, sr.qty, sr.created_at,
           sr.product_id, sr.warehouse_id,
           TIMESTAMPDIFF(DAY, sr.created_at, NOW()) AS pending_days,
           p.name AS product_name,
           w.name AS warehouse_name,
           o.order_no, o.customer_name
    FROM stock_reservations sr
    LEFT JOIN product_items         p ON p.id = sr.product_id
    LEFT JOIN inventory_warehouses  w ON w.id = sr.warehouse_id
    LEFT JOIN sale_orders           o ON o.id = sr.ref_id AND sr.ref_type = 'sale_order'
    WHERE sr.status = 1
      AND sr.created_at < DATE_SUB(NOW(), INTERVAL 7 DAY)
    ORDER BY sr.created_at ASC
  `)
  for (const r of rows) {
    issues.push({
      checkType:    'LONG_PENDING_RESERVATION',
      severity:     'medium',
      relatedId:    r.id,
      relatedTable: 'stock_reservations',
      message:
        `预占记录 #${r.id}（销售单 ${r.ref_no ?? r.order_no}` +
        `${r.customer_name ? `，客户：${r.customer_name}` : ''}）` +
        `已超过 ${r.pending_days} 天未履行。` +
        `商品「${r.product_name ?? r.product_id}」` +
        `在仓库「${r.warehouse_name ?? r.warehouse_id}」` +
        `有 ${r.qty} 件库存被长期锁占，` +
        `预占创建时间：${r.created_at}。`,
    })
  }
}

/**
 * CHECK-08  HIGH_PRIORITY_TASK_DELAY（紧急任务超过 24 小时未出库）
 * warehouse_tasks.priority=1（紧急）且 status 未到达已出库（4）或已取消（5）
 * 且任务创建超过 24 小时
 */
async function checkHighPriorityTaskDelay(conn, issues) {
  const [rows] = await conn.query(`
    SELECT t.id AS task_id, t.task_no, t.status,
           t.created_at,
           TIMESTAMPDIFF(HOUR, t.created_at, NOW()) AS delay_hours,
           t.sale_order_id, o.order_no, o.customer_name
    FROM warehouse_tasks t
    LEFT JOIN sale_orders o ON o.id = t.sale_order_id
    WHERE t.priority = 1
      AND t.status NOT IN (7, 8)
      AND t.created_at < DATE_SUB(NOW(), INTERVAL 24 HOUR)
    ORDER BY t.created_at ASC
  `)
  const STATUS_LABEL = { 2: '拣货中', 3: '待分拣', 4: '待复核', 5: '待打包', 6: '待出库' }
  for (const r of rows) {
    issues.push({
      checkType:    'HIGH_PRIORITY_TASK_DELAY',
      severity:     'high',
      relatedId:    r.task_id,
      relatedTable: 'warehouse_tasks',
      message:
        `紧急任务「${r.task_no}」已超过 ${r.delay_hours} 小时未完成出库，` +
        `当前状态：${STATUS_LABEL[r.status] ?? r.status}。` +
        `${r.order_no ? `关联销售单：${r.order_no}` : ''}` +
        `${r.customer_name ? `，客户：${r.customer_name}` : ''}。` +
        `任务创建时间：${r.created_at}。`,
    })
  }
}

/**
 * CHECK-06  warehouse_tasks.status=4（已出库）但关联 sale_orders 不是 status=4
 * 仓库任务已标记出库，按设计销售单应同步更新为已出库（status=4）
 * 若两者状态不一致，属于事务同步失败
 */
async function checkShippedTaskWithUnsyncedSaleOrder(conn, issues) {
  const [rows] = await conn.query(`
    SELECT t.id AS task_id, t.task_no,
           t.sale_order_id, o.order_no,
           o.status      AS sale_status,
           o.customer_name
    FROM warehouse_tasks t
    LEFT JOIN sale_orders o ON o.id = t.sale_order_id
    WHERE t.status = 7
      AND (o.id IS NULL OR o.status != 4)
  `)
  for (const r of rows) {
    const reason = r.sale_status === null
      ? '关联销售单不存在'
      : `销售单状态为 ${r.sale_status}（期望 4-已出库）`
    issues.push({
      checkType:    'SHIPPED_TASK_UNSYNCED_SALE',
      severity:     'medium',
      relatedId:    r.task_id,
      relatedTable: 'warehouse_tasks',
      message:
        `仓库任务「${r.task_no}」已标记出库（status=4），但${reason}。` +
        `${r.order_no ? `关联销售单：${r.order_no}` : ''}` +
        `${r.customer_name ? `，客户：${r.customer_name}` : ''}。` +
        `可能是事务同步失败，需人工核查。`,
    })
  }
}

/**
 * CHECK-09  STALE_PICKING_TASK（拣货中超过 8 小时未推进）
 * warehouse_tasks.status=2（拣货中）且 updated_at 超过 8 小时
 * 正常拣货应在 2-4 小时内完成；超期说明 PDA 可能离线或任务被遗忘
 */
async function checkStalePickingTask(conn, issues) {
  const [rows] = await conn.query(`
    SELECT t.id, t.task_no, t.customer_name, t.assigned_name,
           t.updated_at, t.created_at,
           TIMESTAMPDIFF(HOUR, t.updated_at, NOW()) AS stale_hours
    FROM warehouse_tasks t
    WHERE t.status = 2
      AND t.updated_at < DATE_SUB(NOW(), INTERVAL 8 HOUR)
      AND t.deleted_at IS NULL
    ORDER BY t.updated_at ASC
  `)
  for (const r of rows) {
    issues.push({
      checkType:    'STALE_PICKING_TASK',
      severity:     'medium',
      relatedId:    r.id,
      relatedTable: 'warehouse_tasks',
      message:
        `拣货任务「${r.task_no}」（客户：${r.customer_name}）` +
        `已超过 ${r.stale_hours} 小时未有进展，` +
        `当前状态：拣货中，` +
        `负责人：${r.assigned_name ?? '未分配'}，` +
        `最后更新：${r.updated_at}。`,
    })
  }
}

/**
 * CHECK-10  STALE_SORTING_TASK（待分拣超过 4 小时未推进）
 * warehouse_tasks.status=3（待分拣）且 updated_at 超过 4 小时
 * 分拣格已被占用；长期不推进会导致分拣格资源持续锁占
 */
async function checkStaleSortingTask(conn, issues) {
  const [rows] = await conn.query(`
    SELECT t.id, t.task_no, t.customer_name,
           t.sorting_bin_code, t.updated_at,
           TIMESTAMPDIFF(HOUR, t.updated_at, NOW()) AS stale_hours
    FROM warehouse_tasks t
    WHERE t.status = 3
      AND t.updated_at < DATE_SUB(NOW(), INTERVAL 4 HOUR)
      AND t.deleted_at IS NULL
    ORDER BY t.updated_at ASC
  `)
  for (const r of rows) {
    issues.push({
      checkType:    'STALE_SORTING_TASK',
      severity:     'medium',
      relatedId:    r.id,
      relatedTable: 'warehouse_tasks',
      message:
        `分拣任务「${r.task_no}」（客户：${r.customer_name}）` +
        `已超过 ${r.stale_hours} 小时停留在「待分拣」阶段，` +
        `占用分拣格：${r.sorting_bin_code ?? '无'}，` +
        `最后更新：${r.updated_at}。分拣格长期占用会阻塞新任务。`,
    })
  }
}

/**
 * CHECK-11  TASK_ITEMS_EMPTY（任务明细为空，无法拣货）
 * warehouse_tasks.status IN (2,3,4,5) 但 warehouse_task_items 中无记录
 * 任务缺少明细将导致拣货/分拣/复核无法执行
 */
async function checkTaskWithNoItems(conn, issues) {
  const [rows] = await conn.query(`
    SELECT t.id, t.task_no, t.customer_name, t.status
    FROM warehouse_tasks t
    WHERE t.status IN (2, 3, 4, 5)
      AND t.deleted_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM warehouse_task_items wti WHERE wti.task_id = t.id
      )
  `)
  const STATUS_NAME = { 2: '拣货中', 3: '待分拣', 4: '待复核', 5: '待打包' }
  for (const r of rows) {
    issues.push({
      checkType:    'TASK_ITEMS_EMPTY',
      severity:     'high',
      relatedId:    r.id,
      relatedTable: 'warehouse_tasks',
      message:
        `任务「${r.task_no}」（客户：${r.customer_name}）` +
        `当前状态「${STATUS_NAME[r.status] ?? r.status}」，` +
        `但 warehouse_task_items 中没有任何明细记录，` +
        `流程无法正常推进。`,
    })
  }
}

/**
 * CHECK-12  SORTED_QTY_EXCEEDS_PICKED_QTY（分拣数量超出拣货数量）
 * warehouse_task_items.sorted_qty > picked_qty
 * 属于数据异常，sorted_qty 不应超过 picked_qty
 */
async function checkSortedQtyOverflow(conn, issues) {
  const [rows] = await conn.query(`
    SELECT wti.id, wti.task_id, wti.product_code, wti.product_name,
           wti.picked_qty, wti.sorted_qty,
           t.task_no, t.customer_name
    FROM warehouse_task_items wti
    JOIN warehouse_tasks t ON t.id = wti.task_id
    WHERE wti.sorted_qty > wti.picked_qty
      AND t.deleted_at IS NULL
  `)
  for (const r of rows) {
    issues.push({
      checkType:    'SORTED_QTY_OVERFLOW',
      severity:     'high',
      relatedId:    r.id,
      relatedTable: 'warehouse_task_items',
      message:
        `任务「${r.task_no}」（客户：${r.customer_name}）` +
        `商品「${r.product_name}（${r.product_code}）」` +
        `分拣数量 ${r.sorted_qty} 超出拣货数量 ${r.picked_qty}，数据异常。`,
    })
  }
}

/**
 * CHECK-13  ORPHANED_SORTING_BIN（分拣格被占用但关联任务已完结）
 * sorting_bins.status=2（占用）但 current_task_id 对应任务状态为已出库/已取消
 * 分拣格未被正常释放，会永久阻塞新任务分配
 */
async function checkOrphanedSortingBin(conn, issues) {
  const [rows] = await conn.query(`
    SELECT sb.id, sb.code, sb.warehouse_id,
           sb.current_task_id,
           t.task_no, t.status AS task_status,
           wh.name AS warehouse_name
    FROM sorting_bins sb
    LEFT JOIN warehouse_tasks      t  ON t.id  = sb.current_task_id
    LEFT JOIN inventory_warehouses wh ON wh.id = sb.warehouse_id
    WHERE sb.status = 2
      AND (
        sb.current_task_id IS NULL
        OR t.status IN (7, 8)
      )
  `)
  for (const r of rows) {
    const reason = r.current_task_id === null
      ? '关联任务 ID 为空'
      : `关联任务「${r.task_no}」已${r.task_status === 7 ? '出库' : '取消'}`
    issues.push({
      checkType:    'ORPHANED_SORTING_BIN',
      severity:     'high',
      relatedId:    r.id,
      relatedTable: 'sorting_bins',
      message:
        `分拣格「${r.code}」（仓库：${r.warehouse_name ?? r.warehouse_id}）` +
        `显示占用状态，但${reason}，分拣格未被正确释放。` +
        `这会永久阻塞该仓库的新任务分拣格分配，需人工强制释放。`,
    })
  }
}

/**
 * CHECK-14  ORPHANED_CONTAINER_LOCK（容器被锁定但关联任务已完结）
 * inventory_containers.locked_by_task_id 不为空，但关联任务状态为已出库/已取消
 * 孤立容器锁会导致该容器的库存无法被其他任务使用
 */
async function checkOrphanedContainerLock(conn, issues) {
  const [rows] = await conn.query(`
    SELECT ic.id, ic.barcode, ic.product_id, ic.warehouse_id,
           ic.locked_by_task_id, ic.locked_at,
           ic.remaining_qty,
           t.task_no, t.status AS task_status,
           p.name  AS product_name,
           w.name  AS warehouse_name,
           TIMESTAMPDIFF(HOUR, ic.locked_at, NOW()) AS locked_hours
    FROM inventory_containers ic
    LEFT JOIN warehouse_tasks      t  ON t.id  = ic.locked_by_task_id
    LEFT JOIN product_items        p  ON p.id  = ic.product_id
    LEFT JOIN inventory_warehouses w  ON w.id  = ic.warehouse_id
    WHERE ic.locked_by_task_id IS NOT NULL
      AND (
        t.id IS NULL
        OR t.status IN (7, 8)
      )
      AND ic.deleted_at IS NULL
  `)
  for (const r of rows) {
    const reason = r.task_status === null
      ? '关联任务不存在'
      : `关联任务「${r.task_no}」已${r.task_status === 7 ? '出库' : '取消'}`
    issues.push({
      checkType:    'ORPHANED_CONTAINER_LOCK',
      severity:     'high',
      relatedId:    r.id,
      relatedTable: 'inventory_containers',
      message:
        `容器「${r.barcode}」（商品：${r.product_name ?? r.product_id}，` +
        `仓库：${r.warehouse_name ?? r.warehouse_id}，` +
        `剩余数量：${r.remaining_qty}）` +
        `仍被锁定（已锁 ${r.locked_hours ?? '?'} 小时），但${reason}。` +
        `孤立容器锁会导致该库存无法被新任务使用。`,
    })
  }
}

async function checkInboundPrintFailures(conn, issues, thresholds) {
  const [rows] = await conn.query(
    `SELECT DISTINCT
        t.id,
        t.task_no,
        t.supplier_name,
        MAX(j.updated_at) AS latest_print_at
     FROM inbound_tasks t
     INNER JOIN inventory_containers c ON c.inbound_task_id = t.id AND c.deleted_at IS NULL
     INNER JOIN print_jobs j ON j.ref_type = 'inventory_container' AND j.ref_id = c.id
     WHERE t.deleted_at IS NULL
       AND (
         (j.status = 3 AND IFNULL(j.error_message, '') <> 'no printer available')
         OR (j.status IN (0,1) AND TIMESTAMPDIFF(MINUTE, j.updated_at, NOW()) >= ?)
         OR (j.status = 3 AND IFNULL(j.error_message, '') = 'no printer available')
       )
     GROUP BY t.id, t.task_no, t.supplier_name`,
    [Number(thresholds.printTimeoutMinutes)],
  )
  for (const r of rows) {
    issues.push({
      checkType: 'INBOUND_PRINT_FAILED',
      severity: 'warning',
      relatedId: r.id,
      relatedTable: 'inbound_tasks',
      message: `收货订单「${r.task_no}」（供应商：${r.supplier_name || '—'}）存在打印失败或超时待确认的库存条码，请尽快补打或确认状态。`,
    })
  }
}

async function checkInboundPutawayTimeout(conn, issues, thresholds) {
  const [rows] = await conn.query(
    `SELECT
        t.id,
        t.task_no,
        t.supplier_name,
        COUNT(*) AS overdue_count
     FROM inbound_tasks t
     INNER JOIN inventory_containers c ON c.inbound_task_id = t.id
     WHERE t.deleted_at IS NULL
       AND c.deleted_at IS NULL
       AND c.status = 0
       AND (
         (c.putaway_deadline_at IS NOT NULL AND c.putaway_deadline_at < NOW())
         OR (c.putaway_deadline_at IS NULL AND TIMESTAMPDIFF(HOUR, c.created_at, NOW()) >= ?)
       )
     GROUP BY t.id, t.task_no, t.supplier_name`,
    [Number(thresholds.putawayTimeoutHours)],
  )
  for (const r of rows) {
    issues.push({
      checkType: 'INBOUND_PUTAWAY_TIMEOUT',
      severity: 'warning',
      relatedId: r.id,
      relatedTable: 'inbound_tasks',
      message: `收货订单「${r.task_no}」（供应商：${r.supplier_name || '—'}）有 ${r.overdue_count} 箱已打印未上架超时，请尽快处理。`,
    })
  }
}

async function checkInboundAuditTimeout(conn, issues, thresholds) {
  const [rows] = await conn.query(
    `SELECT id, task_no, supplier_name
     FROM inbound_tasks
     WHERE deleted_at IS NULL
       AND status = 4
       AND audit_status = 0
       AND TIMESTAMPDIFF(HOUR, updated_at, NOW()) >= ?`,
    [Number(thresholds.auditTimeoutHours)],
  )
  for (const r of rows) {
    issues.push({
      checkType: 'INBOUND_AUDIT_TIMEOUT',
      severity: 'warning',
      relatedId: r.id,
      relatedTable: 'inbound_tasks',
      message: `收货订单「${r.task_no}」（供应商：${r.supplier_name || '—'}）已上架完成但审核超时，请尽快审核。`,
    })
  }
}



async function saveIssues(conn, runId, issues) {
  if (!issues.length) return
  const values = issues.map(i => [
    runId,
    i.checkType,
    i.severity,
    i.relatedId    ?? null,
    i.relatedTable ?? null,
    i.message,
  ])
  await conn.query(
    `INSERT INTO system_health_logs
       (run_id, check_type, severity, related_id, related_table, message)
     VALUES ?`,
    [values]
  )
}

// ─── 写入巡检摘要 ─────────────────────────────────────────────────────────────

async function saveRunSummary(conn, { runId, triggeredBy, startedAt, elapsedMs, summary, hasHigh, errors }) {
  await conn.query(
    `INSERT INTO system_health_runs
       (run_id, triggered_by, started_at, elapsed_ms,
        total_issues, high_count, medium_count, low_count,
        has_high, check_errors)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [
      runId,
      triggeredBy,
      new Date(startedAt),
      elapsedMs,
      summary.high + summary.medium + summary.low,
      summary.high,
      summary.medium,
      summary.low,
      hasHigh ? 1 : 0,
      errors.length ? JSON.stringify(errors) : null,
    ]
  )
}

// ─── 主入口 ──────────────────────────────────────────────────────────────────

/**
 * 执行所有巡检项，写库，返回本次摘要
 * @param {'manual'|'scheduler'} triggeredBy  触发来源，默认 'manual'
 */
async function runAllChecks(triggeredBy = 'manual') {
  const runId   = uuidv4()
  const startAt = Date.now()
  const issues  = []
  const errors  = []
  const inboundThresholds = await getInboundClosureThresholds()

  const conn = await pool.getConnection()
  try {
    const checks = [
      { name: 'NEGATIVE_ON_HAND',                fn: checkNegativeOnHand },
      { name: 'NEGATIVE_RESERVED',               fn: checkNegativeReserved },
      { name: 'RESERVED_EXCEEDS_ON_HAND',        fn: checkReservedExceedsOnHand },
      { name: 'CONFIRMED_SALE_NO_RESERVATION',   fn: checkConfirmedSaleWithoutReservation },
      { name: 'ORPHANED_RESERVATION',            fn: checkOrphanedReservations },
      { name: 'SHIPPED_TASK_UNSYNCED_SALE',      fn: checkShippedTaskWithUnsyncedSaleOrder },
      { name: 'LONG_PENDING_RESERVATION',        fn: checkLongPendingReservations },
      { name: 'HIGH_PRIORITY_TASK_DELAY',        fn: checkHighPriorityTaskDelay },
      // ─── 仓库任务流程健康检查 ────────────────────────────────────────────
      { name: 'STALE_PICKING_TASK',              fn: checkStalePickingTask },
      { name: 'STALE_SORTING_TASK',              fn: checkStaleSortingTask },
      { name: 'TASK_ITEMS_EMPTY',                fn: checkTaskWithNoItems },
      { name: 'SORTED_QTY_OVERFLOW',             fn: checkSortedQtyOverflow },
      { name: 'ORPHANED_SORTING_BIN',            fn: checkOrphanedSortingBin },
      { name: 'ORPHANED_CONTAINER_LOCK',         fn: checkOrphanedContainerLock },
      { name: 'INBOUND_PRINT_FAILED',            fn: (db, list) => checkInboundPrintFailures(db, list, inboundThresholds) },
      { name: 'INBOUND_PUTAWAY_TIMEOUT',         fn: (db, list) => checkInboundPutawayTimeout(db, list, inboundThresholds) },
      { name: 'INBOUND_AUDIT_TIMEOUT',           fn: (db, list) => checkInboundAuditTimeout(db, list, inboundThresholds) },
    ]

    for (const { name, fn } of checks) {
      try {
        await fn(conn, issues)
      } catch (err) {
        errors.push({ checkType: name, error: err.message })
      }
    }

    // ─── 持久化 ──────────────────────────────────────────────────────────────
    const elapsedMs = Date.now() - startAt
    const summary   = { high: 0, medium: 0, low: 0 }
    for (const i of issues) summary[i.severity] = (summary[i.severity] || 0) + 1
    const hasHigh = summary.high > 0

    await saveIssues(conn, runId, issues)
    await saveRunSummary(conn, { runId, triggeredBy, startedAt: startAt, elapsedMs, summary, hasHigh, errors })

    return {
      runId,
      triggeredBy,
      checkedAt:   new Date(startAt).toISOString(),
      elapsedMs,
      healthy:     issues.length === 0 && errors.length === 0,
      hasHigh,
      totalIssues: issues.length,
      severity:    summary,
      issues:      issues.map(i => ({
        checkType:    i.checkType,
        severity:     i.severity,
        relatedId:    i.relatedId    ?? null,
        relatedTable: i.relatedTable ?? null,
        message:      i.message,
      })),
      checkErrors: errors,
    }
  } finally {
    conn.release()
  }
}

// ─── 历史查询 ─────────────────────────────────────────────────────────────────

/**
 * 获取历史巡检日志明细（按 created_at 降序）
 */
async function getRecentLogs(limit = 100) {
  const [rows] = await pool.query(
    `SELECT id, run_id, check_type, severity, related_id, related_table, message, created_at
     FROM system_health_logs
     ORDER BY created_at DESC
     LIMIT ?`,
    [limit]
  )
  return rows
}

/**
 * 获取最近 N 次巡检摘要（从 system_health_runs 表读取，含 elapsedMs / hasHigh）
 */
async function getRunSummaries(limit = 20) {
  const [rows] = await pool.query(
    `SELECT run_id, triggered_by, started_at, elapsed_ms,
            total_issues, high_count, medium_count, low_count, has_high
     FROM system_health_runs
     ORDER BY started_at DESC
     LIMIT ?`,
    [limit]
  )
  return rows.map(r => ({
    runId:       r.run_id,
    triggeredBy: r.triggered_by,
    checkedAt:   r.started_at,
    elapsedMs:   r.elapsed_ms,
    totalIssues: Number(r.total_issues),
    hasHigh:     Boolean(r.has_high),
    severity: {
      high:   Number(r.high_count),
      medium: Number(r.medium_count),
      low:    Number(r.low_count),
    },
  }))
}

module.exports = { runAllChecks, getRecentLogs, getRunSummaries }
