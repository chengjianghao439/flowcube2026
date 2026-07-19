const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const { lockStatusRow, compareAndSetStatus } = require('../../utils/statusTransition')
const { assertStatusAction } = require('../../constants/documentStatusRules')
const { RETURN_EVENT, record: recordReturnEvent } = require('./return-events.service')
const { WT_STATUS_NAME, WT_STATUS_ACTIVE } = require('../../constants/warehouseTaskStatus')
const { getRequestId } = require('../../utils/requestContext')
const { beginOperationRequest, completeOperationRequest } = require('../../utils/operationRequest')
const { genNo, adjustPaymentRecordForReturn } = require('./returns.helpers')

const PR_STATUS = { 1:'草稿', 2:'已确认', 3:'已退货', 4:'已取消' }

const fmtPR = r => ({ id:r.id, returnNo:r.return_no, supplierId:r.supplier_id, supplierName:r.supplier_name, warehouseId:r.warehouse_id, warehouseName:r.warehouse_name, purchaseOrderId:r.purchase_order_id||null, purchaseOrderNo:r.purchase_order_no, status:r.status, statusName:PR_STATUS[r.status], totalAmount:Number(r.total_amount), remark:r.remark, operatorId:r.operator_id, operatorName:r.operator_name, createdAt:r.created_at })

async function loadPurchaseSourceOrderByNo(orderNo) {
  const [rows] = await pool.query(
    'SELECT * FROM purchase_orders WHERE order_no=? AND deleted_at IS NULL LIMIT 1',
    [orderNo],
  )
  if (!rows[0]) throw new AppError('关联采购单不存在', 404)
  const order = rows[0]
  const [items] = await pool.query(
    `SELECT poi.*,
            COALESCE((
              SELECT SUM(iti.received_qty)
              FROM inbound_task_items iti
              JOIN inbound_tasks it ON it.id = iti.task_id
              WHERE iti.purchase_item_id = poi.id
                AND it.deleted_at IS NULL
                AND it.status IN (3, 4)
            ), 0) AS received_qty,
            COALESCE((
              SELECT SUM(pri.quantity)
              FROM purchase_return_items pri
              INNER JOIN purchase_returns pr ON pr.id = pri.return_id
              WHERE pri.purchase_item_id = poi.id
                AND pr.deleted_at IS NULL
                AND pr.status <> 4
            ), 0) AS returned_qty
       FROM purchase_order_items poi
      WHERE poi.order_id=?
      ORDER BY poi.id`,
    [order.id],
  )
  return {
    id: Number(order.id),
    orderNo: order.order_no,
    supplierId: Number(order.supplier_id),
    supplierName: order.supplier_name,
    warehouseId: Number(order.warehouse_id),
    warehouseName: order.warehouse_name,
    items: items.map((row) => {
      const receivedQty = Number(row.received_qty || 0)
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
        receivedQty,
        returnedQty,
        remainingQty: Number(Math.max(0, receivedQty - returnedQty).toFixed(4)),
        unitPrice: Number(row.unit_price || 0),
        amount: Number(row.amount || 0),
      }
    }),
  }
}

