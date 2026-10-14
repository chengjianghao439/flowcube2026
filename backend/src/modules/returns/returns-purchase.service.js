const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const { lockStatusRow, compareAndSetStatus } = require('../../utils/statusTransition')
const { assertStatusAction } = require('../../constants/documentStatusRules')
const { RETURN_EVENT, record: recordReturnEvent } = require('./return-events.service')
const { WT_STATUS_NAME, WT_STATUS_ACTIVE } = require('../../constants/warehouseTaskStatus')
const { getRequestId } = require('../../utils/requestContext')
const { beginCreationOperationRequest, completeOperationRequest } = require('../../utils/operationRequest')
const { genNo, adjustPaymentRecordForReturn, assertReturnPaymentHeadroom } = require('./returns.helpers')
const { scopeFilter, assertInScope } = require('../../utils/warehouseScope')
const { foldEntryItems } = require('../../utils/unitConversion')  // 多单位折算（文档03 Phase4a，退货按箱）
const { normalizePagination } = require('../../utils/pagination')
const { assertNoPendingRefund } = require('../refunds/supplier-refunds.pr-gate')
const { peekPurchaseReturn, lockPurchaseReturn, provePurchaseReturnCash } = require('./returns.purchase-lock')
const purchaseCash = require('../purchase/purchase.cash-money')
const cash = require('../../utils/cashMoney')

// 状态名唯一口径 = documentStatusRules.purchaseReturn / 迁移 146 的列注释 / 前端筛选项（都是「已执行」）。
// 旧名「已退货」「已退货入库」是更早的叫法，曾导致同一页面筛选写「已执行」、表格写「已退货」（2026-09-18 审计 [30]）。
const PR_STATUS = { 1:'草稿', 2:'已确认', 3:'已执行', 4:'已取消' }

const fmtPR = r => ({ id:r.id, returnNo:r.return_no, supplierId:r.supplier_id, supplierName:r.supplier_name, warehouseId:r.warehouse_id, warehouseName:r.warehouse_name, purchaseOrderId:r.purchase_order_id||null, purchaseOrderNo:r.purchase_order_no, status:r.status, statusName:PR_STATUS[r.status], totalAmount:Number(r.total_amount), remark:r.remark, operatorId:r.operator_id, operatorName:r.operator_name, createdAt:r.created_at })

async function loadPurchaseSourceOrderByNo(orderNo, scopeWarehouseIds = null) {
  const [rows] = await pool.query(
    'SELECT * FROM purchase_orders WHERE order_no=? AND deleted_at IS NULL LIMIT 1',
    [orderNo],
  )
  if (!rows[0]) throw new AppError('关联采购单不存在', 404)
  // 按单号直查来源单会返回完整明细与单价金额，必须与按 ID 查详情同口径做仓库范围校验
  // （2026-09-18 审计 P2：此前限仓用户可用别仓单号读出完整单据）
  assertInScope(scopeWarehouseIds, rows[0].warehouse_id, '采购单')
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
        remainingQty: Number(Math.max(0, receivedQty - returnedQty).toFixed(2)),
        unitPrice: Number(row.unit_price || 0),
        amount: Number(row.amount || 0),
      }
    }),
  }
}

