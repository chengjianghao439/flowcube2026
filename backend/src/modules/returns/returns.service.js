const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const { MOVE_TYPE } = require('../../engine/inventoryEngine')
const { adjustContainerStock, SOURCE_TYPE } = require('../../engine/containerEngine')
const { generateDailyCode } = require('../../utils/codeGenerator')
const { lockStatusRow, compareAndSetStatus } = require('../../utils/statusTransition')
const { assertStatusAction } = require('../../constants/documentStatusRules')
const { RETURN_EVENT, record: recordReturnEvent } = require('./return-events.service')
const { PAYMENT_EVENT, record: recordPaymentEvent } = require('../payments/payment-events.service')
const { getRequestId } = require('../../utils/requestContext')

// ─── 采购退货 ────────────────────────────────────────────────
const PR_STATUS = { 1:'草稿', 2:'已确认', 3:'已退货', 4:'已取消' }
const SR_STATUS = { 1:'草稿', 2:'已确认', 3:'已退货入库', 4:'已取消' }

const fmtPR = r => ({ id:r.id, returnNo:r.return_no, supplierId:r.supplier_id, supplierName:r.supplier_name, warehouseId:r.warehouse_id, warehouseName:r.warehouse_name, purchaseOrderId:r.purchase_order_id||null, purchaseOrderNo:r.purchase_order_no, status:r.status, statusName:PR_STATUS[r.status], totalAmount:Number(r.total_amount), remark:r.remark, operatorId:r.operator_id, operatorName:r.operator_name, createdAt:r.created_at })
const fmtSR = r => ({ id:r.id, returnNo:r.return_no, customerId:r.customer_id, customerName:r.customer_name, warehouseId:r.warehouse_id, warehouseName:r.warehouse_name, saleOrderId:r.sale_order_id||null, saleOrderNo:r.sale_order_no, status:r.status, statusName:SR_STATUS[r.status], totalAmount:Number(r.total_amount), remark:r.remark, operatorId:r.operator_id, operatorName:r.operator_name, createdAt:r.created_at })

const genNo = (conn, prefix, table, col) => generateDailyCode(conn, prefix, table, col)

function calcPaymentStatus(totalAmount, paidAmount) {
  const total = Number(totalAmount || 0)
  const paid = Number(paidAmount || 0)
  const balance = Number((total - paid).toFixed(4))
  if (balance <= 0) return { balance, status: 3 }
  if (paid > 0) return { balance, status: 2 }
  return { balance, status: 1 }
}

async function adjustPaymentRecordForReturn(conn, {
  recordType,
  orderId = null,
  orderNo = null,
  returnNo,
  returnType,
  amount,
  operator,
}) {
  const params = [recordType]
  let where = 'type=?'
  if (orderId) {
    where += ' AND order_id=?'
    params.push(orderId)
  } else if (orderNo) {
    where += ' AND order_no=?'
    params.push(orderNo)
  } else {
    return null
  }

  const [[record]] = await conn.query(
    `SELECT * FROM payment_records WHERE ${where} ORDER BY id DESC LIMIT 1 FOR UPDATE`,
    params,
  )
  if (!record) return null

  const currentTotal = Number(record.total_amount || 0)
  const currentPaid = Number(record.paid_amount || 0)
  const newTotal = Number((currentTotal - Number(amount || 0)).toFixed(4))
  if (newTotal < 0) {
    throw new AppError(`退货金额超出原账款总额，无法回冲`, 409)
  }
  if (currentPaid > newTotal) {
    throw new AppError(
      `当前账款已登记金额 ¥${currentPaid.toFixed(2)}，退货后将形成负余额；请先处理退款/退款凭证后再执行退货`,
      409,
    )
  }

  const { balance, status } = calcPaymentStatus(newTotal, currentPaid)
  await conn.query(
    'UPDATE payment_records SET total_amount=?, balance=?, status=? WHERE id=?',
    [newTotal, balance, status, record.id],
  )
  await recordPaymentEvent(conn, {
    paymentRecordId: Number(record.id),
    orderNo: record.order_no,
    eventType: PAYMENT_EVENT.ADJUSTED_BY_RETURN,
    title: '退货冲减账款',
    description: `${returnType === 'purchase' ? '采购退货' : '销售退货'} ${returnNo} 已冲减账款`,
    operatorId: operator.userId,
    operatorName: operator.realName,
    requestId: getRequestId(),
    payload: {
      returnType,
      returnNo,
      adjustAmount: Number(amount || 0),
      oldTotalAmount: currentTotal,
      newTotalAmount: newTotal,
      paidAmount: currentPaid,
      newBalance: balance,
      status,
    },
  })
  return { id: Number(record.id), newTotal, newBalance: balance, status }
}

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
      const quantity = Number(row.quantity || 0)
      const returnedQty = Number(row.returned_qty || 0)
      return {
        sourceItemId: Number(row.id),
        productId: Number(row.product_id),
        productCode: row.product_code,
        productName: row.product_name,
        unit: row.unit,
        quantity,
        returnedQty,
        remainingQty: Number(Math.max(0, quantity - returnedQty).toFixed(4)),
        unitPrice: Number(row.unit_price || 0),
        amount: Number(row.amount || 0),
      }
    }),
  }
}

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
      const quantity = Number(row.quantity || 0)
      const returnedQty = Number(row.returned_qty || 0)
      return {
        sourceItemId: Number(row.id),
        productId: Number(row.product_id),
        productCode: row.product_code,
        productName: row.product_name,
        unit: row.unit,
        quantity,
        returnedQty,
        remainingQty: Number(Math.max(0, quantity - returnedQty).toFixed(4)),
        unitPrice: Number(row.unit_price || 0),
        amount: Number(row.amount || 0),
      }
    }),
  }
}

