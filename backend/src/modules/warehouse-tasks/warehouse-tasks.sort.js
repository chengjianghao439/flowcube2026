const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const { lockStatusRow, compareAndSetStatus } = require('../../utils/statusTransition')
const sortingBinSvc = require('../sorting-bins/sorting-bins.service')
const { isValidTransition, assertWarehouseTaskAction } = require('../../constants/warehouseTaskStatus')
const { WT_EVENT, record: recordEvent } = require('./warehouse-task-events.service')
const { beginOperationRequest, completeOperationRequest } = require('../../utils/operationRequest')
const { logSideEffectFailure, assertTaskPickScanClosure, assertTaskScope } = require('./warehouse-tasks.helpers')

/**
 * 分拣完成，自动推进到「待复核」（3→4）
 * 接收已分拣的 item 列表，后端校验全部完成后自动推进
 * @param {number} id - 任务ID
 * @param {Array<{itemId: number, sortedQty: number}>} [sortedItems] - 可选，逐件上报时传入；不传则视为整任务完成
 */
async function sortTaskWithinTransaction(conn, id, sortedItems = null, { requestKey, userId, scopeWarehouseIds = null, pdaWarehouseId = null } = {}) {
  const taskRow = await lockStatusRow(conn, {
    table: 'warehouse_tasks',
    id,
    columns: 'id, task_no, status, sorting_bin_id, sorting_bin_code, cancel_requested_at, adjustment_requested_at, warehouse_id',
    entityName: '仓库任务',
  })
  assertTaskScope(taskRow, { scopeWarehouseIds, pdaWarehouseId })
  if (taskRow.cancel_requested_at) {
    throw new AppError('该任务正在拣货退回中，不可继续分拣', 409)
  }
  if (taskRow.adjustment_requested_at) {
    throw new AppError('该任务有改单正在等待仓库确认，请先处理完成', 409)
  }
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

  if (sortedItems != null && !Array.isArray(sortedItems)) {
    throw new AppError('分拣明细格式无效', 400)
  }

  if (Array.isArray(sortedItems)) {
    if (!sortedItems.length) throw new AppError('分拣明细不能为空', 400)
    const [taskItems] = await conn.query(
      'SELECT id, picked_qty FROM warehouse_task_items WHERE task_id=? FOR UPDATE',
      [id],
    )
    const itemMap = new Map(taskItems.map(item => [Number(item.id), Number(item.picked_qty)]))
    const seenItemIds = new Set()
    for (const { itemId, sortedQty } of sortedItems) {
      const normalizedItemId = Number(itemId)
      const normalizedSortedQty = Number(sortedQty)
      if (!Number.isInteger(normalizedItemId) || normalizedItemId <= 0) {
        throw new AppError('分拣明细无效', 400)
      }
      if (seenItemIds.has(normalizedItemId)) {
        throw new AppError('分拣明细不能重复提交', 400)
      }
      seenItemIds.add(normalizedItemId)
      if (!itemMap.has(normalizedItemId)) {
        throw new AppError('分拣明细不属于当前任务', 400)
      }
      const pickedQty = itemMap.get(normalizedItemId)
      if (!Number.isFinite(normalizedSortedQty) || normalizedSortedQty < 0) {
        throw new AppError('分拣数量必须为大于或等于 0 的有效数字', 400)
      }
      if (normalizedSortedQty > pickedQty) {
        throw new AppError('分拣数量不能超过已拣数量', 400)
      }
      await conn.query(
        'UPDATE warehouse_task_items SET sorted_qty=? WHERE id=? AND task_id=?',
        [normalizedSortedQty, normalizedItemId, id],
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
    const capacityWarning = await sortingBinSvc.checkCapacityWarning(conn, taskRow.sorting_bin_id)
    const payload = { allSorted: false, progress: `${done}/${updatedItems.length}`, warning: capacityWarning?.message ?? null }
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

  // 分拣格在此不释放：货物未装箱前会一直放在分拣格里，要到打包完成
  // （packDoneWithinTransaction）才真正离开分拣格。这里提前释放会导致分拣格
  // 在"分拣完成→打包完成"这段窗口期被系统当作空闲重新分配给别的任务，造成混货。
  try {
    await recordEvent(conn, {
      taskId: id, taskNo: taskRow.task_no,
      eventType: WT_EVENT.SORT_DONE,
      fromStatus: taskRow.status,
      toStatus: rule.toStatus,
      detail: { itemCount: updatedItems.length },
    })
  } catch (eventErr) {
    logSideEffectFailure('仓库任务事件写入失败：分拣完成事件', eventErr, {
      taskId: id,
      taskNo: taskRow.task_no,
      eventType: WT_EVENT.SORT_DONE,
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

async function sortTask(id, sortedItems = null, { requestKey, userId, scopeWarehouseIds = null, pdaWarehouseId = null } = {}) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const payload = await sortTaskWithinTransaction(conn, id, sortedItems, { requestKey, userId, scopeWarehouseIds, pdaWarehouseId })
    await conn.commit()
    return payload
  } catch (e) { await conn.rollback(); throw e }
  finally { conn.release() }
}

module.exports = {
  sortTask,
  sortTaskWithinTransaction,
}
