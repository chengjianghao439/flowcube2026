/**
 * 「在途预计量」计算 —— 采购订单预计到货量纳入销售占库判定（ATP）。
 *
 * 为何独立成 util 而不放进某模块：containerEngine / reservationEngine / sale / purchase /
 * inventory 多处都要用，且 containerEngine 不能被 purchase 反向 require（会循环）。
 * 本文件只接收连接对象作为入参，依赖方向干净。
 *
 * 口径：expected(product, warehouse) =
 *   采购单 status IN (2 已提交, 5 待审批) 的每个明细行 quantity
 *     − 该明细行已入库量（inbound_task_items.putaway_qty 且任务已审计未取消）
 *   - 已绑定给销售单的量（sale_order_expected_bindings 未释放部分）
 * 排除 status=3（已完成/短装结案，不再到货）、4（已取消）。
 * 每张采购单整单落一个到货仓（po.warehouse_id），已收量按其归属明细行上架量扣。
 */

/** 把一组 (productId, warehouseId) 对去重展开成 [ [productId, warehouseId], ... ] */
function pairParams(pairs) {
  const uniq = new Map()
  for (const p of pairs) uniq.set(`${Number(p.productId)}:${Number(p.warehouseId)}`, [Number(p.productId), Number(p.warehouseId)])
  return [...uniq.values()]
}

/**
 * 查询指定 (product, warehouse) 组合的预计量与可绑定明细。
 * @param {object} conn   事务连接或 pool
 * @param {Array<{productId:number, warehouseId:number}>} pairs
 * @returns {Promise<{
 *   byPair: Map<string, number>,        // `${productId}:${warehouseId}` -> expected（净可参与占用的在途量）
 *   items: Array<{product_id, warehouse_id, purchase_order_id, purchase_item_id, open_qty, bound_qty, burnable, expected_date}>
 * }>}
 */
async function getExpectedStock(conn, pairs) {
  const out = { byPair: new Map(), items: [] }
  const list = pairParams(pairs)
  if (!list.length) return out
  const productIds = [...new Set(list.map(p => p[0]))]

  const [rows] = await conn.query(
    `SELECT poi.product_id, po.warehouse_id, po.id AS purchase_order_id, poi.id AS purchase_item_id,
            poi.quantity AS ordered_qty, po.expected_date,
            COALESCE(rcd.putaway, 0) AS received_qty,
            COALESCE(bnd.bound_qty, 0) AS bound_qty
       FROM purchase_order_items poi
       JOIN purchase_orders po ON po.id = poi.order_id
       LEFT JOIN (
         SELECT iti.purchase_item_id, SUM(iti.putaway_qty) AS putaway
           FROM inbound_task_items iti
           JOIN inbound_tasks it ON it.id = iti.task_id
          WHERE it.status <> 5 AND it.audit_status = 1
          GROUP BY iti.purchase_item_id
       ) rcd ON rcd.purchase_item_id = poi.id
       LEFT JOIN (
         SELECT purchase_item_id, SUM(qty) AS bound_qty
           FROM sale_order_expected_bindings
          WHERE released_at IS NULL
          GROUP BY purchase_item_id
       ) bnd ON bnd.purchase_item_id = poi.id
      WHERE po.status IN (2, 5)
        AND poi.product_id IN (?) ORDER BY po.expected_date IS NULL, po.expected_date ASC, poi.id ASC`,
    [productIds],
  )

  // 只保留与目标 (product, warehouse) 匹配的行
  const pairSet = new Set(list.map(p => `${p[0]}:${p[1]}`))
  const perPairAgg = new Map()
  for (const r of rows) {
    const key = `${Number(r.product_id)}:${Number(r.warehouse_id)}`
    if (!pairSet.has(key)) continue
    const open = Math.max(0, Number(r.ordered_qty) - Number(r.received_qty))
    const bound = Number(r.bound_qty)
    const burnable = Math.max(0, open - bound)
    const expected = Math.max(0, open - bound)
    perPairAgg.set(key, (perPairAgg.get(key) ?? 0) + expected)
    if (burnable > 0) {
      out.items.push({
        product_id: Number(r.product_id),
        warehouse_id: Number(r.warehouse_id),
        purchase_order_id: Number(r.purchase_order_id),
        purchase_item_id: Number(r.purchase_item_id),
        open_qty: open,
        bound_qty: bound,
        burnable,
        expected_date: r.expected_date,
      })
    }
  }
  for (const p of list) {
    const key = `${p[0]}:${p[1]}`
    out.byPair.set(key, perPairAgg.get(key) ?? 0)
  }
  return out
}

/** 便捷：仅按 single pair 取预计量（供单个仓库判定） */
async function getExpectedForPair(conn, productId, warehouseId) {
  const r = await getExpectedStock(conn, [{ productId, warehouseId }])
  return r.byPair.get(`${Number(productId)}:${Number(warehouseId)}`) ?? 0
}

module.exports = { getExpectedStock, getExpectedForPair }