async function validatePurchaseReturnItems(conn, purchaseOrderId, items) {
  if (!purchaseOrderId) return
  const [rows] = await conn.query(
    `SELECT poi.id, poi.product_id, poi.quantity,
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
    requestedQtyBySource.set(
      Number(item.sourceItemId),
      Number((requestedQtyBySource.get(Number(item.sourceItemId)) || 0) + Number(item.quantity || 0)),
    )
    const remainingQty = Number(source.quantity || 0) - Number(source.returned_qty || 0)
    if (Number(requestedQtyBySource.get(Number(item.sourceItemId)).toFixed(4)) > Number(remainingQty.toFixed(4))) {
      throw new AppError(`商品 ${item.productName} 退货数量超出原采购剩余可退数量`, 409)
    }
  }
}

async function validateSaleReturnItems(conn, saleOrderId, items) {
  if (!saleOrderId) return
  const [rows] = await conn.query(
    `SELECT soi.id, soi.product_id, soi.quantity,
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
    requestedQtyBySource.set(
      Number(item.sourceItemId),
      Number((requestedQtyBySource.get(Number(item.sourceItemId)) || 0) + Number(item.quantity || 0)),
    )
    const remainingQty = Number(source.quantity || 0) - Number(source.returned_qty || 0)
    if (Number(requestedQtyBySource.get(Number(item.sourceItemId)).toFixed(4)) > Number(remainingQty.toFixed(4))) {
      throw new AppError(`商品 ${item.productName} 退货数量超出原销售剩余可退数量`, 409)
    }
  }
}

