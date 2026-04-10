const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const logger = require('../../utils/logger')
const { generateDailyCode } = require('../../utils/codeGenerator')
const { createContainer, syncStockFromContainers, CONTAINER_STATUS, SOURCE_TYPE } = require('../../engine/containerEngine')
const { MOVE_TYPE } = require('../../engine/inventoryEngine')

const TASK_STATUS = { 1: '待收货', 2: '收货中', 3: '待上架', 4: '已完成', 5: '已取消' }
const RECEIPT_STATUS_LABEL = {
  draft: '草稿',
  submitted: '已提交到PDA',
  receiving: '收货中',
  printed_waiting_putaway: '已打印待上架',
  putaway_in_progress: '上架中',
  pending_audit: '已上架待审核',
  audited: '已审核',
  exception: '异常中',
  cancelled: '已取消',
}
const PRINT_STATUS_LABEL = {
  not_started: '未打印',
  queued: '待派发',
  printing: '打印中',
  success: '已打印',
  failed: '打印失败',
  timeout: '超时待确认',
  cancelled: '已取消',
}
const PUTAWAY_STATUS_LABEL = {
  not_started: '未开始',
  waiting: '待上架',
  putting_away: '上架中',
  completed: '已上架',
  cancelled: '已取消',
}
const AUDIT_STATUS_LABEL = {
  not_ready: '未到审核',
  pending: '待审核',
  approved: '已审核',
  rejected: '已退回',
  cancelled: '已取消',
}

const genTaskNo = conn => generateDailyCode(conn, 'IT', 'inbound_tasks', 'task_no')

function parseJson(value) {
  if (!value) return null
  if (typeof value === 'object') return value
  try {
    return JSON.parse(String(value))
  } catch {
    return null
  }
}

async function appendInboundEvent(conn, taskId, eventType, title, description = null, operator = null, payload = null) {
  await conn.query(
    `INSERT INTO inbound_task_events (task_id,event_type,title,description,payload_json,created_by,created_by_name)
     VALUES (?,?,?,?,?,?,?)`,
    [
      taskId,
      eventType,
      title,
      description || null,
      payload ? JSON.stringify(payload) : null,
      operator?.userId ?? null,
      operator?.realName ?? operator?.username ?? null,
    ],
  )
}

function buildPrintStatus(summary, cancelled = false) {
  if (cancelled) return { key: 'cancelled', label: PRINT_STATUS_LABEL.cancelled }
  if (!summary || !summary.total) return { key: 'not_started', label: PRINT_STATUS_LABEL.not_started }
  if (summary.timeout > 0) return { key: 'timeout', label: PRINT_STATUS_LABEL.timeout }
  if (summary.failed > 0) return { key: 'failed', label: PRINT_STATUS_LABEL.failed }
  if (summary.printing > 0) return { key: 'printing', label: PRINT_STATUS_LABEL.printing }
  if (summary.queued > 0) return { key: 'queued', label: PRINT_STATUS_LABEL.queued }
  if (summary.success > 0) return { key: 'success', label: PRINT_STATUS_LABEL.success }
  return { key: 'not_started', label: PRINT_STATUS_LABEL.not_started }
}

function buildPutawayStatus(summary, cancelled = false) {
  if (cancelled) return { key: 'cancelled', label: PUTAWAY_STATUS_LABEL.cancelled }
  if (!summary || (!summary.waitingContainers && !summary.storedContainers)) {
    return { key: 'not_started', label: PUTAWAY_STATUS_LABEL.not_started }
  }
  if (summary.waitingContainers > 0 && summary.storedContainers > 0) {
    return { key: 'putting_away', label: PUTAWAY_STATUS_LABEL.putting_away }
  }
  if (summary.waitingContainers > 0) return { key: 'waiting', label: PUTAWAY_STATUS_LABEL.waiting }
  return { key: 'completed', label: PUTAWAY_STATUS_LABEL.completed }
}

function buildAuditStatus(task) {
  if (Number(task.status) === 5) return { key: 'cancelled', label: AUDIT_STATUS_LABEL.cancelled }
  if (Number(task.status) < 4) return { key: 'not_ready', label: AUDIT_STATUS_LABEL.not_ready }
  if (Number(task.auditStatus) === 1) return { key: 'approved', label: AUDIT_STATUS_LABEL.approved }
  if (Number(task.auditStatus) === 2) return { key: 'rejected', label: AUDIT_STATUS_LABEL.rejected }
  return { key: 'pending', label: AUDIT_STATUS_LABEL.pending }
}

function buildExceptionFlags(task) {
  const printSummary = task.printSummary || { failed: 0, timeout: 0 }
  const putawaySummary = task.putawaySummary || { overdueContainers: 0 }
  const isPendingAuditOverdue = Number(task.status) === 4 && Number(task.auditStatus) === 0
    && !!task.updatedAt
    && (Date.now() - new Date(task.updatedAt).getTime()) > 24 * 60 * 60 * 1000
  const flags = {
    failedPrintJobs: Number(printSummary.failed || 0),
    timeoutPrintJobs: Number(printSummary.timeout || 0),
    overduePutawayContainers: Number(putawaySummary.overdueContainers || 0),
    pendingAuditOverdue: isPendingAuditOverdue,
    auditRejected: Number(task.auditStatus) === 2,
  }
  return {
    ...flags,
    hasException: flags.failedPrintJobs > 0
      || flags.timeoutPrintJobs > 0
      || flags.overduePutawayContainers > 0
      || flags.pendingAuditOverdue
      || flags.auditRejected,
  }
}

