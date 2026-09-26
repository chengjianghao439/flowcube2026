const { commitFulfillment } = require('../fulfillment/fulfillment.refresh')
const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const { moveStock, MOVE_TYPE } = require('../../engine/inventoryEngine')
const { unlockContainersByTask } = require('../../engine/containerEngine')
const { lockStatusRow, compareAndSetStatus } = require('../../utils/statusTransition')
const { getCustomerCreditUsed, hasCreditOverridePermission } = require('../../utils/creditExposure')
const { isValidTransition, assertWarehouseTaskAction } = require('../../constants/warehouseTaskStatus')
const { WT_EVENT, record: recordEvent } = require('./warehouse-task-events.service')
const { beginResourceOperationRequest, completeOperationRequest } = require('../../utils/operationRequest')
const { getNetOrderAmount, getOutstandingOrderAmount } = require('../sale/sale.contracts')
const {
  logSideEffectFailure,
  assertTaskPickScanClosure,
  assertSaleReturnReverseClosure,
  assertTaskCheckScanClosure,
  assertTaskPackagingClosure,
  assertTaskPackagePrintClosure,
  assertTaskScope,
} = require('./warehouse-tasks.helpers')
const { findById } = require('./warehouse-tasks.query')

/**
 * 出库信用复查（审计 4.8）。客户行 FOR UPDATE 锁住，防止同客户并发出库都读到旧已用值。
 * 其它订单已用额度 + 本单折后未收敞口 > 限额时拦截（除非操作者有 sale.credit.override 权限）。
 * 抽成独立函数便于单测。
 */
async function assertCreditWithinLimit(conn, customerId, thisOrderAmount, operator, excludeSaleOrderId = null) {
  const [[cust]] = await conn.query(
    'SELECT id, credit_limit FROM sale_customers WHERE id = ? FOR UPDATE',
    [customerId],
  )
  if (!cust || cust.credit_limit == null) return // 无信用额度限制则放行
  const used = await getCustomerCreditUsed(conn, customerId, { excludeSaleOrderId })
  let paidAmount = 0
  if (excludeSaleOrderId != null) {
    const [[receivable]] = await conn.query(
      'SELECT paid_amount FROM payment_records WHERE type = 2 AND order_id = ? LIMIT 1',
      [Number(excludeSaleOrderId)],
    )
    paidAmount = Number(receivable?.paid_amount) || 0
  }
  const thisOrder = getOutstandingOrderAmount(thisOrderAmount, 0, paidAmount)
  const limit = Number(cust.credit_limit)
  if (used + thisOrder > limit) {
    const overBy = Math.round((used + thisOrder - limit) * 100) / 100
    const allowOverride = await hasCreditOverridePermission(conn, operator)
    if (!allowOverride) {
      throw new AppError(
        `客户信用额度不足，无法出库（已用 ${used} + 本单 ${thisOrder} > 限额 ${limit}，超出 ${overBy}）。请先收款或由有权限的人确认后重试`,
        409,
        'CREDIT_LIMIT_EXCEEDED',
        { creditLimit: limit, used, thisOrder, overBy },
      )
    }
  }
}

/**
 * 执行出库（6→7）：扣减库存 + 更新销售单状态 + 生成应收账款
 */