// 采购退货
async function findAllPR({ page=1, pageSize=20, keyword='', status=null }) {
  const offset=(page-1)*pageSize, like=`%${keyword}%`
  const cond=status?'AND status=?':''
  const [rows]=await pool.query(`SELECT * FROM purchase_returns WHERE deleted_at IS NULL AND (return_no LIKE ? OR supplier_name LIKE ?) ${cond} ORDER BY created_at DESC LIMIT ? OFFSET ?`,status?[like,like,status,pageSize,offset]:[like,like,pageSize,offset])
  const [[{total}]]=await pool.query(`SELECT COUNT(*) AS total FROM purchase_returns WHERE deleted_at IS NULL AND (return_no LIKE ? OR supplier_name LIKE ?) ${cond}`,status?[like,like,status]:[like,like])
  return { list:rows.map(fmtPR), pagination:{page,pageSize,total} }
}
async function findByIdPR(id) {
  const [rows]=await pool.query('SELECT * FROM purchase_returns WHERE id=? AND deleted_at IS NULL',[id])
  if(!rows[0]) throw new AppError('退货单不存在',404)
  const ret=fmtPR(rows[0])
  const [items]=await pool.query('SELECT * FROM purchase_return_items WHERE return_id=?',[id])
  ret.items=items.map(r=>({id:r.id,sourceItemId:r.purchase_item_id||null,productId:r.product_id,productCode:r.product_code,productName:r.product_name,unit:r.unit,quantity:Number(r.quantity),unitPrice:Number(r.unit_price),amount:Number(r.amount)}))
  return ret
}
async function createPR({ supplierId, supplierName, warehouseId, warehouseName, purchaseOrderId = null, purchaseOrderNo, remark, items, operator }) {
  const conn=await pool.getConnection()
  try {
    await conn.beginTransaction()
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
    for(const item of items) await conn.query(`INSERT INTO purchase_return_items (return_id,purchase_item_id,product_id,product_code,product_name,unit,quantity,unit_price,amount) VALUES (?,?,?,?,?,?,?,?,?)`,[r.insertId,item.sourceItemId||null,item.productId,item.productCode,item.productName,item.unit,item.quantity,item.unitPrice,item.quantity*item.unitPrice])
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
    await conn.commit(); return { id:r.insertId, returnNo }
  } catch(e){ await conn.rollback(); throw e } finally { conn.release() }
}
async function confirmPR(id, operator = null) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const retRow = await lockStatusRow(conn, {
      table: 'purchase_returns',
      id,
      columns: 'id, return_no, status',
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
    await recordReturnEvent(conn, {
      returnType: 'purchase',
      returnId: Number(retRow.id),
      returnNo: retRow.return_no,
      eventType: RETURN_EVENT.CONFIRMED,
      title: '采购退货单已确认',
      description: '采购退货单确认完成，等待执行',
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
async function executePR(id, operator) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const retRow = await lockStatusRow(conn, {
      table: 'purchase_returns',
      id,
      columns: 'id, return_no, purchase_order_id, purchase_order_no, supplier_id, warehouse_id, status',
      entityName: '采购退货单',
    })
    const rule = assertStatusAction('purchaseReturn', 'execute', retRow.status)
    const [itemRows] = await conn.query('SELECT * FROM purchase_return_items WHERE return_id=? ORDER BY id', [id])
    const ret = {
      id: Number(retRow.id),
      returnNo: retRow.return_no,
      purchaseOrderId: retRow.purchase_order_id ? Number(retRow.purchase_order_id) : null,
      purchaseOrderNo: retRow.purchase_order_no || null,
      supplierId: Number(retRow.supplier_id),
      warehouseId: Number(retRow.warehouse_id),
      items: itemRows.map(r => ({
        productId: r.product_id,
        productName: r.product_name,
        unit: r.unit,
        quantity: Number(r.quantity),
        unitPrice: Number(r.unit_price),
      })),
    }
    for (const item of ret.items) {
      // 采购退货出库：从仓库扣减容器（FIFO）→ 同步缓存
      const { before, after, primaryDeductContainerId } = await adjustContainerStock(conn, {
        productId:    item.productId,
        productName:  item.productName,
        warehouseId:  ret.warehouseId,
        qty:          -item.quantity,   // 出库方向
        unit:         item.unit,
        sourceType:   SOURCE_TYPE.RETURN,
        sourceRefId:  ret.id,
        sourceRefType: 'purchase_return',
        sourceRefNo:  ret.returnNo,
        remark:       `采购退货出库 ${ret.returnNo}`,
      })
      await conn.query(
        `INSERT INTO inventory_logs
           (move_type, type, product_id, warehouse_id, supplier_id,
            quantity, before_qty, after_qty, unit_price,
            ref_type, ref_id, ref_no, container_id, log_source_type, log_source_ref_id,
            remark, operator_id, operator_name)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [MOVE_TYPE.PURCHASE_RET, 2, item.productId, ret.warehouseId, ret.supplierId,
         item.quantity, before, after, item.unitPrice,
         'purchase_return', ret.id, ret.returnNo,
         primaryDeductContainerId, SOURCE_TYPE.RETURN, ret.id,
         `采购退货出库 ${ret.returnNo}`, operator.userId, operator.realName]
      )
    }
    const totalAmount = ret.items.reduce((sum, item) => sum + Number(item.quantity || 0) * Number(item.unitPrice || 0), 0)
    await adjustPaymentRecordForReturn(conn, {
      recordType: 1,
      orderId: ret.purchaseOrderId,
      orderNo: ret.purchaseOrderNo,
      returnNo: ret.returnNo,
      returnType: 'purchase',
      amount: totalAmount,
      operator,
    })
    await compareAndSetStatus(conn, {
      table: 'purchase_returns',
      id,
      fromStatus: rule.from,
      toStatus: rule.to,
      entityName: '采购退货单',
    })
    await recordReturnEvent(conn, {
      returnType: 'purchase',
      returnId: ret.id,
      returnNo: ret.returnNo,
      eventType: RETURN_EVENT.EXECUTED,
      title: '采购退货单已执行',
      description: '采购退货库存扣减已完成',
      operatorId: operator.userId,
      operatorName: operator.realName,
      requestId: getRequestId(),
      payload: {
        warehouseId: ret.warehouseId,
        totalAmount,
        totalQty: ret.items.reduce((sum, item) => sum + Number(item.quantity || 0), 0),
        inventoryDirection: 'out',
      },
    })
    await conn.commit()
  } catch (e) { await conn.rollback(); throw e }
  finally { conn.release() }
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
    await recordReturnEvent(conn, {
      returnType: 'purchase',
      returnId: Number(retRow.id),
      returnNo: retRow.return_no,
      eventType: RETURN_EVENT.CANCELLED,
      title: '采购退货单已取消',
      description: '采购退货单已取消，未执行库存扣减',
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

// 销售退货
async function findAllSR({ page=1, pageSize=20, keyword='', status=null }) {
  const offset=(page-1)*pageSize, like=`%${keyword}%`
  const cond=status?'AND status=?':''
  const [rows]=await pool.query(`SELECT * FROM sale_returns WHERE deleted_at IS NULL AND (return_no LIKE ? OR customer_name LIKE ?) ${cond} ORDER BY created_at DESC LIMIT ? OFFSET ?`,status?[like,like,status,pageSize,offset]:[like,like,pageSize,offset])
  const [[{total}]]=await pool.query(`SELECT COUNT(*) AS total FROM sale_returns WHERE deleted_at IS NULL AND (return_no LIKE ? OR customer_name LIKE ?) ${cond}`,status?[like,like,status]:[like,like])
  return { list:rows.map(fmtSR), pagination:{page,pageSize,total} }
}
async function findByIdSR(id) {
  const [rows]=await pool.query('SELECT * FROM sale_returns WHERE id=? AND deleted_at IS NULL',[id])
  if(!rows[0]) throw new AppError('退货单不存在',404)
  const ret=fmtSR(rows[0])
  const [items]=await pool.query('SELECT * FROM sale_return_items WHERE return_id=?',[id])
  ret.items=items.map(r=>({id:r.id,sourceItemId:r.sale_item_id||null,productId:r.product_id,productCode:r.product_code,productName:r.product_name,unit:r.unit,quantity:Number(r.quantity),unitPrice:Number(r.unit_price),amount:Number(r.amount)}))
  return ret
}
async function createSR({ customerId, customerName, warehouseId, warehouseName, saleOrderId = null, saleOrderNo, remark, items, operator }) {
  const conn=await pool.getConnection()
  try {
    await conn.beginTransaction()
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
    await validateSaleReturnItems(conn, resolvedSaleOrderId, items)
    const returnNo=await genNo(conn,'SR','sale_returns','return_no')
    const total=items.reduce((s,i)=>s+i.quantity*i.unitPrice,0)
    const [r]=await conn.query(`INSERT INTO sale_returns (return_no,customer_id,customer_name,warehouse_id,warehouse_name,sale_order_id,sale_order_no,total_amount,remark,operator_id,operator_name) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,[returnNo,customerId,customerName,warehouseId,warehouseName,resolvedSaleOrderId,saleOrderNo||null,total,remark||null,operator.userId,operator.realName])
    for(const item of items) await conn.query(`INSERT INTO sale_return_items (return_id,sale_item_id,product_id,product_code,product_name,unit,quantity,unit_price,amount) VALUES (?,?,?,?,?,?,?,?,?)`,[r.insertId,item.sourceItemId||null,item.productId,item.productCode,item.productName,item.unit,item.quantity,item.unitPrice,item.quantity*item.unitPrice])
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
    await conn.commit(); return { id:r.insertId, returnNo }
  } catch(e){ await conn.rollback(); throw e } finally { conn.release() }
}
async function confirmSR(id, operator = null) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const retRow = await lockStatusRow(conn, {
      table: 'sale_returns',
      id,
      columns: 'id, return_no, status',
      entityName: '销售退货单',
    })
    const rule = assertStatusAction('saleReturn', 'confirm', retRow.status)
    await compareAndSetStatus(conn, {
      table: 'sale_returns',
      id,
      fromStatus: rule.from,
      toStatus: rule.to,
      entityName: '销售退货单',
    })
    await recordReturnEvent(conn, {
      returnType: 'sale',
      returnId: Number(retRow.id),
      returnNo: retRow.return_no,
      eventType: RETURN_EVENT.CONFIRMED,
      title: '销售退货单已确认',
      description: '销售退货单确认完成，等待执行',
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
async function executeSR(id, operator) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const retRow = await lockStatusRow(conn, {
      table: 'sale_returns',
      id,
      columns: 'id, return_no, sale_order_id, sale_order_no, warehouse_id, status',
      entityName: '销售退货单',
    })
    const rule = assertStatusAction('saleReturn', 'execute', retRow.status)
    const [itemRows] = await conn.query('SELECT * FROM sale_return_items WHERE return_id=? ORDER BY id', [id])
    const ret = {
      id: Number(retRow.id),
      returnNo: retRow.return_no,
      saleOrderId: retRow.sale_order_id ? Number(retRow.sale_order_id) : null,
      saleOrderNo: retRow.sale_order_no || null,
      warehouseId: Number(retRow.warehouse_id),
      items: itemRows.map(r => ({
        productId: r.product_id,
        productName: r.product_name,
        unit: r.unit,
        quantity: Number(r.quantity),
        unitPrice: Number(r.unit_price),
      })),
    }
    for (const item of ret.items) {
      // 销售退货入库：客户退回商品，创建新容器→ 同步缓存
      const { before, after, createdContainerId } = await adjustContainerStock(conn, {
        productId:    item.productId,
        productName:  item.productName,
        warehouseId:  ret.warehouseId,
        qty:          +item.quantity,   // 入库方向
        unit:         item.unit,
        sourceType:   SOURCE_TYPE.RETURN,
        sourceRefId:  ret.id,
        sourceRefType: 'sale_return',
        sourceRefNo:  ret.returnNo,
        remark:       `销售退货入库 ${ret.returnNo}`,
      })
      await conn.query(
        `INSERT INTO inventory_logs
           (move_type, type, product_id, warehouse_id,
            quantity, before_qty, after_qty, unit_price,
            ref_type, ref_id, ref_no, container_id, log_source_type, log_source_ref_id,
            remark, operator_id, operator_name)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [MOVE_TYPE.SALE_RET, 1, item.productId, ret.warehouseId,
         item.quantity, before, after, item.unitPrice,
         'sale_return', ret.id, ret.returnNo,
         createdContainerId, SOURCE_TYPE.RETURN, ret.id,
         `销售退货入库 ${ret.returnNo}`, operator.userId, operator.realName]
      )
    }
    const totalAmount = ret.items.reduce((sum, item) => sum + Number(item.quantity || 0) * Number(item.unitPrice || 0), 0)
    await adjustPaymentRecordForReturn(conn, {
      recordType: 2,
      orderId: ret.saleOrderId,
      orderNo: ret.saleOrderNo,
      returnNo: ret.returnNo,
      returnType: 'sale',
      amount: totalAmount,
      operator,
    })
    await compareAndSetStatus(conn, {
      table: 'sale_returns',
      id,
      fromStatus: rule.from,
      toStatus: rule.to,
      entityName: '销售退货单',
    })
    await recordReturnEvent(conn, {
      returnType: 'sale',
      returnId: ret.id,
      returnNo: ret.returnNo,
      eventType: RETURN_EVENT.EXECUTED,
      title: '销售退货单已执行',
      description: '销售退货入库已完成',
      operatorId: operator.userId,
      operatorName: operator.realName,
      requestId: getRequestId(),
      payload: {
        warehouseId: ret.warehouseId,
        totalAmount,
        totalQty: ret.items.reduce((sum, item) => sum + Number(item.quantity || 0), 0),
        inventoryDirection: 'in',
      },
    })
    await conn.commit()
  } catch (e) { await conn.rollback(); throw e }
  finally { conn.release() }
}
async function cancelSR(id, operator = null) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const retRow = await lockStatusRow(conn, {
      table: 'sale_returns',
      id,
      columns: 'id, return_no, status',
      entityName: '销售退货单',
    })
    const rule = assertStatusAction('saleReturn', 'cancel', retRow.status)
    await compareAndSetStatus(conn, {
      table: 'sale_returns',
      id,
      fromStatus: rule.from,
      toStatus: rule.to,
      entityName: '销售退货单',
    })
    await recordReturnEvent(conn, {
      returnType: 'sale',
      returnId: Number(retRow.id),
      returnNo: retRow.return_no,
      eventType: RETURN_EVENT.CANCELLED,
      title: '销售退货单已取消',
      description: '销售退货单已取消，未执行退货入库',
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

module.exports = {
  findAllPR,
  findByIdPR,
  createPR,
  confirmPR,
  executePR,
  cancelPR,
  findAllSR,
  findByIdSR,
  createSR,
  confirmSR,
  executeSR,
  cancelSR,
  loadPurchaseSourceOrderByNo,
  loadSaleSourceOrderByNo,
}
