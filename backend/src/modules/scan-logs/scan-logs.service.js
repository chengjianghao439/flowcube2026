const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const { lockContainer } = require('../../engine/containerEngine')
const { WT_STATUS } = require('../../constants/warehouseTaskStatus')
const { beginOperationRequest, completeOperationRequest } = require('../../utils/operationRequest')

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

const SCAN_PURPOSE = { PICK: 1, CHECK: 2 }

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
      'SELECT id, status FROM warehouse_tasks WHERE id = ? AND deleted_at IS NULL FOR UPDATE',
      [taskId],
    )
    if (!taskRow) throw new AppError('仓库任务不存在', 404)
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

    await lockContainer(conn, containerId, taskId)

    const [r] = await conn.query(
      `INSERT INTO scan_logs
         (task_id, item_id, container_id, barcode, product_id,
          qty, scan_mode, scan_purpose, operator_id, operator_name, location_code)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [taskId, itemId, containerId, barcode, productId,
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
      'SELECT id, status, warehouse_id FROM warehouse_tasks WHERE id = ? AND deleted_at IS NULL FOR UPDATE',
      [taskId],
    )
    if (!taskRow) throw new AppError('仓库任务不存在', 404)
    if (Number(taskRow.status) !== WT_STATUS.CHECKING) {
      throw new AppError('仅「待复核」任务允许复核扫码', 400)
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
      const [rSt] = await conn.query(
        'UPDATE warehouse_tasks SET status = ? WHERE id = ? AND status = ?',
        [WT_STATUS.PACKING, taskId, WT_STATUS.CHECKING],
      )
      if (rSt.affectedRows === 0) {
        throw new AppError('任务状态已变更，请刷新后重试', 409)
      }
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
  } catch { /* 日志写入失败不影响主流程 */ }
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
  } catch { /* 日志写入失败不影响主流程 */ }
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

  const [errRows] = await pool.query(
    `SELECT
       operator_id   AS operatorId,
       COUNT(*)      AS errorCount
     FROM pda_error_logs
     WHERE operator_id IS NOT NULL ${dateFilter.replace('sl.scanned_at', 'created_at')}
     GROUP BY operator_id`,
    params,
  ).catch(() => [[]])

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
  await pool.query(`CREATE TABLE IF NOT EXISTS pda_error_logs (
    id INT AUTO_INCREMENT PRIMARY KEY, task_id INT, barcode VARCHAR(64),
    reason VARCHAR(255), operator_id INT, operator_name VARCHAR(64),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`).catch(() => {})
  await pool.query(`CREATE TABLE IF NOT EXISTS pda_undo_logs (
    id INT AUTO_INCREMENT PRIMARY KEY, task_id INT, item_id INT, barcode VARCHAR(64),
    prev_qty DECIMAL(10,2), new_qty DECIMAL(10,2), operator_id INT, operator_name VARCHAR(64),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`).catch(() => {})

  // 1. 按操作员统计错误
  const [byOperator] = await pool.query(
    `SELECT operator_id AS operatorId, operator_name AS operatorName,
       COUNT(*) AS errorCount
     FROM pda_error_logs WHERE 1=1 ${dateFilter}
     GROUP BY operator_id, operator_name ORDER BY errorCount DESC LIMIT 20`,
    dateParams,
  ).catch(() => [[]])

  // 2. 按错误原因分类
  const [byReason] = await pool.query(
    `SELECT reason, COUNT(*) AS cnt
     FROM pda_error_logs WHERE 1=1 ${dateFilter}
     GROUP BY reason ORDER BY cnt DESC LIMIT 10`,
    dateParams,
  ).catch(() => [[]])

  // 3. 按条码统计（哪类商品最容易出错）
  const [byBarcode] = await pool.query(
    `SELECT barcode, COUNT(*) AS cnt
     FROM pda_error_logs WHERE 1=1 ${dateFilter}
     GROUP BY barcode ORDER BY cnt DESC LIMIT 10`,
    dateParams,
  ).catch(() => [[]])

  // 4. 撤销统计按操作员
  const [undoByOperator] = await pool.query(
    `SELECT operator_id AS operatorId, operator_name AS operatorName,
       COUNT(*) AS undoCount
     FROM pda_undo_logs WHERE 1=1 ${dateFilter}
     GROUP BY operator_id, operator_name ORDER BY undoCount DESC LIMIT 20`,
    dateParams,
  ).catch(() => [[]])

  // 5. 每日趋势
  const [dailyTrend] = await pool.query(
    `SELECT DATE(created_at) AS date, COUNT(*) AS errorCount
     FROM pda_error_logs WHERE 1=1 ${dateFilter}
     GROUP BY DATE(created_at) ORDER BY date ASC`,
    dateParams,
  ).catch(() => [[]])

  // 6. 总体汇总
  const [[summary]] = await pool.query(
    `SELECT
       (SELECT COUNT(*) FROM pda_error_logs WHERE 1=1 ${dateFilter}) AS totalErrors,
       (SELECT COUNT(*) FROM pda_undo_logs  WHERE 1=1 ${dateFilter}) AS totalUndos,
       (SELECT COUNT(*) FROM scan_logs WHERE 1=1 ${dateFilter.replace('created_at','scanned_at')}) AS totalScans`,
    [...dateParams, ...dateParams, ...dateParams],
  ).catch(() => [[{ totalErrors: 0, totalUndos: 0, totalScans: 0 }]])

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
  findByTask,
  logScanError,
  logUndo,
  getStats,
  getAnomalyReport,
}
