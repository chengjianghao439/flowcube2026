const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const { lockContainer, CONTAINER_STATUS } = require('../../engine/containerEngine')
const { WT_STATUS } = require('../../constants/warehouseTaskStatus')
const { checkDoneWithinTransaction, checkCancelReturnClearedAndFinalize } = require('../warehouse-tasks/warehouse-tasks.service')
const { WT_EVENT, record: recordEvent } = require('../warehouse-tasks/warehouse-task-events.service')
const { logSideEffectFailure: logWtSideEffectFailure } = require('../warehouse-tasks/warehouse-tasks.helpers')
const { beginOperationRequest, completeOperationRequest } = require('../../utils/operationRequest')
const logger = require('../../utils/logger')

const fmt = r => ({
  id:           r.id,
  taskId:       r.task_id,
  itemId:       r.item_id,
  containerId:  r.container_id,
  barcode:      r.barcode,
  productId:    r.product_id,
  productName:  r.product_name  || null,
  qty:          Number(r.qty),
  scanMode:     r.scan_mode,
  scanPurpose:  r.scan_purpose != null ? Number(r.scan_purpose) : 1,
  operatorId:   r.operator_id,
  operatorName: r.operator_name || null,
  locationCode: r.location_code || null,
  scannedAt:    r.scanned_at,
})

const SCAN_PURPOSE = { PICK: 1, CHECK: 2, CANCEL_RETURN: 3 }

function logPdaAuditDegradation(message, error, meta = {}) {
  logger.warn(
    message,
    {
      degradation: 'pda_audit_log_failed',
      error: error?.message || String(error),
      ...meta,
    },
    'ScanLogs',
  )
}

async function pdaOptionalQuery(metricName, promise, fallback) {
  try {
    return await promise
  } catch (e) {
    logger.warn(
      'PDA 统计/异常分析可选查询失败，已返回明确降级值',
      {
        metricName,
        degradation: 'pda_report_fallback',
        error: e?.message || String(e),
      },
      'ScanLogs',
    )
    return fallback
  }
}

/**
 * 拣货扫码：锁定容器 + 写 scan_logs(用途=拣货) + 递增 picked_qty（同一事务）
 */