async function validatePurchaseReturnItems(conn, purchaseOrderId, items) {
  if (!purchaseOrderId) return
  // 锁住该采购单下的明细行：不加锁时，并发创建多张退货单会各自读到同一份"还有余量"的
  // 过期快照，都校验通过，合计超出实际已收货量退货（金额/库存双重超退）。
  await conn.query('SELECT id FROM purchase_order_items WHERE order_id = ? FOR UPDATE', [purchaseOrderId])
  const [rows] = await conn.query(
    `SELECT poi.id, poi.product_id, poi.quantity, poi.unit_price,
            COALESCE((
              SELECT SUM(iti.received_qty)
              FROM inbound_task_items iti
              JOIN inbound_tasks it ON it.id = iti.task_id
              WHERE iti.purchase_item_id = poi.id
                AND it.deleted_at IS NULL
                AND it.status IN (3, 4)
            ), 0) AS received_qty,
            COALESCE((
              SELECT SUM(pri.quantity)
              FROM purchase_return_items pri
              INNER JOIN purchase_returns pr ON pr.id = pri.return_id
              WHERE pri.purchase_item_id = poi.id
                AND pr.deleted_at IS NULL
                AND pr.status <> 4
            ), 0) AS returned_qty
       FROM purchase_order_items poi
      WHERE poi.order_id = ?`,
    [purchaseOrderId],
  )
  const sourceByItemId = new Map(rows.map((row) => [Number(row.id), row]))
  const requestedQtyBySource = new Map()
  for (const item of items) {
    if (!item.sourceItemId) {
      throw new AppError('关联原采购单时，退货明细必须绑定原采购明细', 400)
    }
    const source = sourceByItemId.get(Number(item.sourceItemId))
    if (!source) throw new AppError(`原采购明细不存在，无法创建退货单`, 404)
    if (Number(source.product_id) !== Number(item.productId)) {
      throw new AppError(`退货商品与原采购明细不一致`, 400)
    }
    // 单价以原采购明细为准，不信任客户端传入值：前端"添加商品"手动追加行时默认填的是
    // 商品当前成本价，可能与下单时的采购单价不同（成本价后续会被调整），若不在此处强制
    // 覆盖，冲减应付时算出的金额会和 recomputePurchasePayable 用原始 unit_price 重算出的
    // 应付基准脱节，产生对不上账的永久性残差。
    item.unitPrice = Number(source.unit_price)
    requestedQtyBySource.set(
      Number(item.sourceItemId),
      Number((requestedQtyBySource.get(Number(item.sourceItemId)) || 0) + Number(item.quantity || 0)),
    )
    const remainingQty = Number(source.received_qty || 0) - Number(source.returned_qty || 0)
    if (Number(requestedQtyBySource.get(Number(item.sourceItemId)).toFixed(4)) > Number(remainingQty.toFixed(4))) {
      throw new AppError(`商品 ${item.productName} 退货数量超出实际收货数量`, 409)
    }
  }
}