async function validatePurchaseReturnItems(conn, purchaseOrderId, items, expectedUnit = null) {
  if (!purchaseOrderId) return
  // 锁住该采购单下的明细行：不加锁时，并发创建多张退货单会各自读到同一份"还有余量"的
  // 过期快照，都校验通过，合计超出实际已收货量退货（金额/库存双重超退）。
  await conn.query('SELECT id FROM purchase_order_items WHERE order_id = ? FOR UPDATE', [purchaseOrderId])
  const [rows] = await conn.query(
    `SELECT poi.id, poi.order_id, poi.product_id, poi.quantity, poi.unit_price, poi.unit, poi.amount,
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
    if (expectedUnit !== null && source.unit !== expectedUnit) throw new AppError('原采购明细基本单位与处理来源不一致', 409, 'DISPOSAL_HANDLING_UNIT_CHANGED')
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
    if (Number(requestedQtyBySource.get(Number(item.sourceItemId)).toFixed(2)) > Number(remainingQty.toFixed(2))) {
      throw new AppError(`商品 ${item.productName} 退货数量超出实际收货数量`, 409)
    }
  }
  return rows
}

async function findAllPR({ page=1, pageSize=20, keyword='', status=null, productId=null, supplierId=null, warehouseId=null, operatorId=null, startDate=null, endDate=null, remark=null, scopeWarehouseIds=null }) {
  const { pageSize: ps, offset } = normalizePagination({ page, pageSize }), like=`%${keyword}%`
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
  if (startDate) { whereExtra += ' AND created_at>=?'; params.push(`${startDate} 00:00:00`) }
  if (endDate) { whereExtra += ' AND created_at<DATE_ADD(?, INTERVAL 1 DAY)'; params.push(endDate) }
  if (remark) { whereExtra += ' AND remark LIKE ?'; params.push(`%${remark}%`) }
  const scope = scopeFilter(scopeWarehouseIds, 'warehouse_id')
  if (scope.sql) { whereExtra += scope.sql; params.push(...scope.params) }
  const where = `deleted_at IS NULL AND (return_no LIKE ? OR supplier_name LIKE ?) ${whereExtra}`
  const [rows]=await pool.query(`SELECT * FROM purchase_returns WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,[...params,ps,offset])
  const [[{total}]]=await pool.query(`SELECT COUNT(*) AS total FROM purchase_returns WHERE ${where}`,params)
  return { list:rows.map(fmtPR), pagination:{page,pageSize:ps,total} }
}

async function findByIdPR(id, scopeWarehouseIds = null) {
  const [rows]=await pool.query('SELECT * FROM purchase_returns WHERE id=? AND deleted_at IS NULL',[id])
  if(!rows[0]) throw new AppError('退货单不存在',404)
  assertInScope(scopeWarehouseIds, rows[0].warehouse_id, '采购退货单')
  const ret=fmtPR(rows[0])
  const [items]=await pool.query('SELECT * FROM purchase_return_items WHERE return_id=?',[id])
  ret.items=items.map(r=>({id:r.id,sourceItemId:r.purchase_item_id||null,productId:r.product_id,productCode:r.product_code,productName:r.product_name,articleNumber:r.article_number||null,spec:r.spec||null,color:r.color||null,unit:r.unit,entryUnit:r.entry_unit||r.unit,quantity:Number(r.quantity),entryQty:r.entry_qty!=null?Number(r.entry_qty):Number(r.quantity),conversionRate:Number(r.conversion_rate),unitPrice:Number(r.unit_price),amount:Number(r.amount)}))
  const [[task]]=await pool.query(
    "SELECT id, task_no, status FROM warehouse_tasks WHERE return_id=? AND task_type='purchase_return' AND deleted_at IS NULL ORDER BY id DESC LIMIT 1",
    [id],
  )
  ret.task = task ? { id: Number(task.id), taskNo: task.task_no, status: Number(task.status), statusName: WT_STATUS_NAME[Number(task.status)] || '未知' } : null
  return ret
}