function buildReceiptStatus(task) {
  if (Number(task.status) === 5) return { key: 'cancelled', label: RECEIPT_STATUS_LABEL.cancelled }
  if (task.exceptionFlags?.hasException) return { key: 'exception', label: RECEIPT_STATUS_LABEL.exception }
  if (Number(task.auditStatus) === 1) return { key: 'audited', label: RECEIPT_STATUS_LABEL.audited }
  if (Number(task.status) === 4) return { key: 'pending_audit', label: RECEIPT_STATUS_LABEL.pending_audit }
  if (task.putawayStatus?.key === 'putting_away') return { key: 'putaway_in_progress', label: RECEIPT_STATUS_LABEL.putaway_in_progress }
  if (Number(task.status) === 3) return { key: 'printed_waiting_putaway', label: RECEIPT_STATUS_LABEL.printed_waiting_putaway }
  if (Number(task.status) === 2) return { key: 'receiving', label: RECEIPT_STATUS_LABEL.receiving }
  if (task.submittedAt) return { key: 'submitted', label: RECEIPT_STATUS_LABEL.submitted }
  return { key: 'draft', label: RECEIPT_STATUS_LABEL.draft }
}

const fmt = r => ({
  id:              r.id,
  taskNo:          r.task_no,
  purchaseOrderId: r.purchase_order_id,
  purchaseOrderNo: r.purchase_order_no || null,
  supplierName:    r.supplier_name     || null,
  warehouseId:     r.warehouse_id,
  warehouseName:   r.warehouse_name    || null,
  status:          r.status,
  statusName:      TASK_STATUS[r.status],
  /** 闭环状态机：pending_receive / pending_putaway / done */
  loopStatus:
    r.status === 1 ? 'pending_receive'
      : r.status === 2 ? 'pending_receive'
        : r.status === 3 ? 'pending_putaway'
          : r.status === 4 ? 'done'
            : r.status === 5 ? 'cancelled' : 'unknown',
  operatorId:      r.operator_id       || null,
  operatorName:    r.operator_name     || null,
  remark:          r.remark            || null,
  submittedAt:     r.submitted_at || null,
  submittedBy:     r.submitted_by != null ? Number(r.submitted_by) : null,
  submittedByName: r.submitted_by_name || null,
  auditStatus:     Number(r.audit_status || 0),
  auditRemark:     r.audit_remark || null,
  auditedAt:       r.audited_at || null,
  auditedBy:       r.audited_by != null ? Number(r.audited_by) : null,
  auditedByName:   r.audited_by_name || null,
  lockVersion:     Number(r.lock_version) || 0,
  createdAt:       r.created_at,
  updatedAt:       r.updated_at,
})

const fmtItem = r => ({
  id:              r.id,
  taskId:          r.task_id,
  purchaseOrderId: r.purchase_order_id != null ? Number(r.purchase_order_id) : null,
  purchaseOrderNo: r.purchase_order_no || null,
  purchaseItemId:  r.purchase_item_id != null ? Number(r.purchase_item_id) : null,
  productId:       r.product_id,
  productCode:     r.product_code || null,
  productName:     r.product_name,
  unit:            r.unit || null,
  orderedQty:      Number(r.ordered_qty),
  receivedQty:     Number(r.received_qty),
  putawayQty:      Number(r.putaway_qty),
})

const fmtPurchasableItem = r => ({
  purchaseItemId:  Number(r.purchase_item_id),
  purchaseOrderId: Number(r.purchase_order_id),
  purchaseOrderNo: r.purchase_order_no,
  supplierId:      Number(r.supplier_id),
  supplierName:    r.supplier_name,
  warehouseId:     Number(r.warehouse_id),
  warehouseName:   r.warehouse_name,
  productId:       Number(r.product_id),
  productCode:     r.product_code,
  productName:     r.product_name,
  unit:            r.unit || null,
  orderedQty:      Number(r.ordered_qty),
  assignedQty:     Number(r.assigned_qty),
  remainingQty:    Number(r.remaining_qty),
})

function fmtContainer(r) {
  return {
    id:           r.id,
    barcode:      r.barcode,
    taskId:       r.inbound_task_id,
    productId:    r.product_id,
    productCode:  r.product_code || null,
    productName:  r.product_name || null,
    qty:          Number(r.remaining_qty),
    unit:         r.unit || null,
    status:       r.status === CONTAINER_STATUS.PENDING_PUTAWAY ? 'waiting_putaway' : 'stored',
    locationId:   r.location_id || null,
    locationCode: r.location_code || null,
    createdAt:    r.created_at,
  }
}

