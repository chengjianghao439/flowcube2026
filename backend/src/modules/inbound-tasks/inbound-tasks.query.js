const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const logger = require('../../utils/logger')
const { CONTAINER_STATUS } = require('../../engine/containerEngine')
const { getInboundClosureThresholds } = require('../../utils/inboundThresholds')
const {
  appendInboundEvent,
  parseJson,
  fmtTask,
  fmtItem,
  fmtPurchasableItem,
  fmtContainer,
} = require('./inbound-tasks.helpers')
const {
  DEFAULT_INBOUND_THRESHOLDS,
  buildPrintStatus,
  buildPutawayStatus,
  buildAuditStatus,
  buildExceptionFlags,
  buildReceiptStatus,
  deriveInboundPrintJobState,
  buildInboundPrintBatches,
} = require('./inbound-tasks.status')
const { EXPIRE_MESSAGE } = require('../print-jobs/print-jobs.service')

function buildTaskWithClosure(task, items = [], summary = {}, timeline = [], recentPrintJobs = [], thresholds = DEFAULT_INBOUND_THRESHOLDS) {
  const orderedQty = items.reduce((sum, item) => sum + Number(item.orderedQty || 0), 0)
  const receivedQty = items.reduce((sum, item) => sum + Number(item.receivedQty || 0), 0)
  const putawayQty = items.reduce((sum, item) => sum + Number(item.putawayQty || 0), 0)
  const printSummary = {
    total: Number(summary.totalContainers || 0),
    queued: Number(summary.queuedPrintJobs || 0),
    printing: Number(summary.printingPrintJobs || 0),
    success: Number(summary.successPrintJobs || 0),
    failed: Number(summary.failedPrintJobs || 0),
    timeout: Number(summary.timeoutPrintJobs || 0),
  }
  const putawaySummary = {
    waitingContainers: Number(summary.waitingContainers || 0),
    storedContainers: Number(summary.storedContainers || 0),
    waitingQty: Number(summary.waitingQty || 0),
    storedQty: Number(summary.storedQty || 0),
    overdueContainers: Number(summary.overdueContainers || 0),
  }
  const printBatches = buildInboundPrintBatches(recentPrintJobs)
  const base = {
    ...task,
    items,
    orderedQty,
    receivedQty,
    putawayQty,
    lineCount: items.length,
    printSummary,
    putawaySummary,
    timeline,
    recentPrintJobs,
    printBatches,
    printTimeoutMinutes: Number(thresholds.printTimeoutMinutes || DEFAULT_INBOUND_THRESHOLDS.printTimeoutMinutes),
    putawayTimeoutHours: Number(thresholds.putawayTimeoutHours || DEFAULT_INBOUND_THRESHOLDS.putawayTimeoutHours),
    auditTimeoutHours: Number(thresholds.auditTimeoutHours || DEFAULT_INBOUND_THRESHOLDS.auditTimeoutHours),
  }
  base.printStatus = buildPrintStatus(printSummary, Number(task.status) === 5)
  base.putawayStatus = buildPutawayStatus(putawaySummary, Number(task.status) === 5)
  base.auditFlowStatus = buildAuditStatus(base)
  base.exceptionFlags = buildExceptionFlags(base)
  base.receiptStatus = buildReceiptStatus(base)
  return base
}

