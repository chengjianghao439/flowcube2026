const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const { lockStatusRow, compareAndSetStatus } = require('../../utils/statusTransition')
const { assertStatusAction } = require('../../constants/documentStatusRules')
const { RETURN_EVENT, record: recordReturnEvent } = require('./return-events.service')
const { RT_STATUS_NAME } = require('../return-tasks/return-tasks.service')
const { CONTAINER_STATUS } = require('../../engine/containerEngine')
const { getRequestId } = require('../../utils/requestContext')
const { beginOperationRequest, completeOperationRequest } = require('../../utils/operationRequest')
const { genNo, adjustPaymentRecordForReturn, assertReturnPaymentHeadroom } = require('./returns.helpers')
const { scopeFilter, assertInScope } = require('../../utils/warehouseScope')
const { foldEntryItems } = require('../../utils/unitConversion')  // 多单位折算（文档03 Phase4a，退货按箱）
const { normalizePagination } = require('../../utils/pagination')

const SR_STATUS = { 1:'草稿', 2:'已确认', 3:'已退货入库', 4:'已取消' }

const fmtSR = r => ({ id:r.id, returnNo:r.return_no, customerId:r.customer_id, customerName:r.customer_name, warehouseId:r.warehouse_id, warehouseName:r.warehouse_name, saleOrderId:r.sale_order_id||null, saleOrderNo:r.sale_order_no, status:r.status, statusName:SR_STATUS[r.status], totalAmount:Number(r.total_amount), remark:r.remark, operatorId:r.operator_id, operatorName:r.operator_name, createdAt:r.created_at })

async function loadSaleSourceOrderByNo(orderNo) {
  const [rows] = await pool.query(
    'SELECT * FROM sale_orders WHERE order_no=? AND deleted_at IS NULL LIMIT 1',
    [orderNo],
  )
  if (!rows[0]) throw new AppError('关联销售单不存在', 404)
  const order = rows[0]
  const [items] = await pool.query(
    `SELECT soi.*,
            COALESCE((
              SELECT SUM(wti.picked_qty)
              FROM warehouse_task_items wti
              JOIN warehouse_tasks wt ON wt.id = wti.task_id
              WHERE wt.sale_order_id = soi.order_id
                AND wt.status = 7
                AND wt.deleted_at IS NULL
                AND wti.product_id = soi.product_id
            ), 0) AS shipped_qty,
            COALESCE((
              SELECT SUM(sri.quantity)
              FROM sale_return_items sri
              INNER JOIN sale_returns sr ON sr.id = sri.return_id
              WHERE sri.sale_item_id = soi.id
                AND sr.deleted_at IS NULL
                AND sr.status <> 4
            ), 0) AS returned_qty
       FROM sale_order_items soi
      WHERE soi.order_id=?
      ORDER BY soi.id`,
    [order.id],
  )
  return {
    id: Number(order.id),
    orderNo: order.order_no,
    customerId: Number(order.customer_id),
    customerName: order.customer_name,
    warehouseId: Number(order.warehouse_id),
    warehouseName: order.warehouse_name,
    items: items.map((row) => {
      const shippedQty = Number(row.shipped_qty || 0)
      const returnedQty = Number(row.returned_qty || 0)
      return {
        sourceItemId: Number(row.id),
        productId: Number(row.product_id),
        productCode: row.product_code,
        productName: row.product_name,
        articleNumber: row.article_number || null,
        spec: row.spec || null,
        color: row.color || null,
        unit: row.unit,
        quantity: Number(row.quantity || 0),
        shippedQty,
        returnedQty,
        remainingQty: Number(Math.max(0, shippedQty - returnedQty).toFixed(4)),
        unitPrice: Number(row.unit_price || 0),
        amount: Number(row.amount || 0),
      }
    }),
  }
}