function buildTaskWithClosure(task, items = [], summary = {}, timeline = [], recentPrintJobs = []) {
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
  }
  base.printStatus = buildPrintStatus(printSummary, Number(task.status) === 5)
  base.putawayStatus = buildPutawayStatus(putawaySummary, Number(task.status) === 5)
  base.auditFlowStatus = buildAuditStatus(base)
  base.exceptionFlags = buildExceptionFlags(base)
  base.receiptStatus = buildReceiptStatus(base)
  return base
}

async function loadInboundTaskClosureSummary(taskIds) {
  const ids = [...new Set((taskIds || []).map(Number).filter(id => Number.isFinite(id) && id > 0))]
  if (!ids.length) return new Map()
  const placeholders = ids.map(() => '?').join(',')
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
        COALESCE(SUM(CASE WHEN c.status = ? AND c.is_overdue = 1 THEN 1 ELSE 0 END), 0) AS overdue_containers,
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
        SUM(CASE WHEN latest.status = 3 THEN 1 ELSE 0 END) AS failed_jobs,
        SUM(
          CASE
            WHEN latest.status IN (0,1) AND latest.updated_at < DATE_SUB(NOW(), INTERVAL 10 MINUTE)
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
    ids,
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

async function loadInboundRecentPrintJobs(taskId) {
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
        c.product_id,
        p.code AS product_code,
        p.name AS product_name,
        c.remaining_qty
     FROM print_jobs j
     INNER JOIN inventory_containers c
       ON j.ref_type = 'inventory_container'
      AND j.ref_id = c.id
     LEFT JOIN product_items p ON p.id = c.product_id
     LEFT JOIN printers pr ON pr.id = j.printer_id
     WHERE c.inbound_task_id = ?
     ORDER BY j.id DESC
     LIMIT 20`,
    [taskId],
  )
  return rows.map(row => ({
    id: Number(row.id),
    status: Number(row.status),
    statusKey: row.status === 2 ? 'success' : row.status === 3 ? 'failed' : row.status === 1 ? 'printing' : 'queued',
    statusLabel: row.status === 2 ? '已打印' : row.status === 3 ? '打印失败' : row.status === 1 ? '打印中' : '待派发',
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

// ── 查询 ────────────────────────────────────────────────────────────────────

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
  const list = rows.map(fmt)
  const summaryMap = await loadInboundTaskClosureSummary(list.map(item => item.id))
  return {
    list: list.map(task => buildTaskWithClosure(task, [], summaryMap.get(task.id))),
    pagination: { page, pageSize, total },
  }
}

async function findById(id) {
  const [[row]] = await pool.query('SELECT * FROM inbound_tasks WHERE id = ? AND deleted_at IS NULL', [id])
  if (!row) throw new AppError('入库任务不存在', 404)
  const task = fmt(row)
  const [items] = await pool.query('SELECT * FROM inbound_task_items WHERE task_id = ?', [id])
  const formattedItems = items.map(fmtItem)
  const summaryMap = await loadInboundTaskClosureSummary([id])
  const timeline = await loadInboundTimeline(id)
  const recentPrintJobs = await loadInboundRecentPrintJobs(id)
  return buildTaskWithClosure(task, formattedItems, summaryMap.get(id), timeline, recentPrintJobs)
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

/**
 * 按采购单创建入库任务（采购单须已确认 status=2，且不存在未完结任务）
 */
async function createFromPoId(purchaseOrderId) {
  const purchaseSvc = require('../purchase/purchase.service')
  const order = await purchaseSvc.findById(purchaseOrderId)
  if (order.status !== 2) throw new AppError('只有已确认的采购单可创建入库任务', 400)
  if (!order.items.length) throw new AppError('采购单无明细', 400)

  const [[dup]] = await pool.query(
    `SELECT id FROM inbound_tasks
     WHERE purchase_order_id = ? AND deleted_at IS NULL AND status NOT IN (4, 5) LIMIT 1`,
    [purchaseOrderId],
  )
  if (dup) throw new AppError('该采购单已有未完结的入库任务', 400)

  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const taskNo = await genTaskNo(conn)
    const [r] = await conn.query(
      `INSERT INTO inbound_tasks (task_no, purchase_order_id, purchase_order_no, supplier_name, warehouse_id, warehouse_name, status)
       VALUES (?,?,?,?,?,?,1)`,
      [taskNo, order.id, order.orderNo, order.supplierName, order.warehouseId, order.warehouseName],
    )
    const taskId = r.insertId
    for (const item of order.items) {
      await conn.query(
        `INSERT INTO inbound_task_items (task_id, purchase_order_id, purchase_order_no, purchase_item_id, product_id, product_code, product_name, unit, ordered_qty)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [taskId, order.id, order.orderNo, item.id, item.productId, item.productCode, item.productName, item.unit, item.quantity],
      )
    }
    await appendInboundEvent(conn, taskId, 'created', '创建收货订单', `收货订单 ${taskNo} 已创建，等待提交到 PDA`, null, {
      purchaseOrderNo: order.orderNo,
      warehouseName: order.warehouseName,
    })
    await conn.commit()
    return { taskId, taskNo }
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }
}

