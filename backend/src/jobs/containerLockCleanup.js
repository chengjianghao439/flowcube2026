/**
 * 容器锁兜底释放（销售拣货闭环）
 * - 终态任务上残留锁（异常中断）
 * - 拣货中任务：locked_at 超过阈值且无续锁（依赖 lockContainer 每次扫码刷新 locked_at）
 */
const { pool } = require('../config/db')
const { WT_STATUS } = require('../constants/warehouseTaskStatus')
const logger = require('../utils/logger')

const _mins = Number(process.env.STALE_CONTAINER_LOCK_MINUTES)
const STALE_PICKING_LOCK_MINUTES = Number.isFinite(_mins) && _mins >= 5 && _mins <= 10080
  ? Math.floor(_mins)
  : 30

async function releaseLocksForTerminalTasks() {
  const [r] = await pool.query(
    `UPDATE inventory_containers c
     INNER JOIN warehouse_tasks wt ON wt.id = c.locked_by_task_id
     SET c.locked_by_task_id = NULL, c.locked_at = NULL
     WHERE wt.status IN (?, ?)`,
    [WT_STATUS.SHIPPED, WT_STATUS.CANCELLED],
  )
  return r.affectedRows
}

async function releaseStalePickingLocks() {
  const [r] = await pool.query(
    `UPDATE inventory_containers c
     INNER JOIN warehouse_tasks wt ON wt.id = c.locked_by_task_id
     SET c.locked_by_task_id = NULL, c.locked_at = NULL
     WHERE wt.status = ?
       AND c.locked_at IS NOT NULL
       AND c.locked_at < NOW() - INTERVAL ${STALE_PICKING_LOCK_MINUTES} MINUTE`,
    [WT_STATUS.PICKING],
  )
  return r.affectedRows
}

async function runContainerLockCleanup() {
  let terminal = 0
  let stale = 0
  try {
    terminal = await releaseLocksForTerminalTasks()
    stale = await releaseStalePickingLocks()
    if (terminal > 0 || stale > 0) {
      logger.info(
        `容器锁清理：终态释放 ${terminal} 条，拣货超时释放 ${stale} 条`,
        {},
        'ContainerLockCleanup',
      )
    }
  } catch (e) {
    logger.error('容器锁清理失败', e, {}, 'ContainerLockCleanup')
  }
  return { terminal, stale }
}

module.exports = {
  runContainerLockCleanup,
  releaseLocksForTerminalTasks,
  releaseStalePickingLocks,
  STALE_PICKING_LOCK_MINUTES,
}
