const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const { lockContainer } = require('../../engine/containerEngine')

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
  operatorId:   r.operator_id,
  operatorName: r.operator_name || null,
  locationCode: r.location_code || null,
  scannedAt:    r.scanned_at,
})

/**
 * 执行一次扫描：锁定容器 + 写扫描记录（原子事务）
 */
async function createScanLog({
  taskId, itemId, containerId, barcode, productId,
  qty, scanMode, operatorId, operatorName, locationCode,
}) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()

    // 1a) 整件重复扫描防护：同一任务 + 同一容器 + 整件模式只允许扫一次
    if (scanMode === '整件') {
      const [[dup]] = await conn.query(
        `SELECT id FROM scan_logs
         WHERE task_id = ? AND container_id = ? AND scan_mode = '整件'`,
        [taskId, containerId],
      )
      if (dup) throw new AppError('该容器已整件扫描过，不可重复扫描', 409)
    }

    // 1b) 5秒时间窗防重复：防止网络重试导致同一动作被重复写入
    const [[recent]] = await conn.query(
      `SELECT id FROM scan_logs
       WHERE task_id = ? AND barcode = ? AND scanned_at > NOW() - INTERVAL 5 SECOND`,
      [taskId, barcode],
    )
    if (recent) throw new AppError('请勿重复扫描（5秒内已记录相同条码）', 409)

    // 2) 锁定容器（未锁 → 锁定；已锁且属于本任务 → 放行；被其他任务锁 → 拒绝）
    await lockContainer(conn, containerId, taskId)

    // 3) 写入扫描记录
    const [r] = await conn.query(
      `INSERT INTO scan_logs
         (task_id, item_id, container_id, barcode, product_id,
          qty, scan_mode, operator_id, operator_name, location_code)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [taskId, itemId, containerId, barcode, productId,
       qty, scanMode, operatorId || null, operatorName || null, locationCode || null],
    )

    await conn.commit()
    return { id: r.insertId }
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

module.exports = { createScanLog, findByTask, logScanError, logUndo, getStats, getAnomalyReport }
