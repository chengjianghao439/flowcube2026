/**
 * 采购价格参考（P2-3）：建单/改单时对每个商品给出最近成交价参考，偏离超阈值则预警。
 *
 * 口径：同商品最近 3 次采购成交价（已确认/已完成订单的明细单价）的平均值。
 * 预警阈值：单价与均价偏差超过 PRICE_DEVIATION_WARN（默认 ±20%）。
 * 纯提示不阻断——价格是业务决策，系统只负责给参考，不替采购做决定。
 */
const { pool } = require('../config/db')

const DEVIATION_WARN = Number(process.env.PRICE_DEVIATION_WARN || 20) // 百分比

/**
 * @param {Array<{productId:number, unitPrice:number, productName?:string}>} items
 * @returns {Promise<Array<{productId:number, productName:string, avgPrice:number, count:number, deviationPct:number}>>}
 */
async function getPriceReferenceWarnings(items) {
  const rows = Array.isArray(items) ? items : []
  if (!rows.length) return []
  const productIds = [...new Set(rows.map((i) => Number(i.productId)).filter(Boolean))]
  if (!productIds.length) return []

  // 同商品最近 3 次成交价（已确认 2/已完成 3 的采购单明细）
  const [refs] = await pool.query(
    `SELECT poi.product_id,
            AVG(poi.unit_price) AS avg_price,
            COUNT(*) AS cnt
     FROM (
       SELECT poi2.product_id, poi2.unit_price
       FROM purchase_order_items poi2
       INNER JOIN purchase_orders po2 ON po2.id = poi2.order_id
       WHERE poi2.product_id IN (?) AND po2.deleted_at IS NULL AND po2.status IN (2, 3)
       ORDER BY poi2.id DESC
     ) poi
     GROUP BY poi.product_id`,
    [productIds],
  )
  const refMap = new Map(refs.map((r) => [Number(r.product_id), { avg: Number(r.avg_price), count: Number(r.cnt) }]))

  const warnings = []
  for (const item of rows) {
    const ref = refMap.get(Number(item.productId))
    if (!ref || ref.count === 0 || ref.avg <= 0) continue
    const price = Number(item.unitPrice) || 0
    if (price <= 0) continue
    const deviation = Math.round(((price - ref.avg) / ref.avg) * 1000) / 10
    if (Math.abs(deviation) >= DEVIATION_WARN) {
      warnings.push({
        productId: Number(item.productId),
        productName: item.productName || String(item.productId),
        avgPrice: Math.round(ref.avg * 100) / 100,
        count: ref.count,
        deviationPct: deviation,
      })
    }
  }
  return warnings
}

module.exports = { getPriceReferenceWarnings, DEVIATION_WARN }
