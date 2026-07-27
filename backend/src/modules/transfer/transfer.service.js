const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const { MOVE_TYPE } = require('../../engine/inventoryEngine')
const { SOURCE_TYPE, getAvailableStockForDecision, syncStockFromContainers, CONTAINER_STATUS } = require('../../engine/containerEngine')
const { generateDailyCode } = require('../../utils/codeGenerator')
const { lockStatusRow, compareAndSetStatus } = require('../../utils/statusTransition')
const { transferScopeFilter, assertTransferInScope } = require('../../utils/warehouseScope')
const { assertStatusAction } = require('../../constants/documentStatusRules')
const { TRANSFER_EVENT, record: recordTransferEvent } = require('./transfer-events.service')
const { getRequestId } = require('../../utils/requestContext')
const { beginOperationRequest, completeOperationRequest } = require('../../utils/operationRequest')
const STATUS = { 1:'草稿', 2:'待出库', 3:'在途', 4:'已完成', 5:'已取消' }

const fmt = r => ({ id:r.id, orderNo:r.order_no, fromWarehouseId:r.from_warehouse_id, fromWarehouseName:r.from_warehouse_name, toWarehouseId:r.to_warehouse_id, toWarehouseName:r.to_warehouse_name, status:r.status, statusName:STATUS[r.status], remark:r.remark, submittedAt:r.submitted_at, submittedByName:r.submitted_by_name, operatorId:r.operator_id, operatorName:r.operator_name, createdAt:r.created_at })

const genNo = conn => generateDailyCode(conn, 'TR', 'transfer_orders', 'order_no')

function assertDifferentWarehouses(fromWarehouseId, toWarehouseId) {
  if (Number(fromWarehouseId) === Number(toWarehouseId)) {
    throw new AppError('调出仓库和调入仓库不能相同', 400)
  }
}

async function assertTransferAvailability(conn, order) {
  if (!order.items?.length) throw new AppError('调拨单无明细', 400)

  const merged = new Map()
  for (const item of order.items) {
    const key = `${order.fromWarehouseId}:${item.productId}`
    const prev = merged.get(key)
    if (prev) {
      prev.quantity += Number(item.quantity)
    } else {
      merged.set(key, {
        productId: item.productId,
        productName: item.productName,
        quantity: Number(item.quantity),
      })
    }
  }

  for (const item of merged.values()) {
    const { available } = await getAvailableStockForDecision(conn, {
      productId: item.productId,
      warehouseId: order.fromWarehouseId,
      lock: true,
    })
    if (available < item.quantity) {
      throw new AppError(
        `调拨库存不足：${item.productName} 可用 ${available}，申请 ${item.quantity}`,
        400,
      )
    }
  }
}