async function loadInboundTaskClosureSummary(taskIds, thresholds = DEFAULT_INBOUND_THRESHOLDS) {
  const ids = [...new Set((taskIds || []).map(Number).filter(id => Number.isFinite(id) && id > 0))]
  if (!ids.length) return new Map()
  const placeholders = ids.map(() => '?').join(',')
  const printTimeoutMinutes = Number(thresholds.printTimeoutMinutes || DEFAULT_INBOUND_THRESHOLDS.printTimeoutMinutes)
  const putawayTimeoutHours = Number(thresholds.putawayTimeoutHours || DEFAULT_INBOUND_THRESHOLDS.putawayTimeoutHours)
  const [itemRows] = await pool.query(
    `SELECT
        task_id,
        COUNT(*) AS line_count,
        COALESCE(SUM(ordered_qty), 0) AS ordered_qty,
        COALESCE(SUM(received_qty), 0) AS received_qty,
        COALESCE(SUM(putaway_qty), 0) AS putaway_qty
     FROM inbound_task_items
     WHERE task_id IN (${placeholders})
     GROUP BY task_id`,
    ids,
  )

  const [containerRows] = await pool.query(
    `SELECT
        c.inbound_task_id AS task_id,
        COALESCE(SUM(CASE WHEN c.status = ? THEN 1 ELSE 0 END), 0) AS waiting_containers,
        COALESCE(SUM(CASE WHEN c.status = ? THEN 1 ELSE 0 END), 0) AS stored_containers,
        COALESCE(SUM(CASE WHEN c.status = ? THEN c.remaining_qty ELSE 0 END), 0) AS waiting_qty,
        COALESCE(SUM(CASE WHEN c.status = ? THEN c.remaining_qty ELSE 0 END), 0) AS stored_qty,
        COALESCE(SUM(
          CASE
            WHEN c.status = ?
             AND (
               (c.putaway_deadline_at IS NOT NULL AND c.putaway_deadline_at < NOW())
               OR (c.putaway_deadline_at IS NULL AND TIMESTAMPDIFF(HOUR, c.created_at, NOW()) >= ?)
             )
            THEN 1 ELSE 0
          END
        ), 0) AS overdue_containers,
        COALESCE(COUNT(DISTINCT c.id), 0) AS total_containers
     FROM inventory_containers c
     WHERE c.inbound_task_id IN (${placeholders})
       AND c.deleted_at IS NULL
       AND (c.is_legacy = 0 OR c.is_legacy IS NULL)
     GROUP BY c.inbound_task_id`,
    [
      CONTAINER_STATUS.PENDING_PUTAWAY,
      CONTAINER_STATUS.ACTIVE,
      CONTAINER_STATUS.PENDING_PUTAWAY,
      CONTAINER_STATUS.ACTIVE,
      CONTAINER_STATUS.PENDING_PUTAWAY,
      putawayTimeoutHours,
      ...ids,
    ],
  )

  const [printRows] = await pool.query(
    `SELECT
        c.inbound_task_id AS task_id,
        COUNT(*) AS total_jobs,
        SUM(CASE WHEN latest.status = 0 THEN 1 ELSE 0 END) AS queued_jobs,
        SUM(CASE WHEN latest.status = 1 THEN 1 ELSE 0 END) AS printing_jobs,
        SUM(CASE WHEN latest.status = 2 THEN 1 ELSE 0 END) AS success_jobs,
        SUM(CASE WHEN latest.status = 3 AND IFNULL(latest.error_message, '') <> ? THEN 1 ELSE 0 END) AS failed_jobs,
        SUM(
          CASE
            WHEN (
              (latest.status IN (0,1) AND TIMESTAMPDIFF(MINUTE, latest.updated_at, NOW()) >= ?)
              OR (latest.status = 3 AND IFNULL(latest.error_message, '') = ?)
            )
            THEN 1 ELSE 0
          END
        ) AS timeout_jobs
     FROM inventory_containers c
     INNER JOIN (
       SELECT ref_id, MAX(id) AS max_id
       FROM print_jobs
       WHERE ref_type = 'inventory_container'
       GROUP BY ref_id
     ) latest_ref ON latest_ref.ref_id = c.id
     INNER JOIN print_jobs latest ON latest.id = latest_ref.max_id
     WHERE c.inbound_task_id IN (${placeholders})
     GROUP BY c.inbound_task_id`,
    [EXPIRE_MESSAGE, printTimeoutMinutes, EXPIRE_MESSAGE, ...ids],
  )

  const map = new Map(ids.map(id => [id, {
    lineCount: 0,
    orderedQty: 0,
    receivedQty: 0,
    putawayQty: 0,
    waitingContainers: 0,
    storedContainers: 0,
    waitingQty: 0,
    storedQty: 0,
    overdueContainers: 0,
    totalContainers: 0,
    queuedPrintJobs: 0,
    printingPrintJobs: 0,
    successPrintJobs: 0,
    failedPrintJobs: 0,
    timeoutPrintJobs: 0,
  }]))

  for (const row of itemRows) {
    map.set(Number(row.task_id), {
      ...(map.get(Number(row.task_id)) || {}),
      lineCount: Number(row.line_count || 0),
      orderedQty: Number(row.ordered_qty || 0),
      receivedQty: Number(row.received_qty || 0),
      putawayQty: Number(row.putaway_qty || 0),
    })
  }
  for (const row of containerRows) {
    map.set(Number(row.task_id), {
      ...(map.get(Number(row.task_id)) || {}),
      waitingContainers: Number(row.waiting_containers || 0),
      storedContainers: Number(row.stored_containers || 0),
      waitingQty: Number(row.waiting_qty || 0),
      storedQty: Number(row.stored_qty || 0),
      overdueContainers: Number(row.overdue_containers || 0),
      totalContainers: Number(row.total_containers || 0),
    })
  }
  for (const row of printRows) {
    map.set(Number(row.task_id), {
      ...(map.get(Number(row.task_id)) || {}),
      queuedPrintJobs: Number(row.queued_jobs || 0),
      printingPrintJobs: Number(row.printing_jobs || 0),
      successPrintJobs: Number(row.success_jobs || 0),
      failedPrintJobs: Number(row.failed_jobs || 0),
      timeoutPrintJobs: Number(row.timeout_jobs || 0),
    })
  }
  return map
}

