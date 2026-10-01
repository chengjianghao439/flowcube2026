'use strict'
const AppError = require('../../utils/AppError')
const invalid = () => { throw new AppError('套单派发来源关系或数量不一致，请联系管理员核对', 409, 'SALE_COMMERCIAL_DISPATCH_SOURCE_INVALID') }
function units(value) {
  const n = Number(value), u = Math.round(n * 100)
  if (!Number.isFinite(n) || n < 0 || !Number.isSafeInteger(u) || Math.abs(n * 100 - u) > 1e-6) invalid()
  return u
}
// One batch includes even inactive/soft-deleted history; a broken join must not hide a fact.
async function load(conn, orderId, groups) {
  const [rows] = await conn.query(`SELECT dg.*, g.order_id AS group_order_id, g.warehouse_id AS group_warehouse_id,
      g.kind AS group_kind, g.superseded, wt.sale_order_id AS task_order_id, wt.task_type,
      wt.warehouse_id AS task_warehouse_id, wt.task_no, wt.status AS task_status, wt.deleted_at AS task_deleted_at
    FROM sale_dispatch_groups dg
    LEFT JOIN sale_commercial_groups g ON g.id=dg.group_id
    LEFT JOIN warehouse_tasks wt ON wt.id=dg.task_id
    WHERE dg.order_id=? OR g.order_id=? OR wt.sale_order_id=? ORDER BY dg.id`, [orderId, orderId, orderId])
  const byGroup = new Map(groups.map(g => [g.id, { confirmed: 0, outstanding: 0, allocated: 0, facts: [] }]))
  const facts = rows.map(r => {
    const qty = units(r.quantity), confirmed = r.confirmed_at != null
    if (!qty || Number(r.order_id) !== Number(orderId) || Number(r.group_order_id) !== Number(orderId)
      || Number(r.task_order_id) !== Number(orderId) || r.task_type !== 'sale_out'
      || Number(r.group_warehouse_id) !== Number(r.task_warehouse_id)
      || !['kit', 'ordinary'].includes(r.group_kind) || ![0, 1].includes(Number(r.active)) || (r.group_kind === 'kit' && !Number.isSafeInteger(Number(r.quantity)))
      || (confirmed && Number(r.task_status) !== 7) || (!confirmed && Number(r.active) === 1 && Number(r.task_status) === 7)) invalid()
    // replaceUnconfirmed withdraws old groups while retaining their WT link.
    // When that WT later ships, inactive/unconfirmed rows remain history only.
    const allocated = Number(r.active) === 1 && Number(r.task_status) !== 8 && r.task_deleted_at == null
    const outstanding = allocated && !confirmed
    const fact = { dispatchGroupId: Number(r.id), groupId: Number(r.group_id), taskId: Number(r.task_id),
      taskNo: r.task_no, warehouseId: Number(r.task_warehouse_id), taskStatus: Number(r.task_status),
      quantity: qty / 100, active: Number(r.active) === 1, confirmedAt: r.confirmed_at || null,
      confirmedShipped: confirmed, outstanding, allocated, taskDeletedAt: r.task_deleted_at || null }
    const group = byGroup.get(Number(r.group_id))
    if (!group && (!Number(r.superseded) || confirmed || allocated)) invalid()
    if (group) {
      group.confirmed += confirmed ? qty : 0
      group.outstanding += outstanding ? qty : 0
      group.allocated += allocated ? qty : 0
      group.facts.push(fact)
    }
    return fact
  })
  const projections = new Map(groups.map(g => {
    const p = byGroup.get(g.id), available = units(g.targetQty) - p.allocated
    if (available < 0 || ![p.confirmed, p.outstanding, p.allocated].every(Number.isSafeInteger)) invalid()
    return [g.id, { confirmedShippedQty: p.confirmed / 100, outstandingQty: p.outstanding / 100,
      activeAllocatedQty: p.allocated / 100, availableQty: available / 100, facts: p.facts }]
  }))
  return { projections, facts }
}
module.exports = { load }
