const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const { lockStatusRow, compareAndSetStatus } = require('../../utils/statusTransition')
const sortingBinSvc = require('../sorting-bins/sorting-bins.service')
const { WT_EVENT, record: recordEvent } = require('./warehouse-task-events.service')
const { logSideEffectFailure } = require('./warehouse-tasks.helpers')

/**
 * PDA「取消清理」任务池：列出所有正在取消收尾中（cancel_requested_at 非空）的任务，
 * 每条附带该任务名下仍锁定的容器数，供操作员挑选处理。
 */
async function listPendingCancelReturns(warehouseId) {
  const [rows] = await pool.query(
    `SELECT wt.id, wt.task_no, wt.customer_name, wt.warehouse_id, wt.warehouse_name,
            wt.status, wt.cancel_requested_at,
            (SELECT COUNT(*) FROM inventory_containers c WHERE c.locked_by_task_id = wt.id) AS containersRemaining
       FROM warehouse_tasks wt
      WHERE wt.cancel_requested_at IS NOT NULL
        AND wt.deleted_at IS NULL
        ${warehouseId ? 'AND wt.warehouse_id = ?' : ''}
      ORDER BY wt.cancel_requested_at ASC`,
    warehouseId ? [warehouseId] : [],
  )
  return rows.map(r => ({
    id: Number(r.id),
    taskNo: r.task_no,
    customerName: r.customer_name,
    warehouseId: Number(r.warehouse_id),
    warehouseName: r.warehouse_name,
    status: Number(r.status),
    cancelRequestedAt: r.cancel_requested_at,
    containersRemaining: Number(r.containersRemaining),
  }))
}

/**
 * 逆向归还详情：该任务名下所有仍 locked_by_task_id=taskId 的容器，附原库位信息作为归还提示。
 * 与 warehouse-tasks.command.js 的 cancel() 里查询归还指引的逻辑保持一致口径。
 */
async function getCancelReturnDetail(taskId) {
  const [[taskRow]] = await pool.query(
    `SELECT id, task_no, status, cancel_requested_at, warehouse_id, warehouse_name, customer_name
       FROM warehouse_tasks WHERE id = ? AND deleted_at IS NULL`,
    [taskId],
  )
  if (!taskRow) throw new AppError('仓库任务不存在', 404)
  const [containers] = await pool.query(
    `SELECT c.id, c.barcode, c.product_id, c.remaining_qty, c.container_type,
            wti.product_name,
            loc.code AS location_code, loc.zone, loc.aisle, loc.rack, loc.level, loc.position
       FROM inventory_containers c
       LEFT JOIN warehouse_locations loc ON loc.id = c.location_id
       LEFT JOIN warehouse_task_items wti ON wti.task_id = c.locked_by_task_id AND wti.product_id = c.product_id
      WHERE c.locked_by_task_id = ?`,
    [taskId],
  )
  return {
    id: Number(taskRow.id),
    taskNo: taskRow.task_no,
    status: Number(taskRow.status),
    cancelRequestedAt: taskRow.cancel_requested_at,
    warehouseId: Number(taskRow.warehouse_id),
    warehouseName: taskRow.warehouse_name,
    customerName: taskRow.customer_name,
    containers: containers.map(c => ({
      containerId: Number(c.id),
      barcode: c.barcode,
      productId: Number(c.product_id),
      productName: c.product_name || null,
      qty: Number(c.remaining_qty),
      containerKind: Number(c.container_type) === 2 || /^B/i.test(String(c.barcode || ''))
        ? 'plastic_box' : 'inventory',
      suggestedLocationCode: c.location_code || null,
      zone: c.zone || null,
      aisle: c.aisle || null,
      rack: c.rack || null,
      level: c.level || null,
      position: c.position || null,
    })),
  }
}

/**
 * 在归还最后一个容器的同一事务内调用：释放分拣格（若曾分配过）、sorted_qty 清零、
 * 任务真正推进为已取消(8)、清空 cancel_requested_at。调用方须已持有 warehouse_tasks
 * 该行的事务锁（同一 conn 内先 lockStatusRow 过），避免重复触发。
 */
async function finalizeCancelWithinTransaction(conn, taskId) {
  const taskRow = await lockStatusRow(conn, {
    table: 'warehouse_tasks',
    id: taskId,
    columns: 'id, task_no, status, sorting_bin_id, sorting_bin_code',
    entityName: '仓库任务',
  })

  if (taskRow.sorting_bin_id) {
    await sortingBinSvc.releaseByTask(conn, taskId)
  }
  await conn.query(
    `UPDATE warehouse_task_items SET sorted_qty = 0 WHERE task_id = ?`,
    [taskId],
  )
  await compareAndSetStatus(conn, {
    table: 'warehouse_tasks',
    id: taskId,
    fromStatus: taskRow.status,
    toStatus: 8, // CANCELLED
    entityName: '仓库任务',
    extraSet: {
      sorting_bin_id: null,
      sorting_bin_code: null,
      cancel_requested_at: null,
    },
  })

  try {
    await recordEvent(conn, {
      taskId: Number(taskId), taskNo: taskRow.task_no,
      eventType: WT_EVENT.CANCEL_FINALIZED,
      fromStatus: taskRow.status,
      toStatus: 8,
      detail: { sortingBinReleased: !!taskRow.sorting_bin_id },
    })
  } catch (eventErr) {
    logSideEffectFailure('仓库任务事件写入失败：取消收尾完成事件', eventErr, {
      taskId: Number(taskId),
      taskNo: taskRow.task_no,
      eventType: WT_EVENT.CANCEL_FINALIZED,
    })
  }
}

module.exports = {
  listPendingCancelReturns,
  getCancelReturnDetail,
  finalizeCancelWithinTransaction,
}