async function findAllPR({ page=1, pageSize=20, keyword='', status=null, productId=null, supplierId=null, warehouseId=null, operatorId=null, startDate=null, endDate=null, remark=null }) {
  const offset=(page-1)*pageSize, like=`%${keyword}%`
  const params=[like,like]
  let whereExtra=''
  if (status) { whereExtra += ' AND status=?'; params.push(status) }
  if (productId) {
    whereExtra += ' AND EXISTS (SELECT 1 FROM purchase_return_items pri WHERE pri.return_id = purchase_returns.id AND pri.product_id = ?)'
    params.push(productId)
  }
  if (supplierId) { whereExtra += ' AND supplier_id=?'; params.push(supplierId) }
  if (warehouseId) { whereExtra += ' AND warehouse_id=?'; params.push(warehouseId) }
  if (operatorId) { whereExtra += ' AND operator_id=?'; params.push(operatorId) }
  if (startDate) { whereExtra += ' AND DATE(created_at)>=?'; params.push(startDate) }
  if (endDate) { whereExtra += ' AND DATE(created_at)<=?'; params.push(endDate) }
  if (remark) { whereExtra += ' AND remark LIKE ?'; params.push(`%${remark}%`) }
  const where = `deleted_at IS NULL AND (return_no LIKE ? OR supplier_name LIKE ?) ${whereExtra}`
  const [rows]=await pool.query(`SELECT * FROM purchase_returns WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,[...params,pageSize,offset])
  const [[{total}]]=await pool.query(`SELECT COUNT(*) AS total FROM purchase_returns WHERE ${where}`,params)
  return { list:rows.map(fmtPR), pagination:{page,pageSize,total} }
}

async function findByIdPR(id) {
  const [rows]=await pool.query('SELECT * FROM purchase_returns WHERE id=? AND deleted_at IS NULL',[id])
  if(!rows[0]) throw new AppError('退货单不存在',404)
  const ret=fmtPR(rows[0])
  const [items]=await pool.query('SELECT * FROM purchase_return_items WHERE return_id=?',[id])
  ret.items=items.map(r=>({id:r.id,sourceItemId:r.purchase_item_id||null,productId:r.product_id,productCode:r.product_code,productName:r.product_name,articleNumber:r.article_number||null,spec:r.spec||null,color:r.color||null,unit:r.unit,quantity:Number(r.quantity),unitPrice:Number(r.unit_price),amount:Number(r.amount)}))
  const [[task]]=await pool.query(
    "SELECT id, task_no, status FROM warehouse_tasks WHERE return_id=? AND task_type='purchase_return' AND deleted_at IS NULL ORDER BY id DESC LIMIT 1",
    [id],
  )
  ret.task = task ? { id: Number(task.id), taskNo: task.task_no, status: Number(task.status), statusName: WT_STATUS_NAME[Number(task.status)] || '未知' } : null
  return ret
}

async function createPR({ supplierId, supplierName, warehouseId, warehouseName, purchaseOrderId = null, purchaseOrderNo, remark, items, operator, requestKey }) {
  const conn=await pool.getConnection()
  try {
    await conn.beginTransaction()
    const requestState = await beginOperationRequest(conn, {
      requestKey,
      action: 'purchaseReturn.create',
      userId: operator?.userId ?? null,
    })
    if (requestState.replay) {
      await conn.rollback()
      return requestState.responseData
    }
    let resolvedPurchaseOrderId = purchaseOrderId || null
    let sourceOrder = null
    if (!resolvedPurchaseOrderId && purchaseOrderNo) {
      sourceOrder = await loadPurchaseSourceOrderByNo(purchaseOrderNo)
      resolvedPurchaseOrderId = sourceOrder.id
    } else if (resolvedPurchaseOrderId) {
      const [rows] = await conn.query(
        'SELECT id, supplier_id, warehouse_id FROM purchase_orders WHERE id=? AND deleted_at IS NULL LIMIT 1',
        [resolvedPurchaseOrderId],
      )
      if (!rows[0]) throw new AppError('关联采购单不存在', 404)
      sourceOrder = {
        id: Number(rows[0].id),
        supplierId: Number(rows[0].supplier_id),
        warehouseId: Number(rows[0].warehouse_id),
      }
    }
    if (sourceOrder) {
      if (Number(sourceOrder.supplierId) !== Number(supplierId)) {
        throw new AppError('采购退货供应商必须与原采购单一致', 400)
      }
      if (Number(sourceOrder.warehouseId) !== Number(warehouseId)) {
        throw new AppError('采购退货仓库必须与原采购单一致', 400)
      }
    }
    await validatePurchaseReturnItems(conn, resolvedPurchaseOrderId, items)
    const returnNo=await genNo(conn,'PR','purchase_returns','return_no')
    const total=items.reduce((s,i)=>s+i.quantity*i.unitPrice,0)
    const [r]=await conn.query(`INSERT INTO purchase_returns (return_no,supplier_id,supplier_name,warehouse_id,warehouse_name,purchase_order_id,purchase_order_no,total_amount,remark,operator_id,operator_name) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,[returnNo,supplierId,supplierName,warehouseId,warehouseName,resolvedPurchaseOrderId,purchaseOrderNo||null,total,remark||null,operator.userId,operator.realName])
    for(const item of items) await conn.query(`INSERT INTO purchase_return_items (return_id,purchase_item_id,product_id,product_code,product_name,article_number,spec,color,unit,quantity,unit_price,amount) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,[r.insertId,item.sourceItemId||null,item.productId,item.productCode,item.productName,item.articleNumber||null,item.spec||null,item.color||null,item.unit,item.quantity,item.unitPrice,item.quantity*item.unitPrice])
    await recordReturnEvent(conn, {
      returnType: 'purchase',
      returnId: r.insertId,
      returnNo,
      eventType: RETURN_EVENT.CREATED,
      title: '采购退货单已创建',
      description: `供应商 ${supplierName}`,
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
      resourceType: 'purchase_return',
      resourceId: r.insertId,
    })
    await conn.commit(); return result
  } catch(e){ await conn.rollback(); throw e } finally { conn.release() }
}

async function confirmPR(id, operator = null) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const retRow = await lockStatusRow(conn, {
      table: 'purchase_returns',
      id,
      columns: 'id, return_no, purchase_order_id, purchase_order_no, supplier_id, supplier_name, warehouse_id, warehouse_name, status',
      entityName: '采购退货单',
    })
    const rule = assertStatusAction('purchaseReturn', 'confirm', retRow.status)
    await compareAndSetStatus(conn, {
      table: 'purchase_returns',
      id,
      fromStatus: rule.from,
      toStatus: rule.to,
      entityName: '采购退货单',
    })

    // 确认后自动创建仓库任务（拣货→出库）
    const [itemRows] = await conn.query(
      'SELECT * FROM purchase_return_items WHERE return_id=? ORDER BY id', [id],
    )
    const taskSvc = require('../warehouse-tasks/warehouse-tasks.service')
    const { taskId, taskNo } = await taskSvc.createForPurchaseReturn({
      returnId: Number(retRow.id),
      returnNo: retRow.return_no,
      supplierName: retRow.supplier_name,
      warehouseId: Number(retRow.warehouse_id),
      warehouseName: retRow.warehouse_name,
      items: itemRows.map(r => ({
        productId: Number(r.product_id),
        productCode: r.product_code,
        productName: r.product_name,
        unit: r.unit,
        quantity: Number(r.quantity),
      })),
      conn,
    })

    await recordReturnEvent(conn, {
      returnType: 'purchase',
      returnId: Number(retRow.id),
      returnNo: retRow.return_no,
      eventType: RETURN_EVENT.CONFIRMED,
      title: '采购退货单已确认',
      description: `已生成仓库拣货任务 ${taskNo}，请提交到 PDA 执行`,
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

async function cancelPR(id, operator = null) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const retRow = await lockStatusRow(conn, {
      table: 'purchase_returns',
      id,
      columns: 'id, return_no, status',
      entityName: '采购退货单',
    })
    const rule = assertStatusAction('purchaseReturn', 'cancel', retRow.status)
    await compareAndSetStatus(conn, {
      table: 'purchase_returns',
      id,
      fromStatus: rule.from,
      toStatus: rule.to,
      entityName: '采购退货单',
    })

    // 已确认(2)会自动创建出库仓库任务；取消时必须同步终止该任务，否则仓库端会
    // 继续把一个"已取消"的退货单执行完，造成账实不符（P0-2）。任务已出库(SHIPPED)
    // 的情况不会出现在这里——那条路径会先把本单据的状态推进到 3(已退货)，
    // 与本函数只允许的 from:[1,2] 互斥（两边都对 purchase_returns 行加锁，天然互斥）。
    const [[linkedTask]] = await conn.query(
      `SELECT id, status FROM warehouse_tasks
       WHERE return_id = ? AND task_type = 'purchase_return'
       ORDER BY id DESC LIMIT 1`,
      [id],
    )
    if (linkedTask && WT_STATUS_ACTIVE.includes(Number(linkedTask.status))) {
      const taskSvc = require('../warehouse-tasks/warehouse-tasks.service')
      await taskSvc.cancel(Number(linkedTask.id), { conn })
    }

    await recordReturnEvent(conn, {
      returnType: 'purchase',
      returnId: Number(retRow.id),
      returnNo: retRow.return_no,
      eventType: RETURN_EVENT.CANCELLED,
      title: '采购退货单已取消',
      description: linkedTask && WT_STATUS_ACTIVE.includes(Number(linkedTask.status))
        ? '采购退货单已取消，未执行库存扣减，关联的出库仓库任务已同步终止'
        : '采购退货单已取消，未执行库存扣减',
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
 * 采购退货出库完成回调（由 WT ship 事务内调用）
 * 容器扣减已在 moveStock 中完成，此处仅做退货单状态同步和账款冲减
 */
async function syncPurchaseReturnShipped(conn, returnId, { taskId, taskNo, operator }) {
  const retRow = await lockStatusRow(conn, {
    table: 'purchase_returns',
    id: returnId,
    columns: 'id, return_no, purchase_order_id, purchase_order_no, supplier_id, warehouse_id, status',
    entityName: '采购退货单',
  })
  if (Number(retRow.status) !== 2) {
    throw new AppError(`采购退货单状态异常（当前非已确认），无法完成出库`, 409)
  }
  const rule = assertStatusAction('purchaseReturn', 'execute', retRow.status)

  // 账款冲减：从应付账款中减去退货金额
  const [[{ totalAmount }]] = await conn.query(
    'SELECT COALESCE(SUM(quantity * unit_price), 0) AS totalAmount FROM purchase_return_items WHERE return_id = ?',
    [returnId],
  )
  if (retRow.purchase_order_id && totalAmount > 0) {
    await adjustPaymentRecordForReturn(conn, {
      recordType: 1,
      orderId: Number(retRow.purchase_order_id),
      orderNo: retRow.purchase_order_no,
      returnNo: retRow.return_no,
      returnType: 'purchase',
      amount: Number(totalAmount),
      operator: operator || {},
    })
  }

  await compareAndSetStatus(conn, {
    table: 'purchase_returns',
    id: returnId,
    fromStatus: rule.from,
    toStatus: rule.to,
    entityName: '采购退货单',
  })

  await recordReturnEvent(conn, {
    returnType: 'purchase',
    returnId: Number(retRow.id),
    returnNo: retRow.return_no,
    eventType: RETURN_EVENT.EXECUTED,
    title: '采购退货出库完成',
    description: `仓库任务 ${taskNo} 已出库，退货单自动完成`,
    operatorId: operator?.userId ?? null,
    operatorName: operator?.realName ?? null,
    requestId: getRequestId(),
    payload: {
      taskId,
      taskNo,
      totalAmount: Number(totalAmount),
      inventoryDirection: 'out',
    },
  })
}

module.exports = {
  findAllPR,
  findByIdPR,
  createPR,
  confirmPR,
  cancelPR,
  syncPurchaseReturnShipped,
  loadPurchaseSourceOrderByNo,
}