async function findAll({ page=1, pageSize=20, keyword='', status=null, productId=null, warehouseId=null, operatorId=null, startDate=null, endDate=null, remark=null, scopeWarehouseIds=null }) {
  const offset=(page-1)*pageSize, like=`%${keyword}%`
  const params=[like,like,like]
  let whereExtra=''
  if (status) { whereExtra += ' AND status=?'; params.push(status) }
  if (productId) {
    whereExtra += ' AND EXISTS (SELECT 1 FROM transfer_order_items toi WHERE toi.order_id = transfer_orders.id AND toi.product_id = ?)'
    params.push(productId)
  }
  if (warehouseId) { whereExtra += ' AND (from_warehouse_id=? OR to_warehouse_id=?)'; params.push(warehouseId, warehouseId) }
  if (operatorId) { whereExtra += ' AND operator_id=?'; params.push(operatorId) }
  if (startDate) { whereExtra += ' AND DATE(created_at)>=?'; params.push(startDate) }
  if (endDate) { whereExtra += ' AND DATE(created_at)<=?'; params.push(endDate) }
  if (remark) { whereExtra += ' AND remark LIKE ?'; params.push(`%${remark}%`) }
  // 调拨天然跨仓：源仓或目标仓任一在 scope 内即可见，否则发货方看不到自己发出的单子
  const scope = transferScopeFilter(scopeWarehouseIds, 'from_warehouse_id', 'to_warehouse_id')
  if (scope.sql) { whereExtra += scope.sql; params.push(...scope.params) }
  const where = `deleted_at IS NULL AND (order_no LIKE ? OR from_warehouse_name LIKE ? OR to_warehouse_name LIKE ?) ${whereExtra}`
  const [rows]=await pool.query(`SELECT * FROM transfer_orders WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,[...params,pageSize,offset])
  const [[{total}]]=await pool.query(`SELECT COUNT(*) AS total FROM transfer_orders WHERE ${where}`,params)
  return { list:rows.map(fmt), pagination:{page,pageSize,total} }
}

async function findById(id, scopeWarehouseIds = null) {
  const [rows]=await pool.query('SELECT * FROM transfer_orders WHERE id=? AND deleted_at IS NULL',[id])
  if(!rows[0]) throw new AppError('调拨单不存在',404)
  assertTransferInScope(scopeWarehouseIds, rows[0].from_warehouse_id, rows[0].to_warehouse_id)
  const order=fmt(rows[0])
  const [items]=await pool.query('SELECT * FROM transfer_order_items WHERE order_id=? ORDER BY id',[id])
  order.items=items.map(r=>({ id:r.id, productId:r.product_id, productCode:r.product_code, productName:r.product_name, unit:r.unit, articleNumber:r.article_number, spec:r.spec, color:r.color, quantity:Number(r.quantity), deductedQty:Number(r.deducted_qty||0), receivedQty:Number(r.received_qty||0), remark:r.remark }))
  return order
}

async function create({ fromWarehouseId, fromWarehouseName, toWarehouseId, toWarehouseName, remark, items, operator }) {
  assertDifferentWarehouses(fromWarehouseId, toWarehouseId)
  const conn=await pool.getConnection()
  try {
    await conn.beginTransaction()
    const orderNo=await genNo(conn)
    const [r]=await conn.query(`INSERT INTO transfer_orders (order_no,from_warehouse_id,from_warehouse_name,to_warehouse_id,to_warehouse_name,remark,operator_id,operator_name) VALUES (?,?,?,?,?,?,?,?)`,[orderNo,fromWarehouseId,fromWarehouseName,toWarehouseId,toWarehouseName,remark||null,operator.userId,operator.realName])
    for(const item of items) await conn.query(`INSERT INTO transfer_order_items (order_id,product_id,product_code,product_name,unit,article_number,spec,color,quantity,remark) VALUES (?,?,?,?,?,?,?,?,?,?)`,[r.insertId,item.productId,item.productCode,item.productName,item.unit,item.articleNumber||null,item.spec||null,item.color||null,item.quantity,item.remark||null])
    await recordTransferEvent(conn, {
      transferOrderId: r.insertId,
      orderNo,
      eventType: TRANSFER_EVENT.CREATED,
      title: '调拨单已创建',
      description: `调出仓 ${fromWarehouseName} -> 调入仓 ${toWarehouseName}`,
      operatorId: operator.userId,
      operatorName: operator.realName,
      requestId: getRequestId(),
      payload: {
        fromWarehouseId,
        toWarehouseId,
        lineCount: items.length,
        totalQty: items.reduce((sum, item) => sum + Number(item.quantity || 0), 0),
      },
    })
    await conn.commit()
    return { id:r.insertId, orderNo }
  } catch(e){ await conn.rollback(); throw e } finally { conn.release() }
}

// operator 由 controller 一并传入但改单这里不写操作人（调拨单没有 updated_by 列，
// 操作留痕走 operation_logs），保留在签名里与 create/confirm 保持一致。
async function update(id, { fromWarehouseId, fromWarehouseName, toWarehouseId, toWarehouseName, remark, items, operator: _operator, scopeWarehouseIds = null }) {
  assertDifferentWarehouses(fromWarehouseId, toWarehouseId)
  const conn=await pool.getConnection()
  try {
    await conn.beginTransaction()
    const row = await lockStatusRow(conn, { table: 'transfer_orders', id, columns: 'id, status, from_warehouse_id, to_warehouse_id', entityName: '调拨单' })
    assertTransferInScope(scopeWarehouseIds, row.from_warehouse_id, row.to_warehouse_id)
    // 改单同样受限：改完之后源仓/目标仓至少有一端仍要在自己的 scope 内
    assertTransferInScope(scopeWarehouseIds, fromWarehouseId, toWarehouseId)
    assertStatusAction('transfer', 'edit', row.status)
    await conn.query(`UPDATE transfer_orders SET from_warehouse_id=?, from_warehouse_name=?, to_warehouse_id=?, to_warehouse_name=?, remark=? WHERE id=?`,[fromWarehouseId,fromWarehouseName,toWarehouseId,toWarehouseName,remark||null,id])
    await conn.query('DELETE FROM transfer_order_items WHERE order_id=?', [id])
    for(const item of items) await conn.query(`INSERT INTO transfer_order_items (order_id,product_id,product_code,product_name,unit,article_number,spec,color,quantity,remark) VALUES (?,?,?,?,?,?,?,?,?,?)`,[id,item.productId,item.productCode,item.productName,item.unit,item.articleNumber||null,item.spec||null,item.color||null,item.quantity,item.remark||null])
    await conn.commit()
  } catch(e){ await conn.rollback(); throw e } finally { conn.release() }
  return findById(id)
}

async function confirm(id, operator = null, scopeWarehouseIds = null) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const orderRow = await lockStatusRow(conn, { table: 'transfer_orders', id, entityName: '调拨单' })
    assertTransferInScope(scopeWarehouseIds, orderRow.from_warehouse_id, orderRow.to_warehouse_id)
    const rule = assertStatusAction('transfer', 'confirm', orderRow.status)
    assertDifferentWarehouses(orderRow.from_warehouse_id, orderRow.to_warehouse_id)
    const [itemRows] = await conn.query('SELECT * FROM transfer_order_items WHERE order_id=? ORDER BY id', [id])
    const o = {
      fromWarehouseId: Number(orderRow.from_warehouse_id),
      items: itemRows.map(r => ({
        productId: r.product_id,
        productName: r.product_name,
        quantity: Number(r.quantity),
      })),
    }
    await assertTransferAvailability(conn, o)
    await compareAndSetStatus(conn, {
      table: 'transfer_orders',
      id,
      fromStatus: rule.from,
      toStatus: rule.to,
      entityName: '调拨单',
    })
    // 确认即派发到 PDA：记录派发元数据，调出仓 PDA 可扫码出库
    await conn.query(
      'UPDATE transfer_orders SET submitted_at = NOW(), submitted_by = ?, submitted_by_name = ? WHERE id = ?',
      [operator?.userId ?? null, operator?.realName ?? null, id],
    )
    await recordTransferEvent(conn, {
      transferOrderId: Number(orderRow.id),
      orderNo: orderRow.order_no,
      eventType: TRANSFER_EVENT.CONFIRMED,
      title: '调拨单已确认并派发',
      description: '已派发到 PDA，等待调出仓扫码出库',
      operatorId: operator?.userId ?? null,
      operatorName: operator?.realName ?? null,
      requestId: getRequestId(),
      payload: {
        fromWarehouseId: Number(orderRow.from_warehouse_id),
        toWarehouseId: Number(orderRow.to_warehouse_id),
        lineCount: itemRows.length,
        totalQty: itemRows.reduce((sum, row) => sum + Number(row.quantity || 0), 0),
      },
    })
    await conn.commit()
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }
}

// 调出仓 PDA 扫码出库：整容器移到调入仓设 PENDING_PUTAWAY（在途，暂不计入调入仓），调出仓库存立即减。
async function scanOut(id, { containerBarcode }, operator, requestKey, scopeWarehouseIds = null) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const requestState = await beginOperationRequest(conn, { requestKey, action: 'transfer.scanOut', userId: operator?.userId ?? null })
    if (requestState.replay) { await conn.rollback(); return requestState.responseData }

    const orderRow = await lockStatusRow(conn, { table: 'transfer_orders', id, entityName: '调拨单' })
    assertTransferInScope(scopeWarehouseIds, orderRow.from_warehouse_id, orderRow.to_warehouse_id)
    assertStatusAction('transfer', 'scanOut', orderRow.status)
    assertDifferentWarehouses(orderRow.from_warehouse_id, orderRow.to_warehouse_id)
    const fromWh = Number(orderRow.from_warehouse_id)
    const toWh = Number(orderRow.to_warehouse_id)

    const [[c]] = await conn.query(
      'SELECT * FROM inventory_containers WHERE barcode = ? AND deleted_at IS NULL FOR UPDATE',
      [String(containerBarcode || '').trim()],
    )
    if (!c) throw new AppError('容器条码不存在', 404)
    if (Number(c.warehouse_id) !== fromWh) throw new AppError('该容器不在本调拨单的调出仓库', 400)
    if (Number(c.status) !== CONTAINER_STATUS.ACTIVE) throw new AppError('该容器不是在库状态，无法调拨出库', 400)
    if (c.locked_by_task_id) throw new AppError('该容器已被其他任务锁定', 409)
    if (c.transfer_order_id) throw new AppError('该容器已在其他调拨在途中', 409)

    const [[item]] = await conn.query(
      'SELECT * FROM transfer_order_items WHERE order_id = ? AND product_id = ? ORDER BY id LIMIT 1 FOR UPDATE',
      [id, c.product_id],
    )
    if (!item) throw new AppError('该商品不在本调拨单明细内', 400)

    const qty = Number(c.remaining_qty)
    // 整容器移动到调入仓，标记在途（PENDING_PUTAWAY 不计入调入仓可用库存）
    await conn.query(
      'UPDATE inventory_containers SET warehouse_id = ?, status = ?, location_id = NULL, transfer_order_id = ? WHERE id = ?',
      [toWh, CONTAINER_STATUS.PENDING_PUTAWAY, id, c.id],
    )
    const fromAfter = await syncStockFromContainers(conn, c.product_id, fromWh)
    const fromBefore = fromAfter + qty

    await conn.query(
      `INSERT INTO inventory_logs
         (move_type, type, product_id, warehouse_id, quantity, before_qty, after_qty,
          ref_type, ref_id, ref_no, container_id, log_source_type, log_source_ref_id, remark, operator_id, operator_name)
       VALUES (?,2,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [MOVE_TYPE.TRANSFER_OUT, c.product_id, fromWh, qty, fromBefore, fromAfter,
       'transfer', id, orderRow.order_no, c.id, SOURCE_TYPE.TRANSFER, id,
       `调拨出 ${orderRow.order_no} 容器#${c.barcode}`, operator?.userId ?? null, operator?.realName ?? null],
    )
    await conn.query('UPDATE transfer_order_items SET deducted_qty = deducted_qty + ? WHERE id = ?', [qty, item.id])

    if (Number(orderRow.status) === 2) {
      await compareAndSetStatus(conn, { table: 'transfer_orders', id, fromStatus: 2, toStatus: 3, entityName: '调拨单' })
    }
    await recordTransferEvent(conn, {
      transferOrderId: id, orderNo: orderRow.order_no, eventType: TRANSFER_EVENT.SCAN_OUT,
      title: '调出仓扫码出库', description: `容器#${c.barcode} ${c.product_name || ''} ×${qty}`,
      operatorId: operator?.userId ?? null, operatorName: operator?.realName ?? null,
      requestId: getRequestId(), payload: { containerId: c.id, barcode: c.barcode, productId: c.product_id, qty },
    })

    const result = { transferId: Number(id), containerBarcode: c.barcode, productId: c.product_id, productName: c.product_name, qty }
    await completeOperationRequest(conn, requestState, { data: result, message: '出库成功', resourceType: 'transfer_order', resourceId: Number(id) })
    await conn.commit()
    return result
  } catch (e) { await conn.rollback(); throw e } finally { conn.release() }
}

