'use strict'

const AppError = require('../../utils/AppError')
const { lockStatusRow, compareAndSetStatus } = require('../../utils/statusTransition')
const { assertStatusAction } = require('../../constants/documentStatusRules')
const { RT_STATUS } = require('../../constants/returnTaskStatus')
const { CONTAINER_STATUS } = require('../../engine/containerEngine')
const { getRequestId } = require('../../utils/requestContext')
const { RETURN_EVENT, record: recordReturnEvent } = require('./return-events.service')
const { adjustPaymentRecordForReturn } = require('./returns.helpers')
const purchaseCash = require('../purchase/purchase.cash-money')
const cash = require('../../utils/cashMoney')

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

module.exports = { syncPurchaseReturnShipped, syncSaleReturnReversedWithinTransaction }
