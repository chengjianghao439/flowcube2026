const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const { lockStatusRow, compareAndSetStatus } = require('../../utils/statusTransition')
const {
  WT_STATUS,
  isValidTransition,
  assertWarehouseTaskAction,
} = require('../../constants/warehouseTaskStatus')
const { WT_EVENT, record: recordEvent } = require('./warehouse-task-events.service')
const { beginOperationRequest, completeOperationRequest } = require('../../utils/operationRequest')
const { logSideEffectFailure, assertTaskPickScanClosure } = require('./warehouse-tasks.helpers')
const { findById } = require('./warehouse-tasks.query')

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
    columns: 'id, task_no, task_type, status, sale_order_id, cancel_requested_at',
    entityName: '仓库任务',
  })
  if (taskRow.cancel_requested_at) {
    throw new AppError('该任务正在取消收尾中，不可继续拣货', 409)
  }
  const isPurchaseReturn = taskRow.task_type === 'purchase_return'

  // 采购退货：拣货完成后直接跳到待出库（跳过排序/复核/打包）
  const targetStatus = isPurchaseReturn ? WT_STATUS.SHIPPING : WT_STATUS.SORTING
  const action = isPurchaseReturn ? 'readyToShip' : 'readyToShip'

  if (!isPurchaseReturn) {
    const rule = assertWarehouseTaskAction(action, taskRow.status)
    if (!isValidTransition(taskRow.status, rule.toStatus)) {
      throw new AppError(`非法状态迁移：${taskRow.status} → ${rule.toStatus}`, 400)
    }
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
    toStatus: targetStatus,
    entityName: '仓库任务',
  })
  if (!isPurchaseReturn && taskRow.sale_order_id) {
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
      toStatus: targetStatus,
    })
  } catch (eventErr) {
    logSideEffectFailure('仓库任务事件写入失败：拣货完成事件', eventErr, {
      taskId: id,
      taskNo: taskRow.task_no,
      eventType: WT_EVENT.PICKING_DONE,
      fromStatus: taskRow.status,
      toStatus: targetStatus,
    })
  }
  const payload = { taskId: id, status: targetStatus }
  if (requestState.enabled) {
    await completeOperationRequest(conn, requestState, {
      data: payload,
      message: isPurchaseReturn ? '已标记为待出库' : '已标记为待分拣',
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
  if (task.cancelRequestedAt) {
    throw new AppError('该任务正在取消收尾中，不可继续拣货', 409)
  }
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
  if (task.cancelRequestedAt) {
    throw new AppError('该任务正在取消收尾中，不可继续拣货', 409)
  }
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

module.exports = {
  startPicking,
  updatePickedQty,
  readyToShip,
  readyToShipWithinTransaction,
  getPickSuggestions,
  getPickRoute,
}
