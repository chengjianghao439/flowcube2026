const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const { generateDailyCode } = require('../../utils/codeGenerator')
const { appendInboundEvent } = require('../inbound-tasks/inbound-tasks.helpers')
const { lockStatusRow, compareAndSetStatus } = require('../../utils/statusTransition')
const { assertStatusAction } = require('../../constants/documentStatusRules')
const { beginOperationRequest, completeOperationRequest } = require('../../utils/operationRequest')
const { recomputePurchasePayable } = require('../inbound-tasks/inbound-tasks.settle')

const STATUS = { 1:'草稿', 2:'已提交', 3:'已完成', 4:'已取消' }

function fmtOrder(row) {
  return {
    id: row.id,
    orderNo: row.order_no,
    supplierId: row.supplier_id,
    supplierName: row.supplier_name,
    warehouseId: row.warehouse_id,
    warehouseName: row.warehouse_name,
    status: row.status,
    statusName: STATUS[row.status],
    expectedDate: row.expected_date,
    totalAmount: Number(row.total_amount),
    totalOrderedQty: Number(row.total_ordered_qty || 0),
    totalReceivedQty: Number(row.total_received_qty || 0),
    remark: row.remark,
    operatorId: row.operator_id,
    operatorName: row.operator_name,
    createdAt: row.created_at,
  }
}

/** 显式列清单（勿用 po.*，避免返回无关字段） */
const PO_COLUMNS = `po.id, po.order_no, po.supplier_id, po.supplier_name, po.warehouse_id, po.warehouse_name,
  po.status, po.expected_date, po.total_amount, po.remark, po.operator_id, po.operator_name,
  po.created_at, po.updated_at, po.deleted_at`

const genOrderNo = conn => generateDailyCode(conn, 'PO', 'purchase_orders', 'order_no')