async function loadInboundTimeline(taskId) {
  const [rows] = await pool.query(
    `SELECT * FROM inbound_task_events WHERE task_id = ? ORDER BY created_at DESC, id DESC`,
    [taskId],
  )
  return rows.map(row => ({
    id: Number(row.id),
    eventType: row.event_type,
    title: row.title,
    description: row.description || null,
    payload: parseJson(row.payload_json),
    createdBy: row.created_by != null ? Number(row.created_by) : null,
    createdByName: row.created_by_name || null,
    createdAt: row.created_at,
  }))
}

async function loadInboundRecentPrintJobs(taskId, thresholds = DEFAULT_INBOUND_THRESHOLDS) {
  const [rows] = await pool.query(
    `SELECT
        j.id,
        j.status,
        j.error_message,
        j.ref_id,
        j.ref_code,
        j.created_at,
        j.updated_at,
        j.dispatch_reason,
        pr.code AS printer_code,
        pr.name AS printer_name,
        t.status AS task_status,
        c.product_id,
        p.code AS product_code,
        p.name AS product_name,
        c.remaining_qty
     FROM print_jobs j
     INNER JOIN inventory_containers c
       ON j.ref_type = 'inventory_container'
      AND j.ref_id = c.id
     LEFT JOIN inbound_tasks t ON t.id = c.inbound_task_id
     LEFT JOIN product_items p ON p.id = c.product_id
     LEFT JOIN printers pr ON pr.id = j.printer_id
     WHERE c.inbound_task_id = ?
     ORDER BY j.id DESC
     LIMIT 20`,
    [taskId],
  )
  return rows.map(row => ({
    ...deriveInboundPrintJobState(row, thresholds),
    id: Number(row.id),
    status: Number(row.status),
    printerCode: row.printer_code || null,
    printerName: row.printer_name || null,
    errorMessage: row.error_message || null,
    dispatchReason: row.dispatch_reason || null,
    containerId: row.ref_id != null ? Number(row.ref_id) : null,
    barcode: row.ref_code || null,
    productId: row.product_id != null ? Number(row.product_id) : null,
    productCode: row.product_code || null,
    productName: row.product_name || null,
    qty: Number(row.remaining_qty || 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }))
}

async function findAll({ page = 1, pageSize = 20, keyword = '', status = null, productId = null }) {
  const offset = (page - 1) * pageSize
  const like = `%${keyword}%`
  const conds = ['t.deleted_at IS NULL', '(t.task_no LIKE ? OR t.supplier_name LIKE ? OR t.purchase_order_no LIKE ?)']
  const params = [like, like, like]
  if (status) { conds.push('t.status = ?'); params.push(status) }
  if (productId) {
    conds.push('EXISTS (SELECT 1 FROM inbound_task_items iti WHERE iti.task_id = t.id AND iti.product_id = ?)')
    params.push(productId)
  }
  const where = conds.join(' AND ')

  const [rows] = await pool.query(
    `SELECT t.* FROM inbound_tasks t WHERE ${where} ORDER BY t.created_at DESC LIMIT ? OFFSET ?`,
    [...params, pageSize, offset],
  )
  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) AS total FROM inbound_tasks t WHERE ${where}`,
    params,
  )
  const list = rows.map(fmtTask)
  const thresholds = await getInboundClosureThresholds()
  const summaryMap = await loadInboundTaskClosureSummary(list.map(item => item.id), thresholds)
  return {
    list: list.map(task => buildTaskWithClosure(task, [], summaryMap.get(task.id), [], [], thresholds)),
    pagination: { page, pageSize, total },
  }
}

async function findById(id) {
  const [[row]] = await pool.query('SELECT * FROM inbound_tasks WHERE id = ? AND deleted_at IS NULL', [id])
  if (!row) throw new AppError('入库任务不存在', 404)
  const task = fmtTask(row)
  const [items] = await pool.query('SELECT * FROM inbound_task_items WHERE task_id = ?', [id])
  const formattedItems = items.map(fmtItem)
  const thresholds = await getInboundClosureThresholds()
  const summaryMap = await loadInboundTaskClosureSummary([id], thresholds)
  const timeline = await loadInboundTimeline(id)
  const recentPrintJobs = await loadInboundRecentPrintJobs(id, thresholds)
  return buildTaskWithClosure(task, formattedItems, summaryMap.get(id), timeline, recentPrintJobs, thresholds)
}

async function findPurchasableItems({ supplierId, keyword = '' }) {
  const supplierIdN = Number(supplierId)
  if (!Number.isFinite(supplierIdN) || supplierIdN <= 0) throw new AppError('请选择供应商', 400)

  const like = `%${keyword}%`
  const [rows] = await pool.query(
    `SELECT
        poi.id AS purchase_item_id,
        po.id AS purchase_order_id,
        po.order_no AS purchase_order_no,
        po.supplier_id,
        po.supplier_name,
        po.warehouse_id,
        po.warehouse_name,
        poi.product_id,
        poi.product_code,
        poi.product_name,
        poi.unit,
        poi.quantity AS ordered_qty,
        COALESCE(SUM(
          CASE
            WHEN it.id IS NULL OR it.deleted_at IS NOT NULL OR it.status = 5 THEN 0
            ELSE iti.ordered_qty
          END
        ), 0) AS assigned_qty,
        poi.quantity - COALESCE(SUM(
          CASE
            WHEN it.id IS NULL OR it.deleted_at IS NOT NULL OR it.status = 5 THEN 0
            ELSE iti.ordered_qty
          END
        ), 0) AS remaining_qty
      FROM purchase_order_items poi
      INNER JOIN purchase_orders po
        ON po.id = poi.order_id
       AND po.deleted_at IS NULL
       AND po.status = 2
      LEFT JOIN inbound_task_items iti
        ON iti.purchase_item_id = poi.id
      LEFT JOIN inbound_tasks it
        ON it.id = iti.task_id
      WHERE po.supplier_id = ?
        AND (
          poi.product_code LIKE ?
          OR poi.product_name LIKE ?
          OR po.order_no LIKE ?
        )
      GROUP BY
        poi.id, po.id, po.order_no, po.supplier_id, po.supplier_name,
        po.warehouse_id, po.warehouse_name,
        poi.product_id, poi.product_code, poi.product_name, poi.unit, poi.quantity
      HAVING remaining_qty > 0
      ORDER BY po.created_at ASC, poi.id ASC`,
    [supplierIdN, like, like, like],
  )

  return rows.map(fmtPurchasableItem)
}

async function listWaitingContainers(taskId) {
  await findById(taskId)
  const [rows] = await pool.query(
    `SELECT c.*, p.code AS product_code, p.name AS product_name, loc.code AS location_code
     FROM inventory_containers c
     LEFT JOIN product_items p ON p.id = c.product_id
     LEFT JOIN warehouse_locations loc ON loc.id = c.location_id
     WHERE c.inbound_task_id = ? AND c.deleted_at IS NULL AND c.status = ?
       AND (c.is_legacy = 0 OR c.is_legacy IS NULL)
     ORDER BY c.id ASC`,
    [taskId, CONTAINER_STATUS.PENDING_PUTAWAY],
  )
  return rows.map(fmtContainer)
}

async function listStoredContainers(taskId) {
  await findById(taskId)
  const [rows] = await pool.query(
    `SELECT c.*, p.code AS product_code, p.name AS product_name, loc.code AS location_code
     FROM inventory_containers c
     LEFT JOIN product_items p ON p.id = c.product_id
     LEFT JOIN warehouse_locations loc ON loc.id = c.location_id
     WHERE c.inbound_task_id = ? AND c.deleted_at IS NULL AND c.status = ? AND c.location_id IS NOT NULL
       AND (c.is_legacy = 0 OR c.is_legacy IS NULL)
     ORDER BY c.id ASC`,
    [taskId, CONTAINER_STATUS.ACTIVE],
  )
  return rows.map(fmtContainer)
}

async function listContainers(taskId) {
  const waiting = await listWaitingContainers(taskId)
  const stored = await listStoredContainers(taskId)
  return { waiting, stored }
}

async function refreshPutawayOverdueMarks() {
  try {
    const thresholds = await getInboundClosureThresholds()
    const [u] = await pool.query(
      `UPDATE inventory_containers
       SET putaway_flagged_overdue = 1, is_overdue = 1
       WHERE status = ? AND deleted_at IS NULL AND (is_legacy = 0 OR is_legacy IS NULL)
         AND (
           (putaway_deadline_at IS NOT NULL AND putaway_deadline_at < NOW())
           OR (putaway_deadline_at IS NULL AND TIMESTAMPDIFF(HOUR, created_at, NOW()) >= ?)
         )
         AND (is_overdue = 0 OR is_overdue IS NULL)`,
      [CONTAINER_STATUS.PENDING_PUTAWAY, Number(thresholds.putawayTimeoutHours || DEFAULT_INBOUND_THRESHOLDS.putawayTimeoutHours)],
    )
    if (u.affectedRows > 0) {
      logger.warn(`[PutawayOverdue] 新标记 ${u.affectedRows} 个待上架超时容器`)
    }
  } catch (e) {
    if (e.code === 'ER_BAD_FIELD_ERROR') {
      // 迁移未执行
    } else {
      throw e
    }
  }
}

async function listAllPendingPutawayContainers() {
  await refreshPutawayOverdueMarks()

  const [rows] = await pool.query(
    `SELECT c.id, c.barcode, c.product_id, c.warehouse_id, c.remaining_qty, c.created_at,
            c.putaway_deadline_at, c.putaway_flagged_overdue, c.is_overdue, c.inbound_task_id,
            t.task_no, t.purchase_order_no, t.warehouse_name
     FROM inventory_containers c
     INNER JOIN inbound_tasks t ON t.id = c.inbound_task_id
     WHERE c.status = ? AND c.deleted_at IS NULL AND (c.is_legacy = 0 OR c.is_legacy IS NULL)
     ORDER BY c.created_at ASC`,
    [CONTAINER_STATUS.PENDING_PUTAWAY],
  )
  return rows.map(r => ({
    id: r.id,
    barcode: r.barcode,
    productId: r.product_id,
    warehouseId: r.warehouse_id,
    qty: Number(r.remaining_qty),
    createdAt: r.created_at,
    putawayDeadlineAt: r.putaway_deadline_at || null,
    isOverdue: !!Number(r.is_overdue ?? r.putaway_flagged_overdue),
    inboundTaskId: r.inbound_task_id,
    taskNo: r.task_no,
    purchaseOrderNo: r.purchase_order_no,
    warehouseName: r.warehouse_name,
  }))
}

module.exports = {
  buildTaskWithClosure,
  loadInboundTaskClosureSummary,
  loadInboundTimeline,
  loadInboundRecentPrintJobs,
  findAll,
  findById,
  findPurchasableItems,
  listWaitingContainers,
  listStoredContainers,
  listContainers,
  refreshPutawayOverdueMarks,
  listAllPendingPutawayContainers,
}