async function createPR({ supplierId, supplierName, warehouseId, warehouseName, purchaseOrderId = null, purchaseOrderNo, remark, items, operator, requestKey, scopeWarehouseIds = null, disposalSource, disposalSourceAuthorized = false }) {
  assertInScope(scopeWarehouseIds, warehouseId, '采购退货单')
  const conn=await pool.getConnection()
  try {
    await conn.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED')
    await conn.beginTransaction()
    const creationPayload = { supplierId, supplierName, warehouseId, warehouseName, purchaseOrderId, purchaseOrderNo, remark, items,
      ...(disposalSource !== undefined ? { disposalSource } : {}) }
    const handling = disposalSource !== undefined ? require('../disposal/disposal.handling.targets') : null
    const handlingContext = handling ? await handling.prepare(conn, { reference: disposalSource, type: 'purchase_return', authorized: disposalSourceAuthorized, payload: creationPayload, requestKey, operator, scopeWarehouseIds }) : null
    if (handlingContext?.response) { await conn.rollback(); return handlingContext.response }
    const requestState = await beginCreationOperationRequest(conn, {
      requestKey,
      action: 'purchaseReturn.create',
      userId: operator?.userId ?? null,
      payload: creationPayload,
    })
    if (requestState.replay) {
      if (handling) throw new AppError('原通用结果缺少永久来源关联，请人工核对', 409, 'DISPOSAL_HANDLING_RECEIPT_INVALID')
      await conn.rollback()
      return requestState.responseData
    }
    let resolvedPurchaseOrderId = purchaseOrderId || null
    let sourceOrder = null
    if (!resolvedPurchaseOrderId && purchaseOrderNo) {
      const [[row]] = await conn.query('SELECT id, order_no, supplier_id, warehouse_id, total_amount, cash_basis FROM purchase_orders WHERE order_no=? AND deleted_at IS NULL FOR UPDATE', [purchaseOrderNo])
      if (!row) throw new AppError('关联采购单不存在', 404)
      sourceOrder = row
      resolvedPurchaseOrderId = Number(row.id)
    } else if (resolvedPurchaseOrderId) {
      const [rows] = await conn.query(
        'SELECT id, order_no, supplier_id, warehouse_id, total_amount, cash_basis FROM purchase_orders WHERE id=? AND deleted_at IS NULL FOR UPDATE',
        [resolvedPurchaseOrderId],
      )
      if (!rows[0]) throw new AppError('关联采购单不存在', 404)
      sourceOrder = rows[0]
    }
    if (sourceOrder) {
      assertInScope(scopeWarehouseIds, sourceOrder.warehouse_id, '原采购单')
      if (purchaseOrderNo && purchaseOrderNo !== sourceOrder.order_no) throw new AppError('原采购单号与来源不一致', 409, 'PURCHASE_RETURN_SOURCE_INVALID')
      if (Number(sourceOrder.supplier_id) !== Number(supplierId)) {
        throw new AppError('采购退货供应商必须与原采购单一致', 400)
      }
      if (Number(sourceOrder.warehouse_id) !== Number(warehouseId)) {
        throw new AppError('采购退货仓库必须与原采购单一致', 400)
      }
    }
    // 多单位折算（文档03 Phase4a）：入参 quantity/unitPrice 恒为录入单位口径，折算成基本单位后
    // 再校验/落库。有源退货只允许编辑原行本次基本量，单位/原价只读；
    // validatePurchaseReturnItems 用 folded（quantity 已是基本单位）比对剩余可退量、并强制覆盖 unitPrice 为源单价。
    const folded = await foldEntryItems(conn, items)
    if (!resolvedPurchaseOrderId && folded.some(item => item.sourceItemId != null)) throw new AppError('来源明细缺少准确原采购单，请先核对', 409, 'PURCHASE_RETURN_SOURCE_INVALID')
    if (handling && (!resolvedPurchaseOrderId || folded.length !== 1 || !folded[0].sourceItemId)) throw new AppError('关联退货须绑定准确原采购单及明细', 409, 'PURCHASE_RETURN_SOURCE_INVALID')
    const sourceItems = await validatePurchaseReturnItems(conn, resolvedPurchaseOrderId, folded, handlingContext?.source.unit ?? null)
    if (handling) await handling.validateItems(conn, handlingContext, folded, warehouseId)
    const returnNo=await genNo(conn,'PR','purchase_returns','return_no')
    let quote = null
    let cashBasis = null
    if (sourceOrder) {
      cashBasis = sourceOrder.cash_basis || purchaseCash.legacyBasis(sourceOrder,sourceItems)
      const [priorRows] = await conn.query('SELECT * FROM purchase_returns WHERE purchase_order_id=? AND deleted_at IS NULL AND status<>4 ORDER BY id', [sourceOrder.id])
      const [priorItems] = await conn.query('SELECT pri.* FROM purchase_return_items pri JOIN purchase_returns pr ON pr.id=pri.return_id WHERE pr.purchase_order_id=? AND pr.deleted_at IS NULL AND pr.status<>4 ORDER BY pri.return_id,pri.id', [sourceOrder.id])
      const active = priorRows.map(row => {
        const own = priorItems.filter(i => Number(i.return_id) === Number(row.id))
        return row.cash_execution_basis ? purchaseCash.validateReturn(cashBasis,row,own,sourceItems) : sourceOrder.cash_basis ? purchaseCash.review('新采购存在无冻结证明的活动退货') : purchaseCash.legacyReturn(cashBasis,row,own)
      })
      if (!sourceOrder.cash_basis) {
        const [audited] = await conn.query('SELECT iti.purchase_item_id AS id, SUM(iti.putaway_qty) AS quantity FROM inbound_task_items iti JOIN inbound_tasks it ON it.id=iti.task_id WHERE iti.purchase_order_id=? AND it.deleted_at IS NULL AND it.status<>5 AND it.audit_status=1 GROUP BY iti.purchase_item_id ORDER BY iti.purchase_item_id',[sourceOrder.id])
        const executed = active.filter(f => Number(priorRows.find(r => Number(r.id) === f.returnId).status) === 3)
        const projection = purchaseCash.payableProjection(cashBasis,audited,executed)
        const [accounts] = await conn.query('SELECT id,total_amount,paid_amount,balance FROM payment_records WHERE type=1 AND order_id=? ORDER BY id',[sourceOrder.id])
        if (accounts.length>1 || !accounts.length && cash.storedCashCents(projection.payable)>0n) purchaseCash.review('旧应付缺失或不唯一')
        if (accounts.length) {
          const a=accounts[0],total=cash.storedCashCents(a.total_amount,'旧应付总额'),paid=cash.storedCashCents(a.paid_amount,'旧已付款'),balance=cash.storedCashCents(a.balance,'旧应付余额')
          if (total!==cash.storedCashCents(projection.payable)||paid<0n||balance!==(total>paid?total-paid:0n)) purchaseCash.review('旧应付与准确已审/已退整价分事实不闭合')
        }
      }
      quote = purchaseCash.reserveReturn(cashBasis, sourceItems.map(i => ({ id: Number(i.id), quantity: String(i.received_qty) })), active, folded)
      if (!sourceOrder.cash_basis) quote.proof.legacyBasis = cashBasis
    }
    const lineAmounts = quote ? quote.items.map(i => i.amount) : folded.map(i => cash.cashNumber(cash.productCents(i.quantity, i.unitPrice)))
    const total = cash.cashNumber(cash.sumCashCents(lineAmounts))
    const [r]=await conn.query(`INSERT INTO purchase_returns (return_no,supplier_id,supplier_name,warehouse_id,warehouse_name,purchase_order_id,purchase_order_no,total_amount,remark,operator_id,operator_name) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,[returnNo,supplierId,supplierName,warehouseId,warehouseName,resolvedPurchaseOrderId,sourceOrder?.order_no||purchaseOrderNo||null,total,remark||null,operator.userId,operator.realName])
    for(const [itemIndex,item] of folded.entries()) await conn.query(`INSERT INTO purchase_return_items (return_id,purchase_item_id,product_id,product_code,product_name,article_number,spec,color,unit,entry_unit,quantity,entry_qty,conversion_rate,unit_price,amount) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,[r.insertId,item.sourceItemId||null,item.productId,item.productCode,item.productName,item.articleNumber||null,item.spec||null,item.color||null,item.unit,item.entryUnit,item.quantity,item.entryQty,item.conversionRate,item.unitPrice,lineAmounts[itemIndex]])
    if (quote) {
      const [persistedItems] = await conn.query('SELECT * FROM purchase_return_items WHERE return_id=? ORDER BY id', [r.insertId])
      const proof = purchaseCash.freezeReturn(cashBasis, { id:r.insertId, return_no:returnNo, purchase_order_id:resolvedPurchaseOrderId, supplier_id:supplierId, warehouse_id:warehouseId, total_amount:total }, persistedItems, quote)
      await conn.query('UPDATE purchase_returns SET cash_execution_basis=? WHERE id=?', [JSON.stringify(proof),r.insertId])
    }
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
    if (handling) await handling.complete(conn, handlingContext, result)
    await completeOperationRequest(conn, requestState, {
      data: result,
      message: '创建成功',
      resourceType: 'purchase_return',
      resourceId: r.insertId,
    })
    await conn.commit(); return result
  } catch(e){ await conn.rollback(); throw e } finally { conn.release() }
}

