/** 当前页只读投影，不参与库存决策，不逐单查询。 */
async function loadSalePresentation(conn, ids) {
  const result = new Map(
    ids.map((id) => [
      Number(id),
      {
        quantitySummary: [],
        pendingAdjustment: false,
        pendingReturn: false,
        pendingCredit: false,
      },
    ]),
  )
  if (!ids.length) return result
  const [quantities] = await conn.query(
    `SELECT order_id, unit, SUM(quantity) AS ordered, SUM(reserved_qty) AS reserved,
            SUM(dispatched_qty) AS dispatched, SUM(shipped_qty) AS shipped
     FROM sale_order_items WHERE order_id IN (?) GROUP BY order_id, unit ORDER BY order_id, unit`,
    [ids],
  )
  for (const r of quantities)
    result.get(Number(r.order_id)).quantitySummary.push({
      unit: r.unit || '未标注单位',
      ordered: Number(r.ordered),
      reserved: Number(r.reserved),
      dispatched: Number(r.dispatched),
      shipped: Number(r.shipped),
    })
  const [tasks] = await conn.query(
    `SELECT sale_order_id, MAX(adjustment_requested_at IS NOT NULL) AS adjusting,
            MAX(cancel_requested_at IS NOT NULL) AS returning
     FROM warehouse_tasks WHERE sale_order_id IN (?) AND deleted_at IS NULL GROUP BY sale_order_id`,
    [ids],
  )
  for (const r of tasks)
    Object.assign(result.get(Number(r.sale_order_id)), {
      pendingAdjustment: !!Number(r.adjusting),
      pendingReturn: !!Number(r.returning),
    })
  const [credit] = await conn.query(
    'SELECT DISTINCT sale_order_id FROM sale_credit_overrides WHERE sale_order_id IN (?) AND status=2 AND deleted_at IS NULL',
    [ids],
  )
  for (const r of credit)
    result.get(Number(r.sale_order_id)).pendingCredit = true
  return result
}
module.exports = { loadSalePresentation }
