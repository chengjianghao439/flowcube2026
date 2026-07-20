const AppError = require('../../utils/AppError')
const { generateDailyCode } = require('../../utils/codeGenerator')
const { WT_STATUS_NAME } = require('../../constants/warehouseTaskStatus')
const logger = require('../../utils/logger')

const TASK_STATUS = WT_STATUS_NAME
const PRIORITY    = { 1:'紧急',   2:'普通',   3:'低优先级' }

function logSideEffectFailure(message, error, meta = {}) {
  logger.error(
    message,
    error instanceof Error ? error : new Error(String(error)),
    { degradation: 'side_effect_failed', ...meta },
    'WarehouseTask',
  )
}

async function optionalTaskDetailQuery(metricName, promise, fallback) {
  try {
    return await promise
  } catch (e) {
    logger.warn(
      '仓库任务详情可选区块查询失败，已返回明确降级值',
      {
        metricName,
        degradation: 'task_detail_optional_block_failed',
        error: e?.message || String(e),
      },
      'WarehouseTask',
    )
    return fallback
  }
}

/**
 * 拣货闭环：已拣满 + 扫码合计与 picked_qty 一致 + 锁定容器集合与拣货扫码容器一致
 */
async function assertTaskPickScanClosure(conn, taskId) {
  const [items] = await conn.query(
    'SELECT id, required_qty, picked_qty FROM warehouse_task_items WHERE task_id=?',
    [taskId],
  )
  for (const row of items) {
    if (Number(row.picked_qty) !== Number(row.required_qty)) {
      throw new AppError(`拣货未完成：存在未拣满明细（需 ${row.required_qty}，已拣 ${row.picked_qty}）`, 400)
    }
    const [[agg]] = await conn.query(
      `SELECT COALESCE(SUM(qty),0) AS sq FROM scan_logs
       WHERE task_id=? AND item_id=? AND COALESCE(scan_purpose,1)=1`,
      [taskId, row.id],
    )
    if (Number(agg.sq) !== Number(row.picked_qty)) {
      throw new AppError('拣货扫码合计与明细已拣数量不一致，无法推进', 400)
    }
  }
  const [locked] = await conn.query(
    'SELECT id FROM inventory_containers WHERE locked_by_task_id=? AND deleted_at IS NULL',
    [taskId],
  )
  const [pickedContainers] = await conn.query(
    `SELECT DISTINCT container_id AS cid FROM scan_logs
     WHERE task_id=? AND COALESCE(scan_purpose,1)=1`,
    [taskId],
  )
  const lockedIds = new Set(locked.map(r => r.id))
  const pickIds = new Set(pickedContainers.map(r => r.cid))
  if (lockedIds.size !== pickIds.size) {
    throw new AppError('锁定容器与拣货扫码容器不一致：每个锁定容器必须完成拣货扫码', 400)
  }
  for (const id of lockedIds) {
    if (!pickIds.has(id)) throw new AppError('存在未经拣货扫码的锁定容器', 400)
  }
  for (const id of pickIds) {
    if (!lockedIds.has(id)) throw new AppError('拣货扫码中的容器必须全部锁定于本任务', 400)
  }
}

/**
 * 复核闭环：checked_qty === picked_qty，且复核扫码合计与 checked_qty 一致
 */
async function assertTaskCheckScanClosure(conn, taskId) {
  const [items] = await conn.query(
    'SELECT id, picked_qty, required_qty, checked_qty FROM warehouse_task_items WHERE task_id=?',
    [taskId],
  )
  for (const row of items) {
    const p = Number(row.picked_qty)
    const ch = Number(row.checked_qty)
    if (p !== Number(row.required_qty)) {
      throw new AppError('出库前置：存在未拣满明细', 400)
    }
    if (ch !== p) {
      throw new AppError('出库前置：复核未完成（已核须等于拣货数量）', 400)
    }
    const [[agg]] = await conn.query(
      `SELECT COALESCE(SUM(qty),0) AS sq FROM scan_logs
       WHERE task_id=? AND item_id=? AND scan_purpose=2`,
      [taskId, row.id],
    )
    if (Number(agg.sq) !== ch) {
      throw new AppError('复核扫码合计与已核数量不一致', 400)
    }
  }
}