async function confirmPR(id, operator = null, scopeWarehouseIds = null) {
  const conn = await pool.getConnection()
  try {
    const identity = await peekPurchaseReturn(conn, id)
    assertInScope(scopeWarehouseIds, identity.warehouse_id, '采购退货单')
    await conn.beginTransaction()
    const lockedReturn = await lockPurchaseReturn(conn, identity, scopeWarehouseIds)
    const { row: retRow, items: itemRows } = lockedReturn
    assertInScope(scopeWarehouseIds, retRow.warehouse_id, '采购退货单')
    // PO S / PR X are held; this must be the first non-locking read in this transaction.
    const refundState = retRow.purchase_order_id ? await assertNoPendingRefund(conn, Number(retRow.id)) : { received: false }
    const rule = assertStatusAction('purchaseReturn', 'confirm', retRow.status)
    await provePurchaseReturnCash(conn,lockedReturn)
    // 负余额前置拦截：已付供应商金额 > 退货冲减后应付总额时，不让退货单走到出库末端才抛 409
    // 回滚、卡在中间态。采购退货全额出库，预判额与末端冲减额一致；末端 FOR UPDATE 仍兜底。
    if (retRow.purchase_order_id) {
      await assertReturnPaymentHeadroom(conn, {
        recordType: 1,
        purchaseReturnId: Number(retRow.id),
        orderId: Number(retRow.purchase_order_id),
        orderNo: retRow.purchase_order_no,
        amount: Number(retRow.total_amount || 0),
      })
    }
    await compareAndSetStatus(conn, {
      table: 'purchase_returns',
      id,
      fromStatus: rule.from,
      toStatus: rule.to,
      entityName: '采购退货单',
    })

    // 确认后自动创建仓库任务（拣货→出库）
    const taskSvc = require('../warehouse-tasks/warehouse-tasks.service')
    const { taskId, taskNo } = await taskSvc.createForPurchaseReturn({
      returnId: Number(retRow.id),
      returnNo: retRow.return_no,
      supplierName: retRow.supplier_name,
      warehouseId: Number(retRow.warehouse_id),
      warehouseName: retRow.warehouse_name,
      items: itemRows.map(r => ({
        returnItemId: Number(r.id),
        productId: Number(r.product_id),
        productCode: r.product_code,
        productName: r.product_name,
        unit: r.unit,
        articleNumber: r.article_number || null,
        spec: r.spec || null,
        color: r.color || null,
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
      description: `已生成仓库拣货任务 ${taskNo}，请提交到 PDA 执行${refundState.received ? '；已收供应商退款，请财务核对后续退货账款' : ''}`,
      operatorId: operator?.userId ?? null,
      operatorName: operator?.realName ?? null,
      requestId: getRequestId(),
      payload: { taskId, taskNo, ...(refundState.received ? { supplierRefundReceived: true, financialReview: '已收供应商退款，请财务核对后续退货账款' } : {}) },
    })
    await conn.commit()
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }
}

async function cancelPR(id, operator = null, scopeWarehouseIds = null) {
  const conn = await pool.getConnection()
  try {
    const identity = await peekPurchaseReturn(conn, id)
    assertInScope(scopeWarehouseIds, identity.warehouse_id, '采购退货单')
    await conn.beginTransaction()
    const { row: retRow } = await lockPurchaseReturn(conn, identity, scopeWarehouseIds)
    assertInScope(scopeWarehouseIds, retRow.warehouse_id, '采购退货单')
    // PO S / PR X are held; this must be the first non-locking read in this transaction.
    const refundState = retRow.purchase_order_id ? await assertNoPendingRefund(conn, Number(retRow.id)) : { received: false }
    const rule = assertStatusAction('purchaseReturn', 'cancel', retRow.status)
    // 核全部当前任务，不能仅信最后一张；已发异常拒绝，实际归还未完成时PR仍占用预算。
    const [linkedTasks] = await conn.query(
      `SELECT id, task_no, task_type, return_id, sale_order_id, warehouse_id, status, shipped_at, cancel_requested_at, deleted_at FROM warehouse_tasks
       WHERE return_id = ? AND task_type = 'purchase_return'
       ORDER BY id FOR UPDATE`,
      [id],
    )
    for (const task of linkedTasks) {
      assertInScope(scopeWarehouseIds, task.warehouse_id, '仓库任务')
      if (Number(task.warehouse_id) !== Number(retRow.warehouse_id) || Number(task.return_id) !== Number(retRow.id)
        || task.sale_order_id != null || Number(task.status) === 7 || task.shipped_at
        || ![...WT_STATUS_ACTIVE, 8].includes(Number(task.status)) || task.deleted_at && Number(task.status) !== 8) {
        throw new AppError('关联出库任务存在已发或来源异常，请先核对', 409, 'PURCHASE_RETURN_TASK_INVALID')
      }
    }
    const taskSvc = require('../warehouse-tasks/warehouse-tasks.service')
    for (const task of linkedTasks) {
      if (WT_STATUS_ACTIVE.includes(Number(task.status)) && !task.cancel_requested_at) {
        await taskSvc.cancel(Number(task.id), { conn, operator, scopeWarehouseIds, purchaseReturnId: Number(retRow.id) })
      }
    }
    const [currentTasks] = await conn.query("SELECT id, task_no, status, cancel_requested_at FROM warehouse_tasks WHERE return_id=? AND task_type='purchase_return' ORDER BY id FOR UPDATE", [id])
    const pendingTasks = currentTasks.filter(task => Number(task.status) !== 8 || task.cancel_requested_at)
    const pendingCancel = pendingTasks.length > 0
    if (!pendingCancel) await compareAndSetStatus(conn, {
      table: 'purchase_returns', id, fromStatus: rule.from, toStatus: rule.to, entityName: '采购退货单',
    })

    await recordReturnEvent(conn, {
      returnType: 'purchase',
      returnId: Number(retRow.id),
      returnNo: retRow.return_no,
      eventType: pendingCancel ? RETURN_EVENT.CANCEL_REQUESTED : RETURN_EVENT.CANCELLED,
      title: pendingCancel ? '采购退货取消待归还' : '采购退货单已取消',
      description: (pendingCancel ? '原退货单保持已确认与可退预算占用，待仓库完成实物归还后再次取消'
        : linkedTasks.length
        ? '采购退货单已取消，未执行库存扣减，关联的出库仓库任务已同步终止'
        : '采购退货单已取消，未执行库存扣减')
        + (refundState.received ? '；已收供应商退款，请财务核对后续退货账款' : ''),
      operatorId: operator?.userId ?? null,
      operatorName: operator?.realName ?? null,
      requestId: getRequestId(),
      ...(refundState.received ? { payload: { supplierRefundReceived: true, financialReview: '已收供应商退款，请财务核对后续退货账款' } } : {}),
    })
    await conn.commit()
    return { pendingCancel, tasks: pendingTasks.map(task => ({ id: Number(task.id), taskNo: task.task_no })) }
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
async function syncPurchaseReturnShipped(conn, returnId, { taskId, taskNo, operator, lockedPurchaseReturn }) {
  const retRow = lockedPurchaseReturn?.row || await lockStatusRow(conn, {
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
  let fact = null
  let totalAmount
  if (retRow.purchase_order_id) {
    if (!lockedPurchaseReturn?.cashFact || !lockedPurchaseReturn?.po) purchaseCash.review('采购退货执行缺少库存前锁定来源证明')
    fact = lockedPurchaseReturn.cashFact
    totalAmount = cash.cashNumber(cash.storedCashCents(fact.credit))
  } else {
    const [items] = await conn.query('SELECT quantity, unit_price, amount FROM purchase_return_items WHERE return_id=? ORDER BY id', [returnId])
    totalAmount = cash.cashNumber(cash.sumCashCents(items.map(i => cash.cashNumber(cash.storedCashCents(i.amount,'原非来源退货行额')))))
    if (items.some(i => cash.storedCashCents(i.amount) !== cash.productCents(i.quantity,i.unit_price))) purchaseCash.review('非来源退货金额与原量价不一致')
  }
  if (retRow.purchase_order_id && totalAmount > 0) {
    await adjustPaymentRecordForReturn(conn, {
      recordType: 1,
      orderId: Number(retRow.purchase_order_id),
      orderNo: retRow.purchase_order_no,
      returnNo: retRow.return_no,
      returnType: 'purchase',
      amount: Number(totalAmount),
      operator: operator || {},
      ...(fact && lockedPurchaseReturn.po.cash_basis ? { purchaseCashProjection: { snapshot: lockedPurchaseReturn.po.cash_basis, fact } } : {}),
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