async function createScanLog({
  taskId, itemId, containerId, barcode, productId,
  qty, scanMode, operatorId, operatorName, locationCode,
  requestKey,
}) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const requestState = await beginOperationRequest(conn, {
      requestKey,
      action: 'scan-log.pick',
      userId: operatorId || null,
    })
    if (requestState.replay) {
      await conn.rollback()
      return requestState.responseData
    }

    const [[taskRow]] = await conn.query(
      'SELECT id, warehouse_id, status, cancel_requested_at FROM warehouse_tasks WHERE id = ? AND deleted_at IS NULL FOR UPDATE',
      [taskId],
    )
    if (!taskRow) throw new AppError('仓库任务不存在', 404)
    if (taskRow.cancel_requested_at) {
      throw new AppError('该任务已因订单取消停止拣货，请勿继续', 409)
    }
    if (Number(taskRow.status) !== WT_STATUS.PICKING) {
      throw new AppError('仅「拣货中」任务允许拣货扫码', 400)
    }

    const [[itemRow]] = await conn.query(
      'SELECT id, product_id, required_qty, picked_qty FROM warehouse_task_items WHERE id = ? AND task_id = ? FOR UPDATE',
      [itemId, taskId],
    )
    if (!itemRow) throw new AppError('任务明细不存在', 404)
    if (Number(itemRow.product_id) !== Number(productId)) {
      throw new AppError('商品与任务明细不一致', 400)
    }

    const needRemain = Number(itemRow.required_qty) - Number(itemRow.picked_qty)
    if (qty > needRemain) {
      throw new AppError(`扫码数量超过待拣数量（剩余 ${needRemain}）`, 400)
    }

    const [[containerRow]] = await conn.query(
      `SELECT id, barcode, product_id, warehouse_id, status, remaining_qty, locked_by_task_id
       FROM inventory_containers
       WHERE id = ? AND deleted_at IS NULL
       FOR UPDATE`,
      [containerId],
    )
    if (!containerRow) throw new AppError('容器不存在', 404)
    if (String(containerRow.barcode) !== String(barcode)) {
      throw new AppError('容器条码不匹配', 400)
    }
    if (Number(containerRow.product_id) !== Number(itemRow.product_id)) {
      throw new AppError('容器商品不属于当前任务明细', 400)
    }
    if (Number(containerRow.warehouse_id) !== Number(taskRow.warehouse_id)) {
      throw new AppError('容器仓库与任务仓库不一致', 400)
    }
    if (Number(containerRow.status) !== CONTAINER_STATUS.ACTIVE) {
      throw new AppError('容器状态不可拣货', 400)
    }
    const remainingQty = Number(containerRow.remaining_qty)
    if (remainingQty <= 0) {
      throw new AppError('容器库存不足', 400)
    }
    if (qty > remainingQty) {
      throw new AppError(`扫码数量超过容器可用数量（剩余 ${remainingQty}）`, 400)
    }
    if (
      containerRow.locked_by_task_id != null
      && Number(containerRow.locked_by_task_id) !== Number(taskId)
    ) {
      throw new AppError('容器已被其它任务锁定', 409)
    }

    if (scanMode === '整件') {
      const [[dup]] = await conn.query(
        `SELECT id FROM scan_logs
         WHERE task_id = ? AND container_id = ? AND scan_mode = '整件'
           AND COALESCE(scan_purpose, ${SCAN_PURPOSE.PICK}) = ${SCAN_PURPOSE.PICK}`,
        [taskId, containerId],
      )
      if (dup) throw new AppError('该容器已整件扫描过，不可重复扫描', 409)
    }

    const [[recent]] = await conn.query(
      `SELECT id FROM scan_logs
       WHERE task_id = ? AND barcode = ? AND scanned_at > NOW() - INTERVAL 5 SECOND`,
      [taskId, barcode],
    )
    if (recent) throw new AppError('请勿重复扫描（5秒内已记录相同条码）', 409)

    await lockContainer(conn, containerId, taskId, {
      expectedProductId: itemRow.product_id,
      expectedWarehouseId: taskRow.warehouse_id,
      expectedBarcode: barcode,
      minRemainingQty: qty,
      expectedStatus: CONTAINER_STATUS.ACTIVE,
    })

    const [r] = await conn.query(
      `INSERT INTO scan_logs
         (task_id, item_id, container_id, barcode, product_id,
          qty, scan_mode, scan_purpose, operator_id, operator_name, location_code)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [taskId, itemId, containerId, containerRow.barcode, itemRow.product_id,
        qty, scanMode, SCAN_PURPOSE.PICK, operatorId || null, operatorName || null, locationCode || null],
    )

    const [upd] = await conn.query(
      `UPDATE warehouse_task_items
       SET picked_qty = picked_qty + ?
       WHERE id = ? AND task_id = ? AND picked_qty + ? <= required_qty`,
      [qty, itemId, taskId, qty],
    )
    if (upd.affectedRows !== 1) {
      throw new AppError('更新已拣数量失败（可能超出需求或并发冲突）', 409)
    }

    const payload = { id: r.insertId }
    await completeOperationRequest(conn, requestState, {
      data: payload,
      message: '扫描记录已保存',
      resourceType: 'scan_log',
      resourceId: r.insertId,
    })
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
 * 复核扫码：须为「待复核」任务；容器须本任务锁定且已有拣货扫码；按容器确认剩余拣货量并累加 checked_qty
 */
async function createCheckScanLog({
  taskId, barcode, operatorId, operatorName,
  requestKey,
}) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const requestState = await beginOperationRequest(conn, {
      requestKey,
      action: 'scan-log.check',
      userId: operatorId || null,
    })
    if (requestState.replay) {
      await conn.rollback()
      return requestState.responseData
    }

    const [[taskRow]] = await conn.query(
      'SELECT id, status, warehouse_id, cancel_requested_at FROM warehouse_tasks WHERE id = ? AND deleted_at IS NULL FOR UPDATE',
      [taskId],
    )
    if (!taskRow) throw new AppError('仓库任务不存在', 404)
    if (Number(taskRow.status) !== WT_STATUS.CHECKING) {
      throw new AppError('仅「待复核」任务允许复核扫码', 400)
    }
    if (taskRow.cancel_requested_at) {
      throw new AppError('该任务正在取消收尾中，不可继续复核', 409)
    }

    const [[c]] = await conn.query(
      `SELECT id, product_id, locked_by_task_id, warehouse_id
       FROM inventory_containers
       WHERE barcode = ? AND warehouse_id = ? AND deleted_at IS NULL
       FOR UPDATE`,
      [barcode, taskRow.warehouse_id],
    )
    if (!c) throw new AppError('容器不存在或不属于本仓', 404)
    if (Number(c.locked_by_task_id) !== Number(taskId)) {
      throw new AppError('该容器未锁定于当前任务，无法复核', 400)
    }

    const [pickGroups] = await conn.query(
      `SELECT item_id, COALESCE(SUM(qty), 0) AS pick_sum
       FROM scan_logs
       WHERE task_id = ? AND container_id = ? AND COALESCE(scan_purpose, 1) = ?
       GROUP BY item_id`,
      [taskId, c.id, SCAN_PURPOSE.PICK],
    )
    if (!pickGroups.length) {
      throw new AppError('该容器无拣货扫码记录，请先完成拣货', 400)
    }

    let targetItemId = null
    let addQty = 0
    for (const g of pickGroups) {
      const [[chk]] = await conn.query(
        `SELECT COALESCE(SUM(qty), 0) AS s FROM scan_logs
         WHERE task_id = ? AND container_id = ? AND item_id = ? AND scan_purpose = ?`,
        [taskId, c.id, g.item_id, SCAN_PURPOSE.CHECK],
      )
      const remain = Number(g.pick_sum) - Number(chk.s)
      if (remain > 0) {
        targetItemId = g.item_id
        addQty = remain
        break
      }
    }
    if (!targetItemId || addQty <= 0) {
      throw new AppError('该容器已完成复核扫码', 409)
    }

    const [[itemRow]] = await conn.query(
      'SELECT id, product_id, picked_qty, checked_qty FROM warehouse_task_items WHERE id = ? AND task_id = ? FOR UPDATE',
      [targetItemId, taskId],
    )
    if (!itemRow) throw new AppError('任务明细不存在', 404)
    if (Number(itemRow.product_id) !== Number(c.product_id)) {
      throw new AppError('容器商品与任务明细不一致', 400)
    }
    const nextChecked = Number(itemRow.checked_qty) + addQty
    if (nextChecked > Number(itemRow.picked_qty)) {
      throw new AppError('复核累计将超过拣货数量', 400)
    }

    const [[recent]] = await conn.query(
      `SELECT id FROM scan_logs
       WHERE task_id = ? AND barcode = ? AND scan_purpose = ?
         AND scanned_at > NOW() - INTERVAL 5 SECOND`,
      [taskId, barcode, SCAN_PURPOSE.CHECK],
    )
    if (recent) throw new AppError('请勿重复扫描（5秒内已记录相同条码）', 409)

    const [ins] = await conn.query(
      `INSERT INTO scan_logs
         (task_id, item_id, container_id, barcode, product_id,
          qty, scan_mode, scan_purpose, operator_id, operator_name, location_code)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [taskId, targetItemId, c.id, barcode, c.product_id,
        addQty, '整件', SCAN_PURPOSE.CHECK, operatorId || null, operatorName || null, null],
    )

    const [upd] = await conn.query(
      `UPDATE warehouse_task_items
       SET checked_qty = checked_qty + ?
       WHERE id = ? AND task_id = ? AND checked_qty + ? <= picked_qty`,
      [addQty, targetItemId, taskId, addQty],
    )
    if (upd.affectedRows !== 1) {
      throw new AppError('更新复核数量失败', 409)
    }

    const [allItems] = await conn.query(
      'SELECT picked_qty, checked_qty FROM warehouse_task_items WHERE task_id = ?',
      [taskId],
    )
    const allChecked = allItems.length > 0 && allItems.every(
      row => Number(row.checked_qty) === Number(row.picked_qty),
    )
    if (allChecked) {
      await checkDoneWithinTransaction(conn, taskId)
    }

    const payload = { id: ins.insertId, allChecked, itemId: targetItemId, qty: addQty }
    await completeOperationRequest(conn, requestState, {
      data: payload,
      message: allChecked ? '复核完成，已进入待打包' : '复核扫码已记录',
      resourceType: 'scan_log',
      resourceId: ins.insertId,
    })
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
 * 取消逆向归还扫码：逐容器确认放回原库位，解锁容器。
 * 仓库/PDA 一侧只负责执行扫码核对，不做"放哪儿"的决策——容器的 location_id
 * 在整个拣货过程中从未被移动过（lockContainer 只锁定，不改库位），系统本来就
 * 知道这个容器该回哪儿，所以强制要求扫入的库位必须等于容器当前 location_id，
 * 不接受操作员自行选择的其它库位。
 * 归还完该任务名下最后一个容器时，在同一事务内触发 finalizeCancelWithinTransaction
 * 真正把任务推进为已取消(8)、释放分拣格。
 */
