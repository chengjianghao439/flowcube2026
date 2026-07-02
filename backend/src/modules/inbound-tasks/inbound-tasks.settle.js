const { assertStatusAction } = require('../../constants/documentStatusRules')
const { compareAndSetStatus } = require('../../utils/statusTransition')

/**
 * 重算并 upsert 某采购单的应付。
 *
 * 关键：**全量重算**（按该采购单下所有「已审核通过」收货订单的实际上架数量 × 采购单价求和），
 * 用 SET 覆盖而非累加——这样审核退回后重新通过、或多批到货多次结算都幂等，不会重复计账。
 * 金额=实收（上架）量，天然反映短装。依赖 payment_records 的 UNIQUE(type, order_id)（迁移 091）。
 */
async function recomputePurchasePayable(conn, purchaseOrderId) {
  const poId = Number(purchaseOrderId)
  if (!Number.isFinite(poId) || poId <= 0) return
  const [[po]] = await conn.query(
    'SELECT id, order_no, supplier_name FROM purchase_orders WHERE id = ?',
    [poId],
  )
  if (!po) return
  const [[{ amount }]] = await conn.query(
    `SELECT COALESCE(SUM(iti.putaway_qty * poi.unit_price), 0) AS amount
       FROM inbound_tasks it
       JOIN inbound_task_items iti ON iti.task_id = it.id
       JOIN purchase_order_items poi ON poi.id = iti.purchase_item_id
      WHERE it.purchase_order_id = ? AND it.deleted_at IS NULL
        AND it.status <> 5 AND it.audit_status = 1`,
    [poId],
  )
  const total = Number(amount) || 0
  if (total <= 0) return
  await conn.query(
    `INSERT INTO payment_records
       (type, order_id, order_no, party_name, total_amount, paid_amount, balance, status, due_date)
     VALUES (1, ?, ?, ?, ?, 0, ?, 1, DATE_ADD(NOW(), INTERVAL 30 DAY))
     ON DUPLICATE KEY UPDATE
       total_amount = VALUES(total_amount),
       balance = VALUES(total_amount) - paid_amount,
       status = CASE WHEN paid_amount >= VALUES(total_amount) THEN 3
                     WHEN paid_amount > 0 THEN 2 ELSE 1 END`,
    [poId, po.order_no, po.supplier_name, total, total],
  )
}

/**
 * 采购单是否「全部明细都已由已审核通过的收货订单收齐」且无未审核收货订单。
 * 满足则可自动完成；短装（未收齐）时返回 false，需人工「关闭剩余」结案。
 */
async function isPurchaseFullyReceivedAndAudited(conn, purchaseOrderId) {
  const poId = Number(purchaseOrderId)
  if (!Number.isFinite(poId) || poId <= 0) return false
  const [[{ pending }]] = await conn.query(
    `SELECT COUNT(*) AS pending FROM inbound_tasks
      WHERE purchase_order_id = ? AND deleted_at IS NULL AND status <> 5 AND audit_status <> 1`,
    [poId],
  )
  if (Number(pending) > 0) return false
  const [rows] = await conn.query(
    `SELECT poi.quantity,
            COALESCE(SUM(CASE WHEN it.status <> 5 AND it.audit_status = 1 THEN iti.putaway_qty ELSE 0 END), 0) AS ap
       FROM purchase_order_items poi
       LEFT JOIN inbound_task_items iti ON iti.purchase_item_id = poi.id
       LEFT JOIN inbound_tasks it ON it.id = iti.task_id
      WHERE poi.order_id = ?
      GROUP BY poi.id, poi.quantity`,
    [poId],
  )
  return rows.length > 0 && rows.every(r => Number(r.ap) >= Number(r.quantity))
}

/** 尝试把采购单推进到「已完成(3)」，已完成/状态不符则静默忽略（幂等）。 */
async function tryCompletePurchase(conn, purchaseOrderId) {
  const rule = assertStatusAction('purchase', 'complete', 2)
  try {
    await compareAndSetStatus(conn, {
      table: 'purchase_orders',
      id: Number(purchaseOrderId),
      fromStatus: rule.from,
      toStatus: rule.to,
      entityName: '采购单',
    })
  } catch (e) {
    if (e?.statusCode !== 409) throw e
  }
}

/**
 * 收货订单审核通过后的结算：重算该采购单应付；若已收齐且无待审核订单则自动完成。
 * 在 audit 的同一事务内调用。
 */
async function settlePurchaseOnAudit(conn, taskId) {
  const [[task]] = await conn.query(
    'SELECT purchase_order_id FROM inbound_tasks WHERE id = ?',
    [taskId],
  )
  const poId = Number(task?.purchase_order_id)
  if (!Number.isFinite(poId) || poId <= 0) return
  await recomputePurchasePayable(conn, poId)
  if (await isPurchaseFullyReceivedAndAudited(conn, poId)) {
    await tryCompletePurchase(conn, poId)
  }
}

module.exports = {
  recomputePurchasePayable,
  isPurchaseFullyReceivedAndAudited,
  tryCompletePurchase,
  settlePurchaseOnAudit,
}
