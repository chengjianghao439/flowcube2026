/**
 * 客户授信口径（文档 05）。集中一处实现，供占库校验、客户用信接口、看板复用，避免口径漂移。
 *
 * 已用授信 = 未清应收余额(A) + 在途订单敞口(B)。
 * 必须传事务连接 conn：额度校验要在客户行锁 FOR UPDATE 内、同一事务读，才能挡住
 * "同客户两单并发都读到旧已用值、双双放行、合计超限"的竞态（CLAUDE.md 第 11 节）。
 */

async function getCustomerCreditUsed(conn, customerId) {
  // (A) 未清应收：payment_records type=2 未付清的 balance，经 order_id→sale_orders.customer_id 归户
  //     （payment_records 无 customer_id 列，只能按订单归户；应收全由销售单产生，此 JOIN 可靠）
  const [[a]] = await conn.query(
    `SELECT COALESCE(SUM(pr.balance), 0) AS used
     FROM payment_records pr
     JOIN sale_orders so ON so.id = pr.order_id
     WHERE pr.type = 2 AND pr.status IN (1, 2) AND so.customer_id = ?`,
    [customerId],
  )
  // (B) 在途敞口：已占库(2)/拣货中(3)订单的 (订单总额 − 已生成应收总额)，防与(A)双算
  //     已发货部分已进(A)，这里减掉；已占库未发货部分应收为 0，全额计入敞口
  const [[b]] = await conn.query(
    `SELECT COALESCE(SUM(GREATEST(0, so.total_amount - COALESCE(pr.total_amount, 0))), 0) AS used_open
     FROM sale_orders so
     LEFT JOIN payment_records pr ON pr.type = 2 AND pr.order_id = so.id
     WHERE so.customer_id = ? AND so.status IN (2, 3) AND so.deleted_at IS NULL`,
    [customerId],
  )
  return Math.round((Number(a.used) + Number(b.used_open)) * 10000) / 10000
}

/** 当前操作者是否有超额放行权限（回查角色权限，自包含不依赖中间件；超管 roleId=1 恒有） */
async function hasCreditOverridePermission(conn, operator) {
  if (Number(operator?.roleId) === 1) return true
  if (operator?.roleId == null) return false
  const [rows] = await conn.query(
    'SELECT 1 FROM sys_role_permissions WHERE role_id=? AND permission=? LIMIT 1',
    [operator.roleId, 'sale.credit.override'],
  )
  return rows.length > 0
}

module.exports = { getCustomerCreditUsed, hasCreditOverridePermission }