async function createCancelReturnScanLog({
  taskId, containerId, barcode, locationId,
  operatorId, operatorName, requestKey,
}) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const requestState = await beginOperationRequest(conn, {
      requestKey,
      action: 'scan-log.cancel-return',
      userId: operatorId || null,
    })
    if (requestState.replay) {
      await conn.rollback()
      return requestState.responseData
    }

    const [[taskRow]] = await conn.query(
      'SELECT id, task_no, status, warehouse_id, cancel_requested_at FROM warehouse_tasks WHERE id = ? AND deleted_at IS NULL FOR UPDATE',
      [taskId],
    )
    if (!taskRow) throw new AppError('仓库任务不存在', 404)
    if (!taskRow.cancel_requested_at) {
      throw new AppError('该任务未处于取消收尾状态，无需归还扫码', 400)
    }

    const [[c]] = await conn.query(
      `SELECT id, barcode, product_id, remaining_qty, locked_by_task_id, warehouse_id, location_id
       FROM inventory_containers WHERE id = ? AND deleted_at IS NULL FOR UPDATE`,
      [containerId],
    )
    if (!c) throw new AppError('容器不存在', 404)
    if (Number(c.locked_by_task_id) !== Number(taskId)) {
      throw new AppError('该容器不属于当前任务的待归还清单（可能已被归还或不属于本任务）', 400)
    }
    if (String(c.barcode) !== String(barcode)) {
      throw new AppError('容器条码不匹配', 400)
    }

    const [[loc]] = await conn.query(
      `SELECT id, code, warehouse_id, status FROM warehouse_locations
       WHERE id = ? AND deleted_at IS NULL AND status = 1 FOR UPDATE`,
      [locationId],
    )
    if (!loc) throw new AppError('库位不存在或已停用', 404)
    if (Number(loc.warehouse_id) !== Number(taskRow.warehouse_id)) {
      throw new AppError('库位与任务所属仓库不一致', 400)
    }
    if (c.location_id == null || Number(loc.id) !== Number(c.location_id)) {
      const [[originalLoc]] = c.location_id
        ? await conn.query('SELECT code FROM warehouse_locations WHERE id = ?', [c.location_id])
        : [[null]]
      throw new AppError(
        originalLoc ? `必须放回原库位 ${originalLoc.code}，不能放到其它库位` : '该容器原库位信息缺失，无法归还，请联系管理员',
        400,
      )
    }

    const [[itemRow]] = await conn.query(
      'SELECT id FROM warehouse_task_items WHERE task_id = ? AND product_id = ? LIMIT 1',
      [taskId, c.product_id],
    )
    if (!itemRow) throw new AppError('容器商品不属于当前任务，数据异常', 409)

    await conn.query(
      `UPDATE inventory_containers
       SET locked_by_task_id = NULL, locked_at = NULL, location_id = ?
       WHERE id = ?`,
      [locationId, c.id],
    )

    const [ins] = await conn.query(
      `INSERT INTO scan_logs
         (task_id, item_id, container_id, barcode, product_id,
          qty, scan_mode, scan_purpose, operator_id, operator_name, location_code)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [taskId, itemRow.id, c.id, barcode, c.product_id,
        Number(c.remaining_qty), '归还', SCAN_PURPOSE.CANCEL_RETURN, operatorId || null, operatorName || null, loc.code],
    )

    try {
      await recordEvent(conn, {
        taskId: Number(taskId), taskNo: taskRow.task_no,
        eventType: WT_EVENT.CANCEL_RETURN_SCAN,
        operatorId: operatorId || null,
        operatorName: operatorName || null,
        detail: { containerId: c.id, barcode: c.barcode, locationCode: loc.code },
      })
    } catch (eventErr) {
      logWtSideEffectFailure('仓库任务事件写入失败：取消归还扫码事件', eventErr, {
        taskId: Number(taskId),
        taskNo: taskRow.task_no,
        eventType: WT_EVENT.CANCEL_RETURN_SCAN,
      })
    }

    const { containersRemaining, packagesRemaining, finalized } =
      await checkCancelReturnClearedAndFinalize(conn, taskId)

    const payload = {
      id: ins.insertId,
      remaining: containersRemaining,
      packagesRemaining,
      finalized,
    }
    await completeOperationRequest(conn, requestState, {
      data: payload,
      message: finalized
        ? '归还完成，任务已取消'
        : `已归还，剩余 ${containersRemaining} 个容器 / ${packagesRemaining} 个箱子待处理`,
      resourceType: 'scan_log',
      resourceId: ins.insertId,
    })
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
 * 取消逆向归还 — 已完成箱子拆箱确认扫码：仓库侧只负责扫码核对"这个箱子已经处理"，
 * 不需要第二步扫库位——箱子拆散后里面的商品对应的容器仍然完整未动（装箱本身不影响
 * 容器库存数字，见 warehouse-tasks.cancel-return.js 顶部说明），走的是同一批容器
 * 各自的原库位归还流程，箱子本身没有一个"应该被扫回哪里"的答案。
 */
async function createCancelReturnBoxScanLog({
  taskId, packageId, barcode, operatorId, operatorName, requestKey,
}) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const requestState = await beginOperationRequest(conn, {
      requestKey,
      action: 'scan-log.cancel-return-box',
      userId: operatorId || null,
    })
    if (requestState.replay) {
      await conn.rollback()
      return requestState.responseData
    }

    const [[taskRow]] = await conn.query(
      'SELECT id, task_no, cancel_requested_at FROM warehouse_tasks WHERE id = ? AND deleted_at IS NULL FOR UPDATE',
      [taskId],
    )
    if (!taskRow) throw new AppError('仓库任务不存在', 404)
    if (!taskRow.cancel_requested_at) {
      throw new AppError('该任务未处于取消收尾状态，无需拆箱确认', 400)
    }

    const [[pkg]] = await conn.query(
      'SELECT id, barcode, status FROM packages WHERE id = ? AND warehouse_task_id = ? FOR UPDATE',
      [packageId, taskId],
    )
    if (!pkg) throw new AppError('该箱子不属于当前任务的待拆箱清单', 400)
    if (String(pkg.barcode) !== String(barcode)) throw new AppError('箱子条码不匹配', 400)
    if (Number(pkg.status) !== 2) throw new AppError('该箱不在待拆箱确认状态（可能已处理）', 409)

    await conn.query('UPDATE packages SET status = 3 WHERE id = ?', [pkg.id])
    await conn.query(
      `UPDATE print_jobs SET status = 3, error_message = '仓库任务取消收尾：箱子已拆箱作废'
       WHERE ref_type = 'package' AND ref_id = ? AND status IN (0, 1)`,
      [pkg.id],
    )

    try {
      await recordEvent(conn, {
        taskId: Number(taskId), taskNo: taskRow.task_no,
        eventType: WT_EVENT.CANCEL_RETURN_BOX_SCAN,
        operatorId: operatorId || null,
        operatorName: operatorName || null,
        detail: { packageId: pkg.id, barcode: pkg.barcode },
      })
    } catch (eventErr) {
      logWtSideEffectFailure('仓库任务事件写入失败：取消归还拆箱确认事件', eventErr, {
        taskId: Number(taskId),
        taskNo: taskRow.task_no,
        eventType: WT_EVENT.CANCEL_RETURN_BOX_SCAN,
      })
    }

    const { containersRemaining, packagesRemaining, finalized } =
      await checkCancelReturnClearedAndFinalize(conn, taskId)

    const payload = { id: pkg.id, containersRemaining, packagesRemaining, finalized }
    await completeOperationRequest(conn, requestState, {
      data: payload,
      message: finalized
        ? '拆箱确认完成，任务已取消'
        : `已确认拆箱，剩余 ${containersRemaining} 个容器 / ${packagesRemaining} 个箱子待处理`,
      resourceType: 'scan_log',
      resourceId: pkg.id,
    })
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
 * 查询某任务的扫描记录
 */
async function findByTask(taskId) {
  const [rows] = await pool.query(
    `SELECT sl.*, p.name AS product_name
     FROM scan_logs sl
     LEFT JOIN product_items p ON p.id = sl.product_id
     WHERE sl.task_id = ?
     ORDER BY sl.scanned_at DESC`,
    [taskId],
  )
  return rows.map(fmt)
}

/**
 * 记录错误扫码事件（不写 scan_logs，写单独的 pda_error_logs）
 * 如果表不存在则自动创建（轻量级，避免迁移依赖）
 */
async function logScanError({ taskId, barcode, reason, operatorId, operatorName }) {
  try {
    await pool.query(
      `CREATE TABLE IF NOT EXISTS pda_error_logs (
        id            INT AUTO_INCREMENT PRIMARY KEY,
        task_id       INT,
        barcode       VARCHAR(64),
        reason        VARCHAR(255),
        operator_id   INT,
        operator_name VARCHAR(64),
        created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    )
    await pool.query(
      `INSERT INTO pda_error_logs (task_id, barcode, reason, operator_id, operator_name)
       VALUES (?,?,?,?,?)`,
      [taskId || null, barcode || null, reason || null, operatorId || null, operatorName || null],
    )
  } catch (e) {
    logPdaAuditDegradation('PDA 错误扫码日志写入失败，主流程继续', e, {
      taskId: taskId || null,
      barcode: barcode || null,
      reason: reason || null,
      operatorId: operatorId || null,
    })
  }
}

