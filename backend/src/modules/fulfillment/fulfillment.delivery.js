const { getStockProjections } = require('../../engine/containerEngine')
const { getExpectedStock } = require('../../utils/expectedStock')
const { beijingTodayYmd } = require('../../utils/backendTime')
const { dateOnly, quantity, deliveryEstimate, isDeliveryLate } = require('./fulfillment.rules')
const { can, definitions } = require('./fulfillment.access')

async function commitments(conn, type, id) {
  const [rows] = await conn.query('SELECT * FROM order_delivery_commitments WHERE document_type=? AND document_id=? ORDER BY item_id', [type, id])
  return rows.map(r => ({ itemId: Number(r.item_id), promisedDate: dateOnly(r.promised_date), originalDate: dateOnly(r.original_date), processingDays: r.processing_days == null ? null : Number(r.processing_days) }))
}
async function saleDelivery(conn, order, user) {
  const dates = await commitments(conn, 'sale', order.id)
  const head = dates.find(d => d.itemId === 0)
  const [rows] = await conn.query(`SELECT i.*,COALESCE(i.warehouse_id,?) AS delivery_warehouse_id,
    COALESCE(i.warehouse_name,?) AS delivery_warehouse_name FROM sale_order_items i WHERE i.order_id=? ORDER BY i.id`, [order.warehouse_id, order.warehouse_name, order.id])
  const pairs = [...new Map(rows.map(i => [`${i.product_id}:${i.delivery_warehouse_id}`, { productId: Number(i.product_id), warehouseId: Number(i.delivery_warehouse_id) }])).values()]
  const expected = await getExpectedStock(conn, pairs)
  const [bindings] = await conn.query(`SELECT b.*,p.order_no,p.expected_date,p.status AS purchase_status,
    COALESCE((SELECT SUM(GREATEST(0,iti.received_qty-iti.putaway_qty)) FROM inbound_task_items iti
      JOIN inbound_tasks t ON t.id=iti.task_id WHERE iti.purchase_item_id=b.purchase_item_id AND t.deleted_at IS NULL AND t.status<>5),0) AS waiting_putaway
    FROM sale_order_expected_bindings b JOIN purchase_orders p ON p.id=b.purchase_order_id
    WHERE b.sale_order_id=? AND b.released_at IS NULL AND p.deleted_at IS NULL AND p.status IN (2,5) ORDER BY b.id`, [order.id])
  const [reserves] = await conn.query(`SELECT product_id,warehouse_id,SUM(qty) AS qty FROM stock_reservations
    WHERE ref_type='sale_order' AND ref_id=? AND status=1 GROUP BY product_id,warehouse_id`, [order.id])
  const stocks = await getStockProjections(conn, pairs)
  const budgets = new Map()
  for (const pair of pairs) {
    const key = `${pair.productId}:${pair.warehouseId}`
    const stock = stocks.get(key) || { quantity: 0, reserved: 0 }
    const own = Number(reserves.find(r => Number(r.product_id) === pair.productId && Number(r.warehouse_id) === pair.warehouseId)?.qty || 0)
    const ownBound = bindings.filter(b => Number(b.product_id) === pair.productId && Number(b.warehouse_id) === pair.warehouseId).reduce((n, b) => n + Number(b.qty), 0)
    const allPhysicalReserved = quantity(stock.reserved - (expected.boundByPair.get(key) || 0))
    budgets.set(key, { physical: Math.min(stock.quantity, quantity(own - ownBound) + quantity(stock.quantity - allPhysicalReserved)),
      sources: expected.items.filter(s => s.product_id === pair.productId && s.warehouse_id === pair.warehouseId).map(s => ({ ...s, remaining: s.burnable })) })
  }
  const [shipments] = await conn.query(`SELECT wti.product_id,wt.warehouse_id,MAX(wt.shipped_at) AS shipped_at
    FROM warehouse_tasks wt JOIN warehouse_task_items wti ON wti.task_id=wt.id
    WHERE wt.sale_order_id=? AND wt.task_type='sale_out' AND wt.status=7 AND wt.deleted_at IS NULL AND wti.picked_qty>0
    GROUP BY wti.product_id,wt.warehouse_id`, [order.id])
  const canPurchase = can(user, definitions.purchase.view)
  const today = beijingTodayYmd()
  const items = rows.map(row => {
    const itemId = Number(row.id)
    const ownDate = dates.find(d => d.itemId === itemId)
    const promisedDate = ownDate?.promisedDate || head?.promisedDate || null
    const processingDays = ownDate?.processingDays ?? head?.processingDays ?? null
    const remaining = [4, 5].includes(Number(order.status)) ? 0 : quantity(Number(row.quantity) - Number(row.shipped_qty || 0))
    const budget = budgets.get(`${row.product_id}:${row.delivery_warehouse_id}`)
    const bound = bindings.filter(b => Number(b.sale_order_item_id) === itemId)
    const boundQty = quantity(bound.reduce((n, b) => n + Number(b.qty), 0))
    const physical = Math.min(quantity(remaining - boundQty), budget.physical)
    budget.physical = quantity(budget.physical - physical)
    const sources = bound.map(b => ({ quantity: Number(b.qty), date: dateOnly(b.expected_date), unconfirmed: Number(b.purchase_status) === 5,
      orderId: canPurchase ? Number(b.purchase_order_id) : null, orderNo: canPurchase ? b.order_no : '关联采购（无查看权限）', bound: true,
      stage: Number(b.waiting_putaway) > 0 ? '已收待上架（含该采购其他需求）' : Number(b.purchase_status) === 5 ? '采购待审批' : '待到货' }))
    let need = quantity(remaining - physical - boundQty)
    for (const s of budget.sources) {
      const take = Math.min(need, s.remaining)
      if (!take) continue
      sources.push({ quantity: take, date: dateOnly(s.expected_date), orderId: canPurchase ? s.purchase_order_id : null,
        orderNo: canPurchase ? `采购 #${s.purchase_order_id}` : '候选采购（无查看权限）', bound: false, unconfirmed: true, stage: '候选供货，待占库确认' })
      need = quantity(need - take); s.remaining = quantity(s.remaining - take)
    }
    const estimate = deliveryEstimate({ remaining, physical, sources, processingDays, today })
    const shippedAt = shipments.find(s => Number(s.product_id) === Number(row.product_id) && Number(s.warehouse_id) === Number(row.delivery_warehouse_id))?.shipped_at
    const actualShipDate = shippedAt ? dateOnly(shippedAt) : null
    const deliveryOutcome = !promisedDate ? '未设承诺' : Number(row.shipped_qty || 0) > 0 && actualShipDate ? (actualShipDate > promisedDate ? '已发部分逾期' : remaining > 0 ? '已发部分按期' : '按期发完') : '尚无出库记录'
    const delayed = isDeliveryLate({ remaining, promisedDate, allDate: estimate.allDate, sources, today })
    return { id: itemId, productId: Number(row.product_id), productCode: row.product_code, productName: row.product_name,
      articleNumber: row.article_number, spec: row.spec, color: row.color, unit: row.unit,
      warehouseId: Number(row.delivery_warehouse_id), warehouseName: row.delivery_warehouse_name,
      remaining, actualShipDate, deliveryOutcome, physical: quantity(physical), boundQty, sources, promisedDate, processingDays, ...estimate, delayed,
      state: !remaining ? '已结束' : estimate.shortage > 0 ? '供应未覆盖' : boundQty > 0 ? '依赖采购' : physical >= remaining ? (Number(row.reserved_qty || 0) > 0 ? '现货可安排' : '有货待占库') : '候选供应待确认' }
  })
  const open = items.filter(i => i.remaining > 0)
  const knownFirst = open.map(i => i.firstDate).filter(Boolean).sort()
  return { commitments: dates, items, firstDate: knownFirst[0] || null,
    allDate: open.length && open.every(i => i.allDate) ? open.map(i => i.allDate).sort().at(-1) : null }
}
async function purchaseImpacts(conn, id, user) {
  if (!can(user, definitions.sale.view)) return []
  const [rows] = await conn.query(`SELECT b.sale_order_id AS saleId,s.order_no AS orderNo,s.warehouse_id,
    b.warehouse_id AS itemWarehouseId,b.sale_order_item_id AS itemId,b.qty AS quantity,i.product_code AS productCode,i.product_name AS productName,i.unit,
    COALESCE(dc.promised_date,dh.promised_date) AS promisedDate,p.expected_date AS expectedDate
    FROM sale_order_expected_bindings b JOIN sale_orders s ON s.id=b.sale_order_id
    JOIN sale_order_items i ON i.id=b.sale_order_item_id JOIN purchase_orders p ON p.id=b.purchase_order_id
    LEFT JOIN order_delivery_commitments dc ON dc.document_type='sale' AND dc.document_id=s.id AND dc.item_id=i.id
    LEFT JOIN order_delivery_commitments dh ON dh.document_type='sale' AND dh.document_id=s.id AND dh.item_id=0
    WHERE b.purchase_order_id=? AND b.released_at IS NULL AND s.deleted_at IS NULL AND s.status NOT IN (4,5)
    ${Array.isArray(user.warehouseIds) ? 'AND NOT EXISTS(SELECT 1 FROM sale_order_items other WHERE other.order_id=s.id AND COALESCE(other.warehouse_id,s.warehouse_id) NOT IN (?))' : ''}
    ORDER BY s.id,i.id,b.id`, [id, ...(Array.isArray(user.warehouseIds) ? [user.warehouseIds.length ? user.warehouseIds : [-1]] : [])])
  return rows.filter(r => !Array.isArray(user.warehouseIds) || (user.warehouseIds.includes(Number(r.warehouse_id)) && user.warehouseIds.includes(Number(r.itemWarehouseId))))
    .map(r => ({ ...r, quantity: Number(r.quantity), promisedDate: dateOnly(r.promisedDate), expectedDate: dateOnly(r.expectedDate) }))
}
module.exports = { commitments, saleDelivery, purchaseImpacts }