async function validateSaleReturnItems(conn, saleOrderId, items) {
  if (!saleOrderId) return
  // 同 validatePurchaseReturnItems：锁住该销售单下的明细行，避免并发创建退货单读到同一份
  // 过期的"已出库-已退"余量快照而合计超退。
  await conn.query('SELECT id FROM sale_order_items WHERE order_id = ? FOR UPDATE', [saleOrderId])
  const [rows] = await conn.query(
    `SELECT soi.id, soi.product_id, soi.quantity, soi.unit_price,
            COALESCE((
              SELECT SUM(wti.picked_qty)
              FROM warehouse_task_items wti
              JOIN warehouse_tasks wt ON wt.id = wti.task_id
              WHERE wt.sale_order_id = soi.order_id
                AND wt.status = 7
                AND wt.deleted_at IS NULL
                AND wti.product_id = soi.product_id
            ), 0) AS shipped_qty,
            COALESCE((
              SELECT SUM(sri.quantity)
              FROM sale_return_items sri
              INNER JOIN sale_returns sr ON sr.id = sri.return_id
              WHERE sri.sale_item_id = soi.id
                AND sr.deleted_at IS NULL
                AND sr.status <> 4
            ), 0) AS returned_qty
       FROM sale_order_items soi
      WHERE soi.order_id = ?`,
    [saleOrderId],
  )
  const sourceByItemId = new Map(rows.map((row) => [Number(row.id), row]))
  const requestedQtyBySource = new Map()
  for (const item of items) {
    if (!item.sourceItemId) {
      throw new AppError('关联原销售单时，退货明细必须绑定原销售明细', 400)
    }
    const source = sourceByItemId.get(Number(item.sourceItemId))
    if (!source) throw new AppError(`原销售明细不存在，无法创建退货单`, 404)
    if (Number(source.product_id) !== Number(item.productId)) {
      throw new AppError(`退货商品与原销售明细不一致`, 400)
    }
    // 单价以原销售明细为准，不信任客户端传入值，理由同 validatePurchaseReturnItems。
    item.unitPrice = Number(source.unit_price)
    requestedQtyBySource.set(
      Number(item.sourceItemId),
      Number((requestedQtyBySource.get(Number(item.sourceItemId)) || 0) + Number(item.quantity || 0)),
    )
    const remainingQty = Number(source.shipped_qty || 0) - Number(source.returned_qty || 0)
    if (Number(requestedQtyBySource.get(Number(item.sourceItemId)).toFixed(4)) > Number(remainingQty.toFixed(4))) {
      throw new AppError(`商品 ${item.productName} 退货数量超出实际发货数量`, 409)
    }
  }
}

