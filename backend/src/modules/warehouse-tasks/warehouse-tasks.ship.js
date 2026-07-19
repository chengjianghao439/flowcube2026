const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const { moveStock, MOVE_TYPE } = require('../../engine/inventoryEngine')
const { unlockContainersByTask } = require('../../engine/containerEngine')
const { lockStatusRow, compareAndSetStatus } = require('../../utils/statusTransition')
const { isValidTransition, assertWarehouseTaskAction } = require('../../constants/warehouseTaskStatus')
const { WT_EVENT, record: recordEvent } = require('./warehouse-task-events.service')
const { beginOperationRequest, completeOperationRequest } = require('../../utils/operationRequest')
const {
  logSideEffectFailure,
  assertTaskPickScanClosure,
  assertTaskCheckScanClosure,
  assertTaskPackagingClosure,
  assertTaskPackagePrintClosure,
} = require('./warehouse-tasks.helpers')
const { findById } = require('./warehouse-tasks.query')

/**
 * 执行出库（6→7）：扣减库存 + 更新销售单状态 + 生成应收账款
 */
async function shipWithinTransaction(conn, id, operator, saleData, { requestKey } = {}) {
  const taskRow = await lockStatusRow(conn, {
    table: 'warehouse_tasks',
    id,
    columns: 'id, task_no, task_type, status, return_id',
    entityName: '仓库任务',
  })
  const rule = assertWarehouseTaskAction('ship', taskRow.status)
  if (!isValidTransition(taskRow.status, rule.toStatus)) throw new AppError(`非法状态迁移：${taskRow.status} → ${rule.toStatus}`, 400)
  const requestState = await beginOperationRequest(conn, {
    requestKey,
    action: 'warehouse.ship',
    userId: operator?.userId ?? null,
  })
  if (requestState.replay) {
    return requestState.responseData
  }

  const isPurchaseReturn = taskRow.task_type === 'purchase_return'

  await assertTaskPickScanClosure(conn, id)
  if (!isPurchaseReturn) {
    await assertTaskCheckScanClosure(conn, id)
    await assertTaskPackagingClosure(conn, id)
    await assertTaskPackagePrintClosure(conn, id)
  }

  const { saleOrderId, orderNo, warehouseId, totalAmount, customerName, items } = saleData

  if (!isPurchaseReturn && saleOrderId) {
    const saleRow = await lockStatusRow(conn, {
      table: 'sale_orders',
      id: saleOrderId,
      columns: 'id, status, order_no',
      entityName: '销售单',
    })
    if (Number(saleRow.status) === 5) {
      throw new AppError(`关联销售单 ${saleRow.order_no} 已取消，无法继续出库`, 400)
    }
    if (Number(saleRow.status) === 4) {
      throw new AppError(`关联销售单 ${saleRow.order_no} 已完成出库，请勿重复操作`, 400)
    }
  }

  for (const item of items) {
    await moveStock(conn, {
      moveType: MOVE_TYPE.TASK_OUT,
      productId: item.productId,
      productName: item.productName,
      warehouseId,
      qty: item.quantity,
      unitPrice: item.unitPrice,
      refType: 'warehouse_task',
      refId: taskRow.id,
      refNo: taskRow.task_no,
      reservationRefType: isPurchaseReturn ? null : 'sale_order',
      reservationRefId: isPurchaseReturn ? null : saleOrderId,
      operatorId: operator.userId,
      operatorName: operator.realName,
      lockedByTaskId: id,
    })
  }

  if (!isPurchaseReturn && saleOrderId) {
    const saleSvc = require('../sale/sale.service')
    await saleSvc.syncShippedByWarehouseTaskWithinTransaction(conn, saleOrderId, {
      taskId: Number(id),
      taskNo: taskRow.task_no,
    })
  }

  // 采购退货出库完成：同步退货单状态 + 冲减应付账款
  if (isPurchaseReturn && taskRow.return_id) {
    const returnSvc = require('../returns/returns-purchase.service')
    await returnSvc.syncPurchaseReturnShipped(conn, Number(taskRow.return_id), {
      taskId: Number(id),
      taskNo: taskRow.task_no,
      operator,
    })
  }

  const shippedAt = new Date()
  await compareAndSetStatus(conn, {
    table: 'warehouse_tasks',
    id,
    fromStatus: taskRow.status,
    toStatus: rule.toStatus,
    entityName: '仓库任务',
    extraSet: {
      shipped_at: shippedAt,
    },
  })

  await unlockContainersByTask(conn, id)

  if (!isPurchaseReturn) {
    await conn.query(
      `INSERT IGNORE INTO payment_records (type,order_id,order_no,party_name,total_amount,balance,due_date) VALUES (2,?,?,?,?,?,DATE_ADD(NOW(), INTERVAL 30 DAY))`,
      [saleOrderId, orderNo, customerName, totalAmount, totalAmount],
    )
  }

  try {
    await recordEvent(conn, {
      taskId: id, taskNo: taskRow.task_no,
      eventType: WT_EVENT.SHIP_DONE,
      fromStatus: taskRow.status,
      toStatus: rule.toStatus,
      operatorId: operator.userId,
      operatorName: operator.realName,
      detail: { saleOrderId, totalAmount, itemCount: items.length, isPurchaseReturn },
    })
  } catch (eventErr) {
    logSideEffectFailure('仓库任务事件写入失败：出库完成事件', eventErr, {
      taskId: id,
      taskNo: taskRow.task_no,
      eventType: WT_EVENT.SHIP_DONE,
      saleOrderId,
    })
  }

  const payload = { taskId: id, status: rule.toStatus, shippedAt: shippedAt.toISOString() }
  await completeOperationRequest(conn, requestState, {
    data: payload,
    message: '出库成功',
    resourceType: 'warehouse_task',
    resourceId: id,
  })
  return payload
}

