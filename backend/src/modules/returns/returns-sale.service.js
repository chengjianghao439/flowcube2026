const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const { lockStatusRow, compareAndSetStatus } = require('../../utils/statusTransition')
const { assertStatusAction } = require('../../constants/documentStatusRules')
const { RETURN_EVENT, record: recordReturnEvent } = require('./return-events.service')
const { RT_STATUS_NAME, RT_STATUS } = require('../return-tasks/return-tasks.service')
const { CONTAINER_STATUS } = require('../../engine/containerEngine')
const { getRequestId } = require('../../utils/requestContext')
const { beginCreationOperationRequest, completeOperationRequest } = require('../../utils/operationRequest')
const { genNo, adjustPaymentRecordForReturn, assertReturnPaymentHeadroom } = require('./returns.helpers')
const { scopeFilter, assertInScope } = require('../../utils/warehouseScope')
const { foldEntryItems } = require('../../utils/unitConversion')  // 多单位折算（文档03 Phase4a，退货按箱）
const { normalizePagination } = require('../../utils/pagination')

// 同 returns-purchase：3 的显示名统一为「已执行」（documentStatusRules / 迁移 146 / 前端筛选项一致）
const SR_STATUS = { 1:'草稿', 2:'已确认', 3:'已执行', 4:'已取消' }

const fmtSR = r => ({ id:r.id, returnNo:r.return_no, customerId:r.customer_id, customerName:r.customer_name, warehouseId:r.warehouse_id, warehouseName:r.warehouse_name, saleOrderId:r.sale_order_id||null, saleOrderNo:r.sale_order_no, status:r.status, statusName:SR_STATUS[r.status], totalAmount:Number(r.total_amount), remark:r.remark, operatorId:r.operator_id, operatorName:r.operator_name, createdAt:r.created_at })