/**
 * 记录撤销操作
 */
async function logUndo({ taskId, itemId, barcode, prevQty, newQty, operatorId, operatorName }) {
  try {
    await pool.query(
      `CREATE TABLE IF NOT EXISTS pda_undo_logs (
        id            INT AUTO_INCREMENT PRIMARY KEY,
        task_id       INT,
        item_id       INT,
        barcode       VARCHAR(64),
        prev_qty      DECIMAL(10,2),
        new_qty       DECIMAL(10,2),
        operator_id   INT,
        operator_name VARCHAR(64),
        created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    )
    await pool.query(
      `INSERT INTO pda_undo_logs (task_id, item_id, barcode, prev_qty, new_qty, operator_id, operator_name)
       VALUES (?,?,?,?,?,?,?)`,
      [taskId, itemId, barcode, prevQty, newQty, operatorId || null, operatorName || null],
    )
  } catch (e) {
    logPdaAuditDegradation('PDA 撤销日志写入失败，主流程继续', e, {
      taskId,
      itemId,
      barcode,
      operatorId: operatorId || null,
    })
  }
}

/**
 * 操作统计：每人扫码量、错误率（按日期范围）
 */
async function getStats({ startDate, endDate } = {}) {
  const dateFilter = startDate && endDate
    ? `AND sl.scanned_at BETWEEN ? AND ?`
    : ''
  const params = startDate && endDate ? [startDate, endDate] : []

  const [scanRows] = await pool.query(
    `SELECT
       operator_id   AS operatorId,
       operator_name AS operatorName,
       COUNT(*)      AS scanCount,
       SUM(qty)      AS totalQty
     FROM scan_logs sl
     WHERE operator_id IS NOT NULL ${dateFilter}
     GROUP BY operator_id, operator_name
     ORDER BY scanCount DESC`,
    params,
  )

  const [errRows] = await pdaOptionalQuery('stats.errorRows', pool.query(
    `SELECT
       operator_id   AS operatorId,
       COUNT(*)      AS errorCount
     FROM pda_error_logs
     WHERE operator_id IS NOT NULL ${dateFilter.replace('sl.scanned_at', 'created_at')}
     GROUP BY operator_id`,
    params,
  ), [[]])

  const errMap = Object.fromEntries(errRows.map(r => [r.operatorId, Number(r.errorCount)]))

  return scanRows.map(r => ({
    operatorId:   r.operatorId,
    operatorName: r.operatorName,
    scanCount:    Number(r.scanCount),
    totalQty:     Number(r.totalQty),
    errorCount:   errMap[r.operatorId] ?? 0,
    errorRate:    Number(r.scanCount) > 0
      ? ((errMap[r.operatorId] ?? 0) / Number(r.scanCount) * 100).toFixed(1) + '%'
      : '0%',
  }))
}

/**
 * 详细异常分析：按操作员 / 条码 / 错误原因 / 日期趋势
 */
async function getAnomalyReport({ startDate, endDate } = {}) {
  const hasDate = startDate && endDate
  const dateParams = hasDate ? [startDate, endDate] : []
  const dateFilter = hasDate ? 'AND created_at BETWEEN ? AND ?' : ''

  // 确保表存在
  await pdaOptionalQuery('anomaly.ensurePdaErrorLogs', pool.query(`CREATE TABLE IF NOT EXISTS pda_error_logs (
    id INT AUTO_INCREMENT PRIMARY KEY, task_id INT, barcode VARCHAR(64),
    reason VARCHAR(255), operator_id INT, operator_name VARCHAR(64),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`), null)
  await pdaOptionalQuery('anomaly.ensurePdaUndoLogs', pool.query(`CREATE TABLE IF NOT EXISTS pda_undo_logs (
    id INT AUTO_INCREMENT PRIMARY KEY, task_id INT, item_id INT, barcode VARCHAR(64),
    prev_qty DECIMAL(10,2), new_qty DECIMAL(10,2), operator_id INT, operator_name VARCHAR(64),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`), null)

  // 1. 按操作员统计错误
  const [byOperator] = await pdaOptionalQuery('anomaly.byOperator', pool.query(
    `SELECT operator_id AS operatorId, operator_name AS operatorName,
       COUNT(*) AS errorCount
     FROM pda_error_logs WHERE 1=1 ${dateFilter}
     GROUP BY operator_id, operator_name ORDER BY errorCount DESC LIMIT 20`,
    dateParams,
  ), [[]])

  // 2. 按错误原因分类
  const [byReason] = await pdaOptionalQuery('anomaly.byReason', pool.query(
    `SELECT reason, COUNT(*) AS cnt
     FROM pda_error_logs WHERE 1=1 ${dateFilter}
     GROUP BY reason ORDER BY cnt DESC LIMIT 10`,
    dateParams,
  ), [[]])

  // 3. 按条码统计（哪类商品最容易出错）
  const [byBarcode] = await pdaOptionalQuery('anomaly.byBarcode', pool.query(
    `SELECT barcode, COUNT(*) AS cnt
     FROM pda_error_logs WHERE 1=1 ${dateFilter}
     GROUP BY barcode ORDER BY cnt DESC LIMIT 10`,
    dateParams,
  ), [[]])

  // 4. 撤销统计按操作员
  const [undoByOperator] = await pdaOptionalQuery('anomaly.undoByOperator', pool.query(
    `SELECT operator_id AS operatorId, operator_name AS operatorName,
       COUNT(*) AS undoCount
     FROM pda_undo_logs WHERE 1=1 ${dateFilter}
     GROUP BY operator_id, operator_name ORDER BY undoCount DESC LIMIT 20`,
    dateParams,
  ), [[]])

  // 5. 每日趋势
  const [dailyTrend] = await pdaOptionalQuery('anomaly.dailyTrend', pool.query(
    `SELECT DATE(created_at) AS date, COUNT(*) AS errorCount
     FROM pda_error_logs WHERE 1=1 ${dateFilter}
     GROUP BY DATE(created_at) ORDER BY date ASC`,
    dateParams,
  ), [[]])

  // 6. 总体汇总
  const [[summary]] = await pdaOptionalQuery('anomaly.summary', pool.query(
    `SELECT
       (SELECT COUNT(*) FROM pda_error_logs WHERE 1=1 ${dateFilter}) AS totalErrors,
       (SELECT COUNT(*) FROM pda_undo_logs  WHERE 1=1 ${dateFilter}) AS totalUndos,
       (SELECT COUNT(*) FROM scan_logs WHERE 1=1 ${dateFilter.replace('created_at','scanned_at')}) AS totalScans`,
    [...dateParams, ...dateParams, ...dateParams],
  ), [[{ totalErrors: 0, totalUndos: 0, totalScans: 0 }]])

  return {
    summary: {
      totalScans:  Number(summary?.totalScans  ?? 0),
      totalErrors: Number(summary?.totalErrors ?? 0),
      totalUndos:  Number(summary?.totalUndos  ?? 0),
      errorRate:   summary?.totalScans > 0
        ? ((summary.totalErrors / summary.totalScans) * 100).toFixed(1) + '%'
        : '0%',
    },
    byOperator:    byOperator.map(r => ({ ...r, errorCount: Number(r.errorCount) })),
    byReason:      byReason.map(r => ({ reason: r.reason, count: Number(r.cnt) })),
    byBarcode:     byBarcode.map(r => ({ barcode: r.barcode, count: Number(r.cnt) })),
    undoByOperator: undoByOperator.map(r => ({ ...r, undoCount: Number(r.undoCount) })),
    dailyTrend:    dailyTrend.map(r => ({ date: r.date, errorCount: Number(r.errorCount) })),
  }
}

module.exports = {
  createScanLog,
  createCheckScanLog,
  createCancelReturnScanLog,
  createCancelReturnBoxScanLog,
  findByTask,
  logScanError,
  logUndo,
  getStats,
  getAnomalyReport,
}