async function findAll({ page=1, pageSize=20, keyword='', status=null, productId=null, supplierId=null, warehouseId=null, startDate=null, endDate=null, remark=null, operatorId=null }) {
  const offset = (page - 1) * pageSize
  const like = `%${keyword}%`
  const params = [like]
  let whereExtra = ''
  if (status) {
    whereExtra += ' AND po.status = ?'
    params.push(status)
  }
  if (productId) {
    whereExtra += ' AND EXISTS (SELECT 1 FROM purchase_order_items poi WHERE poi.order_id = po.id AND poi.product_id = ?)'
    params.push(productId)
  }
  if (supplierId) {
    whereExtra += ' AND po.supplier_id = ?'
    params.push(supplierId)
  }
  if (warehouseId) {
    whereExtra += ' AND po.warehouse_id = ?'
    params.push(warehouseId)
  }
  if (startDate) {
    whereExtra += ' AND DATE(po.created_at) >= ?'
    params.push(startDate)
  }
  if (endDate) {
    whereExtra += ' AND DATE(po.created_at) <= ?'
    params.push(endDate)
  }
  if (remark) {
    whereExtra += ' AND po.remark LIKE ?'
    params.push(`%${remark}%`)
  }
  if (operatorId) {
    whereExtra += ' AND po.operator_id = ?'
    params.push(operatorId)
  }
  const [rows] = await pool.query(
    `SELECT ${PO_COLUMNS},
       COALESCE((
         SELECT SUM(iti.ordered_qty)
         FROM inbound_task_items iti
         JOIN inbound_tasks it ON it.id = iti.task_id
         WHERE iti.purchase_order_id = po.id AND it.deleted_at IS NULL
       ), 0) AS total_ordered_qty,
       COALESCE((
         SELECT SUM(iti.received_qty)
         FROM inbound_task_items iti
         JOIN inbound_tasks it ON it.id = iti.task_id
         WHERE iti.purchase_order_id = po.id AND it.deleted_at IS NULL
       ), 0) AS total_received_qty
     FROM purchase_orders po
     WHERE po.deleted_at IS NULL AND po.order_no LIKE ? ${whereExtra}
     ORDER BY po.created_at DESC LIMIT ? OFFSET ?`,
    [...params, pageSize, offset],
  )
  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) AS total FROM purchase_orders po
     WHERE po.deleted_at IS NULL AND po.order_no LIKE ? ${whereExtra}`,
    params,
  )
  return { list: rows.map(fmtOrder), pagination: { page, pageSize, total } }
}

async function findById(id) {
  const [rows] = await pool.query(
    'SELECT * FROM purchase_orders WHERE id=? AND deleted_at IS NULL',
    [id],
  )
  if (!rows[0]) throw new AppError('采购单不存在', 404)
  const order = fmtOrder(rows[0])
  const [items] = await pool.query('SELECT * FROM purchase_order_items WHERE order_id=?',[id])
  order.items = items.map(r=>({ id:r.id, productId:r.product_id, productCode:r.product_code, productName:r.product_name, unit:r.unit, articleNumber:r.article_number, spec:r.spec, color:r.color, quantity:Number(r.quantity), unitPrice:Number(r.unit_price), amount:Number(r.amount), remark:r.remark }))

  const [[qty]] = await pool.query(
    `SELECT COALESCE(SUM(iti.ordered_qty),0) AS total_ordered_qty, COALESCE(SUM(iti.received_qty),0) AS total_received_qty
     FROM inbound_task_items iti JOIN inbound_tasks it ON it.id = iti.task_id
     WHERE iti.purchase_order_id = ? AND it.deleted_at IS NULL`,
    [id],
  )
  order.totalOrderedQty = Number(qty.total_ordered_qty)
  order.totalReceivedQty = Number(qty.total_received_qty)

  // 混合采购单收货单的 inbound_tasks.purchase_order_id 头字段为空，须按明细行关联查找
  const [taskRows] = await pool.query(
    `SELECT DISTINCT it.id, it.task_no, it.status, it.created_at
     FROM inbound_task_items iti JOIN inbound_tasks it ON it.id = iti.task_id
     WHERE iti.purchase_order_id = ? AND it.deleted_at IS NULL ORDER BY it.created_at ASC`,
    [id],
  )
  order.inboundTasks = taskRows.map(r => ({ id: r.id, taskNo: r.task_no, status: r.status }))

  return order
}

async function create({ supplierId, supplierName, warehouseId, warehouseName, expectedDate, remark, items, operator, requestKey }) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const requestState = await beginOperationRequest(conn, {
      requestKey,
      action: 'purchase.create',
      userId: operator?.userId ?? null,
    })
    if (requestState.replay) {
      await conn.rollback()
      return requestState.responseData
    }
    const orderNo = await genOrderNo(conn)
    const total = items.reduce((s,i)=>s+i.quantity*i.unitPrice,0)
    const [r] = await conn.query(
      `INSERT INTO purchase_orders (order_no,supplier_id,supplier_name,warehouse_id,warehouse_name,expected_date,total_amount,remark,operator_id,operator_name) VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [orderNo,supplierId,supplierName,warehouseId,warehouseName,expectedDate||null,total,remark||null,operator.userId,operator.realName]
    )
    const orderId = r.insertId
    for(const item of items) {
      await conn.query(
        `INSERT INTO purchase_order_items (order_id,product_id,product_code,product_name,unit,article_number,spec,color,quantity,unit_price,amount,remark) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        [orderId,item.productId,item.productCode,item.productName,item.unit,item.articleNumber||null,item.spec||null,item.color||null,item.quantity,item.unitPrice,item.quantity*item.unitPrice,item.remark||null]
      )
    }
    const result = { id:orderId, orderNo }
    await completeOperationRequest(conn, requestState, {
      data: result,
      message: '创建成功',
      resourceType: 'purchase_order',
      resourceId: orderId,
    })
    await conn.commit()
    return result
  } catch(e){ await conn.rollback(); throw e }
  finally { conn.release() }
}

async function update(id, { supplierId, supplierName, warehouseId, warehouseName, expectedDate, remark, items }) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const row = await lockStatusRow(conn, { table: 'purchase_orders', id, columns: 'id, status', entityName: '采购单' })
    assertStatusAction('purchase', 'edit', row.status)
    const total = items.reduce((s,i)=>s+i.quantity*i.unitPrice,0)
    await conn.query(
      `UPDATE purchase_orders SET supplier_id=?, supplier_name=?, warehouse_id=?, warehouse_name=?, expected_date=?, total_amount=?, remark=? WHERE id=?`,
      [supplierId,supplierName,warehouseId,warehouseName,expectedDate||null,total,remark||null,id]
    )
    await conn.query('DELETE FROM purchase_order_items WHERE order_id=?', [id])
    for(const item of items) {
      await conn.query(
        `INSERT INTO purchase_order_items (order_id,product_id,product_code,product_name,unit,article_number,spec,color,quantity,unit_price,amount,remark) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        [id,item.productId,item.productCode,item.productName,item.unit,item.articleNumber||null,item.spec||null,item.color||null,item.quantity,item.unitPrice,item.quantity*item.unitPrice,item.remark||null]
      )
    }
    await conn.commit()
  } catch(e){ await conn.rollback(); throw e }
  finally { conn.release() }
  return findById(id)
}