/** 打包闭环：全部箱子已完成，且存在装箱明细 */
async function assertTaskPackagingClosure(conn, taskId) {
  const [[{ open }]] = await conn.query(
    `SELECT COUNT(*) AS open FROM packages WHERE warehouse_task_id=? AND status = 1`,
    [taskId],
  )
  if (Number(open) > 0) {
    throw new AppError('存在未完成的装箱，请先完成全部箱子打包', 400)
  }
  const [[{ cnt }]] = await conn.query(
    `SELECT COUNT(*) AS cnt FROM package_items pi
     INNER JOIN packages p ON p.id = pi.package_id
     WHERE p.warehouse_task_id = ? AND p.status = 2`,
    [taskId],
  )
  if (Number(cnt) === 0) {
    throw new AppError('没有已完成的装箱明细，无法进入待出库', 400)
  }
}

async function assertTaskPackagePrintClosure(conn, taskId) {
  const [rows] = await conn.query(
    `SELECT
        p.id AS package_id,
        p.barcode,
        j.id AS job_id,
        j.status,
        j.error_message
     FROM packages p
     LEFT JOIN (
       SELECT j1.*
       FROM print_jobs j1
       INNER JOIN (
         SELECT ref_id, MAX(id) AS max_id
         FROM print_jobs
         WHERE ref_type = 'package'
         GROUP BY ref_id
       ) latest ON latest.max_id = j1.id
     ) j ON j.ref_id = p.id AND j.ref_type = 'package'
     WHERE p.warehouse_task_id = ? AND p.status = 2
     ORDER BY p.id ASC`,
    [taskId],
  )
  if (!rows.length) {
    throw new AppError('没有已完成的箱子，无法推进到待出库', 400)
  }
  const missing = rows.find((row) => row.job_id == null)
  if (missing) {
    throw new AppError(`箱贴未进入打印链：箱号 ${missing.barcode} 还没有打印任务`, 409)
  }
  const failed = rows.find((row) => Number(row.status) === 3)
  if (failed) {
    throw new AppError(
      `箱贴打印失败：箱号 ${failed.barcode}${failed.error_message ? `，${failed.error_message}` : ''}`,
      409,
    )
  }
  const pending = rows.find((row) => Number(row.status) !== 2)
  if (pending) {
    throw new AppError(`箱贴仍待确认：箱号 ${pending.barcode} 尚未打印完成，请先收口打印任务`, 409)
  }
}

const fmt = r => ({
  id: r.id,
  taskNo: r.task_no,
  taskType: r.task_type || 'sale_out',
  returnId: r.return_id != null ? Number(r.return_id) : null,
  saleOrderId: r.sale_order_id,
  saleOrderNo: r.sale_order_no,
  customerId: r.customer_id,
  customerName: r.customer_name,
  warehouseId: r.warehouse_id,
  warehouseName: r.warehouse_name,
  status: r.status,
  statusName: TASK_STATUS[r.status],
  priority: r.priority,
  priorityName: PRIORITY[r.priority],
  assignedTo: r.assigned_to || null,
  assignedName: r.assigned_name || null,
  expectedShipDate: r.expected_ship_date,
  remark: r.remark,
  sortingBinId:   r.sorting_bin_id   || null,
  sortingBinCode: r.sorting_bin_code || null,
  cancelRequestedAt: r.cancel_requested_at || null,
  shippedAt: r.shipped_at,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
})

const genTaskNo = conn => generateDailyCode(conn, 'WT', 'warehouse_tasks', 'task_no')

module.exports = {
  PRIORITY,
  fmt,
  genTaskNo,
  logSideEffectFailure,
  optionalTaskDetailQuery,
  assertTaskPickScanClosure,
  assertTaskCheckScanClosure,
  assertTaskPackagingClosure,
  assertTaskPackagePrintClosure,
}