async function createManualTask({ supplierId, supplierName, remark, items }) {
  const supplierIdN = Number(supplierId)
  if (!Number.isFinite(supplierIdN) || supplierIdN <= 0) throw new AppError('请选择供应商', 400)
  if (!supplierName?.trim()) throw new AppError('供应商名称不能为空', 400)
  if (!Array.isArray(items) || items.length === 0) throw new AppError('请至少选择一条采购明细', 400)

  const normalized = items.map(item => ({
    purchaseItemId: Number(item.purchaseItemId),
    qty: Number(item.qty),
  }))

  if (normalized.some(item => !Number.isFinite(item.purchaseItemId) || item.purchaseItemId <= 0)) {
    throw new AppError('采购明细无效', 400)
  }
  if (normalized.some(item => !Number.isFinite(item.qty) || item.qty <= 0)) {
    throw new AppError('收货数量必须大于 0', 400)
  }

  const purchaseItemIds = [...new Set(normalized.map(item => item.purchaseItemId))]
  const placeholders = purchaseItemIds.map(() => '?').join(',')
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
        ), 0) AS assigned_qty
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
        AND poi.id IN (${placeholders})
      GROUP BY
        poi.id, po.id, po.order_no, po.supplier_id, po.supplier_name,
        po.warehouse_id, po.warehouse_name,
        poi.product_id, poi.product_code, poi.product_name, poi.unit, poi.quantity`,
    [supplierIdN, ...purchaseItemIds],
  )

  if (rows.length !== purchaseItemIds.length) throw new AppError('存在不可用的采购明细，请刷新后重试', 400)

  const candidateMap = new Map(rows.map(row => [Number(row.purchase_item_id), fmtPurchasableItem({
    ...row,
    remaining_qty: Number(row.ordered_qty) - Number(row.assigned_qty),
  })]))

  const warehouseIds = new Set()
  const taskItems = normalized.map(item => {
    const candidate = candidateMap.get(item.purchaseItemId)
    if (!candidate) throw new AppError('存在不可用的采购明细，请刷新后重试', 400)
    if (candidate.remainingQty < item.qty) {
      throw new AppError(`${candidate.productName} 超出可建单数量，最多还能建 ${candidate.remainingQty}`, 400)
    }
    warehouseIds.add(candidate.warehouseId)
    return {
      ...candidate,
      qty: item.qty,
    }
  })

  if (warehouseIds.size !== 1) throw new AppError('同一张收货单仅支持同仓到货，请按仓库分别建单', 400)

  const warehouseId = taskItems[0].warehouseId
  const warehouseName = taskItems[0].warehouseName
  const purchaseOrders = [...new Set(taskItems.map(item => `${item.purchaseOrderId}:${item.purchaseOrderNo}`))]
  const headerPurchaseOrderId = purchaseOrders.length === 1 ? taskItems[0].purchaseOrderId : null
  const headerPurchaseOrderNo = purchaseOrders.length === 1
    ? taskItems[0].purchaseOrderNo
    : `${purchaseOrders.length} 单混合`

  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const taskNo = await genTaskNo(conn)
    const [r] = await conn.query(
      `INSERT INTO inbound_tasks (task_no, purchase_order_id, purchase_order_no, supplier_name, warehouse_id, warehouse_name, status, remark)
       VALUES (?,?,?,?,?,?,1,?)`,
      [taskNo, headerPurchaseOrderId, headerPurchaseOrderNo, supplierName.trim(), warehouseId, warehouseName, remark?.trim() || null],
    )
    const taskId = r.insertId

    for (const item of taskItems) {
      await conn.query(
        `INSERT INTO inbound_task_items (task_id, purchase_order_id, purchase_order_no, purchase_item_id, product_id, product_code, product_name, unit, ordered_qty)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [
          taskId,
          item.purchaseOrderId,
          item.purchaseOrderNo,
          item.purchaseItemId,
          item.productId,
          item.productCode,
          item.productName,
          item.unit,
          item.qty,
        ],
      )
    }

    await appendInboundEvent(conn, taskId, 'created', '创建收货订单', `收货订单 ${taskNo} 已创建，等待提交到 PDA`, null, {
      supplierName: supplierName.trim(),
      mixedPurchaseOrders: purchaseOrders.length,
      warehouseName,
    })

    await conn.commit()
    return { taskId, taskNo }
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }
}

