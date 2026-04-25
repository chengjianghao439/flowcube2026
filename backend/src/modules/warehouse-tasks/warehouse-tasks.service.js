const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const { moveStock, MOVE_TYPE } = require('../../engine/inventoryEngine')
const { releaseByRef } = require('../../engine/reservationEngine')
const { unlockContainersByTask } = require('../../engine/containerEngine')
const { generateDailyCode } = require('../../utils/codeGenerator')
const { getInboundClosureThresholds } = require('../../utils/inboundThresholds')
const { lockStatusRow, compareAndSetStatus } = require('../../utils/statusTransition')
const sortingBinSvc = require('../sorting-bins/sorting-bins.service')
const { WT_STATUS, WT_STATUS_NAME, WT_STATUS_PICK_POOL, isValidTransition, assertWarehouseTaskAction } = require('../../constants/warehouseTaskStatus')
const { WT_EVENT, record: recordEvent } = require('./warehouse-task-events.service')
const { beginOperationRequest, completeOperationRequest } = require('../../utils/operationRequest')
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
    `SELECT COUNT(*) AS open FROM packages WHERE warehouse_task_id=? AND status <> 2`,
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
  const missing = rows.find((row) => row.status == null)
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
  shippedAt: r.shipped_at,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
})

const genTaskNo = conn => generateDailyCode(conn, 'WT', 'warehouse_tasks', 'task_no')

