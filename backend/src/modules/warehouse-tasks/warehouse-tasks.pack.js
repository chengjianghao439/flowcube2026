const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const { lockStatusRow, compareAndSetStatus } = require('../../utils/statusTransition')
const { isValidTransition, assertWarehouseTaskAction } = require('../../constants/warehouseTaskStatus')
const { WT_EVENT, record: recordEvent } = require('./warehouse-task-events.service')
const { beginOperationRequest, completeOperationRequest } = require('../../utils/operationRequest')
const {
  logSideEffectFailure,
  assertTaskCheckScanClosure,
  assertTaskPackagingClosure,
  assertTaskPackagePrintClosure,
} = require('./warehouse-tasks.helpers')

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

module.exports = {
  packDone,
  packDoneWithinTransaction,
}