async function findAllSR({ page=1, pageSize=20, keyword='', status=null, productId=null, customerId=null, warehouseId=null, operatorId=null, startDate=null, endDate=null, remark=null, scopeWarehouseIds=null }) {
  const { pageSize: ps, offset } = normalizePagination({ page, pageSize }), like=`%${keyword}%`
  const params=[like,like]
  let whereExtra=''
  if (status) { whereExtra += ' AND status=?'; params.push(status) }
  if (productId) {
    whereExtra += ' AND EXISTS (SELECT 1 FROM sale_return_items sri WHERE sri.return_id = sale_returns.id AND sri.product_id = ?)'
    params.push(productId)
  }
  if (customerId) { whereExtra += ' AND customer_id=?'; params.push(customerId) }
  if (warehouseId) { whereExtra += ' AND warehouse_id=?'; params.push(warehouseId) }
  if (operatorId) { whereExtra += ' AND operator_id=?'; params.push(operatorId) }
  if (startDate) { whereExtra += ' AND created_at>=?'; params.push(`${startDate} 00:00:00`) }
  if (endDate) { whereExtra += ' AND created_at<DATE_ADD(?, INTERVAL 1 DAY)'; params.push(endDate) }
  if (remark) { whereExtra += ' AND remark LIKE ?'; params.push(`%${remark}%`) }
  const scope = scopeFilter(scopeWarehouseIds, 'warehouse_id')
  if (scope.sql) { whereExtra += scope.sql; params.push(...scope.params) }
  const where = `deleted_at IS NULL AND (return_no LIKE ? OR customer_name LIKE ?) ${whereExtra}`
  const [rows]=await pool.query(`SELECT * FROM sale_returns WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,[...params,ps,offset])
  const [[{total}]]=await pool.query(`SELECT COUNT(*) AS total FROM sale_returns WHERE ${where}`,params)
  return { list:rows.map(fmtSR), pagination:{page,pageSize:ps,total} }
}

async function findByIdSR(id, scopeWarehouseIds = null) {
  const [rows]=await pool.query('SELECT * FROM sale_returns WHERE id=? AND deleted_at IS NULL',[id])
  if(!rows[0]) throw new AppError('退货单不存在',404)
  assertInScope(scopeWarehouseIds, rows[0].warehouse_id, '销售退货单')
  const ret=fmtSR(rows[0])
  const [items]=await pool.query('SELECT * FROM sale_return_items WHERE return_id=?',[id])
  ret.items=items.map(r=>({id:r.id,sourceItemId:r.sale_item_id||null,productId:r.product_id,productCode:r.product_code,productName:r.product_name,articleNumber:r.article_number||null,spec:r.spec||null,color:r.color||null,unit:r.unit,entryUnit:r.entry_unit||r.unit,quantity:Number(r.quantity),entryQty:r.entry_qty!=null?Number(r.entry_qty):Number(r.quantity),conversionRate:Number(r.conversion_rate),unitPrice:Number(r.unit_price),amount:Number(r.amount)}))
  const [[task]]=await pool.query(
    "SELECT id, task_no, status FROM return_tasks WHERE return_id=? AND return_type='sale' AND deleted_at IS NULL ORDER BY id DESC LIMIT 1",
    [id],
  )
  if (task) {
    const [[{ rejectedQty }]] = await pool.query(
      'SELECT COALESCE(SUM(rejected_qty),0) AS rejectedQty FROM return_task_items WHERE task_id=?',
      [task.id],
    )
    const [rejectedContainers] = await pool.query(
      `SELECT c.id, c.barcode, c.remaining_qty, c.product_id, p.name AS product_name
       FROM inventory_containers c
       LEFT JOIN product_items p ON p.id = c.product_id
       WHERE c.source_ref_type = 'sale_return' AND c.source_ref_id = ? AND c.status = ?
       ORDER BY c.id`,
      [task.id, CONTAINER_STATUS.REJECTED],
    )
    ret.task = {
      id: Number(task.id), taskNo: task.task_no, status: Number(task.status), statusName: RT_STATUS_NAME[Number(task.status)] || '未知',
      rejectedQty: Number(rejectedQty),
      rejectedContainers: rejectedContainers.map(r => ({
        id: Number(r.id), barcode: r.barcode, qty: Number(r.remaining_qty),
        productId: Number(r.product_id), productName: r.product_name,
      })),
    }
  } else {
    ret.task = null
  }
  return ret
}

async function createSR({ customerId, customerName, warehouseId, warehouseName, saleOrderId = null, saleOrderNo, remark, items, operator, requestKey, scopeWarehouseIds = null }) {
  assertInScope(scopeWarehouseIds, warehouseId, '销售退货单')
  const conn=await pool.getConnection()
  try {
    await conn.beginTransaction()
    const requestState = await beginOperationRequest(conn, {
      requestKey,
      action: 'saleReturn.create',
      userId: operator?.userId ?? null,
    })
    if (requestState.replay) {
      await conn.rollback()
      return requestState.responseData
    }
    let resolvedSaleOrderId = saleOrderId || null
    let sourceOrder = null
    if (!resolvedSaleOrderId && saleOrderNo) {
      sourceOrder = await loadSaleSourceOrderByNo(saleOrderNo)
      resolvedSaleOrderId = sourceOrder.id
    } else if (resolvedSaleOrderId) {
      const [rows] = await conn.query(
        'SELECT id, customer_id, warehouse_id FROM sale_orders WHERE id=? AND deleted_at IS NULL LIMIT 1',
        [resolvedSaleOrderId],
      )
      if (!rows[0]) throw new AppError('关联销售单不存在', 404)
      sourceOrder = {
        id: Number(rows[0].id),
        customerId: Number(rows[0].customer_id),
        warehouseId: Number(rows[0].warehouse_id),
      }
    }
    if (sourceOrder) {
      if (Number(sourceOrder.customerId) !== Number(customerId)) {
        throw new AppError('销售退货客户必须与原销售单一致', 400)
      }
      if (Number(sourceOrder.warehouseId) !== Number(warehouseId)) {
        throw new AppError('销售退货仓库必须与原销售单一致', 400)
      }
    }
    // 多单位折算（文档03 Phase4a）：入参 quantity/unitPrice 恒为录入单位口径，折算成基本单位后
    // 再校验/落库。有源退货前端锁死数量/单价（entryUnit=基本单位→rate 1，等价旧行为）；
    // validateSaleReturnItems 用 folded（quantity 已是基本单位）比对剩余可退量、并强制覆盖 unitPrice 为源单价。
    const folded = await foldEntryItems(conn, items)
    await validateSaleReturnItems(conn, resolvedSaleOrderId, folded)
    const returnNo=await genNo(conn,'SR','sale_returns','return_no')
    const total=folded.reduce((s,i)=>s+i.quantity*i.unitPrice,0)
    const [r]=await conn.query(`INSERT INTO sale_returns (return_no,customer_id,customer_name,warehouse_id,warehouse_name,sale_order_id,sale_order_no,total_amount,remark,operator_id,operator_name) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,[returnNo,customerId,customerName,warehouseId,warehouseName,resolvedSaleOrderId,saleOrderNo||null,total,remark||null,operator.userId,operator.realName])
    for(const item of folded) await conn.query(`INSERT INTO sale_return_items (return_id,sale_item_id,product_id,product_code,product_name,article_number,spec,color,unit,entry_unit,quantity,entry_qty,conversion_rate,unit_price,amount) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,[r.insertId,item.sourceItemId||null,item.productId,item.productCode,item.productName,item.articleNumber||null,item.spec||null,item.color||null,item.unit,item.entryUnit,item.quantity,item.entryQty,item.conversionRate,item.unitPrice,item.quantity*item.unitPrice])
    await recordReturnEvent(conn, {
      returnType: 'sale',
      returnId: r.insertId,
      returnNo,
      eventType: RETURN_EVENT.CREATED,
      title: '销售退货单已创建',
      description: `客户 ${customerName}`,
      operatorId: operator.userId,
      operatorName: operator.realName,
      requestId: getRequestId(),
      payload: {
        warehouseId,
        totalAmount: total,
        lineCount: items.length,
        totalQty: items.reduce((sum, item) => sum + Number(item.quantity || 0), 0),
      },
    })
    const result = { id: r.insertId, returnNo }
    await completeOperationRequest(conn, requestState, {
      data: result,
      message: '创建成功',
      resourceType: 'sale_return',
      resourceId: r.insertId,
    })
    await conn.commit(); return result
  } catch(e){ await conn.rollback(); throw e } finally { conn.release() }
}

async function confirmSR(id, operator = null, scopeWarehouseIds = null) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const retRow = await lockStatusRow(conn, {
      table: 'sale_returns',
      id,
      columns: 'id, return_no, customer_id, customer_name, sale_order_id, sale_order_no, total_amount, warehouse_id, warehouse_name, status',
      entityName: '销售退货单',
    })
    assertInScope(scopeWarehouseIds, retRow.warehouse_id, '销售退货单')
    const rule = assertStatusAction('saleReturn', 'confirm', retRow.status)
    // 负余额前置拦截：客户已付/已核销金额 > 退货冲减后应收总额时，不让退货单走到执行末端
    // （最后一箱上架）才由 adjustPaymentRecordForReturn 抛 409 回滚、卡在中间态。这里按计划
    // 全额保守预判（实际按合格量冲减，≤计划量）；末端 FOR UPDATE 校验仍兜底。
    if (retRow.sale_order_id) {
      await assertReturnPaymentHeadroom(conn, {
        recordType: 2,
        orderId: Number(retRow.sale_order_id),
        orderNo: retRow.sale_order_no,
        amount: Number(retRow.total_amount || 0),
      })
    }
    await compareAndSetStatus(conn, {
      table: 'sale_returns',
      id,
      fromStatus: rule.from,
      toStatus: rule.to,
      entityName: '销售退货单',
    })

    // 确认后自动创建退货 PDA 任务（收货→质检→上架）
    const [itemRows] = await conn.query(
      'SELECT * FROM sale_return_items WHERE return_id=? ORDER BY id', [id],
    )
    const taskSvc = require('../return-tasks/return-tasks.service')
    const { taskId, taskNo } = await taskSvc.create(conn, {
      returnId: Number(retRow.id),
      returnNo: retRow.return_no,
      returnType: 'sale',
      warehouseId: Number(retRow.warehouse_id),
      warehouseName: retRow.warehouse_name,
      partyName: retRow.customer_name,
      items: itemRows.map((r) => ({
        returnItemId: Number(r.id),
        productId: Number(r.product_id),
        productCode: r.product_code,
        productName: r.product_name,
        unit: r.unit,
        quantity: Number(r.quantity),
      })),
    })
    // 确认即派发到 PDA（与调拨/收货一致：ERP 端不再需要额外「提交」一步）
    await taskSvc.submitWithinTransaction(conn, taskId, operator || {})

    await recordReturnEvent(conn, {
      returnType: 'sale',
      returnId: Number(retRow.id),
      returnNo: retRow.return_no,
      eventType: RETURN_EVENT.CONFIRMED,
      title: '销售退货单已确认',
      description: `已生成退货收货任务 ${taskNo}，请提交到 PDA 执行`,
      operatorId: operator?.userId ?? null,
      operatorName: operator?.realName ?? null,
      requestId: getRequestId(),
      payload: { taskId, taskNo },
    })
    await conn.commit()
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }
}

async function cancelSR(id, operator = null, scopeWarehouseIds = null) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const retRow = await lockStatusRow(conn, {
      table: 'sale_returns',
      id,
      columns: 'id, return_no, status, warehouse_id',
      entityName: '销售退货单',
    })
    assertInScope(scopeWarehouseIds, retRow.warehouse_id, '销售退货单')
    const rule = assertStatusAction('saleReturn', 'cancel', retRow.status)
    await compareAndSetStatus(conn, {
      table: 'sale_returns',
      id,
      fromStatus: rule.from,
      toStatus: rule.to,
      entityName: '销售退货单',
    })

    // 已确认(2)会自动创建并派发 PDA 退货任务（return_tasks）；取消时必须同步终止该任务，
    // 否则仓库端会继续把一个"已取消"的退货单执行完，造成账实不符（P0-2，同 cancelPR）。
    const returnTasksSvc = require('../return-tasks/return-tasks.service')
    const [[linkedTask]] = await conn.query(
      `SELECT id, status FROM return_tasks
       WHERE return_id = ? AND return_type = 'sale'
       ORDER BY id DESC LIMIT 1`,
      [id],
    )
    const RT_ACTIVE = [
      returnTasksSvc.RT_STATUS.PENDING_RECEIVE,
      returnTasksSvc.RT_STATUS.RECEIVING,
      returnTasksSvc.RT_STATUS.PENDING_CHECK,
      returnTasksSvc.RT_STATUS.PENDING_PUTAWAY,
    ]
    const shouldCancelTask = linkedTask && RT_ACTIVE.includes(Number(linkedTask.status))
    if (shouldCancelTask) {
      await returnTasksSvc.cancel(Number(linkedTask.id), operator || {}, { conn })
    }

    await recordReturnEvent(conn, {
      returnType: 'sale',
      returnId: Number(retRow.id),
      returnNo: retRow.return_no,
      eventType: RETURN_EVENT.CANCELLED,
      title: '销售退货单已取消',
      description: shouldCancelTask
        ? '销售退货单已取消，未执行退货入库，关联的退货任务已同步终止'
        : '销售退货单已取消，未执行退货入库',
      operatorId: operator?.userId ?? null,
      operatorName: operator?.realName ?? null,
      requestId: getRequestId(),
    })
    await conn.commit()
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }
}

/**
 * 销售退货入仓完成回调（由 return_tasks putaway 事务内调用）
 * 容器已通过 PDA 流程上架，此处仅做退货单状态同步和账款冲减
 */
async function syncSaleReturnCompleted(conn, returnId, { taskId, taskNo }) {
  const retRow = await lockStatusRow(conn, {
    table: 'sale_returns',
    id: returnId,
    columns: 'id, return_no, sale_order_id, sale_order_no, warehouse_id, status',
    entityName: '销售退货单',
  })
  if (Number(retRow.status) !== 2) {
    throw new AppError(`销售退货单状态异常（当前非已确认），无法完成入仓`, 409)
  }
  const rule = assertStatusAction('saleReturn', 'execute', retRow.status)

  // 账款冲减：按实际质检合格入库量（checked_qty − rejected_qty）× 退货单价冲减应收。
  // 质检不合格部分留在 REJECTED 容器、不退客户（业务决策 2026-07-28）。口径与 sale.service
  // 的 recomputeSaleReceivable 严格一致，避免后续出库全量重算时口径不符导致覆盖。
  const [[{ totalAmount }]] = await conn.query(
    `SELECT COALESCE(SUM((rti.checked_qty - rti.rejected_qty) * sri.unit_price), 0) AS totalAmount
       FROM return_task_items rti
       JOIN sale_return_items sri ON sri.id = rti.return_item_id
      WHERE rti.task_id = ?`,
    [taskId],
  )
  if (retRow.sale_order_id && totalAmount > 0) {
    await adjustPaymentRecordForReturn(conn, {
      recordType: 2,
      orderId: Number(retRow.sale_order_id),
      orderNo: retRow.sale_order_no,
      returnNo: retRow.return_no,
      returnType: 'sale',
      amount: Number(totalAmount),
      operator: {},
    })
  }

  await compareAndSetStatus(conn, {
    table: 'sale_returns',
    id: returnId,
    fromStatus: rule.from,
    toStatus: rule.to,
    entityName: '销售退货单',
  })

  await recordReturnEvent(conn, {
    returnType: 'sale',
    returnId: Number(retRow.id),
    returnNo: retRow.return_no,
    eventType: RETURN_EVENT.EXECUTED,
    title: '销售退货入仓完成',
    description: `PDA 退货任务 ${taskNo} 已上架完成，退货单自动完成`,
    requestId: getRequestId(),
    payload: { taskId, taskNo, totalAmount: Number(totalAmount), inventoryDirection: 'in' },
  })
}

module.exports = {
  findAllSR,
  findByIdSR,
  createSR,
  confirmSR,
  cancelSR,
  syncSaleReturnCompleted,
  loadSaleSourceOrderByNo,
}