async function loadSaleSourceOrderByNo(orderNo, scopeWarehouseIds = null) {
  const [rows] = await pool.query(
    'SELECT * FROM sale_orders WHERE order_no=? AND deleted_at IS NULL LIMIT 1',
    [orderNo],
  )
  if (!rows[0]) throw new AppError('关联销售单不存在', 404)
  // 按单号直查来源单会返回完整明细与单价金额，必须与按 ID 查详情同口径做仓库范围校验
  // （2026-09-18 审计 P2）。销售单按「整单」口径：头仓与全部明细仓都要在范围内，
  // 与 sale 模块和 fulfillment.access 的既有约定一致。
  assertInScope(scopeWarehouseIds, rows[0].warehouse_id, '销售单')
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
                AND wt.warehouse_id = COALESCE(soi.warehouse_id, (SELECT so2.warehouse_id FROM sale_orders so2 WHERE so2.id = soi.order_id))
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
  // 销售单整单口径：明细行的发货仓也必须逐行在范围内（头仓在范围内不代表每行都可见）
  for (const row of items) {
    assertInScope(scopeWarehouseIds, row.warehouse_id ?? order.warehouse_id, '销售单')
  }
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
        remainingQty: Number(Math.max(0, shippedQty - returnedQty).toFixed(2)),
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
                AND wt.warehouse_id = COALESCE(soi.warehouse_id, (SELECT so2.warehouse_id FROM sale_orders so2 WHERE so2.id = soi.order_id))
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
    if (Number(requestedQtyBySource.get(Number(item.sourceItemId)).toFixed(2)) > Number(remainingQty.toFixed(2))) {
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

  // 返货出库单（2026-09-26 一致性审查 · 任务 1 第二期）：取消时若已有合格品入库，退货单不会直接
  // 取消，而是挂着这张出库单等仓库把货退回客户。详情页必须能显示单号、进度和待退回的条码清单，
  // 否则用户只看到「取消没生效」，无从知道货还在仓库里等着出。
  const [[reverseTask]] = await pool.query(
    `SELECT id, task_no, status, shipped_at, created_at FROM warehouse_tasks
      WHERE task_type = 'sale_return_out' AND return_id = ? AND deleted_at IS NULL
      ORDER BY id DESC LIMIT 1`,
    [id],
  )
  if (reverseTask) {
    const { WT_STATUS_NAME } = require('../../constants/warehouseTaskStatus')
    const [reverseContainers] = await pool.query(
      `SELECT c.id, c.barcode, c.remaining_qty, c.product_id, p.name AS product_name
         FROM inventory_containers c
         LEFT JOIN product_items p ON p.id = c.product_id
        WHERE c.locked_by_task_id = ? AND c.status = ? AND c.deleted_at IS NULL
        ORDER BY c.id`,
      [reverseTask.id, CONTAINER_STATUS.ACTIVE],
    )
    ret.reverseTask = {
      id: Number(reverseTask.id),
      taskNo: reverseTask.task_no,
      status: Number(reverseTask.status),
      statusName: WT_STATUS_NAME[Number(reverseTask.status)] || '未知',
      shippedAt: reverseTask.shipped_at || null,
      createdAt: reverseTask.created_at,
      containers: reverseContainers.map(r => ({
        id: Number(r.id), barcode: r.barcode, qty: Number(r.remaining_qty),
        productId: Number(r.product_id), productName: r.product_name,
      })),
    }
  } else {
    ret.reverseTask = null
  }
  return ret
}

async function createSR({ customerId, customerName, warehouseId, warehouseName, saleOrderId = null, saleOrderNo, remark, items, operator, requestKey, scopeWarehouseIds = null }) {
  assertInScope(scopeWarehouseIds, warehouseId, '销售退货单')
  const conn=await pool.getConnection()
  try {
    await conn.beginTransaction()
    const requestState = await beginCreationOperationRequest(conn, {
      requestKey,
      action: 'saleReturn.create',
      userId: operator?.userId ?? null,
      payload: { customerId, customerName, warehouseId, warehouseName, saleOrderId, saleOrderNo, remark, items },
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
      // customer_name / warehouse_name 供返货出库任务落库（PDA 与任务列表要显示客户与仓库）
      columns: 'id, return_no, status, warehouse_id, warehouse_name, customer_name',
      entityName: '销售退货单',
    })
    assertInScope(scopeWarehouseIds, retRow.warehouse_id, '销售退货单')
    const rule = assertStatusAction('saleReturn', 'cancel', retRow.status)

    // ── 已入库容器的处置：返货出库（2026-09-26 一致性审查 · 任务 1 第二期）──────────
    // 退货任务允许"部分明细先上架"：此时退货单仍在可取消的已确认(2)——冲减应收与生成退货凭证
    // 都发生在全部上架完成、退货单→3 那一刻（凭证引擎取数条件是 sr.status = 3）——但已上架的
    // 容器是 ACTIVE、已计入库存。直接取消会让这批货与退货单脱钩。
    // 正确处置是「返货出库」：生成一张独立的退货返货出库单，由仓库按 PDA 出库流程把货退回客户；
    // 退货单等返货出库完成才真正取消（中间态对用户可见，不出现"单据已取消、货还在库里"）。
    //
    // 会计上全程不动：应收从未冲减过，也就不能"恢复"（恢复＝客户被多收一次钱、收入虚增）。
    // 设计依据见 docs/sale-return-reverse-flow-2026-09-26.md。
    //
    // 先锁该退货单的全部退货任务行（升序，与上架侧同序）。这同时是「冷冻容器集合」的前提：
    // 上架要求任务状态=4，下面把 4 置为反向处理中(7)后，不可能再有新容器被上架进来，
    // 之后的容器扫描与锁定才是稳定的。
    // 容器的 source_ref_id 存的是**退货任务** id（return_tasks.id），不是退货单 id，故须 JOIN 关联。
    const [linkedTasks] = await conn.query(
      `SELECT id, task_no, status FROM return_tasks
        WHERE return_id = ? AND return_type = 'sale' AND deleted_at IS NULL
        ORDER BY id FOR UPDATE`,
      [id],
    )
    const [[inbound]] = await conn.query(
      `SELECT COUNT(*) AS cnt, COALESCE(SUM(c.remaining_qty), 0) AS qty
         FROM inventory_containers c
         JOIN return_tasks rt ON rt.id = c.source_ref_id
        WHERE rt.return_id = ? AND rt.return_type = 'sale'
          AND c.source_ref_type = 'sale_return'
          AND c.status = ? AND c.deleted_at IS NULL`,
      [id, CONTAINER_STATUS.ACTIVE],
    )
    if (Number(inbound.cnt) > 0) {
      const reverse = await enterSaleReturnReverse(conn, { retRow, operator, linkedTasks })
      await conn.commit()
      return reverse
    }

    await compareAndSetStatus(conn, {
      table: 'sale_returns',
      id,
      fromStatus: rule.from,
      toStatus: rule.to,
      entityName: '销售退货单',
    })

    // 已确认(2)会自动创建并派发 PDA 退货任务（return_tasks）；取消时必须同步终止该任务，
    // 否则仓库端会继续把一个"已取消"的退货单执行完，造成账实不符（P0-2，同 cancelPR）。
    // linkedTasks 上面已按 id 升序加锁读出，取末尾一个（id 最大）与原 ORDER BY id DESC LIMIT 1 等价。
    const returnTasksSvc = require('../return-tasks/return-tasks.service')
    const lastTask = linkedTasks.length ? linkedTasks[linkedTasks.length - 1] : null
    const RT_ACTIVE = [
      returnTasksSvc.RT_STATUS.PENDING_RECEIVE,
      returnTasksSvc.RT_STATUS.RECEIVING,
      returnTasksSvc.RT_STATUS.PENDING_CHECK,
      returnTasksSvc.RT_STATUS.PENDING_PUTAWAY,
    ]
    const shouldCancelTask = lastTask && RT_ACTIVE.includes(Number(lastTask.status))
    if (shouldCancelTask) {
      await returnTasksSvc.cancel(Number(lastTask.id), operator || {}, { conn })
    }

    await recordReturnEvent(conn, {
      returnType: 'sale',
      returnId: Number(retRow.id),
      returnNo: retRow.return_no,
      eventType: RETURN_EVENT.CANCELLED,
      title: '销售退货单已取消',
      description: shouldCancelTask
        ? '销售退货单已取消，未执行退货入库（无合格品上架），关联的退货任务已同步终止'
        : '销售退货单已取消，未执行退货入库（无合格品上架）',
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
 * 有已入库容器时的取消：进入「待反向处理」，准备返货出库。
 *
 * 调用方须已在本事务内锁住 sale_returns 行与全部 return_tasks 行（升序）。
 * **本函数不改变退货单状态**：退货单保持已确认(2)，等返货出库真正完成才在
 * syncSaleReturnReversedWithinTransaction 里转为已取消(4)——中间态对用户可见，
 * 不会出现「单据已取消、货还在库里」。
 *
 * @returns {{ pendingReverse: true, taskId: number, taskNo: string, alreadyRequested: boolean }}
 */
async function enterSaleReturnReverse(conn, { retRow, operator, linkedTasks }) {
  const { WT_STATUS } = require('../../constants/warehouseTaskStatus')
  const commandSvc = require('../warehouse-tasks/warehouse-tasks.command')
  const returnTasksSvc = require('../return-tasks/return-tasks.service')

  // 幂等：一个退货单只允许有一张进行中的返货出库单。重复点「取消」不再建单——否则同一批
  // 容器会被两张任务分别锁定（第二张的预锁会撞上 CONTAINER_BUSY 而失败，用户看到的是
  // 一个莫名其妙的 409），既有单号直接返回给用户。
  const [[existing]] = await conn.query(
    `SELECT id, task_no FROM warehouse_tasks
      WHERE task_type = 'sale_return_out' AND return_id = ? AND deleted_at IS NULL
        AND status NOT IN (?, ?)
      ORDER BY id DESC LIMIT 1`,
    [retRow.id, WT_STATUS.SHIPPED, WT_STATUS.CANCELLED],
  )
  if (existing) {
    return {
      pendingReverse: true,
      taskId: Number(existing.id),
      taskNo: existing.task_no,
      alreadyRequested: true,
    }
  }

  const RT = returnTasksSvc.RT_STATUS
  for (const t of linkedTasks) {
    const st = Number(t.status)
    if (st === RT.PENDING_PUTAWAY) {
      // 待上架 → 反向处理中(7)（RT_TRANSITIONS 里这条边本就为此预留）。这同时冷冻了容器集合：
      // 上架要求任务状态=4，置 7 之后不可能再有新容器被上架进来。
      await compareAndSetStatus(conn, {
        table: 'return_tasks',
        id: Number(t.id),
        fromStatus: RT.PENDING_PUTAWAY,
        toStatus: RT.REVERSING,
        entityName: '退货任务',
      })
    } else if ([RT.PENDING_RECEIVE, RT.RECEIVING, RT.PENDING_CHECK].includes(st)) {
      // 还没走到上架的阶段（这种任务不可能持有 ACTIVE 容器，属多任务并行时的另一支）：
      // 直接终止，免得留下一个还能继续收货/质检的活跃任务。
      await returnTasksSvc.cancel(Number(t.id), operator || {}, { conn })
    }
    // 已完成(5)的任务保持原状：它的货同样是这批要返的货，但状态机不允许 5 回退，
    // 也没有必要——退货单最终会转为已取消，任务 5 只是"当时确实完成过入库"的历史记录。
  }

  // 未上架的容器不可能再上架了，当场作废（PENDING_QA=5 / PENDING_PUTAWAY=4）。不这么做它们会
  // 永久卡在待上架：任务已不是 4，putaway() 的前置条件再也不满足，货实收而系统里永远找不到。
  // 这些容器从未计入库存（不是 ACTIVE），作废不需要回滚任何数量。
  const taskIds = linkedTasks.map(t => Number(t.id))
  if (taskIds.length) {
    await conn.query(
      `UPDATE inventory_containers SET status = ?
        WHERE source_ref_type = 'sale_return' AND source_ref_id IN (?)
          AND status IN (?, ?) AND deleted_at IS NULL`,
      [CONTAINER_STATUS.VOID, taskIds, CONTAINER_STATUS.PENDING_QA, CONTAINER_STATUS.PENDING_PUTAWAY],
    )
  }

  // 返货明细按「实际入库量」生成（per 退货明细行的 putaway_qty 汇总）。只取 qty>0 的行：
  // 没入库的明细退回不了任何东西。行级关联到 sale_return_items 行，出库按该行取退货单价。
  const [items] = await conn.query(
    `SELECT sri.id AS return_item_id, sri.product_id, sri.product_code, sri.product_name, sri.unit,
            sri.article_number, sri.spec, sri.color,
            COALESCE(SUM(rti.putaway_qty), 0) AS qty
       FROM return_tasks rt
       JOIN return_task_items rti ON rti.task_id = rt.id
       JOIN sale_return_items sri ON sri.id = rti.return_item_id
      WHERE rt.return_id = ? AND rt.return_type = 'sale' AND rt.deleted_at IS NULL
      GROUP BY sri.id
     HAVING qty > 0
      ORDER BY sri.id`,
    [retRow.id],
  )
  if (!items.length) {
    // 有 ACTIVE 容器却说没有入库量：容器与明细已脱节，不能猜一个数量出来建单
    throw new AppError(
      '该退货单有已入库的库存条码，但查不到对应的入库数量明细，无法生成返货出库单，请联系管理员核查',
      500,
      'SALE_RETURN_REVERSE_ITEMS_MISSING',
    )
  }

  // ── 可返量与明细口径核对（2026-09-26 一致性审查 · 任务 1 第二期）────────────────
  // required_qty 不能直接照抄历史 rti.putaway_qty：这批货上架后就是普通可用库存，之后可能被
  // 别的销售出库按 FIFO 扣走一部分。若按历史量建单而容器里不够，拣货扫码会因「超过库存条码
  // 可用数量」永远填不满，任务卡死在拣货中——退货单既取消不了、货也退不回去。
  // 反过来「按现有量静默少退」同样不行：客户少拿回货而单据照旧取消，差额无人知晓、日后必成纠纷。
  // 返货的语义是原样退回，货不全说明物理前提已被破坏，这里停下来让人核查（报错逐商品列出差额）。
  //
  // 口径必须与预锁容器完全一致：都取「ACTIVE 且 remaining_qty > 0」（零量容器不可扫，不进集合）。
  const [available] = await conn.query(
    `SELECT c.product_id, COALESCE(SUM(c.remaining_qty), 0) AS qty
       FROM inventory_containers c
       JOIN return_tasks rt ON rt.id = c.source_ref_id AND rt.return_type = 'sale'
      WHERE rt.return_id = ? AND c.source_ref_type = 'sale_return'
        AND c.status = ? AND c.deleted_at IS NULL AND c.remaining_qty > 0
      GROUP BY c.product_id`,
    [retRow.id, CONTAINER_STATUS.ACTIVE],
  )
  const RATIO = 100  // 按分比较，避开 DECIMAL 浮点尾差（同 assertTaskPackagingClosure）
  const availByProduct = new Map(available.map(r => [Number(r.product_id), Math.round(Number(r.qty) * RATIO)]))
  const expectByProduct = new Map()
  const productNameById = new Map()
  for (const it of items) {
    const pid = Number(it.product_id)
    expectByProduct.set(pid, (expectByProduct.get(pid) || 0) + Math.round(Number(it.qty) * RATIO))
    productNameById.set(pid, it.product_name)
  }
  const stockChanged = []
  for (const pid of new Set([...expectByProduct.keys(), ...availByProduct.keys()])) {
    const expected = expectByProduct.get(pid) || 0
    const avail = availByProduct.get(pid) || 0
    if (expected !== avail) {
      stockChanged.push({
        productId: pid,
        productName: productNameById.get(pid) || `商品#${pid}`,
        expected: expected / RATIO,
        available: avail / RATIO,
      })
    }
  }
  if (stockChanged.length) {
    throw new AppError(
      '退货单已入库的货与账面不符，无法生成返货出库单：'
      + stockChanged.map(m => `「${m.productName}」应返 ${m.expected}，当前在库 ${m.available}`).join('；')
      + '。这批货可能已被其它出库或库存调整动用，请先核查该批退货库存条码的去向，再重新取消退货单',
      409,
      'SALE_RETURN_REVERSE_STOCK_CHANGED',
      { mismatches: stockChanged },
    )
  }

  const { taskId, taskNo } = await commandSvc.createForSaleReturnReverse({
    returnId: Number(retRow.id),
    returnNo: retRow.return_no,
    customerName: retRow.customer_name || null,
    warehouseId: Number(retRow.warehouse_id),
    warehouseName: retRow.warehouse_name || '',
    items: items.map(r => ({
      returnItemId: Number(r.return_item_id),
      productId: Number(r.product_id),
      productCode: r.product_code,
      productName: r.product_name,
      unit: r.unit,
      articleNumber: r.article_number || null,
      spec: r.spec || null,
      color: r.color || null,
      quantity: Number(r.qty),
    })),
    conn,
  })

  await recordReturnEvent(conn, {
    returnType: 'sale',
    returnId: Number(retRow.id),
    returnNo: retRow.return_no,
    eventType: RETURN_EVENT.REVERSE_REQUESTED,
    title: '退货单取消需返货出库',
    description: `该退货单已有合格品入库，不能直接取消：已生成返货出库单 ${taskNo}，`
      + '请仓库按 PDA 出库流程把这批货退回客户，出库完成后退货单自动取消',
    operatorId: operator?.userId ?? null,
    operatorName: operator?.realName ?? null,
    requestId: getRequestId(),
    payload: { taskId, taskNo, inventoryDirection: 'out' },
  })

  return { pendingReverse: true, taskId, taskNo, alreadyRequested: false }
}

/**
 * 返货出库完成回调（由 warehouse-tasks.ship 事务内调用）。
 *
 * 与 syncSaleReturnCompleted 的关键差异：**这里不做任何账务动作**——不冲减/恢复应收、
 * 不生成任何凭证。返货发生在退货单状态 2 时，而应收冲减与退货凭证都只在该单到状态 3 时才发生
 * （凭证引擎取数条件是 `sr.status = 3`），所以此时应收从未冲减过。若在这里"恢复应收"，
 * 客户会被多收一次钱、收入虚增。依据见 docs/sale-return-reverse-flow-2026-09-26.md §一。
 *
 * 收口条件：只有该退货单下**再没有 ACTIVE 容器**时才把退货单转为已取消(4)。一个退货单可能拆成
 * 多张退货任务（分仓/分批），本任务出库完而别的任务还有货在库里时，退货单停在已确认(2)等它。
 */
async function syncSaleReturnReversedWithinTransaction(conn, returnId, { taskId, taskNo }) {
  const retRow = await lockStatusRow(conn, {
    table: 'sale_returns',
    id: returnId,
    columns: 'id, return_no, sale_order_id, sale_order_no, warehouse_id, status',
    entityName: '销售退货单',
  })
  if (Number(retRow.status) !== 2) {
    throw new AppError('销售退货单状态异常（当前非已确认），无法完成返货出库', 409)
  }
  const rule = assertStatusAction('saleReturn', 'cancel', retRow.status)

  // 反向处理中的退货任务 → 已取消(6)。此时它们的货已由本任务出库退回客户。
  const [reversingTasks] = await conn.query(
    `SELECT id, status FROM return_tasks
      WHERE return_id = ? AND return_type = 'sale' AND status = ? AND deleted_at IS NULL
      ORDER BY id FOR UPDATE`,
    [returnId, RT_STATUS.REVERSING],
  )
  for (const t of reversingTasks) {
    await compareAndSetStatus(conn, {
      table: 'return_tasks',
      id: Number(t.id),
      fromStatus: RT_STATUS.REVERSING,
      toStatus: RT_STATUS.CANCELLED,
      entityName: '退货任务',
    })
  }

  // 还有别的退货任务的货在库里 → 本任务收口，但退货单保持已确认(2)，等剩余部分也返货出库。
  const [[{ remaining }]] = await conn.query(
    `SELECT COUNT(*) AS remaining
       FROM inventory_containers c
       JOIN return_tasks rt ON rt.id = c.source_ref_id AND rt.return_type = 'sale'
      WHERE rt.return_id = ? AND c.source_ref_type = 'sale_return'
        AND c.status = ? AND c.deleted_at IS NULL`,
    [returnId, CONTAINER_STATUS.ACTIVE],
  )
  if (Number(remaining) > 0) {
    await recordReturnEvent(conn, {
      returnType: 'sale',
      returnId: Number(retRow.id),
      returnNo: retRow.return_no,
      eventType: RETURN_EVENT.REVERSE_REQUESTED,
      title: '返货出库部分完成',
      description: `返货出库单 ${taskNo} 已出库；该退货单还有 ${Number(remaining)} 个库存条码在库，退货单待全部返货完成后自动取消`,
      requestId: getRequestId(),
      payload: { taskId, taskNo, remainingContainers: Number(remaining), inventoryDirection: 'out' },
    })
    return
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
    eventType: RETURN_EVENT.CANCELLED,
    title: '销售退货单已取消',
    description: `已入库的货由返货出库单 ${taskNo} 退回客户，退货单自动取消（未冲减应收：该单从未冲减、也从未生成退货凭证）`,
    requestId: getRequestId(),
    payload: { taskId, taskNo, inventoryDirection: 'out' },
  })
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
  syncSaleReturnReversedWithinTransaction,
  loadSaleSourceOrderByNo,
}
