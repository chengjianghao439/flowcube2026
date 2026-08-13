const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const { lockStatusRow, compareAndSetStatus } = require('../../utils/statusTransition')
const { isValidTransition, assertWarehouseTaskAction } = require('../../constants/warehouseTaskStatus')
const { WT_EVENT, record: recordEvent } = require('./warehouse-task-events.service')
const { logSideEffectFailure, assertTaskCheckScanClosure } = require('./warehouse-tasks.helpers')

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
    columns: 'id, task_no, status, cancel_requested_at, adjustment_requested_at',
    entityName: '仓库任务',
  })
  if (taskRow.cancel_requested_at) {
    throw new AppError('该任务正在拣货退回中，不可继续复核', 409)
  }
  if (taskRow.adjustment_requested_at) {
    throw new AppError('该任务有改单正在等待仓库确认，请先处理完成', 409)
  }
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
  checkDone,
  checkDoneWithinTransaction,
  checkItems,
}