async function submit(taskId, operator) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const [[taskRow]] = await conn.query(
      'SELECT * FROM inbound_tasks WHERE id = ? AND deleted_at IS NULL FOR UPDATE',
      [taskId],
    )
    if (!taskRow) throw new AppError('收货订单不存在', 404)
    if (Number(taskRow.status) === 5) throw new AppError('已取消的收货订单不能提交到 PDA', 400)
    if (taskRow.submitted_at) throw new AppError('该收货订单已提交到 PDA', 400)
    await conn.query(
      `UPDATE inbound_tasks
       SET submitted_at = NOW(), submitted_by = ?, submitted_by_name = ?, operator_id = ?, operator_name = ?
       WHERE id = ?`,
      [
        operator?.userId ?? null,
        operator?.realName ?? operator?.username ?? null,
        operator?.userId ?? null,
        operator?.realName ?? operator?.username ?? null,
        taskId,
      ],
    )
    await appendInboundEvent(
      conn,
      taskId,
      'submitted_to_pda',
      '提交到PDA',
      `收货订单 ${taskRow.task_no} 已提交到 PDA，等待现场收货`,
      operator,
      null,
    )
    await conn.commit()
    return findById(taskId)
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }
}

async function audit(taskId, { action = 'approve', remark = '' } = {}, operator) {
  const normalizedAction = String(action || 'approve').toLowerCase()
  if (!['approve', 'reject'].includes(normalizedAction)) throw new AppError('审核动作无效', 400)
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const [[taskRow]] = await conn.query(
      'SELECT * FROM inbound_tasks WHERE id = ? AND deleted_at IS NULL FOR UPDATE',
      [taskId],
    )
    if (!taskRow) throw new AppError('收货订单不存在', 404)
    if (Number(taskRow.status) !== 4) throw new AppError('只有已上架完成的收货订单才能审核', 400)
    const auditStatus = normalizedAction === 'approve' ? 1 : 2
    await conn.query(
      `UPDATE inbound_tasks
       SET audit_status = ?, audit_remark = ?, audited_at = NOW(), audited_by = ?, audited_by_name = ?
       WHERE id = ?`,
      [
        auditStatus,
        String(remark || '').trim() || null,
        operator?.userId ?? null,
        operator?.realName ?? operator?.username ?? null,
        taskId,
      ],
    )
    await appendInboundEvent(
      conn,
      taskId,
      normalizedAction === 'approve' ? 'audit_approved' : 'audit_rejected',
      normalizedAction === 'approve' ? '审核通过' : '审核退回',
      String(remark || '').trim() || (normalizedAction === 'approve' ? '收货订单已审核通过' : '收货订单已退回，请处理异常后重新审核'),
      operator,
      { auditStatus },
    )
    await conn.commit()
    return findById(taskId)
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }
}

/**
 * 将 qty 分摊到任务明细（同 SKU 多行按 id 顺序）
 * @returns {Array<{ itemId: number, add: number }>}
 */
function distributeQtyToLines(taskItems, productId, qty) {
  const lines = taskItems
    .filter(i => i.productId === productId && i.receivedQty < i.orderedQty)
    .sort((a, b) => a.id - b.id)
  let left = +qty
  const updates = []
  for (const line of lines) {
    const cap = line.orderedQty - line.receivedQty
    const add = Math.min(left, cap)
    if (add > 0) {
      updates.push({ itemId: line.id, add })
      left -= add
    }
    if (left <= 0) break
  }
  if (left > 0) throw new AppError('收货数量超过该商品待收数量', 400)
  return updates
}

/**
 * 收货：支持旧版单包 { productId, qty }，也支持同商品多箱 { productId, packages:[{ qty }] }
 */
