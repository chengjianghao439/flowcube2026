const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const { generateDailyCode } = require('../../utils/codeGenerator')
const { appendInboundEvent, fmtTask } = require('../inbound-tasks/inbound-tasks.helpers')
const { buildTaskWithClosure, loadInboundTaskClosureSummary } = require('../inbound-tasks/inbound-tasks.query')
const { getInboundClosureThresholds } = require('../../utils/inboundThresholds')
const { lockStatusRow, compareAndSetStatus } = require('../../utils/statusTransition')
const { assertStatusAction } = require('../../constants/documentStatusRules')
const { beginOperationRequest, completeOperationRequest } = require('../../utils/operationRequest')
const { recomputePurchasePayable } = require('../inbound-tasks/inbound-tasks.settle')
const { scopeFilter, assertInScope } = require('../../utils/warehouseScope')

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
    // 与 closeRemaining() 的两条硬性前提保持完全一致（相关收货订单均已上架完成 + 已有实收数量），
    // 供列表页判断是否展示"关闭剩余"入口，避免对必然失败的订单诱导点击。
    canCloseRemaining: row.pending_inbound_count !== undefined
      ? Number(row.pending_inbound_count) === 0 && Number(row.putaway_received_qty || 0) > 0
      : undefined,
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

async function findAll({ page=1, pageSize=20, keyword='', status=null, productId=null, supplierId=null, warehouseId=null, startDate=null, endDate=null, remark=null, operatorId=null, overdueOnly=false, scopeWarehouseIds=null }) {
  const offset = (page - 1) * pageSize
  const params = []
  let whereExtra = ''
  if (keyword) {
    whereExtra += ' AND po.order_no LIKE ?'
    params.push(`%${keyword}%`)
  }
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
  if (overdueOnly) {
    // 到货看板"逾期未到"筛选：仍在草稿/已确认状态且预计到货日已过
    whereExtra += ' AND po.status IN (1,2) AND po.expected_date IS NOT NULL AND po.expected_date < CURDATE()'
  }
  // 仓库数据权限：列表与计数共用 whereExtra/params，加一次即两处生效
  const scope = scopeFilter(scopeWarehouseIds, 'po.warehouse_id')
  if (scope.sql) {
    whereExtra += scope.sql
    params.push(...scope.params)
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
       ), 0) AS total_received_qty,
       (
         SELECT COUNT(DISTINCT it.id)
         FROM inbound_task_items iti
         JOIN inbound_tasks it ON it.id = iti.task_id
         WHERE iti.purchase_order_id = po.id AND it.deleted_at IS NULL AND it.status <> 5 AND it.audit_status <> 1
       ) AS pending_inbound_count,
       COALESCE((
         SELECT SUM(iti.putaway_qty)
         FROM inbound_task_items iti
         JOIN inbound_tasks it ON it.id = iti.task_id
         WHERE iti.purchase_order_id = po.id AND it.deleted_at IS NULL AND it.status <> 5 AND it.audit_status = 1
       ), 0) AS putaway_received_qty
     FROM purchase_orders po
     WHERE po.deleted_at IS NULL ${whereExtra}
     ORDER BY po.created_at DESC LIMIT ? OFFSET ?`,
    [...params, pageSize, offset],
  )
  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) AS total FROM purchase_orders po
     WHERE po.deleted_at IS NULL ${whereExtra}`,
    params,
  )
  return { list: rows.map(fmtOrder), pagination: { page, pageSize, total } }
}

// scopeWarehouseIds 默认 null（不限仓）——内部调用方（如 createFromPoId）不传即保持原行为；
// 只有来自 HTTP 的 controller 会把 req.user.warehouseIds 传进来，用于挡住「知道 id 就直查详情」
async function findById(id, scopeWarehouseIds = null) {
  const [rows] = await pool.query(
    'SELECT * FROM purchase_orders WHERE id=? AND deleted_at IS NULL',
    [id],
  )
  if (!rows[0]) throw new AppError('采购单不存在', 404)
  assertInScope(scopeWarehouseIds, rows[0].warehouse_id, '采购单')
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
    `SELECT * FROM inbound_tasks
     WHERE id IN (SELECT DISTINCT task_id FROM inbound_task_items WHERE purchase_order_id = ?)
       AND deleted_at IS NULL
     ORDER BY created_at ASC`,
    [id],
  )
  // 展示的状态要跟收货订单详情页一致：不能只看 status（4=已完成）字段，还要叠加
  // 打印超时/失败、上架超期等异常——否则这里显示"已完成"，点进去却是"异常中"。
  const thresholds = await getInboundClosureThresholds()
  const closureSummaryMap = await loadInboundTaskClosureSummary(taskRows.map(r => r.id), thresholds)
  order.inboundTasks = taskRows.map(r => {
    const task = fmtTask(r)
    const withClosure = buildTaskWithClosure(task, [], closureSummaryMap.get(task.id), [], [], thresholds)
    return { id: task.id, taskNo: task.taskNo, status: task.status, receiptStatus: withClosure.receiptStatus }
  })

  return order
}

