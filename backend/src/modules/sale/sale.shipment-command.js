'use strict'

const AppError = require('../../utils/AppError')
const { cashNumber, storedCashCents } = require('../../utils/cashMoney')
const { lockStatusRow, compareAndSetStatus } = require('../../utils/statusTransition')
const { assertStatusAction } = require('../../constants/documentStatusRules')
const { buildDueDateSql, normalizeSettlementType } = require('../../constants/settlementType')
const { calculateDiscountApplied } = require('./sale.contracts')
const { appendSaleEvent } = require('./sale.events')
const commercialMoney = require('./sale.commercial-money')
const ordinaryReturnMoney = require('./sale.ordinary-return-money')

// Invoked on the caller's transaction under the original sale/task/source locks.
// 应收全量重算：应收 = SUM(shipped_qty × unit_price)，每次出库后重算 upsert。
// 复用采购应付的幂等模式（见 inbound-tasks.settle.recomputePurchasePayable）——分批出库、
// 退货冲减任意顺序都不会重复计账。应收视为已确认（确认闸门只针对采购自动结算的应付）。
async function recomputeSaleReceivable(conn, saleOrderId, ordinaryReturnContext=null) {
  const [[{ amount:legacyAmount }]] = await conn.query(
    'SELECT COALESCE(SUM(shipped_qty * unit_price), 0) AS amount FROM sale_order_items WHERE order_id = ?',
    [saleOrderId],
  )
  const amount=ordinaryReturnContext
    ? await ordinaryReturnMoney.currentShippedGross(conn,ordinaryReturnContext) : legacyAmount
  const [[model]] = await conn.query('SELECT commercial_model FROM sale_orders WHERE id=?',[saleOrderId])
  if(model?.commercial_model!=='kit-v1'&&!ordinaryReturnContext)throw new AppError('普通销售缺少库存动作前的分位成交依据，请核对原单',409,'SALE_RETURN_NET_BASIS_REQUIRED')
  if(model?.commercial_model === 'kit-v1'){const [[ar]]=await conn.query('SELECT id,total_amount,paid_amount,balance FROM payment_records WHERE type=2 AND order_id=? FOR UPDATE',[saleOrderId]);if(ar)for(const field of ['total_amount','paid_amount','balance'])storedCashCents(ar[field],`原套单应收${field}`)}
  const money = model?.commercial_model === 'kit-v1' ? await commercialMoney.orderMoney(conn,saleOrderId) : null
  let ordinaryMoney=null
  if(model?.commercial_model!=='kit-v1'&&ordinaryReturnContext){
    const [[currentAR]]=await conn.query('SELECT id,total_amount,paid_amount,balance FROM payment_records WHERE type=2 AND order_id=? FOR UPDATE',[saleOrderId])
    ordinaryReturnMoney.assertReceivableRow(ordinaryReturnContext,currentAR)
    ordinaryMoney=await ordinaryReturnMoney.orderMoney(conn,saleOrderId,ordinaryReturnContext)
  }
  const grossTotal = money ? money.shippedGross : Number(amount) || 0
  // 整单折扣（P2-4）：按发货比例分摊折扣到已发部分。总折扣 × (已发原值 / 订单原值)，
  // 分批发货时只扣已发那部分的折扣，未发部分留到后续批次。
  const [[{ orderTotal, discount }]] = await conn.query(
    `SELECT COALESCE(so.total_amount, 0) AS orderTotal,
            COALESCE(so.discount_amount, 0) AS discount
     FROM sale_orders so
     WHERE so.id = ?`,
    [saleOrderId],
  )
  const discountApplied = calculateDiscountApplied({
    discount:ordinaryMoney ? ordinaryMoney.basis.discount_basis : discount,
    shippedGross: grossTotal,
    orderGross: ordinaryMoney ? ordinaryMoney.basis.gross_basis : orderTotal,
  })
  // 扣除该销售单下所有「已执行(3)」的销售退货金额（与采购应付 recomputePurchasePayable 对称）。
  // 否则分批/分仓发货时，中途完成的销售退货冲减（syncSaleReturnCompleted 增量减）会被下一批
  // 出库的全量重算覆盖回全额，客户被静默多计应收——这正是采购侧 P0-1 的销售镜像。
  // 口径：按实际质检合格入库量（checked_qty − rejected_qty）× 退货单价，与 syncSaleReturnCompleted
  // 严格一致（质检不合格部分不退客户，业务决策 2026-07-28）；全量覆盖不与增量叠加，故不双重扣。
  const [[{ returnedAmount }]] = await conn.query(
    `SELECT COALESCE(SUM((rti.checked_qty - rti.rejected_qty) * sri.unit_price), 0) AS returnedAmount
       FROM sale_returns sr
       JOIN return_tasks rt ON rt.return_id = sr.id AND rt.return_type = 'sale' AND rt.deleted_at IS NULL
       JOIN return_task_items rti ON rti.task_id = rt.id
       JOIN sale_return_items sri ON sri.id = rti.return_item_id
      WHERE sr.sale_order_id = ? AND sr.deleted_at IS NULL AND sr.status = 3`,
    [saleOrderId],
  )
  const total = ordinaryMoney
    ? ordinaryReturnMoney.receivableTotal(ordinaryMoney.basis,amount,ordinaryMoney.returnedFinancial)
    : money?cashNumber(storedCashCents(money.netEarned)-storedCashCents(money.returnedFinancial)):Math.max(0,grossTotal-(Number(returnedAmount)||0)-discountApplied)
  if (total <= 0) {
    const [[existing]] = await conn.query('SELECT id FROM payment_records WHERE type = 2 AND order_id = ?', [saleOrderId])
    if (!existing) return
  }
  const [[row]] = await conn.query(
    `SELECT so.order_no, so.customer_name, so.created_at,
            COALESCE(c.settlement_type, 2) AS settlement_type,
            COALESCE(c.payment_terms_days, 30) AS terms
     FROM sale_orders so LEFT JOIN sale_customers c ON c.id = so.customer_id WHERE so.id = ?`,
    [saleOrderId],
  )
  if (!row) return
  // 到期日按客户主数据的结算方式 + 账期天数计算：现结从销售单创建日起算，
  // 月结从本次出库结算时刻起算（见 constants/settlementType.js 的对照表）。
  //
  // settlement_type 与 due_date 一样只在首次 INSERT 时写入，**不在分批发货重算时更新**：
  // 账款是历史事实，当初按什么条件结算就是什么条件；之后把客户从现结改成月结，
  // 不该把这批老账追溯改写成月结（迁移 136）。后续批次只重算金额。
  const settlementSnapshot = normalizeSettlementType(row.settlement_type)
  const due = buildDueDateSql(settlementSnapshot, row.terms, row.created_at)
  await conn.query(
    `INSERT INTO payment_records (type, order_id, order_no, party_name, total_amount, paid_amount, balance, status, confirm_status, settlement_type, due_date)
     VALUES (2, ?, ?, ?, ?, 0, ?, 1, 1, ?, ${due.expr})
     ON DUPLICATE KEY UPDATE
       total_amount = VALUES(total_amount),
       balance = GREATEST(0, VALUES(total_amount) - paid_amount),
       status = CASE WHEN paid_amount >= VALUES(total_amount) THEN 3
                     WHEN paid_amount > 0 THEN 2 ELSE 1 END`,
    [saleOrderId, row.order_no, row.customer_name, total, total, settlementSnapshot, ...due.params],
  )
}