async function shipWithinTransaction(conn, id, operator, saleData, { requestKey, scopeWarehouseIds = null, pdaWarehouseId = null } = {}) {
  const { saleOrderId, warehouseId, totalAmount, items } = saleData

  // 加锁顺序统一为「先销售单、后仓库任务」，与 sale.cancel / requestAdjustment(SO→WT) 一致，
  // 避免 ship(原 WT→SO) 与它们并发同一订单+任务时 ABBA 死锁（审计 P2）。这里只「加锁」拿 SO 快照，
  // SO 的状态校验（已取消/已完成）仍放到 WT 前置校验（拣货退回中/改单中）之后，保持既有错误优先级
  // 不变。只有销售出库有关联销售单；采购退货任务 getShipContext 返回 saleOrderId=null，不锁 SO。
  let saleRow = null
  if (saleOrderId) {
    saleRow = await lockStatusRow(conn, {
      table: 'sale_orders',
      id: saleOrderId,
      columns: 'id, status, order_no, customer_id, total_amount, discount_amount',
      entityName: '销售单',
    })
  }

  const taskRow = await lockStatusRow(conn, {
    table: 'warehouse_tasks',
    id,
    // sale_order_id 必须取出来：下面的返货出库守卫靠它判断"任务是否被挂上了销售单"。
    // 少了这一列时值是 undefined，而 `undefined != null` 为 false，守卫会**静默失效**——
    // 一旦有人手改了数据，返货就会掉进销售出库分支重算应收（客户被多收一次钱）。
    columns: 'id, task_no, task_type, status, return_id, sale_order_id, cancel_requested_at, adjustment_requested_at, warehouse_id',
    entityName: '仓库任务',
  })
  // 出库是最重的库存动作：限仓用户只能出本仓任务；PDA 设备绑定仓库必须与任务仓库一致
  assertTaskScope(taskRow, { scopeWarehouseIds, pdaWarehouseId })
  if (taskRow.cancel_requested_at) {
    throw new AppError('该任务正在拣货退回中，不可出库', 409)
  }
  if (taskRow.adjustment_requested_at) {
    throw new AppError('该任务有改单正在等待仓库确认，请先处理完成', 409)
  }
  const rule = assertWarehouseTaskAction('ship', taskRow.status)
  if (!isValidTransition(taskRow.status, rule.toStatus)) throw new AppError(`非法状态迁移：${taskRow.status} → ${rule.toStatus}`, 400)
  const requestState = await beginResourceOperationRequest(conn, {
    requestKey,
    action: 'warehouse.ship',
    userId: operator?.userId ?? null,
    resourceType: 'warehouse_task',
    resourceId: id,
  })
  if (requestState.replay) {
    return requestState.responseData
  }

  const isPurchaseReturn = taskRow.task_type === 'purchase_return'
  // 销售退货返货出库（任务 1 第二期）：把已入库的那批退货货品退回客户。
  // 与销售出库的本质差异是**会计上什么都不做**——这批货所属的退货单此刻还是状态 2，
  // 应收从未冲减、退货凭证从未生成（凭证引擎取数条件是 sr.status = 3），所以返货不能去
  // 重算应收、更不能写 payment_records。能取消的退货单只到状态 2，这是硬事实。
  const isSaleReturnReverse = taskRow.task_type === 'sale_return_out'
  if (isSaleReturnReverse && taskRow.sale_order_id != null) {
    // 带了销售单就会走进应收重算：那是把「从未冲减过的应收」凭空重算出来，客户被多收一次钱。
    // 建单侧恒为 NULL，这里出现非空说明有人手改了数据或程序错了，直接暴露而不是静默按销售出库处理。
    throw new AppError(
      '返货出库任务不应关联销售单（销售退货返货不涉及销售单与应收账款），请联系管理员核查',
      500,
      'SALE_RETURN_REVERSE_SALE_ORDER_FORBIDDEN',
    )
  }
  // 两类「退货出库」的共同口径：都不经过分拣/复核/打包/打印，也不携带销售预占
  const isReturnOut = isPurchaseReturn || isSaleReturnReverse

  await assertTaskPickScanClosure(conn, id)
  // 返货要求「整批退回客户」：预锁容器里有多少就必须扫多少（见 assertSaleReturnReverseClosure）
  if (isSaleReturnReverse) {
    await assertSaleReturnReverseClosure(conn, id)
  }
  if (!isReturnOut) {
    await assertTaskCheckScanClosure(conn, id)
    await assertTaskPackagingClosure(conn, id)
    await assertTaskPackagePrintClosure(conn, id)
  }

  // SO 状态校验：放在任务级前置校验之后，保持「拣货退回中/改单中」优先报错的既有契约；
  // saleRow 已在函数开头 FOR UPDATE 锁定（销售出库才有；采购退货 saleOrderId=null）。
  if (saleRow) {
    if (Number(saleRow.status) === 5) {
      throw new AppError(`关联销售单 ${saleRow.order_no} 已取消，无法继续出库`, 400)
    }
    if (Number(saleRow.status) === 4) {
      throw new AppError(`关联销售单 ${saleRow.order_no} 已完成出库，请勿重复操作`, 400)
    }
  }

  // 出库环节信用复查（审计 4.8）：占库时校验过一次，但占库到出库之间
  // 客户可能又开了新单、或未清应收变多，额度可能已经超限——出库确认是货物
  // 真正离开仓库的时点，此时复查比占库时更贴近「钱能不能收回来」。
  // 口径与占库一致；排除本单后再加回本单折后未收敞口，避免分批出库重复计算。
  if (saleRow && saleRow.customer_id != null) {
    await assertCreditWithinLimit(
      conn,
      saleRow.customer_id,
      getNetOrderAmount(saleRow.total_amount, saleRow.discount_amount),
      operator,
      saleRow.id,
    )
  }

  // 与占库侧（sale.service.reserveStock）保持同一加锁顺序：moveStock 会对
  // inventory_stock 行加 FOR UPDATE，多个任务并发出库时若商品顺序不一致会互相等待成死锁。
  // 明细的自然顺序取决于建单时的录入顺序，不可依赖（审计 P1-6）。
  const shipOrder = [...items].sort((a, b) => Number(a.productId) - Number(b.productId))
  for (const item of shipOrder) {
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
      // 两类退货出库都不携带销售预占：返货的货来自退货入库，从未占用过任何销售单的预占。
      // 若在这里带上 reservationRefType，moveStock 会去核销别的销售单的预占（审计 P0-1 同因）。
      reservationRefType: isReturnOut ? null : 'sale_order',
      reservationRefId: isReturnOut ? null : saleOrderId,
      operatorId: operator.userId,
      operatorName: operator.realName,
      lockedByTaskId: id,
    })
  }

  if (!isReturnOut && saleOrderId) {
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

  // 销售退货返货出库完成：把退货任务收口、必要时把退货单转为已取消。
  // 注意这里**不动任何账款**——见函数头注释与设计文档 §一。
  if (isSaleReturnReverse && taskRow.return_id) {
    const saleReturnSvc = require('../returns/returns-sale.service')
    await saleReturnSvc.syncSaleReturnReversedWithinTransaction(conn, Number(taskRow.return_id), {
      taskId: Number(id),
      taskNo: taskRow.task_no,
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

  if (!isReturnOut) {
    // COGS 成本快照：只对本任务实发的商品固化出库时点均价（分仓/分批下各任务
    // 独立快照，不再一次性刷全订单）。利润分析用快照口径，避免改进价导致历史毛利漂移。
    for (const item of items) {
      await conn.query(
        `UPDATE sale_order_items soi
         JOIN product_items p ON p.id = soi.product_id
         SET soi.cost_snapshot = COALESCE(p.avg_cost, NULLIF(p.cost_price, 0))
         WHERE soi.order_id = ? AND soi.product_id = ? AND soi.warehouse_id = ? AND soi.cost_snapshot IS NULL`,
        [saleOrderId, item.productId, warehouseId],
      )
    }
    // 应收由 syncShippedByWarehouseTaskWithinTransaction 全量重算（按 shipped_qty 汇总，
    // 分批增量幂等，见 sale.service.recomputeSaleReceivable），此处不再单独生成。
  }

  try {
    await recordEvent(conn, {
      taskId: id, taskNo: taskRow.task_no,
      eventType: WT_EVENT.SHIP_DONE,
      fromStatus: taskRow.status,
      toStatus: rule.toStatus,
      operatorId: operator.userId,
      operatorName: operator.realName,
      detail: { saleOrderId, totalAmount, itemCount: items.length, isPurchaseReturn, isSaleReturnReverse },
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

async function ship(id, operator, saleData, { requestKey, scopeWarehouseIds = null, pdaWarehouseId = null } = {}) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const payload = await shipWithinTransaction(conn, id, operator, saleData, { requestKey, scopeWarehouseIds, pdaWarehouseId })
    await commitFulfillment(conn, 'warehouse', id)
    return payload
  } catch (e) { await conn.rollback(); throw e }
  finally { conn.release() }
}

/**
 * 出库明细的重复放大防线。
 *
 * getShipContext 的结果会被 shipWithinTransaction 逐条 moveStock，所以它的行数必须
 * 严格等于 warehouse_task_items 的行数。一旦 LEFT JOIN 因关联键不唯一而放大，
 * 同一批货会被扣减多次且全程无报错（审计 P0-5）。宁可拒绝出库，也不能静默多扣库存。
 */
async function assertNoShipItemFanout(taskId, joinedCount) {
  const [[{ taskItemCount }]] = await pool.query(
    'SELECT COUNT(*) AS taskItemCount FROM warehouse_task_items WHERE task_id = ?',
    [taskId],
  )
  if (joinedCount !== Number(taskItemCount)) {
    throw new AppError(
      `出库明细异常：任务有 ${taskItemCount} 条商品明细，关联单据后得到 ${joinedCount} 条，` +
      '可能存在重复商品行，已阻止出库以免重复扣减库存，请联系管理员核查',
      409,
    )
  }
}

async function getShipContext(taskId) {
  const task = await findById(taskId)

  if (task.taskType === 'purchase_return') {
    // 行级关联（迁移 247，2026-09-18 审计 P1-18）：出库必须按「任务明细行 → 退货明细行」精确取单价。
    // 原先按 `pri.return_id = ? AND pri.product_id = wti.product_id` 关联：同一退货单里同商品有两行时
    // LEFT JOIN 放大成 2 行，assertNoShipItemFanout 抛 409 → 出库被**永久卡死**（库存与应付永不冲减）。
    // 现在的关联键 wti.purchase_return_item_id 唯一，不会放大。
    // 历史任务没有该列（迁移前建的）时，只在该商品于本退货单内**唯一**的情况下回退到 product_id 关联；
    // 同商品多行的历史任务保持无法解析，由下面显式报错要求人工核对——绝不用「随便挑一行」蒙过去。
    const [wmsItems] = await pool.query(
      `SELECT wti.product_id, wti.product_name, wti.picked_qty,
              COALESCE(pri.unit_price, legacy.unit_price) AS unit_price,
              (pri.id IS NULL AND legacy.unit_price IS NULL AND wti.picked_qty <> 0) AS link_missing
         FROM warehouse_task_items wti
         LEFT JOIN purchase_return_items pri ON pri.id = wti.purchase_return_item_id
         LEFT JOIN (
           SELECT product_id, MIN(unit_price) AS unit_price, COUNT(*) AS line_count
             FROM purchase_return_items
            WHERE return_id = ?
            GROUP BY product_id
         ) legacy
           ON wti.purchase_return_item_id IS NULL
          AND legacy.product_id = wti.product_id
          AND legacy.line_count = 1
        WHERE wti.task_id = ?`,
      [task.returnId, taskId],
    )
    if (!wmsItems.length) throw new AppError('任务无出库明细', 400)
    await assertNoShipItemFanout(taskId, wmsItems.length)
    if (wmsItems.some(i => Number(i.link_missing) === 1)) {
      throw new AppError(
        '该退货任务缺少行级关联（多为迁移 247 之前创建的历史任务，且该商品在退货单内有多行），'
        + '无法确定各行的退货单价。请核对该退货单明细后重建任务，或联系管理员处理。',
        409,
        'PURCHASE_RETURN_ITEM_LINK_MISSING',
      )
    }
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

  if (task.taskType === 'sale_return_out') {
    // 返货出库（任务 1 第二期）：sale_order_id 恒为 NULL，不能走下面的销售单分支
    // （那会以「关联销售单不存在」404 把返货卡死），也不能碰任何应收。
    //
    // 单价按行级关联（迁移 262 的 sale_return_item_id）从 sale_return_items 取，理由同采购退货：
    // 按 (return_id, product_id) 关联时同一退货单内同商品多行会 JOIN 放大，assertNoShipItemFanout
    // 抛 409 把出库永久卡死。该类型是本次新增，不存在"迁移前的历史任务"，故没有 legacy 回退分支；
    // 缺关联只可能是数据被改过，直接拒绝并要求人工核查，绝不"随便挑一行"蒙过去。
    const [wmsItems] = await pool.query(
      `SELECT wti.product_id, wti.product_name, wti.picked_qty,
              sri.unit_price,
              (wti.sale_return_item_id IS NULL AND wti.picked_qty <> 0) AS link_missing
         FROM warehouse_task_items wti
         LEFT JOIN sale_return_items sri ON sri.id = wti.sale_return_item_id
        WHERE wti.task_id = ?`,
      [taskId],
    )
    if (!wmsItems.length) throw new AppError('任务无出库明细', 400)
    await assertNoShipItemFanout(taskId, wmsItems.length)
    if (wmsItems.some(i => Number(i.link_missing) === 1)) {
      throw new AppError(
        '返货出库任务缺少退货明细行关联，无法确定退货单价，请联系管理员核查后重建任务',
        409,
        'SALE_RETURN_ITEM_LINK_MISSING',
      )
    }
    return {
      saleOrderId: null,
      warehouseId: task.warehouseId,
      totalAmount: wmsItems.reduce((sum, i) => sum + Number(i.picked_qty) * Number(i.unit_price || 0), 0),
      // 返货的对手方是退货单上的客户，但出库不写任何单据/账款，ship 不需要客户名
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

  // JOIN 必须带仓库维度：sale_order_items 自迁移 123 起是「行级发货仓库」模型，同一商品
  // 从多个仓库发货会产生多行且 product_id 相同（分仓订单的正常用法，不是脏数据）。
  // 只按 product_id 关联时，一行 warehouse_task_items 会匹配出 N 行，下游对同一批货
  // 调用 N 次 moveStock，库存被扣 N 倍。取本任务自己的仓库，与 syncShipped 回写
  // shipped_qty 的定位口径保持一致（审计 P0-5）。
  const [wmsItems] = await pool.query(
    `SELECT wti.product_id, wti.product_name, wti.picked_qty, soi.unit_price
     FROM warehouse_task_items wti
     LEFT JOIN sale_order_items soi
       ON soi.order_id = ? AND soi.product_id = wti.product_id AND soi.warehouse_id = ?
     WHERE wti.task_id = ?`,
    [saleOrder.id, task.warehouseId, taskId],
  )
  if (!wmsItems.length) throw new AppError('任务无出库明细', 400)
  await assertNoShipItemFanout(taskId, wmsItems.length)

  return {
    saleOrderId: saleOrder.id,
    orderNo: saleOrder.order_no,
    // 分仓：从任务自己的仓库扣库存，不再用整单头仓库
    warehouseId: task.warehouseId,
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
  assertCreditWithinLimit,
}
