/**
 * 销售 ATP：expected 是已提交/待审批采购的「尚未上架总量」，不是扣除绑定后的净量。
 * available = ACTIVE 现货 + expected - 全部有效预占，绑定不能再扣第二次。
 * 绑定只记录未兑现的采购依赖：上架转为现货预占，出库/释放按量解除，均不额外扣 reserved。
 */
const qty = value => Math.round(Number(value) * 10000) / 10000

function pairParams(pairs) {
  return [...new Map(pairs.map(p => [`${Number(p.productId)}:${Number(p.warehouseId)}`,
    [Number(p.productId), Number(p.warehouseId)]])).values()]
}

/** 销售占库先锁全部候选采购主单，再按商品/仓库锁库存，与入库的采购→库存顺序一致。 */
async function lockExpectedPurchaseOrders(conn, pairs) {
  const list = pairParams(pairs)
  if (!list.length) return
  await conn.query(
    `SELECT po.id FROM purchase_orders po JOIN purchase_order_items poi ON poi.order_id=po.id
     WHERE po.deleted_at IS NULL AND po.status IN (2,5)
       AND (poi.product_id,po.warehouse_id) IN (${list.map(() => '(?,?)').join(',')})
     ORDER BY po.id,poi.id FOR UPDATE`, list.flat(),
  )
}

/** lock=true 使用当前读，避免事务早先快照漏看刚提交的上架/销售绑定。 */
async function getExpectedStock(conn, pairs, { lock = false } = {}) {
  const list = pairParams(pairs)
  const out = { byPair: new Map(), boundByPair: new Map(), items: [], supplyItems: [] }
  if (!list.length) return out
  const [rows] = await conn.query(
    `SELECT poi.product_id,po.warehouse_id,po.id AS purchase_order_id,poi.id AS purchase_item_id,
            poi.quantity AS ordered_qty,po.expected_date
     FROM purchase_orders po JOIN purchase_order_items poi ON poi.order_id=po.id
     WHERE po.deleted_at IS NULL AND po.status IN (2,5)
       AND (poi.product_id,po.warehouse_id) IN (${list.map(() => '(?,?)').join(',')})
     ORDER BY po.expected_date IS NULL,po.expected_date,poi.id${lock ? ' FOR UPDATE' : ''}`, list.flat(),
  )
  const ids = rows.map(r => Number(r.purchase_item_id))
  const received = new Map(), bound = new Map()
  if (ids.length) {
    // 只锁明细，不锁 inbound_tasks：上架先持任务锁再等采购锁，反向锁任务会成环。
    const [receivedRows] = await conn.query(
      `SELECT iti.purchase_item_id,iti.putaway_qty FROM inbound_task_items iti
       JOIN inbound_tasks it ON it.id=iti.task_id
       WHERE iti.purchase_item_id IN (?) AND it.deleted_at IS NULL AND it.status<>5
       ${lock ? 'FOR UPDATE OF iti' : ''}`, [ids],
    )
    for (const row of receivedRows) received.set(Number(row.purchase_item_id), qty((received.get(Number(row.purchase_item_id)) || 0) + Number(row.putaway_qty)))
    const [bindings] = await conn.query(
      `SELECT purchase_item_id,qty FROM sale_order_expected_bindings
       WHERE purchase_item_id IN (?) AND released_at IS NULL${lock ? ' FOR UPDATE' : ''}`, [ids],
    )
    for (const row of bindings) bound.set(Number(row.purchase_item_id), qty((bound.get(Number(row.purchase_item_id)) || 0) + Number(row.qty)))
  }
  for (const r of rows) {
    const key = `${Number(r.product_id)}:${Number(r.warehouse_id)}`
    const open = Math.max(0, qty(Number(r.ordered_qty) - (received.get(Number(r.purchase_item_id)) || 0)))
    const boundQty = bound.get(Number(r.purchase_item_id)) || 0
    out.byPair.set(key, qty((out.byPair.get(key) || 0) + open))
    out.boundByPair.set(key, qty((out.boundByPair.get(key) || 0) + boundQty))
    if (open > 0) out.supplyItems.push({ productId: Number(r.product_id), warehouseId: Number(r.warehouse_id), quantity: open, expectedDate: r.expected_date || null })
    const burnable = Math.max(0, qty(open - boundQty))
    if (burnable > 0) out.items.push({
      product_id: Number(r.product_id), warehouse_id: Number(r.warehouse_id),
      purchase_order_id: Number(r.purchase_order_id), purchase_item_id: Number(r.purchase_item_id),
      open_qty: open, bound_qty: boundQty, burnable, expected_date: r.expected_date,
    })
  }
  for (const [productId, warehouseId] of list) {
    const key = `${productId}:${warehouseId}`
    if (!out.byPair.has(key)) out.byPair.set(key, 0)
  }
  return out
}

async function getExpectedForPair(conn, productId, warehouseId, options) {
  const result = await getExpectedStock(conn, [{ productId, warehouseId }], options)
  return result.byPair.get(`${Number(productId)}:${Number(warehouseId)}`) || 0
}

/** 在持有库存维度锁的事务内，将已兑现/释放的依赖按 FIFO 关闭；部分保留未兑现量。 */
async function reduceExpectedBindings(conn, { purchaseItemId, saleOrderId, productId, warehouseId }, amount) {
  let remaining = qty(amount)
  if (!(remaining > 0)) return
  const conditions = ['released_at IS NULL'], params = []
  if (purchaseItemId != null) { conditions.push('purchase_item_id=?'); params.push(purchaseItemId) }
  else { conditions.push('sale_order_id=? AND product_id=? AND warehouse_id=?'); params.push(saleOrderId, productId, warehouseId) }
  const [bindings] = await conn.query(
    `SELECT id,qty FROM sale_order_expected_bindings WHERE ${conditions.join(' AND ')} ORDER BY id FOR UPDATE`, params,
  )
  for (const binding of bindings) {
    if (remaining <= 0) break
    const take = Math.min(Number(binding.qty), remaining)
    if (take >= Number(binding.qty)) await conn.query('UPDATE sale_order_expected_bindings SET released_at=NOW() WHERE id=?', [binding.id])
    else await conn.query('UPDATE sale_order_expected_bindings SET qty=qty-? WHERE id=?', [take, binding.id])
    remaining = qty(remaining - take)
  }
}

module.exports = { getExpectedStock, getExpectedForPair, lockExpectedPurchaseOrders, reduceExpectedBindings }
