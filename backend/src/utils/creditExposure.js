/**
 * 客户授信口径（文档 05）。集中一处实现，供占库校验、客户用信接口、看板复用，避免口径漂移。
 *
 * 已用授信 = 未清应收余额(A) + 在途订单敞口(B)。
 * 必须传事务连接 conn：额度校验要在客户行锁 FOR UPDATE 内、同一事务读，才能挡住
 * "同客户两单并发都读到旧已用值、双双放行、合计超限"的竞态（docs/claude-md-archive-2026-09-04.md 第 11 节）。
 */

async function getCustomerCreditUsed(conn, customerId, { excludeSaleOrderId = null } = {}) {
  const excludeSql = excludeSaleOrderId != null ? ' AND so.id <> ?' : ''
  const params = excludeSaleOrderId != null ? [customerId, Number(excludeSaleOrderId)] : [customerId]
  // (A) 未清应收：payment_records type=2 未付清的 balance，经 order_id→sale_orders.customer_id 归户
  //     （payment_records 无 customer_id 列，只能按订单归户；应收全由销售单产生，此 JOIN 可靠）
  const [[a]] = await conn.query(
    `SELECT COALESCE(SUM(pr.balance), 0) AS used
     FROM payment_records pr
     JOIN sale_orders so ON so.id = pr.order_id
     WHERE pr.type = 2 AND pr.status IN (1, 2) AND so.customer_id = ?${excludeSql}`,
    params,
  )
  // (B) 在途敞口：已占库(2)/部分占库(6)/拣货中(3)订单的 (订单总额 − 已生成应收总额)，防与(A)双算
  //     已发货部分已进(A)，这里减掉；已占库未发货部分应收为 0，全额计入敞口
  const [[b]] = await conn.query(
    `SELECT COALESCE(SUM(GREATEST(0, (so.total_amount - COALESCE(so.discount_amount, 0)) - COALESCE(pr.total_amount, 0))), 0) AS used_open
     FROM sale_orders so
     LEFT JOIN payment_records pr ON pr.type = 2 AND pr.order_id = so.id
     WHERE so.customer_id = ? AND so.status IN (2, 3, 6) AND so.deleted_at IS NULL${excludeSql}`,
    params,
  )
  return Math.round((Number(a.used) + Number(b.used_open)) * 10000) / 10000
}

// Fixed-size batch for approved-request lists. Same A+B source predicates as
// above; subtract each order's contribution before converting exact DECIMAL4.
async function getCustomerCreditUsedForOrders(db, orders) {
  if (!orders.length) return new Map()
  const { moneyUnits, moneyNumber } = require('./decimalMoney')
  const customerIds = [...new Set(orders.map(o => Number(o.customer_id)))]
  const [rows] = await db.query(`SELECT customer_id,order_id,SUM(amount) AS used FROM (
    SELECT so.customer_id,so.id AS order_id,pr.balance AS amount
    FROM payment_records pr JOIN sale_orders so ON so.id=pr.order_id
    WHERE pr.type=2 AND pr.status IN (1,2) AND so.customer_id IN (?)
    UNION ALL
    SELECT so.customer_id,so.id,GREATEST(0,(so.total_amount-COALESCE(so.discount_amount,0))-COALESCE(pr.total_amount,0))
    FROM sale_orders so LEFT JOIN payment_records pr ON pr.type=2 AND pr.order_id=so.id
    WHERE so.customer_id IN (?) AND so.status IN (2,3,6) AND so.deleted_at IS NULL
  ) credit_parts GROUP BY customer_id,order_id`, [customerIds,customerIds])
  const totals = new Map(), own = new Map()
  for (const r of rows) {
    const amount = moneyUnits(r.used ?? 0)
    totals.set(Number(r.customer_id),(totals.get(Number(r.customer_id)) || 0n)+amount)
    own.set(Number(r.order_id),amount)
  }
  return new Map(orders.map(o => [Number(o.id),moneyNumber((totals.get(Number(o.customer_id)) || 0n)-(own.get(Number(o.id)) || 0n))]))
}

module.exports = { getCustomerCreditUsed, getCustomerCreditUsedForOrders }
