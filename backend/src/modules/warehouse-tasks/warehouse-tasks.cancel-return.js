const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const { lockStatusRow, compareAndSetStatus } = require('../../utils/statusTransition')
const sortingBinSvc = require('../sorting-bins/sorting-bins.service')
const { WT_EVENT, record: recordEvent } = require('./warehouse-task-events.service')
const { logSideEffectFailure } = require('./warehouse-tasks.helpers')
const { scopeFilter } = require('../../utils/warehouseScope')

/**
 * PDA「拣货退回」任务池：列出所有正在拣货退回中（cancel_requested_at 非空）的任务，
 * 每条附带该任务名下仍锁定的容器数，供操作员挑选处理。
 */
async function listPendingCancelReturns(warehouseId, scopeWarehouseIds = null) {
  // 与主列表 findAll 同口径接入用户仓库数据范围：受限用户只看授权仓库的待归还任务
  const scope = scopeFilter(scopeWarehouseIds, 'wt.warehouse_id')
  const [rows] = await pool.query(
    `SELECT wt.id, wt.task_no, wt.customer_name, wt.warehouse_id, wt.warehouse_name,
            wt.status, wt.cancel_requested_at,
            (SELECT COUNT(*) FROM inventory_containers c WHERE c.locked_by_task_id = wt.id) AS containersRemaining,
            (SELECT COUNT(*) FROM packages p WHERE p.warehouse_task_id = wt.id AND p.status = 2) AS packagesRemaining
       FROM warehouse_tasks wt
      WHERE wt.cancel_requested_at IS NOT NULL
        AND wt.deleted_at IS NULL
        ${warehouseId ? 'AND wt.warehouse_id = ?' : ''}${scope.sql}
      ORDER BY wt.cancel_requested_at ASC`,
    [...(warehouseId ? [warehouseId] : []), ...scope.params],
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
    packagesRemaining: Number(r.packagesRemaining),
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
  // 只有已完成（已打印箱贴、有物理实体）的箱子需要人工扫码确认拆箱；
  // 打包中的箱子在 cancel() 发起拣货退回时已经被自动作废，不会出现在这里。
  const [packages] = await pool.query(
    `SELECT id, barcode, created_at FROM packages
      WHERE warehouse_task_id = ? AND status = 2
      ORDER BY created_at ASC`,
    [taskId],
  )
  let itemsByPackage = {}
  if (packages.length) {
    const [items] = await pool.query(
      `SELECT package_id, product_name, unit, qty FROM package_items WHERE package_id IN (?)`,
      [packages.map(p => p.id)],
    )
    itemsByPackage = items.reduce((acc, i) => {
      const key = Number(i.package_id)
      ;(acc[key] ??= []).push({ productName: i.product_name || null, unit: i.unit, qty: Number(i.qty) })
      return acc
    }, {})
  }
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
    packages: packages.map(p => ({
      packageId: Number(p.id),
      barcode: p.barcode,
      items: itemsByPackage[Number(p.id)] || [],
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
  // 复核/打包都没有真正完成，任务终态是已取消，这些进度量不该再留着，
  // 避免之后翻看任务历史时被当成"已复核/已打包过"误读。
  await conn.query(
    `UPDATE warehouse_task_items SET sorted_qty = 0, checked_qty = 0 WHERE task_id = ?`,
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
    logSideEffectFailure('仓库任务事件写入失败：拣货退回完成事件', eventErr, {
      taskId: Number(taskId),
      taskNo: taskRow.task_no,
      eventType: WT_EVENT.CANCEL_FINALIZED,
    })
  }
}

/**
 * 逆向归还是否已全部清零：容器归还 + 已完成箱子拆箱确认，两个集合都清零才真正
 * 完成取消。必须在同一事务内、在容器/箱子扫码写入之后调用；调用方须已持有
 * warehouse_tasks 该行的事务锁。容器扫码（scan-logs.service.js 的
 * createCancelReturnScanLog）与箱子扫码（createCancelReturnBoxScanLog）两条
 * 路径共用本函数，避免各写一份 finalize 触发条件。
 */
async function checkCancelReturnClearedAndFinalize(conn, taskId) {
  const [[{ containersRemaining }]] = await conn.query(
    'SELECT COUNT(*) AS containersRemaining FROM inventory_containers WHERE locked_by_task_id = ? FOR UPDATE',
    [taskId],
  )
  const [[{ packagesRemaining }]] = await conn.query(
    'SELECT COUNT(*) AS packagesRemaining FROM packages WHERE warehouse_task_id = ? AND status = 2 FOR UPDATE',
    [taskId],
  )
  let finalized = false
  if (Number(containersRemaining) === 0 && Number(packagesRemaining) === 0) {
    await finalizeCancelWithinTransaction(conn, taskId)
    finalized = true
  }
  return {
    containersRemaining: Number(containersRemaining),
    packagesRemaining: Number(packagesRemaining),
    finalized,
  }
}

module.exports = {
  listPendingCancelReturns,
  getCancelReturnDetail,
  finalizeCancelWithinTransaction,
  checkCancelReturnClearedAndFinalize,
}