async function ship(id, operator, saleData, { requestKey } = {}) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const payload = await shipWithinTransaction(conn, id, operator, saleData, { requestKey })
    await conn.commit()
    return payload
  } catch (e) { await conn.rollback(); throw e }
  finally { conn.release() }
}

async function getShipContext(taskId) {
  const task = await findById(taskId)

  if (task.taskType === 'purchase_return') {
    const [wmsItems] = await pool.query(
      `SELECT wti.product_id, wti.product_name, wti.picked_qty, pri.unit_price
       FROM warehouse_task_items wti
       LEFT JOIN purchase_return_items pri ON pri.return_id = ? AND pri.product_id = wti.product_id
       WHERE wti.task_id = ?`,
      [task.returnId, taskId],
    )
    if (!wmsItems.length) throw new AppError('任务无出库明细', 400)
    return {
      saleOrderId: null,
      warehouseId: task.warehouseId,
      totalAmount: wmsItems.reduce((sum, i) => sum + Number(i.picked_qty) * Number(i.unit_price || 0), 0),
      customerName: null,
      items: wmsItems.map(i => ({
        productId: i.product_id,
        productName: i.product_name,
        quantity: Number(i.picked_qty),
        unitPrice: i.unit_price != null ? Number(i.unit_price) : null,
      })),
    }
  }

  const [[saleOrder]] = await pool.query(
    'SELECT id, order_no, status, warehouse_id, total_amount, customer_name FROM sale_orders WHERE id=?',
    [task.saleOrderId],
  )
  if (!saleOrder) throw new AppError('关联销售单不存在', 404)

  const [wmsItems] = await pool.query(
    `SELECT wti.product_id, wti.product_name, wti.picked_qty, soi.unit_price
     FROM warehouse_task_items wti
     LEFT JOIN sale_order_items soi ON soi.order_id = ? AND soi.product_id = wti.product_id
     WHERE wti.task_id = ?`,
    [saleOrder.id, taskId],
  )
  if (!wmsItems.length) throw new AppError('任务无出库明细', 400)

  return {
    saleOrderId: saleOrder.id,
    orderNo: saleOrder.order_no,
    warehouseId: saleOrder.warehouse_id,
    totalAmount: Number(saleOrder.total_amount),
    customerName: saleOrder.customer_name,
    items: wmsItems.map(i => ({
      productId: i.product_id,
      productName: i.product_name,
      quantity: Number(i.picked_qty),
      unitPrice: i.unit_price != null ? Number(i.unit_price) : null,
    })),
  }
}

module.exports = {
  ship,
  shipWithinTransaction,
  getShipContext,
}