// 调入仓 PDA 扫码入库上架：在途容器翻 ACTIVE + 落库位，调入仓库存立即增；全部收齐则完成。
async function scanIn(id, { containerBarcode, locationId }, operator, requestKey, scopeWarehouseIds = null) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const requestState = await beginOperationRequest(conn, { requestKey, action: 'transfer.scanIn', userId: operator?.userId ?? null })
    if (requestState.replay) { await conn.rollback(); return requestState.responseData }

    const orderRow = await lockStatusRow(conn, { table: 'transfer_orders', id, entityName: '调拨单' })
    assertTransferInScope(scopeWarehouseIds, orderRow.from_warehouse_id, orderRow.to_warehouse_id)
    assertStatusAction('transfer', 'scanIn', orderRow.status)
    const toWh = Number(orderRow.to_warehouse_id)

    const [[c]] = await conn.query(
      'SELECT * FROM inventory_containers WHERE barcode = ? AND deleted_at IS NULL FOR UPDATE',
      [String(containerBarcode || '').trim()],
    )
    if (!c) throw new AppError('容器条码不存在', 404)
    if (Number(c.transfer_order_id) !== Number(id) || Number(c.status) !== CONTAINER_STATUS.PENDING_PUTAWAY) {
      throw new AppError('该容器不是本调拨单的在途容器', 400)
    }

    const [[loc]] = await conn.query(
      'SELECT id, warehouse_id, status FROM warehouse_locations WHERE id = ? AND deleted_at IS NULL AND status = 1 FOR UPDATE',
      [locationId],
    )
    if (!loc) throw new AppError('库位不存在或已停用', 404)
    if (Number(loc.warehouse_id) !== toWh) throw new AppError('库位与调入仓库不一致', 400)

    const qty = Number(c.remaining_qty)
    await conn.query(
      'UPDATE inventory_containers SET status = ?, location_id = ?, transfer_order_id = NULL WHERE id = ?',
      [CONTAINER_STATUS.ACTIVE, locationId, c.id],
    )
    const toAfter = await syncStockFromContainers(conn, c.product_id, toWh)
    const toBefore = toAfter - qty

    await conn.query(
      `INSERT INTO inventory_logs
         (move_type, type, product_id, warehouse_id, quantity, before_qty, after_qty,
          ref_type, ref_id, ref_no, container_id, log_source_type, log_source_ref_id, remark, operator_id, operator_name)
       VALUES (?,1,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [MOVE_TYPE.TRANSFER_IN, c.product_id, toWh, qty, toBefore, toAfter,
       'transfer', id, orderRow.order_no, c.id, SOURCE_TYPE.TRANSFER, id,
       `调拨入 ${orderRow.order_no} 容器#${c.barcode}`, operator?.userId ?? null, operator?.realName ?? null],
    )
    const [[item]] = await conn.query(
      'SELECT id FROM transfer_order_items WHERE order_id = ? AND product_id = ? ORDER BY id LIMIT 1',
      [id, c.product_id],
    )
    if (item) await conn.query('UPDATE transfer_order_items SET received_qty = received_qty + ? WHERE id = ?', [qty, item.id])

    await recordTransferEvent(conn, {
      transferOrderId: id, orderNo: orderRow.order_no, eventType: TRANSFER_EVENT.SCAN_IN,
      title: '调入仓扫码入库', description: `容器#${c.barcode} ${c.product_name || ''} ×${qty} → 库位#${loc.id}`,
      operatorId: operator?.userId ?? null, operatorName: operator?.realName ?? null,
      requestId: getRequestId(), payload: { containerId: c.id, barcode: c.barcode, productId: c.product_id, qty, locationId: Number(locationId) },
    })

    // 完成判断：本单已无在途 PENDING 容器
    const [[{ pending }]] = await conn.query(
      'SELECT COUNT(*) AS pending FROM inventory_containers WHERE transfer_order_id = ? AND status = ? AND deleted_at IS NULL',
      [id, CONTAINER_STATUS.PENDING_PUTAWAY],
    )
    let completed = false
    if (Number(pending) === 0) {
      await compareAndSetStatus(conn, { table: 'transfer_orders', id, fromStatus: 3, toStatus: 4, entityName: '调拨单' })
      completed = true
      await recordTransferEvent(conn, {
        transferOrderId: id, orderNo: orderRow.order_no, eventType: TRANSFER_EVENT.COMPLETED,
        title: '调拨单已完成', description: '全部在途容器已入库上架',
        operatorId: operator?.userId ?? null, operatorName: operator?.realName ?? null, requestId: getRequestId(),
      })
    }

    const result = { transferId: Number(id), containerBarcode: c.barcode, productId: c.product_id, productName: c.product_name, qty, completed }
    await completeOperationRequest(conn, requestState, { data: result, message: completed ? '调拨完成' : '入库成功', resourceType: 'transfer_order', resourceId: Number(id) })
    await conn.commit()
    return result
  } catch (e) { await conn.rollback(); throw e } finally { conn.release() }
}