// 短装结案：把「已提交(2)」采购单手动完成（剩余未收量作罢），前提是相关收货订单已全部审核通过且确有实收入库。
async function closeRemaining(id, operator) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const row = await lockStatusRow(conn, { table: 'purchase_orders', id, columns: 'id, order_no, status', entityName: '采购单' })
    const rule = assertStatusAction('purchase', 'close', row.status)
    const [[{ pending }]] = await conn.query(
      `SELECT COUNT(DISTINCT it.id) AS pending
         FROM inbound_task_items iti JOIN inbound_tasks it ON it.id=iti.task_id
        WHERE iti.purchase_order_id=? AND it.deleted_at IS NULL AND it.status<>5 AND it.audit_status<>1`,
      [id],
    )
    if (Number(pending) > 0) throw new AppError('存在未审核通过的收货订单，请先完成审核再关闭剩余', 409)
    const [[{ received }]] = await conn.query(
      `SELECT COALESCE(SUM(iti.putaway_qty),0) AS received
         FROM inbound_task_items iti JOIN inbound_tasks it ON it.id=iti.task_id
        WHERE iti.purchase_order_id=? AND it.deleted_at IS NULL AND it.status<>5 AND it.audit_status=1`,
      [id],
    )
    if (Number(received) <= 0) throw new AppError('该采购单尚无已审核入库，不能关闭结案（如需终止请改用取消）', 409)
    await recomputePurchasePayable(conn, id)
    await compareAndSetStatus(conn, {
      table: 'purchase_orders', id,
      fromStatus: rule.from, toStatus: rule.to, entityName: '采购单',
    })
    await conn.commit()
  } catch(e){ await conn.rollback(); throw e }
  finally { conn.release() }
}

async function confirm(id, operator) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const orderRow = await lockStatusRow(conn, { table: 'purchase_orders', id, columns: 'id, status', entityName: '采购单' })
    const rule = assertStatusAction('purchase', 'confirm', orderRow.status)
    await compareAndSetStatus(conn, {
      table: 'purchase_orders',
      id,
      fromStatus: rule.from,
      toStatus: rule.to,
      entityName: '采购单',
    })
    await conn.commit()
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }
}

async function cancel(id, operator) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const orderRow = await lockStatusRow(conn, { table: 'purchase_orders', id, entityName: '采购单' })
    const cancelRule = assertStatusAction('purchase', 'cancel', orderRow.status)

    // 混合采购单收货单的 inbound_tasks.purchase_order_id 头字段为空，须按明细行关联查找涉及本采购单的收货单
    const [taskIdRows] = await conn.query(
      'SELECT DISTINCT task_id FROM inbound_task_items WHERE purchase_order_id = ?',
      [id],
    )
    const taskIds = taskIdRows.map(r => Number(r.task_id))
    // 与 receive() 锁的是同一行（inbound_tasks 主键），避免与 PDA 现场收货并发时产生竞态
    const [taskRows] = taskIds.length
      ? await conn.query(
          `SELECT id, task_no, status FROM inbound_tasks
           WHERE id IN (?) AND deleted_at IS NULL AND status <> 5 FOR UPDATE`,
          [taskIds],
        )
      : [[]]

    // 本采购单在收货单里已产生实际收货（即便是混单场景），不能随取消动作静默消失，必须先走收货流程处理
    for (const taskRow of taskRows) {
      const [[{ received }]] = await conn.query(
        `SELECT COALESCE(SUM(received_qty), 0) AS received
         FROM inbound_task_items
         WHERE task_id = ? AND purchase_order_id = ?`,
        [taskRow.id, id],
      )
      if (Number(received) > 0) {
        throw new AppError(`采购单在收货订单 ${taskRow.task_no} 中已产生实际收货，请先处理收货流程`, 409)
      }
    }

    // 校验通过：本采购单在这些收货单里都还没实际收货，安全移出对应明细；
    // 收货单因此变空则整单级联取消（等同混单前的行为），否则保留收货单继续处理其余采购单的明细
    for (const taskRow of taskRows) {
      const [[{ remain }]] = await conn.query(
        'SELECT COUNT(*) AS remain FROM inbound_task_items WHERE task_id = ? AND purchase_order_id <> ?',
        [taskRow.id, id],
      )
      await conn.query(
        'DELETE FROM inbound_task_items WHERE task_id = ? AND purchase_order_id = ?',
        [taskRow.id, id],
      )
      if (Number(remain) === 0) {
        assertStatusAction('inboundTask', 'cancel', taskRow.status)
        await compareAndSetStatus(conn, {
          table: 'inbound_tasks',
          id: Number(taskRow.id),
          fromStatus: 1,
          toStatus: 5,
          entityName: '收货订单',
        })
        await appendInboundEvent(
          conn,
          Number(taskRow.id),
          'cancelled_by_purchase',
          '采购单取消同步取消收货订单',
          `因采购单 ${orderRow.order_no} 已取消，收货订单 ${taskRow.task_no} 自动取消`,
          operator,
          { purchaseOrderId: id, purchaseOrderNo: orderRow.order_no },
        )
      } else {
        await appendInboundEvent(
          conn,
          Number(taskRow.id),
          'items_removed_by_purchase_cancel',
          '采购单取消移出关联明细',
          `因采购单 ${orderRow.order_no} 已取消，已从收货订单 ${taskRow.task_no} 中移出其未收货明细`,
          operator,
          { purchaseOrderId: id, purchaseOrderNo: orderRow.order_no },
        )
      }
    }

    await compareAndSetStatus(conn, {
      table: 'purchase_orders',
      id,
      fromStatus: cancelRule.from,
      toStatus: cancelRule.to,
      entityName: '采购单',
    })
    await conn.commit()
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }
}

module.exports = { findAll, findById, create, update, confirm, cancel, closeRemaining }