async function receive(taskId, payload, { userId, tenantId = 0 } = {}) {
  const { productId, qty, packages: rawPackages } = payload
  const productIdN = Number(productId)
  const packages = Array.isArray(rawPackages) && rawPackages.length
    ? rawPackages
    : [{ qty }]
  const normalizedPackages = packages.map((pkg, index) => ({
    lineNo: index + 1,
    qty: Number(pkg.qty),
  }))
  const totalQty = normalizedPackages.reduce((sum, pkg) => sum + pkg.qty, 0)

  if (!Number.isFinite(productIdN) || productIdN <= 0) throw new AppError('请选择有效商品', 400)
  if (!normalizedPackages.length) throw new AppError('请至少填写一箱数量', 400)
  if (normalizedPackages.some(pkg => !Number.isFinite(pkg.qty) || pkg.qty <= 0)) throw new AppError('箱数量必须大于 0', 400)

  const conn = await pool.getConnection()
  let result = {
    containerCode: null,
    containerId: null,
    productName: '',
    qty: totalQty,
    totalQty,
    printJobId: null,
    printJobIds: [],
    containers: [],
  }
  try {
    await conn.beginTransaction()

    const [[taskRow]] = await conn.query(
      'SELECT * FROM inbound_tasks WHERE id = ? AND deleted_at IS NULL FOR UPDATE',
      [taskId],
    )
    if (!taskRow) throw new AppError('入库任务不存在', 404)
    if (Number(taskRow.status) >= 4) throw new AppError('任务已完成或已取消', 400)
    if (!taskRow.submitted_at) throw new AppError('请先在 ERP 提交到 PDA，再开始收货', 400)
    if (Number(taskRow.status) === 3) throw new AppError('任务已全部收货，请执行上架', 400)

    if (Number(taskRow.status) === 1) {
      await conn.query('UPDATE inbound_tasks SET status = 2 WHERE id = ?', [taskId])
      await appendInboundEvent(
        conn,
        taskId,
        'receive_started',
        'PDA 开始收货',
        `现场开始收货 ${taskRow.task_no}`,
        { userId, realName: null },
        null,
      )
    }

    const [itemRowsFresh] = await conn.query(
      'SELECT * FROM inbound_task_items WHERE task_id = ? ORDER BY id',
      [taskId],
    )
    if (!itemRowsFresh.length) throw new AppError('任务无明细', 400)
    const taskItems = itemRowsFresh.map(fmtItem)

    const warehouseId = Number(taskRow.warehouse_id)
    const taskNo = taskRow.task_no

    const updates = distributeQtyToLines(taskItems, productIdN, totalQty)
    for (const u of updates) {
      await conn.query(
        'UPDATE inbound_task_items SET received_qty = received_qty + ? WHERE id = ?',
        [u.add, u.itemId],
      )
      const ti = taskItems.find(x => x.id === u.itemId)
      if (ti) ti.receivedQty += u.add
    }

    const line = taskItems.find(i => i.productId === productIdN)
    const unit = line?.unit || null
    const productName = line?.productName || ''
    const itemCount = normalizedPackages.length

    const containers = []
    for (const pkg of normalizedPackages) {
      const { containerId, barcode } = await createContainer(conn, {
        productId:       productIdN,
        warehouseId,
        initialQty:      pkg.qty,
        unit,
        locationId:      null,
        inboundTaskId:   taskId,
        containerStatus: CONTAINER_STATUS.PENDING_PUTAWAY,
        sourceType:      SOURCE_TYPE.INBOUND_TASK,
        sourceRefId:     taskId,
        sourceRefType:   'inbound_task',
        sourceRefNo:     taskNo,
        remark:          `收货待上架 ${taskNo} 第${pkg.lineNo}箱`,
      })
      containers.push({
        containerId,
        containerCode: barcode,
        qty: pkg.qty,
      })
    }

    await appendInboundEvent(
      conn,
      taskId,
      'receive_recorded',
      '收货登记',
      `${productName} 已登记 ${itemCount} 箱，共 ${totalQty}${unit ? ` ${unit}` : ''}`,
      { userId, realName: null },
      {
        productId: productIdN,
        productName,
        totalQty,
        packages: normalizedPackages.length,
      },
    )

    const [updatedItems] = await conn.query('SELECT * FROM inbound_task_items WHERE task_id = ?', [taskId])
    const allReceived = updatedItems.every(i => Number(i.received_qty) >= Number(i.ordered_qty))
    if (allReceived) {
      await conn.query('UPDATE inbound_tasks SET status = 3 WHERE id = ?', [taskId])
    }

    await conn.query('UPDATE inbound_tasks SET lock_version = lock_version + 1 WHERE id = ?', [taskId])

    await conn.commit()

    result = {
      containerCode: containers[0]?.containerCode ?? null,
      containerId: containers[0]?.containerId ?? null,
      productName,
      qty: totalQty,
      totalQty,
      warehouseId,
      printJobId: null,
      printJobIds: [],
      containers,
    }
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }

  try {
    const printJobs = require('../print-jobs/print-jobs.service')
    for (const container of result.containers) {
      const job = await printJobs.enqueueContainerLabelJob({
        type: 'container_label',
        containerId: container.containerId,
        tenantId: Number(tenantId) >= 0 ? Number(tenantId) : 0,
        warehouseId: result.warehouseId,
        data: {
          container_code: container.containerCode,
          product_name:   result.productName,
          qty:            container.qty,
        },
        createdBy: userId ?? null,
      })
      if (job?.id) result.printJobIds.push(job.id)
    }
    result.printJobId = result.printJobIds[0] ?? null
    if (result.printJobIds.length > 0) {
      await appendInboundEvent(
        pool,
        taskId,
        'print_queued',
        '打印提交',
        `${result.productName} 已提交 ${result.printJobIds.length} 条库存条码打印任务`,
        { userId, realName: null },
        {
          printJobIds: result.printJobIds,
          containerCodes: result.containers.map(item => item.containerCode),
        },
      )
    }
  } catch (e) {
    logger.warn(`[inbound receive] 打印队列失败（收货已成功）: ${e.message}`)
  }

  return result
}

/** 待上架容器（status=PENDING_PUTAWAY） */
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

/** 已上架容器（本任务下 ACTIVE 且有库位） */
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

/**
 * 上架：绑定库位、容器变 ACTIVE、sync 库存、写流水、尝试闭环任务
 */