// 某个仓库任务出库完成时的回调：累加该任务实发量到对应明细行 shipped_qty、重算应收、
// 判断整单是否全部发完（所有行 shipped_qty>=quantity）。全发完 → 3→4；否则订单留在 3（履约中）。
// 单仓订单只有一个任务，一次就全发完，行为与旧版一致。
async function recordShippedWarehouseTask(conn, id, { taskId = null, taskNo = null,ordinaryReturnContext=null } = {}) {
  const orderRow = await lockStatusRow(conn, {
    table: 'sale_orders',
    id,
    columns: 'id, order_no, status, task_id, task_no, warehouse_id',
    entityName: '销售单',
  })

  // 1. 累加本任务实发量：按 warehouse_task_items.picked_qty 回写到对应明细行
  //    （一个商品只在一个仓库，用 product_id + 任务仓库 精确定位明细行）
  if (taskId) {
    const [[task]] = await conn.query('SELECT warehouse_id FROM warehouse_tasks WHERE id = ?', [taskId])
    const taskWhId = task ? Number(task.warehouse_id) : Number(orderRow.warehouse_id)
    const [taskItems] = await conn.query(
      'SELECT product_id, picked_qty FROM warehouse_task_items WHERE task_id = ?',
      [taskId],
    )
    for (const ti of taskItems) {
      await conn.query(
        `UPDATE sale_order_items
         SET shipped_qty = LEAST(quantity, shipped_qty + ?)
         WHERE order_id = ? AND product_id = ? AND warehouse_id = ?`,
        [Number(ti.picked_qty), id, ti.product_id, taskWhId],
      )
    }
  }

  // 2. 应收全量重算（按实发汇总）
  await recomputeSaleReceivable(conn, id,ordinaryReturnContext)

  // 3. 判断整单是否全部发完
  const [[{ pending }]] = await conn.query(
    'SELECT COUNT(*) AS pending FROM sale_order_items WHERE order_id = ? AND shipped_qty < quantity',
    [id],
  )
  const allShipped = Number(pending) === 0

  if (allShipped) {
    const rule = assertStatusAction('sale', 'completeShip', orderRow.status)
    await compareAndSetStatus(conn, {
      table: 'sale_orders',
      id,
      fromStatus: rule.from,
      toStatus: rule.to,
      entityName: '销售单',
    })
    await appendSaleEvent(
      conn, id, 'warehouse_shipped', '已完成出库',
      `销售单 ${orderRow.order_no} 已全部出库`,
      null,
      { taskId: taskId != null ? Number(taskId) : null, taskNo: taskNo || null },
    )
    return { orderRow, status: rule.to }
  }

  // 部分出库：订单保持"履约中(3)"，等其余仓库任务陆续出库
  await appendSaleEvent(
    conn, id, 'warehouse_partial_shipped', '部分出库',
    `销售单 ${orderRow.order_no} 部分商品已出库，仍有未发部分`,
    null,
    { taskId: taskId != null ? Number(taskId) : null, taskNo: taskNo || null },
  )
  return { orderRow, status: Number(orderRow.status) }
}

async function snapshotShippedCosts(conn, saleOrderId, warehouseId, items) {
  // COGS 成本快照：本任务所发物料行仅在首次 cost_snapshot 为空时固化；
  // 已有快照保持。利润分析用原销售行快照口径，避免改进价导致历史毛利漂移。
  for (const item of items) {
    await conn.query(
      `UPDATE sale_order_items soi
       JOIN product_items p ON p.id = soi.product_id
       SET soi.cost_snapshot = COALESCE(p.avg_cost, NULLIF(p.cost_price, 0))
       WHERE soi.order_id = ? AND soi.product_id = ? AND soi.warehouse_id = ? AND soi.cost_snapshot IS NULL`,
      [saleOrderId, item.productId, warehouseId],
    )
  }
}

module.exports = { recordShippedWarehouseTask, recomputeSaleReceivable, snapshotShippedCosts }