// 事务内建单核心：供应商校验 + 建采购单草稿(status=1) + 明细。承接调用方 conn，不自管事务、不做幂等
// （幂等由外层 create 的 operationRequest 负责）。供采购计划转采购(procurement.service.convert)在同一事务复用。
async function createWithinTransaction(conn, { supplierId, supplierName, warehouseId, warehouseName, expectedDate, remark, items, operator }) {
  // 前端选择器已过滤停用供应商，这里补一道后端校验，防止绕过前端直接调 API 建单（禁用供应商未在下单流程过滤）
  const [[supplierRow]] = await conn.query(
    'SELECT is_active FROM supply_suppliers WHERE id = ? AND deleted_at IS NULL',
    [supplierId],
  )
  if (!supplierRow) throw new AppError('供应商不存在', 404)
  if (!supplierRow.is_active) throw new AppError('该供应商已停用，无法新建采购单', 400)
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
  return { id:orderId, orderNo }
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
    const result = await createWithinTransaction(conn, { supplierId, supplierName, warehouseId, warehouseName, expectedDate, remark, items, operator })
    await completeOperationRequest(conn, requestState, {
      data: result,
      message: '创建成功',
      resourceType: 'purchase_order',
      resourceId: result.id,
    })
    await conn.commit()
    return result
  } catch(e){ await conn.rollback(); throw e }
  finally { conn.release() }
}

async function update(id, { supplierId, supplierName, warehouseId, warehouseName, expectedDate, remark, items, scopeWarehouseIds = null }) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const row = await lockStatusRow(conn, { table: 'purchase_orders', id, columns: 'id, status, warehouse_id', entityName: '采购单' })
    assertInScope(scopeWarehouseIds, row.warehouse_id, '采购单')
    // 改单同时限制目标仓：不能把单据「搬」到 scope 之外的仓库
    assertInScope(scopeWarehouseIds, warehouseId, '采购单')
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

// 短装结案：把「已提交(2)」采购单手动完成（剩余未收量作罢），前提是相关收货订单已全部上架完成（audit_status 随上架完成自动置1）且确有实收入库。
async function closeRemaining(id, operator, scopeWarehouseIds = null) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const row = await lockStatusRow(conn, { table: 'purchase_orders', id, columns: 'id, order_no, status, warehouse_id', entityName: '采购单' })
    assertInScope(scopeWarehouseIds, row.warehouse_id, '采购单')
    const rule = assertStatusAction('purchase', 'close', row.status)
    const [[{ pending }]] = await conn.query(
      `SELECT COUNT(DISTINCT it.id) AS pending
         FROM inbound_task_items iti JOIN inbound_tasks it ON it.id=iti.task_id
        WHERE iti.purchase_order_id=? AND it.deleted_at IS NULL AND it.status<>5 AND it.audit_status<>1`,
      [id],
    )
    if (Number(pending) > 0) throw new AppError('存在未全部上架完成的收货订单，请先处理完收货/上架再关闭剩余', 409)
    const [[{ received }]] = await conn.query(
      `SELECT COALESCE(SUM(iti.putaway_qty),0) AS received
         FROM inbound_task_items iti JOIN inbound_tasks it ON it.id=iti.task_id
        WHERE iti.purchase_order_id=? AND it.deleted_at IS NULL AND it.status<>5 AND it.audit_status=1`,
      [id],
    )
    if (Number(received) <= 0) throw new AppError('该采购单尚无已入库数量，不能关闭结案（如需终止请改用取消）', 409)
    await recomputePurchasePayable(conn, id)
    await compareAndSetStatus(conn, {
      table: 'purchase_orders', id,
      fromStatus: rule.from, toStatus: rule.to, entityName: '采购单',
      extraSet: { closed_reason: 'short_close' },
    })
    await conn.commit()
  } catch(e){ await conn.rollback(); throw e }
  finally { conn.release() }
}

async function confirm(id, operator, scopeWarehouseIds = null) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const orderRow = await lockStatusRow(conn, { table: 'purchase_orders', id, columns: 'id, status, warehouse_id', entityName: '采购单' })
    assertInScope(scopeWarehouseIds, orderRow.warehouse_id, '采购单')
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

async function withdrawConfirm(id, operator, scopeWarehouseIds = null) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    // 与 cancel()/receive() 保持同样的加锁顺序（先 inbound_tasks 后 purchase_orders），避免并发死锁。
    // 混合采购单收货单的 inbound_tasks.purchase_order_id 头字段为空，须按明细行关联查找。
    const [taskIdRows] = await conn.query(
      'SELECT DISTINCT task_id FROM inbound_task_items WHERE purchase_order_id = ?',
      [id],
    )
    const taskIds = taskIdRows.map(r => Number(r.task_id))
    const [taskRows] = taskIds.length
      ? await conn.query(
          `SELECT id, task_no FROM inbound_tasks WHERE id IN (?) AND deleted_at IS NULL AND status <> 5 FOR UPDATE`,
          [taskIds],
        )
      : [[]]
    if (taskRows.length) {
      throw new AppError(
        `该采购单已创建收货订单 ${taskRows.map(t => t.task_no).join('、')}，请先取消收货订单后再撤回确认`,
        409,
      )
    }
    const orderRow = await lockStatusRow(conn, { table: 'purchase_orders', id, columns: 'id, status, warehouse_id', entityName: '采购单' })
    assertInScope(scopeWarehouseIds, orderRow.warehouse_id, '采购单')
    const rule = assertStatusAction('purchase', 'withdrawConfirm', orderRow.status)
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

async function cancel(id, operator, scopeWarehouseIds = null) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()

    // 混合采购单收货单的 inbound_tasks.purchase_order_id 头字段为空，须按明细行关联查找涉及本采购单的收货单。
    // 加锁顺序必须与 receive()/putaway()（含上架完成自动结算）保持一致（先 inbound_tasks 后 purchase_orders），
    // 否则并发下两边反向加锁会触发 InnoDB 死锁。
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

    const orderRow = await lockStatusRow(conn, { table: 'purchase_orders', id, entityName: '采购单' })
    assertInScope(scopeWarehouseIds, orderRow.warehouse_id, '采购单')
    const cancelRule = assertStatusAction('purchase', 'cancel', orderRow.status)

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

module.exports = { findAll, findById, create, createWithinTransaction, update, confirm, withdrawConfirm, cancel, closeRemaining }