async function putaway(taskId, { containerId, locationId }, operator) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()

    const [[taskRow]] = await conn.query(
      'SELECT id, status, lock_version FROM inbound_tasks WHERE id = ? AND deleted_at IS NULL FOR UPDATE',
      [taskId],
    )
    if (!taskRow) throw new AppError('入库任务不存在', 404)
    const ts = Number(taskRow.status)
    if (ts >= 4) throw new AppError('任务已完成或已取消', 400)
    if (ts === 1) throw new AppError('任务尚未开始收货，无法上架', 400)

    const [[c]] = await conn.query(
      `SELECT c.*, t.task_no, t.purchase_order_id
       FROM inventory_containers c
       INNER JOIN inbound_tasks t ON t.id = c.inbound_task_id
       WHERE c.id = ? AND c.deleted_at IS NULL FOR UPDATE`,
      [containerId],
    )
    if (!c) throw new AppError('容器不存在', 404)
    if (Number(c.inbound_task_id) !== Number(taskId)) throw new AppError('容器不属于该入库任务', 400)
    if (Number(c.status) !== CONTAINER_STATUS.PENDING_PUTAWAY) {
      throw new AppError('容器须为待上架状态（status=4）', 400)
    }

    const [[storedBefore]] = await conn.query(
      `SELECT COUNT(*) AS n
       FROM inventory_containers
       WHERE inbound_task_id = ? AND deleted_at IS NULL AND status = ?`,
      [taskId, CONTAINER_STATUS.ACTIVE],
    )
    if (Number(storedBefore?.n || 0) === 0) {
      await appendInboundEvent(
        conn,
        taskId,
        'putaway_started',
        '开始上架',
        `开始执行收货订单 ${c.task_no} 的扫码上架`,
        operator,
        null,
      )
    }

    const [[loc]] = await conn.query(
      `SELECT l.id, l.code, l.warehouse_id, l.status
       FROM warehouse_locations l
       WHERE l.id = ? AND l.deleted_at IS NULL AND l.status = 1 FOR UPDATE`,
      [locationId],
    )
    if (!loc) throw new AppError('库位不存在或已停用', 404)
    if (Number(loc.warehouse_id) !== Number(c.warehouse_id)) throw new AppError('库位与容器不在同一仓库', 400)

    await conn.query(
      `UPDATE inventory_containers
       SET location_id = ?, status = ?,
           is_overdue = 0, putaway_flagged_overdue = 0, putaway_deadline_at = NULL
       WHERE id = ?`,
      [locationId, CONTAINER_STATUS.ACTIVE, containerId],
    )

    const qty = Number(c.remaining_qty)
    const afterQty = await syncStockFromContainers(conn, c.product_id, c.warehouse_id)
    const beforeQty = afterQty - qty

    await conn.query(
      `INSERT INTO inventory_logs
         (move_type, type, product_id, warehouse_id, supplier_id,
          quantity, before_qty, after_qty, unit_price,
          ref_type, ref_id, ref_no, container_id, log_source_type, log_source_ref_id,
          remark, operator_id, operator_name)
       VALUES (?,1,?,?,NULL,?,?,?,NULL,?,?,?,?,?,?,?,?)`,
      [
        MOVE_TYPE.PURCHASE_IN,
        c.product_id, c.warehouse_id,
        qty, beforeQty, afterQty,
        'inbound_task', taskId, c.task_no,
        containerId, SOURCE_TYPE.INBOUND_TASK, taskId,
        `入库上架 ${c.task_no} 容器#${c.barcode}`,
        operator?.userId || null, operator?.realName || null,
      ],
    )

    let putLeft = qty
    const [itemRows] = await conn.query(
      'SELECT * FROM inbound_task_items WHERE task_id = ? ORDER BY id',
      [taskId],
    )
    for (const row of itemRows) {
      if (Number(row.product_id) !== Number(c.product_id) || putLeft <= 0) continue
      const cap = Number(row.received_qty) - Number(row.putaway_qty)
      if (cap <= 0) continue
      const inc = Math.min(cap, putLeft)
      await conn.query(
        'UPDATE inbound_task_items SET putaway_qty = putaway_qty + ? WHERE id = ?',
        [inc, row.id],
      )
      putLeft -= inc
    }

    await tryFinishTask(conn, taskId)

    await conn.query('UPDATE inbound_tasks SET lock_version = lock_version + 1 WHERE id = ?', [taskId])

    await appendInboundEvent(
      conn,
      taskId,
      'putaway_recorded',
      '完成上架',
      `库存条码 ${c.barcode} 已上架到货架 ${loc.code}`,
      operator,
      {
        containerId,
        barcode: c.barcode,
        locationId,
        locationCode: loc.code,
      },
    )

    await conn.commit()
    return { barcode: c.barcode, locationCode: loc.code }
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }
}

async function tryFinishTask(conn, taskId) {
  const [[{ n }]] = await conn.query(
    `SELECT COUNT(*) AS n FROM inventory_containers
     WHERE inbound_task_id = ? AND deleted_at IS NULL AND status = ?`,
    [taskId, CONTAINER_STATUS.PENDING_PUTAWAY],
  )
  if (Number(n) > 0) return

  const [itemRows] = await conn.query('SELECT * FROM inbound_task_items WHERE task_id = ?', [taskId])
  if (!itemRows.length) return
  const allReceived = itemRows.every(r => Number(r.received_qty) >= Number(r.ordered_qty))
  const allPutaway = itemRows.every(r => Number(r.putaway_qty) >= Number(r.received_qty))
  if (!allReceived || !allPutaway) return

  const [res] = await conn.query('UPDATE inbound_tasks SET status = 4 WHERE id = ? AND status = 3', [taskId])
  if (res.affectedRows > 0) {
    await appendInboundEvent(
      conn,
      taskId,
      'putaway_completed',
      '上架完成',
      '收货订单已全部上架，等待审核',
      null,
      null,
    )
  }

  const [poRows] = await conn.query(
    `SELECT DISTINCT purchase_order_id
     FROM inbound_task_items
     WHERE task_id = ? AND purchase_order_id IS NOT NULL`,
    [taskId],
  )

  for (const row of poRows) {
    await syncPurchaseOrderStatus(conn, Number(row.purchase_order_id))
  }
}