async function findAll({ page=1, pageSize=20, keyword='', status=null, warehouseId=null }) {
  const offset = (page - 1) * pageSize
  const like = `%${keyword}%`
  const conds = ['deleted_at IS NULL', '(task_no LIKE ? OR customer_name LIKE ? OR sale_order_no LIKE ?)']
  const params = [like, like, like]
  if (status)      { conds.push('status=?');       params.push(status) }
  if (warehouseId) { conds.push('warehouse_id=?'); params.push(warehouseId) }
  const where = conds.join(' AND ')

  const [rows] = await pool.query(`SELECT * FROM warehouse_tasks WHERE ${where} ORDER BY priority ASC, created_at DESC LIMIT ? OFFSET ?`, [...params, pageSize, offset])
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM warehouse_tasks WHERE ${where}`, params)
  return { list: rows.map(fmt), pagination: { page, pageSize, total } }
}

async function findById(id) {
  const [rows] = await pool.query('SELECT * FROM warehouse_tasks WHERE id=? AND deleted_at IS NULL', [id])
  if (!rows[0]) throw new AppError('仓库任务不存在', 404)
  const task = fmt(rows[0])
  const inboundThresholds = await getInboundClosureThresholds()
  const [items] = await pool.query('SELECT * FROM warehouse_task_items WHERE task_id=?', [id])
  task.items = items.map(r => ({
    id: r.id,
    productId: r.product_id,
    productCode: r.product_code,
    productName: r.product_name,
    unit: r.unit,
    requiredQty: Number(r.required_qty),
    pickedQty: Number(r.picked_qty),
    checkedQty: Number(r.checked_qty ?? 0),
  }))

  const [packageRows] = await pool.query(
    `SELECT id, status
     FROM packages
     WHERE warehouse_task_id = ?
     ORDER BY created_at ASC`,
    [id],
  )
  const [packageItemAgg] = await pool.query(
    `SELECT COALESCE(SUM(pi.qty), 0) AS total_items
     FROM package_items pi
     INNER JOIN packages p ON p.id = pi.package_id
     WHERE p.warehouse_task_id = ?`,
    [id],
  )
  task.packageSummary = {
    totalPackages: packageRows.length,
    openPackages: packageRows.filter(row => Number(row.status) !== 2).length,
    donePackages: packageRows.filter(row => Number(row.status) === 2).length,
    totalItems: Number(packageItemAgg?.[0]?.total_items || 0),
  }

  const [printRows] = await pool.query(
    `SELECT
        j.status,
        j.updated_at,
        j.error_message,
        pr.code AS printer_code,
        pr.name AS printer_name
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
     LEFT JOIN printers pr ON pr.id = j.printer_id
     WHERE p.warehouse_task_id = ?`,
    [id],
  )
  task.printSummary = {
    totalPackages: packageRows.length,
    successCount: 0,
    failedCount: 0,
    timeoutCount: 0,
    processingCount: 0,
    recentError: null,
    recentPrinter: null,
  }
  for (const row of printRows) {
    const status = Number(row.status)
    if (status === 2) task.printSummary.successCount += 1
    else if (status === 3) task.printSummary.failedCount += 1
    else if ((status === 0 || status === 1) && row.updated_at && (Date.now() - new Date(row.updated_at).getTime()) >= Number(inboundThresholds.printTimeoutMinutes) * 60 * 1000) task.printSummary.timeoutCount += 1
    else if (status === 0 || status === 1) task.printSummary.processingCount += 1
    if (!task.printSummary.recentError && row.error_message) task.printSummary.recentError = row.error_message
    if (!task.printSummary.recentPrinter && (row.printer_code || row.printer_name)) task.printSummary.recentPrinter = row.printer_code || row.printer_name
  }
  return task
}

/**
 * 由销售单确认时自动调用，在事务外部创建任务（使用 pool）
 * 创建后自动为任务分配一个空闲分拣格
 * status=2 拣货中（跳过待拣货，直接可拣）
 */
async function createForSaleOrder({ saleOrderId, saleOrderNo, customerId, customerName, warehouseId, warehouseName, items, conn: extConn }) {
  const useConn = extConn || pool
  const taskNo = await genTaskNo(useConn)
  const [r] = await useConn.query(
    `INSERT INTO warehouse_tasks (task_no,sale_order_id,sale_order_no,customer_id,customer_name,warehouse_id,warehouse_name,status,priority) VALUES (?,?,?,?,?,?,?,${WT_STATUS.PICKING},2)`,
    [taskNo, saleOrderId, saleOrderNo, customerId, customerName, warehouseId, warehouseName]
  )
  const taskId = r.insertId
  for (const item of items) {
    await useConn.query(
      `INSERT INTO warehouse_task_items (task_id,product_id,product_code,product_name,unit,required_qty,picked_qty) VALUES (?,?,?,?,?,?,0)`,
      [taskId, item.productId, item.productCode, item.productName, item.unit, item.quantity]
    )
  }
  // 自动分配分拣格（无空闲格时忽略，不阻断任务创建）
  // 注意：assignToTask 内部已使用 FOR UPDATE 行锁，保证原子性
  // 若分配部分失败，需回滚分拣格占用，避免孤立锁
  try {
    const bin = await sortingBinSvc.assignToTask(useConn, { warehouseId, taskId })
    if (bin) {
      await useConn.query(
        'UPDATE warehouse_tasks SET sorting_bin_id=?, sorting_bin_code=? WHERE id=?',
        [bin.binId, bin.binCode, taskId]
      )
      try {
        await recordEvent(useConn, { taskId, taskNo, eventType: WT_EVENT.SORTING_BIN_ASSIGNED, detail: { binCode: bin.binCode } })
      } catch (eventErr) {
        logSideEffectFailure('仓库任务事件写入失败：分拣格分配事件', eventErr, {
          taskId,
          taskNo,
          eventType: WT_EVENT.SORTING_BIN_ASSIGNED,
        })
      }
    }
  } catch (binErr) {
    // 分拣格分配失败：尝试释放可能已占用的格，确保不产生孤立锁
    logSideEffectFailure('分拣格自动分配失败，任务继续创建但进入待人工分配降级状态', binErr, {
      taskId,
      taskNo,
      warehouseId,
      degradation: 'sorting_bin_assignment_failed',
    })
    try {
      await sortingBinSvc.releaseByTask(useConn, taskId)
    } catch (releaseErr) {
      logSideEffectFailure('分拣格分配失败后的释放兜底也失败', releaseErr, {
        taskId,
        taskNo,
        degradation: 'sorting_bin_release_after_assignment_failed',
      })
    }
  }
  // 记录任务创建事件
  try {
    await recordEvent(useConn, {
      taskId, taskNo,
      eventType:  WT_EVENT.TASK_CREATED,
      toStatus:   WT_STATUS.PICKING,
      detail:     { itemCount: items.length },
    })
  } catch (eventErr) {
    logSideEffectFailure('仓库任务事件写入失败：任务创建事件', eventErr, {
      taskId,
      taskNo,
      eventType: WT_EVENT.TASK_CREATED,
    })
  }
  return { taskId, taskNo }
}

/**
 * 分配操作员
 */
async function assign(id, { userId, userName }) {
  const task = await findById(id)
  assertWarehouseTaskAction('assign', task.status)
  await pool.query('UPDATE warehouse_tasks SET assigned_to=?, assigned_name=? WHERE id=?', [userId, userName, id])
}

/**
 * 开始拣货（2 拣货中，已是默认状态，保留此接口供 PDA 兼容调用）
 * 同时清除孤立容器锁
 */
async function startPicking(id) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const taskRow = await lockStatusRow(conn, {
      table: 'warehouse_tasks',
      id,
      columns: 'id, status',
      entityName: '仓库任务',
    })
    assertWarehouseTaskAction('startPicking', taskRow.status)
    if (Number(taskRow.status) !== WT_STATUS.PICKING) {
      await compareAndSetStatus(conn, {
        table: 'warehouse_tasks',
        id,
        fromStatus: taskRow.status,
        toStatus: WT_STATUS.PICKING,
        entityName: '仓库任务',
      })
    }
    // 清除孤立容器锁（防止历史数据清空或任务已终结后残留锁阻断拣货）
    await conn.query(
      `UPDATE inventory_containers
       SET locked_by_task_id = NULL, locked_at = NULL
       WHERE locked_by_task_id IS NOT NULL
         AND locked_by_task_id NOT IN (
           SELECT wt.id FROM warehouse_tasks wt
           WHERE wt.status NOT IN (?,?)
         )`,
      [WT_STATUS.SHIPPED, WT_STATUS.CANCELLED],
    )
    await conn.commit()
  } catch (e) { await conn.rollback(); throw e }
  finally { conn.release() }
}

/**
 * 已废弃：已拣数量仅允许由拣货扫码（scan_logs）累加
 */
async function updatePickedQty() {
  throw new AppError('禁止直接修改已拣数量，请使用 PDA 拣货扫码', 400)
}

/**
 * 拣货完成，自动推进到「待分拣」（2→3）
 * 同步销售单状态 → 3；释放分拣格
 */
async function readyToShipWithinTransaction(conn, id, { requestKey, userId } = {}) {
  const taskRow = await lockStatusRow(conn, {
    table: 'warehouse_tasks',
    id,
    columns: 'id, task_no, status, sale_order_id',
    entityName: '仓库任务',
  })
  const rule = assertWarehouseTaskAction('readyToShip', taskRow.status)
  if (!isValidTransition(taskRow.status, rule.toStatus)) {
    throw new AppError(`非法状态迁移：${taskRow.status} → ${rule.toStatus}`, 400)
  }

  let requestState = { enabled: false }
  if (requestKey) {
    requestState = await beginOperationRequest(conn, {
      requestKey,
      action: 'warehouse.ready-to-ship',
      userId: userId || null,
    })
    if (requestState.replay) {
      return requestState.responseData
    }
  }

  await assertTaskPickScanClosure(conn, id)
  await compareAndSetStatus(conn, {
    table: 'warehouse_tasks',
    id,
    fromStatus: taskRow.status,
    toStatus: rule.toStatus,
    entityName: '仓库任务',
  })
  if (taskRow.sale_order_id) {
    const saleSvc = require('../sale/sale.service')
    await saleSvc.syncPickingByWarehouseTaskWithinTransaction(conn, Number(taskRow.sale_order_id), {
      taskId: Number(taskRow.id),
      taskNo: taskRow.task_no,
    })
  }
  try {
    await recordEvent(conn, {
      taskId: id,
      taskNo: taskRow.task_no,
      eventType: WT_EVENT.PICKING_DONE,
      fromStatus: taskRow.status,
      toStatus: rule.toStatus,
    })
  } catch (eventErr) {
    logSideEffectFailure('仓库任务事件写入失败：拣货完成事件', eventErr, {
      taskId: id,
      taskNo: taskRow.task_no,
      eventType: WT_EVENT.PICKING_DONE,
      fromStatus: taskRow.status,
      toStatus: rule.toStatus,
    })
  }
  const payload = { taskId: id, status: rule.toStatus }
  if (requestState.enabled) {
    await completeOperationRequest(conn, requestState, {
      data: payload,
      message: '已标记为待分拣',
      resourceType: 'warehouse_task',
      resourceId: id,
    })
  }
  return payload
}

async function readyToShip(id, { requestKey, userId } = {}) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const payload = await readyToShipWithinTransaction(conn, id, { requestKey, userId })
    await conn.commit()
    return payload
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }
}

/**
 * 分拣完成，自动推进到「待复核」（3→4）
 * 接收已分拣的 item 列表，后端校验全部完成后自动推进
 * @param {number} id - 任务ID
 * @param {Array<{itemId: number, sortedQty: number}>} [sortedItems] - 可选，逐件上报时传入；不传则视为整任务完成
 */
async function sortTaskWithinTransaction(conn, id, sortedItems = null, { requestKey, userId } = {}) {
  const taskRow = await lockStatusRow(conn, {
    table: 'warehouse_tasks',
    id,
    columns: 'id, task_no, status, sorting_bin_code',
    entityName: '仓库任务',
  })
  const rule = assertWarehouseTaskAction('sortTask', taskRow.status)
  if (!isValidTransition(taskRow.status, rule.toStatus)) throw new AppError(`非法状态迁移：${taskRow.status} → ${rule.toStatus}`, 400)
  const requestState = await beginOperationRequest(conn, {
    requestKey,
    action: 'warehouse.sort',
    userId: userId || null,
  })
  if (requestState.replay) {
    return requestState.responseData
  }

  await assertTaskPickScanClosure(conn, id)

  if (sortedItems && sortedItems.length > 0) {
    for (const { itemId, sortedQty } of sortedItems) {
      await conn.query(
        'UPDATE warehouse_task_items SET sorted_qty=? WHERE id=? AND task_id=?',
        [sortedQty, itemId, id],
      )
    }
  } else {
    await conn.query(
      'UPDATE warehouse_task_items SET sorted_qty=picked_qty WHERE task_id=?',
      [id],
    )
  }

  const [updatedItems] = await conn.query(
    'SELECT picked_qty, sorted_qty FROM warehouse_task_items WHERE task_id=?',
    [id],
  )
  const allSorted = updatedItems.every(i => Number(i.sorted_qty) >= Number(i.picked_qty))
  if (!allSorted) {
    const done = updatedItems.filter(i => Number(i.sorted_qty) >= Number(i.picked_qty)).length
    try {
      await recordEvent(conn, {
        taskId: id, taskNo: taskRow.task_no,
        eventType: WT_EVENT.SORT_PROGRESS,
        detail: { done, total: updatedItems.length, progress: `${done}/${updatedItems.length}` },
      })
    } catch (eventErr) {
      logSideEffectFailure('仓库任务事件写入失败：分拣进度事件', eventErr, {
        taskId: id,
        taskNo: taskRow.task_no,
        eventType: WT_EVENT.SORT_PROGRESS,
      })
    }
    const payload = { allSorted: false, progress: `${done}/${updatedItems.length}` }
    await completeOperationRequest(conn, requestState, {
      data: payload,
      message: `分拣进度 ${payload.progress}，继续操作`,
      resourceType: 'warehouse_task',
      resourceId: id,
    })
    return payload
  }

  await compareAndSetStatus(conn, {
    table: 'warehouse_tasks',
    id,
    fromStatus: taskRow.status,
    toStatus: rule.toStatus,
    entityName: '仓库任务',
  })

  await sortingBinSvc.releaseByTask(conn, id)
  await conn.query('UPDATE warehouse_tasks SET sorting_bin_id=NULL, sorting_bin_code=NULL WHERE id=?', [id])

  try {
    await recordEvent(conn, {
      taskId: id, taskNo: taskRow.task_no,
      eventType: WT_EVENT.SORT_DONE,
      fromStatus: taskRow.status,
      toStatus: rule.toStatus,
      detail: { itemCount: updatedItems.length },
    })
    await recordEvent(conn, {
      taskId: id, taskNo: taskRow.task_no,
      eventType: WT_EVENT.SORTING_BIN_RELEASED,
      detail: { binCode: taskRow.sorting_bin_code },
    })
  } catch (eventErr) {
    logSideEffectFailure('仓库任务事件写入失败：分拣完成/分拣格释放事件', eventErr, {
      taskId: id,
      taskNo: taskRow.task_no,
      eventTypes: [WT_EVENT.SORT_DONE, WT_EVENT.SORTING_BIN_RELEASED],
    })
  }

  const payload = { allSorted: true }
  await completeOperationRequest(conn, requestState, {
    data: payload,
    message: '分拣完成，已进入待复核',
    resourceType: 'warehouse_task',
    resourceId: id,
  })
  return payload
}

async function sortTask(id, sortedItems = null, { requestKey, userId } = {}) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const payload = await sortTaskWithinTransaction(conn, id, sortedItems, { requestKey, userId })
    await conn.commit()
    return payload
  } catch (e) { await conn.rollback(); throw e }
  finally { conn.release() }
}
async function checkDone(id) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    await checkDoneWithinTransaction(conn, id)
    await conn.commit()
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }
}

async function checkDoneWithinTransaction(conn, id) {
  const taskRow = await lockStatusRow(conn, {
    table: 'warehouse_tasks',
    id,
    columns: 'id, task_no, status',
    entityName: '仓库任务',
  })
  const rule = assertWarehouseTaskAction('checkDone', taskRow.status)
  if (!isValidTransition(taskRow.status, rule.toStatus)) {
    throw new AppError(`非法状态迁移：${taskRow.status} → ${rule.toStatus}`, 400)
  }
  await assertTaskCheckScanClosure(conn, id)
  await compareAndSetStatus(conn, {
    table: 'warehouse_tasks',
    id,
    fromStatus: taskRow.status,
    toStatus: rule.toStatus,
    entityName: '仓库任务',
  })
  try {
    await recordEvent(conn, {
      taskId: id,
      taskNo: taskRow.task_no,
      eventType: WT_EVENT.CHECK_DONE,
      fromStatus: taskRow.status,
      toStatus: rule.toStatus,
    })
  } catch (eventErr) {
    logSideEffectFailure('仓库任务事件写入失败：复核完成事件', eventErr, {
      taskId: id,
      taskNo: taskRow.task_no,
      eventType: WT_EVENT.CHECK_DONE,
    })
  }
  return { taskId: id, status: rule.toStatus }
}

/**
 * 打包完成，自动推进到「待出库」（5→6）
 */
async function packDoneWithinTransaction(conn, id, { requestKey, userId } = {}) {
  const taskRow = await lockStatusRow(conn, {
    table: 'warehouse_tasks',
    id,
    columns: 'id, task_no, status',
    entityName: '仓库任务',
  })
  const rule = assertWarehouseTaskAction('packDone', taskRow.status)
  if (!isValidTransition(taskRow.status, rule.toStatus)) throw new AppError(`非法状态迁移：${taskRow.status} → ${rule.toStatus}`, 400)
  const requestState = await beginOperationRequest(conn, {
    requestKey,
    action: 'warehouse.pack-done',
    userId: userId || null,
  })
  if (requestState.replay) {
    return requestState.responseData
  }
  await assertTaskCheckScanClosure(conn, id)
  await assertTaskPackagingClosure(conn, id)
  await assertTaskPackagePrintClosure(conn, id)
  await compareAndSetStatus(conn, {
    table: 'warehouse_tasks',
    id,
    fromStatus: taskRow.status,
    toStatus: rule.toStatus,
    entityName: '仓库任务',
  })
  try {
    await recordEvent(conn, {
      taskId: id, taskNo: taskRow.task_no,
      eventType: WT_EVENT.PACK_DONE,
      fromStatus: taskRow.status,
      toStatus: rule.toStatus,
    })
  } catch (eventErr) {
    logSideEffectFailure('仓库任务事件写入失败：打包完成事件', eventErr, {
      taskId: id,
      taskNo: taskRow.task_no,
      eventType: WT_EVENT.PACK_DONE,
    })
  }
  const payload = { taskId: id, status: rule.toStatus }
  await completeOperationRequest(conn, requestState, {
    data: payload,
    message: '已标记为待出库',
    resourceType: 'warehouse_task',
    resourceId: id,
  })
  return payload
}

async function packDone(id, { requestKey, userId } = {}) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const payload = await packDoneWithinTransaction(conn, id, { requestKey, userId })
    await conn.commit()
    return payload
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }
}

/**
 * 执行出库（6→7）：扣减库存 + 更新销售单状态 + 生成应收账款
 */
async function shipWithinTransaction(conn, id, operator, saleData, { requestKey } = {}) {
  const { saleOrderId, warehouseId, totalAmount, customerName, items } = saleData
  const taskRow = await lockStatusRow(conn, {
    table: 'warehouse_tasks',
    id,
    columns: 'id, task_no, status',
    entityName: '仓库任务',
  })
  const rule = assertWarehouseTaskAction('ship', taskRow.status)
  if (!isValidTransition(taskRow.status, rule.toStatus)) throw new AppError(`非法状态迁移：${taskRow.status} → ${rule.toStatus}`, 400)
  const requestState = await beginOperationRequest(conn, {
    requestKey,
    action: 'warehouse.ship',
    userId: operator?.userId ?? null,
  })
  if (requestState.replay) {
    return requestState.responseData
  }

  await assertTaskPickScanClosure(conn, id)
  await assertTaskCheckScanClosure(conn, id)
  await assertTaskPackagingClosure(conn, id)
  await assertTaskPackagePrintClosure(conn, id)

  if (saleOrderId) {
    const saleRow = await lockStatusRow(conn, {
      table: 'sale_orders',
      id: saleOrderId,
      columns: 'id, status, order_no',
      entityName: '销售单',
    })
    if (Number(saleRow.status) === 5) {
      throw new AppError(`关联销售单 ${saleRow.order_no} 已取消，无法继续出库`, 400)
    }
    if (Number(saleRow.status) === 4) {
      throw new AppError(`关联销售单 ${saleRow.order_no} 已完成出库，请勿重复操作`, 400)
    }
  }

  for (const item of items) {
    await moveStock(conn, {
      moveType: MOVE_TYPE.TASK_OUT,
      productId: item.productId,
      productName: item.productName,
      warehouseId,
      qty: item.quantity,
      unitPrice: item.unitPrice,
      refType: 'warehouse_task',
      refId: taskRow.id,
      refNo: taskRow.task_no,
      reservationRefType: 'sale_order',
      reservationRefId: saleOrderId,
      operatorId: operator.userId,
      operatorName: operator.realName,
      lockedByTaskId: id,
    })
  }

  if (saleOrderId) {
    const saleSvc = require('../sale/sale.service')
    await saleSvc.syncShippedByWarehouseTaskWithinTransaction(conn, saleOrderId, {
      taskId: Number(id),
      taskNo: taskRow.task_no,
    })
  }
  const shippedAt = new Date()
  await compareAndSetStatus(conn, {
    table: 'warehouse_tasks',
    id,
    fromStatus: taskRow.status,
    toStatus: rule.toStatus,
    entityName: '仓库任务',
    extraSet: {
      shipped_at: shippedAt,
    },
  })

  await unlockContainersByTask(conn, id)

  await conn.query(
    `INSERT IGNORE INTO payment_records (type,order_id,order_no,party_name,total_amount,balance,due_date) VALUES (2,?,?,?,?,?,DATE_ADD(NOW(), INTERVAL 30 DAY))`,
    [saleOrderId, taskRow.task_no, customerName, totalAmount, totalAmount],
  )

  try {
    await recordEvent(conn, {
      taskId: id, taskNo: taskRow.task_no,
      eventType: WT_EVENT.SHIP_DONE,
      fromStatus: taskRow.status,
      toStatus: rule.toStatus,
      operatorId: operator.userId,
      operatorName: operator.realName,
      detail: { saleOrderId, totalAmount, itemCount: items.length },
    })
  } catch (eventErr) {
    logSideEffectFailure('仓库任务事件写入失败：出库完成事件', eventErr, {
      taskId: id,
      taskNo: taskRow.task_no,
      eventType: WT_EVENT.SHIP_DONE,
      saleOrderId,
    })
  }

  const payload = { taskId: id, status: rule.toStatus, shippedAt: shippedAt.toISOString() }
  await completeOperationRequest(conn, requestState, {
    data: payload,
    message: '出库成功',
    resourceType: 'warehouse_task',
    resourceId: id,
  })
  return payload
}

async function ship(id, operator, saleData, { requestKey } = {}) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const payload = await shipWithinTransaction(conn, id, operator, saleData, { requestKey })
    await conn.commit()
    return payload
  } catch (e) { await conn.rollback(); throw e }
  finally { conn.release() }
}

/**
 * 取消任务（→8）：同步销售单状态 → 5；释放分拣格
 */
async function cancel(id, options = {}) {
  const manageConn = !options.conn
  const conn = options.conn || await pool.getConnection()
  try {
    if (manageConn) await conn.beginTransaction()

    const taskRow = await lockStatusRow(conn, {
      table: 'warehouse_tasks',
      id,
      columns: 'id, task_no, status, sale_order_id, sorting_bin_id, sorting_bin_code',
      entityName: '仓库任务',
    })
    const rule = assertWarehouseTaskAction('cancel', taskRow.status)
    if (!isValidTransition(taskRow.status, rule.toStatus)) {
      throw new AppError(`非法状态迁移：${taskRow.status} → ${rule.toStatus}`, 400)
    }

    await compareAndSetStatus(conn, {
      table: 'warehouse_tasks',
      id,
      fromStatus: taskRow.status,
      toStatus: rule.toStatus,
      entityName: '仓库任务',
      extraSet: {
        sorting_bin_id: null,
        sorting_bin_code: null,
      },
    })

    // 只有任务真实切换到 CANCELLED 后，才执行资源释放与单据同步副作用。
    await unlockContainersByTask(conn, id)
    await sortingBinSvc.releaseByTask(conn, id)

    if (taskRow.sale_order_id) {
      await releaseByRef(conn, 'sale_order', Number(taskRow.sale_order_id))
    }

    if (taskRow.sale_order_id && options.syncSaleStatus !== false) {
      const saleSvc = require('../sale/sale.service')
      await saleSvc.syncCancelledByWarehouseTaskWithinTransaction(conn, Number(taskRow.sale_order_id), {
        taskId: Number(taskRow.id),
        taskNo: taskRow.task_no,
      })
    }
    try {
      await recordEvent(conn, {
        taskId: id, taskNo: taskRow.task_no,
        eventType:  WT_EVENT.TASK_CANCELLED,
        fromStatus: taskRow.status,
        toStatus:   rule.toStatus,
        operatorId: options.operator?.userId ?? null,
        operatorName: options.operator?.realName ?? null,
        detail:     {
          saleOrderId: taskRow.sale_order_id != null ? Number(taskRow.sale_order_id) : null,
          reservationReleased: taskRow.sale_order_id != null,
        },
      })
    } catch (eventErr) {
      logSideEffectFailure('仓库任务事件写入失败：任务取消事件', eventErr, {
        taskId: id,
        taskNo: taskRow.task_no,
        eventType: WT_EVENT.TASK_CANCELLED,
      })
    }
    if (manageConn) await conn.commit()
  } catch (e) {
    if (manageConn) await conn.rollback()
    throw e
  } finally {
    if (manageConn) conn.release()
  }
}

/**
 * 修改优先级
 */
async function updatePriority(id, priority) {
  if (![1,2,3].includes(priority)) throw new AppError('优先级无效', 400)
  await findById(id)
  await pool.query('UPDATE warehouse_tasks SET priority=? WHERE id=?', [priority, id])
}

/**
 * 公共容器查询 — 一次性批量获取多个商品的可用容器，按库位路径排序
 * 消除 getPickSuggestions / getPickRoute 的 N+1 查询
 *
 * @param {number[]} productIds
 * @param {number}   warehouseId
 * @param {number}   taskId       - 当前任务ID（排除其他任务锁定的容器）
 * @returns {Record<number, Array>}  key = productId
 */
async function _fetchContainersForProducts(productIds, warehouseId, taskId) {
  if (!productIds.length) return {}
  const [containers] = await pool.query(
    `SELECT c.id AS containerId, c.barcode, c.container_type AS containerType, c.remaining_qty AS remainingQty,
            c.product_id AS productId,
            c.locked_by_task_id AS lockedByTaskId,
            loc.code AS locationCode,
            loc.zone, loc.aisle, loc.rack, loc.level, loc.position
     FROM inventory_containers c
     LEFT JOIN warehouse_locations loc ON loc.id = c.location_id
     WHERE c.product_id IN (?)
       AND c.warehouse_id = ?
       AND c.remaining_qty > 0
       AND c.status = 1
       AND c.deleted_at IS NULL
       AND (c.locked_by_task_id IS NULL OR c.locked_by_task_id = ?)
     ORDER BY
       loc.zone ASC, loc.aisle ASC, loc.rack ASC, loc.level ASC, loc.position ASC,
       c.created_at ASC`,
    [productIds, warehouseId, taskId],
  )
  const grouped = {}
  for (const c of containers) {
    if (!grouped[c.productId]) grouped[c.productId] = []
    grouped[c.productId].push(c)
  }
  return grouped
}

/**
 * 自动推荐拣货容器（N+1 已优化：批量查询后 JS 分组）
 */
async function getPickSuggestions(taskId) {
  const task = await findById(taskId)
  assertWarehouseTaskAction('viewPickWork', task.status)

  const pendingItems = task.items.filter(i => i.requiredQty - i.pickedQty > 0)
  const productIds   = pendingItems.map(i => i.productId)
  const grouped      = await _fetchContainersForProducts(productIds, task.warehouseId, taskId)

  const items = task.items.map(item => {
    const remaining = item.requiredQty - item.pickedQty
    if (remaining <= 0) return { ...item, remaining: 0, suggestions: [] }
    const containers = (grouped[item.productId] || []).slice(0, 10)
    return {
      ...item,
      remaining,
      suggestions: containers.map(c => ({
        containerId:  c.containerId,
        barcode:      c.barcode,
        containerKind: Number(c.containerType) === 2 || /^B/i.test(String(c.barcode || '')) ? 'plastic_box' : 'inventory',
        locationCode: c.locationCode || null,
        remainingQty: Number(c.remainingQty),
        locked:       c.lockedByTaskId === taskId,
      })),
    }
  })

  return { taskId, taskNo: task.taskNo, items }
}

/**
 * 生成最优拣货路线（N+1 已优化：批量查询后 JS 分组排序）
 */
async function getPickRoute(taskId) {
  const task = await findById(taskId)
  assertWarehouseTaskAction('viewPickWork', task.status)

  const pendingItems = task.items.filter(i => i.requiredQty - i.pickedQty > 0)
  const productIds   = pendingItems.map(i => i.productId)
  const grouped      = await _fetchContainersForProducts(productIds, task.warehouseId, taskId)

  const allSteps = []
  for (const item of pendingItems) {
    let need = item.requiredQty - item.pickedQty
    for (const c of (grouped[item.productId] || [])) {
      if (need <= 0) break
      const qty = Math.min(Number(c.remainingQty), need)
      allSteps.push({
        itemId:       item.id,
        productId:    item.productId,
        productCode:  item.productCode,
        productName:  item.productName,
        unit:         item.unit,
        containerId:  c.containerId,
        barcode:      c.barcode,
        locationCode: c.locationCode || null,
        zone:     c.zone     || '',
        aisle:    c.aisle    || '',
        rack:     c.rack     || '',
        level:    c.level    || '',
        position: c.position || '',
        qty,
        locked: c.lockedByTaskId === taskId,
      })
      need -= qty
    }
  }

  allSteps.sort((a, b) => {
    for (const k of ['zone','aisle','rack','level','position']) {
      if (a[k] < b[k]) return -1
      if (a[k] > b[k]) return  1
    }
    return 0
  })

  return {
    taskId,
    taskNo: task.taskNo,
    totalSteps: allSteps.length,
    route: allSteps.map((s, idx) => ({
      step:         idx + 1,
      itemId:       s.itemId,
      productName:  s.productName,
      productCode:  s.productCode,
      unit:         s.unit,
      containerId:  s.containerId,
      barcode:      s.barcode,
      locationCode: s.locationCode,
      qty:          s.qty,
      locked:       s.locked,
    })),
  }
}

/**
 * PDA 任务池 — 返回所有待分配/备货中的任务（供 PDA 主页显示）
 * 使用 JOIN + GROUP BY 替代 N+1 子查询
 */
async function findMyTasks() {
  const [rows] = await pool.query(`
    SELECT wt.*,
      COUNT(wti.id)                     AS item_count,
      COALESCE(SUM(wti.required_qty),0) AS total_required,
      COALESCE(SUM(wti.picked_qty),0)   AS total_picked
    FROM warehouse_tasks wt
    LEFT JOIN warehouse_task_items wti ON wti.task_id = wt.id
    WHERE wt.status IN (${WT_STATUS_PICK_POOL.join(',')}) AND wt.deleted_at IS NULL
    GROUP BY wt.id
    ORDER BY wt.priority ASC, wt.created_at DESC
    LIMIT 50
  `)
  return rows.map(r => ({
    ...fmt(r),
    itemCount:     Number(r.item_count),
    totalRequired: Number(r.total_required),
    totalPicked:   Number(r.total_picked),
  }))
}

async function findMyTaskSkuSummary() {
  const [rows] = await pool.query(`
    SELECT
      wti.product_id AS product_id,
      wti.product_code AS product_code,
      wti.product_name AS product_name,
      wti.unit AS unit,
      COALESCE(SUM(wti.required_qty),0) AS total_required,
      COALESCE(SUM(wti.picked_qty),0) AS total_picked,
      COUNT(DISTINCT wt.id) AS order_count,
      GROUP_CONCAT(DISTINCT wt.id ORDER BY wt.id ASC) AS task_ids
    FROM warehouse_tasks wt
    INNER JOIN warehouse_task_items wti ON wti.task_id = wt.id
    WHERE wt.status IN (${WT_STATUS_PICK_POOL.join(',')})
      AND wt.deleted_at IS NULL
    GROUP BY wti.product_id, wti.product_code, wti.product_name, wti.unit
    ORDER BY
      CASE WHEN COALESCE(SUM(wti.picked_qty),0) >= COALESCE(SUM(wti.required_qty),0) THEN 1 ELSE 0 END ASC,
      wti.product_name ASC,
      wti.product_code ASC
  `)
  return rows.map((row) => ({
    productId: Number(row.product_id),
    productCode: row.product_code,
    productName: row.product_name,
    unit: row.unit,
    totalRequired: Number(row.total_required),
    totalPicked: Number(row.total_picked),
    orderCount: Number(row.order_count),
    taskIds: String(row.task_ids || '')
      .split(',')
      .map((v) => Number(v))
      .filter((v) => Number.isFinite(v) && v > 0),
  }))
}

async function getTaskStats() {
  const counts = { picking: 0, sorting: 0, checking: 0, packing: 0, shipping: 0, done: 0, urgent: 0 }
  const [rows] = await pool.query(`
    SELECT status, COUNT(*) AS total
    FROM warehouse_tasks
    WHERE deleted_at IS NULL
    GROUP BY status
  `)
  for (const row of rows) {
    const status = Number(row.status)
    const total = Number(row.total)
    if (status === WT_STATUS.PICKING) counts.picking = total
    else if (status === WT_STATUS.SORTING) counts.sorting = total
    else if (status === WT_STATUS.CHECKING) counts.checking = total
    else if (status === WT_STATUS.PACKING) counts.packing = total
    else if (status === WT_STATUS.SHIPPING) counts.shipping = total
    else if (status === WT_STATUS.SHIPPED) counts.done = total
  }
  const [[urgentRow]] = await pool.query(
    `SELECT COUNT(*) AS total
     FROM warehouse_tasks
     WHERE deleted_at IS NULL
       AND priority = 1
       AND status < ?`,
    [WT_STATUS.SHIPPED],
  )
  counts.urgent = Number(urgentRow?.total || 0)
  return counts
}

async function findEvents(taskId) {
  const [events] = await pool.query(
    `SELECT id, event_type, from_status, to_status, operator_name, detail, created_at
     FROM warehouse_task_events
     WHERE task_id=?
     ORDER BY created_at ASC`,
    [taskId],
  )
  return events
}

async function getDebugSnapshot(taskId) {
  const [[task]] = await pool.query(
    `SELECT t.*,
            wh.name AS warehouse_name_full,
            sb.code AS sorting_bin_code_live,
            sb.status AS sorting_bin_status_live,
            sb.current_task_id AS sorting_bin_task_id_live
     FROM warehouse_tasks t
     LEFT JOIN inventory_warehouses wh ON wh.id = t.warehouse_id
     LEFT JOIN sorting_bins         sb ON sb.current_task_id = t.id
     WHERE t.id = ?`,
    [taskId],
  )
  if (!task) throw new AppError('任务不存在', 404)

  const [items] = await pool.query(
    `SELECT id, product_id, product_code, product_name, unit,
            required_qty, picked_qty, sorted_qty, checked_qty
     FROM warehouse_task_items WHERE task_id=? ORDER BY id`,
    [taskId],
  )
  const [lockedContainers] = await pool.query(
    `SELECT ic.id, ic.barcode, ic.remaining_qty, ic.status,
            ic.locked_by_task_id, ic.locked_at,
            p.name AS product_name,
            loc.code AS location_code
     FROM inventory_containers ic
     LEFT JOIN product_items        p   ON p.id   = ic.product_id
     LEFT JOIN warehouse_locations  loc ON loc.id = ic.location_id
     WHERE ic.locked_by_task_id = ?
       AND ic.deleted_at IS NULL`,
    [taskId],
  )
  const [packages] = await pool.query(
    `SELECT p.id, p.barcode, p.status,
            COUNT(pi.id) AS item_types,
            SUM(pi.qty)  AS total_qty
     FROM packages p
     LEFT JOIN package_items pi ON pi.package_id = p.id
     WHERE p.warehouse_task_id = ?
     GROUP BY p.id`,
    [taskId],
  )
  const [[sortingBin]] = await optionalTaskDetailQuery('detail.sortingBin', pool.query(
    `SELECT id, code, status, current_task_id
     FROM sorting_bins WHERE id = ?`,
    [task.sorting_bin_id || 0],
  ), [[null]])
  const [events] = await optionalTaskDetailQuery('detail.events', pool.query(
    `SELECT id, event_type, from_status, to_status, operator_name, detail, created_at
     FROM warehouse_task_events
     WHERE task_id=?
     ORDER BY created_at DESC LIMIT 20`,
    [taskId],
  ), [[]])
  const [scanLogs] = await optionalTaskDetailQuery('detail.scanLogs', pool.query(
    `SELECT id, barcode, action, result, operator_name, created_at
     FROM scan_logs
     WHERE task_id=?
     ORDER BY created_at DESC LIMIT 10`,
    [taskId],
  ), [[]])

  const checks = []
  if (items.some(i => Number(i.sorted_qty) > Number(i.picked_qty))) {
    checks.push({ level: 'error', msg: 'sorted_qty 超出 picked_qty，数据异常' })
  }
  if (items.some(i => Number(i.checked_qty) > Number(i.required_qty))) {
    checks.push({ level: 'error', msg: 'checked_qty 超出 required_qty，数据异常' })
  }
  if (task.sorting_bin_id && sortingBin && sortingBin.current_task_id !== taskId) {
    checks.push({ level: 'warn', msg: `分拣格 ${sortingBin.code} 的 current_task_id 与任务不一致` })
  }
  if ([2, 3, 4, 5].includes(task.status) && items.length === 0) {
    checks.push({ level: 'error', msg: '进行中任务无明细记录，流程无法推进' })
  }
  if (checks.length === 0) checks.push({ level: 'ok', msg: '数据一致性检查通过' })

  return {
    snapshot: {
      task: {
        id: task.id,
        taskNo: task.task_no,
        status: task.status,
        statusName: WT_STATUS_NAME[task.status] ?? task.status,
        priority: task.priority,
        customerName: task.customer_name,
        warehouseId: task.warehouse_id,
        warehouseName: task.warehouse_name_full,
        assignedName: task.assigned_name,
        sortingBinId: task.sorting_bin_id,
        sortingBinCode: task.sorting_bin_code,
        createdAt: task.created_at,
        updatedAt: task.updated_at,
        shippedAt: task.shipped_at,
      },
      items: items.map(i => ({
        id: i.id,
        productCode: i.product_code,
        productName: i.product_name,
        unit: i.unit,
        requiredQty: Number(i.required_qty),
        pickedQty: Number(i.picked_qty),
        sortedQty: Number(i.sorted_qty ?? 0),
        checkedQty: Number(i.checked_qty ?? 0),
        pickProgress: `${i.picked_qty}/${i.required_qty}`,
        sortProgress: `${i.sorted_qty ?? 0}/${i.picked_qty}`,
        checkProgress: `${i.checked_qty ?? 0}/${i.required_qty}`,
      })),
      sortingBin: sortingBin ? {
        id: sortingBin.id,
        code: sortingBin.code,
        status: sortingBin.status,
        statusName: sortingBin.status === 1 ? '空闲' : '占用',
        currentTaskId: sortingBin.current_task_id,
        consistent: sortingBin.current_task_id === taskId,
      } : null,
      lockedContainers: lockedContainers.map(c => ({
        id: c.id,
        barcode: c.barcode,
        productName: c.product_name,
        remainingQty: Number(c.remaining_qty),
        status: c.status,
        locationCode: c.location_code,
        lockedAt: c.locked_at,
      })),
      packages: packages.map(p => ({
        id: p.id,
        barcode: p.barcode,
        status: p.status,
        statusName: p.status === 2 ? '已完成' : '打包中',
        itemTypes: Number(p.item_types ?? 0),
        totalQty: Number(p.total_qty ?? 0),
      })),
      recentEvents: events,
      recentScanLogs: scanLogs,
      consistencyChecks: checks,
    },
  }
}

async function getShipContext(taskId) {
  const task = await findById(taskId)
  const [[saleOrder]] = await pool.query(
    'SELECT id, order_no, status, warehouse_id, total_amount, customer_name FROM sale_orders WHERE id=?',
    [task.saleOrderId],
  )
  if (!saleOrder) throw new AppError('关联销售单不存在', 404)

  const [wmsItems] = await pool.query(
    `SELECT wti.product_id, wti.product_name, wti.picked_qty, soi.unit_price
     FROM warehouse_task_items wti
     LEFT JOIN sale_order_items soi ON soi.order_id = ? AND soi.product_id = wti.product_id
     WHERE wti.task_id = ?`,
    [saleOrder.id, taskId],
  )
  if (!wmsItems.length) throw new AppError('任务无出库明细', 400)

  return {
    saleOrderId: saleOrder.id,
    warehouseId: saleOrder.warehouse_id,
    totalAmount: Number(saleOrder.total_amount),
    customerName: saleOrder.customer_name,
    items: wmsItems.map(i => ({
      productId: i.product_id,
      productName: i.product_name,
      quantity: Number(i.picked_qty),
      unitPrice: i.unit_price != null ? Number(i.unit_price) : null,
    })),
  }
}

/**
 * 复核：批量更新明细的 checked_qty
 * 当所有明细 checked_qty >= required_qty 时，在任务上记录复核完成时间
 *
 * @param {number} taskId
 * @param {Array<{itemId: number, checkedQty: number}>} items
 */
async function checkItems(taskId, items) {
  void taskId
  void items
  throw new AppError('已禁止手动提交复核数量，请使用 PDA 复核扫码（扫描容器条码）', 400)
}

module.exports = {
  findAll,
  findById,
  findEvents,
  getDebugSnapshot,
  getShipContext,
  findMyTasks,
  findMyTaskSkuSummary,
  getTaskStats,
  createForSaleOrder,
  assign,
  startPicking,
  updatePickedQty,
  readyToShip,
  readyToShipWithinTransaction,
  sortTask,
  sortTaskWithinTransaction,
  checkDoneWithinTransaction,
  checkDone,
  packDone,
  packDoneWithinTransaction,
  ship,
  shipWithinTransaction,
  cancel,
  updatePriority,
  getPickSuggestions,
  getPickRoute,
  checkItems,
  assertTaskPickScanClosure,
  assertTaskCheckScanClosure,
  assertTaskPackagingClosure,
  assertTaskPackagePrintClosure,
}