async function cancel(id, operator = null, scopeWarehouseIds = null) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const orderRow = await lockStatusRow(conn, { table: 'transfer_orders', id, columns: 'id, order_no, status, from_warehouse_id, to_warehouse_id', entityName: '调拨单' })
    assertTransferInScope(scopeWarehouseIds, orderRow.from_warehouse_id, orderRow.to_warehouse_id)
    const rule = assertStatusAction('transfer', 'cancel', orderRow.status)
    await compareAndSetStatus(conn, {
      table: 'transfer_orders',
      id,
      fromStatus: rule.from,
      toStatus: rule.to,
      entityName: '调拨单',
    })
    await recordTransferEvent(conn, {
      transferOrderId: Number(orderRow.id),
      orderNo: orderRow.order_no,
      eventType: TRANSFER_EVENT.CANCELLED,
      title: '调拨单已取消',
      description: '调拨单已取消，未执行库存移动',
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
 * 在途异常了结（运输丢失/无法找到等）：状态机层面「在途(3)」明确禁止 cancel，注释称
 * "请通过盘点处理差异"，但盘点只统计 ACTIVE 容器，在途容器是 PENDING_PUTAWAY 且绑定
 * transfer_order_id，源仓/目的仓的盘点都覆盖不到——货物一旦运输途中出问题，调拨单和容器
 * 会永久卡在"在途"，没有任何配套的收尾路径。
 *
 * 这里补一个范围很小、需要管理员权限的应急收尾动作：把该调拨单下仍在途的容器作废(VOID)，
 * 调拨单本身复用状态4「已完成」（未新增状态码，避免牵动状态机定义/前端展示/报表等大范围
 * 改动），但在事件记录里明确标注"异常了结"及必填原因，与正常 scanIn 完成的语义区分开、留痕
 * 可查。作废的数量不做任何库存增补——scanOut 时已从源仓扣减，货物按实际运输损耗处理，不会
 * 凭空回到源仓也不会凭空出现在目的仓。
 */
async function forceCloseInTransit(id, operator, { reason } = {}, scopeWarehouseIds = null) {
  if (!reason || !String(reason).trim()) {
    throw new AppError('必须填写异常了结原因', 400)
  }
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const orderRow = await lockStatusRow(conn, { table: 'transfer_orders', id, columns: 'id, order_no, status, from_warehouse_id, to_warehouse_id', entityName: '调拨单' })
    assertTransferInScope(scopeWarehouseIds, orderRow.from_warehouse_id, orderRow.to_warehouse_id)
    if (Number(orderRow.status) !== 3) {
      throw new AppError('只有"在途"状态的调拨单才能异常了结', 409)
    }
    const [containers] = await conn.query(
      'SELECT id, barcode, product_id, product_name, remaining_qty FROM inventory_containers WHERE transfer_order_id=? AND status=? AND deleted_at IS NULL FOR UPDATE',
      [id, CONTAINER_STATUS.PENDING_PUTAWAY],
    )
    if (!containers.length) {
      throw new AppError('该调拨单已无在途容器，无需异常了结', 409)
    }
    await conn.query(
      'UPDATE inventory_containers SET status = ?, transfer_order_id = NULL WHERE transfer_order_id = ? AND status = ?',
      [CONTAINER_STATUS.VOID, id, CONTAINER_STATUS.PENDING_PUTAWAY],
    )
    await compareAndSetStatus(conn, {
      table: 'transfer_orders', id, fromStatus: 3, toStatus: 4, entityName: '调拨单',
      extraSet: { closed_reason: 'force_close' },
    })
    await recordTransferEvent(conn, {
      transferOrderId: Number(id),
      orderNo: orderRow.order_no,
      eventType: TRANSFER_EVENT.COMPLETED,
      title: '调拨单异常了结（运输损耗核销）',
      description: `原因：${reason}；核销在途容器 ${containers.length} 个：${containers.map(c => `${c.barcode}×${c.remaining_qty}`).join('、')}`,
      operatorId: operator?.userId ?? null,
      operatorName: operator?.realName ?? null,
      requestId: getRequestId(),
      payload: {
        reason,
        voidedContainers: containers.map(c => ({ id: c.id, barcode: c.barcode, productId: c.product_id, qty: Number(c.remaining_qty) })),
      },
    })
    await conn.commit()
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }
}

module.exports = { findAll, findById, create, update, confirm, scanOut, scanIn, cancel, forceCloseInTransit }