async function syncPurchaseOrderStatus(conn, purchaseOrderId) {
  if (!Number.isFinite(purchaseOrderId) || purchaseOrderId <= 0) return

  const [rows] = await conn.query(
    `SELECT
        poi.id,
        poi.quantity,
        COALESCE(SUM(
          CASE
            WHEN it.id IS NULL OR it.deleted_at IS NOT NULL OR it.status = 5 THEN 0
            ELSE iti.putaway_qty
          END
        ), 0) AS putaway_qty
      FROM purchase_order_items poi
      LEFT JOIN inbound_task_items iti
        ON iti.purchase_item_id = poi.id
      LEFT JOIN inbound_tasks it
        ON it.id = iti.task_id
      WHERE poi.order_id = ?
      GROUP BY poi.id, poi.quantity`,
    [purchaseOrderId],
  )

  const completed = rows.length > 0 && rows.every(row => Number(row.putaway_qty) >= Number(row.quantity))
  if (!completed) return

  await conn.query('UPDATE purchase_orders SET status = 3 WHERE id = ? AND status = 2', [purchaseOrderId])
  const [[po]] = await conn.query('SELECT * FROM purchase_orders WHERE id = ?', [purchaseOrderId])
  if (!po) return

  await conn.query(
    `INSERT IGNORE INTO payment_records (type,order_id,order_no,party_name,total_amount,balance,due_date)
     VALUES (1,?,?,?,?,?,DATE_ADD(NOW(), INTERVAL 30 DAY))`,
    [po.id, po.order_no, po.supplier_name, Number(po.total_amount), Number(po.total_amount)],
  )
}

/** 刷新待上架超时标记（按 putaway_deadline_at 或创建超过 24h） */
async function refreshPutawayOverdueMarks() {
  try {
    const [u] = await pool.query(
      `UPDATE inventory_containers
       SET putaway_flagged_overdue = 1, is_overdue = 1
       WHERE status = ? AND deleted_at IS NULL AND (is_legacy = 0 OR is_legacy IS NULL)
         AND (
           (putaway_deadline_at IS NOT NULL AND putaway_deadline_at < NOW())
           OR (putaway_deadline_at IS NULL AND created_at < DATE_SUB(NOW(), INTERVAL 24 HOUR))
         )
         AND (is_overdue = 0 OR is_overdue IS NULL)`,
      [CONTAINER_STATUS.PENDING_PUTAWAY],
    )
    if (u.affectedRows > 0) {
      logger.warn(`[PutawayOverdue] 新标记 ${u.affectedRows} 个待上架超时容器`)
    }
  } catch (e) {
    if (e.code === 'ER_BAD_FIELD_ERROR') { /* 迁移未执行 */ } else throw e
  }
}

/** 全局待上架容器（跨任务），并标记超时 */
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
    id:            r.id,
    barcode:       r.barcode,
    productId:     r.product_id,
    warehouseId:   r.warehouse_id,
    qty:           Number(r.remaining_qty),
    createdAt:     r.created_at,
    putawayDeadlineAt: r.putaway_deadline_at || null,
    isOverdue:     !!Number(r.is_overdue ?? r.putaway_flagged_overdue),
    inboundTaskId: r.inbound_task_id,
    taskNo:        r.task_no,
    purchaseOrderNo: r.purchase_order_no,
    warehouseName: r.warehouse_name,
  }))
}

async function cancel(taskId) {
  const task = await findById(taskId)
  if (task.status !== 1) throw new AppError('仅待收货状态的任务可取消', 400)
  const [[{ n }]] = await pool.query(
    'SELECT COUNT(*) AS n FROM inventory_containers WHERE inbound_task_id = ? AND deleted_at IS NULL',
    [taskId],
  )
  if (Number(n) > 0) throw new AppError('任务已产生容器，无法取消', 400)
  await pool.query('UPDATE inbound_tasks SET status = 5 WHERE id = ?', [taskId])
  await appendInboundEvent(
    pool,
    taskId,
    'cancelled',
    '取消收货订单',
    `收货订单 ${task.taskNo} 已取消`,
    null,
    null,
  )
}

module.exports = {
  findAll,
  findById,
  findPurchasableItems,
  createFromPoId,
  createManualTask,
  submit,
  audit,
  receive,
  putaway,
  listContainers,
  listWaitingContainers,
  listStoredContainers,
  refreshPutawayOverdueMarks,
  listAllPendingPutawayContainers,
  cancel,
}
