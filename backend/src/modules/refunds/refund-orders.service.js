/**
 * 已收款退货退款单（P2-6）：专用红冲退款链路。
 *
 * 背景：销售退货在「已登记收款 > 退货冲减后账款总额」时被 returns.helpers 的负余额
 * 守卫硬拦截（提示「请先处理退款」），此前系统没有退款功能，已收款的退货直接卡死。
 * 本模块提供退款单：把多收的钱退还给客户，退款完成后退货链路即可通过。
 *
 * 状态机（documentStatusRules.refundOrder）：1草稿 → 2已确认 → 3已完成 / 4已取消。
 *
 * 执行退款语义（execute，事务内）：
 *   1. 锁退款单 + 锁关联 payment_records（FOR UPDATE）
 *   2. 校验退款金额 ≤ 已收金额（paid_amount）
 *   3. paid_amount -= 退款额，balance += 退款额，重算 status
 *   4. 写负向 payment_entries（退款留痕，与收款登记对称）
 *   5. 资金账户 OUT（BIZ_TYPE.REFUND）——钱出去与单据状态同生共死（同报销付款）
 *   6. 退款单 → 已完成
 * 幂等：执行走 compareAndSetStatus（2→3），重复执行 409。
 *
 * 负余额口径：退款金额上限是「已收金额」，不是账款总额——把已收的多退部分退回即可，
 * 不允许把尚未收到的钱也退掉（那会造成账款倒挂）。
 */

const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const { generateDailyCode } = require('../../utils/codeGenerator')
const { lockStatusRow, compareAndSetStatus } = require('../../utils/statusTransition')
const { assertStatusAction } = require('../../constants/documentStatusRules')
const { getRequestId } = require('../../utils/requestContext')
const { PAYMENT_EVENT, record: recordPaymentEvent } = require('../payments/payment-events.service')
const statementSvc = require('../payments/reconciliation-statements.service')
const accountSvc = require('../finance/finance-accounts.service')
const { normalizePagination } = require('../../utils/pagination')
const { assertInScope, scopeFilter } = require('../../utils/warehouseScope')

const STATUS = { 1: '草稿', 2: '已确认', 3: '已完成', 4: '已取消' }
const genNo = conn => generateDailyCode(conn, 'RF', 'refund_orders', 'refund_no')

const fmt = r => ({
  id: r.id,
  refundNo: r.refund_no,
  saleOrderId: r.sale_order_id,
  saleOrderNo: r.sale_order_no,
  customerName: r.customer_name,
  amount: Number(r.amount),
  status: r.status,
  statusName: STATUS[r.status] || '未知',
  paymentRecordId: r.payment_record_id,
  accountId: r.account_id,
  refundDate: r.refund_date,
  remark: r.remark,
  operatorId: r.operator_id,
  operatorName: r.operator_name,
  confirmedByName: r.confirmed_by_name,
  confirmedAt: r.confirmed_at,
  refundedAt: r.refunded_at,
  createdAt: r.created_at,
})

async function findAll({ page = 1, pageSize = 20, keyword = '', status = null, startDate = null, endDate = null, scopeWarehouseIds = null } = {}) {
  const { pageSize: ps, offset } = normalizePagination({ page, pageSize })
  const conds = ['ro.deleted_at IS NULL']
  const params = []
  if (keyword) { conds.push('(ro.refund_no LIKE ? OR ro.sale_order_no LIKE ? OR ro.customer_name LIKE ?)'); const k = `%${keyword}%`; params.push(k, k, k) }
  if (status) { conds.push('ro.status = ?'); params.push(Number(status)) }
  if (startDate) { conds.push('ro.created_at >= ?'); params.push(`${startDate} 00:00:00`) }
  if (endDate) { conds.push('ro.created_at <= ?'); params.push(`${endDate} 23:59:59`) }
  // 限仓用户只能看到本仓销售单对应的退款单
  const scope = scopeFilter(scopeWarehouseIds, 'so.warehouse_id')
  if (scope.sql) { conds.push(scope.sql); params.push(...scope.params) }
  const where = conds.join(' AND ')
  const joins = 'LEFT JOIN sale_orders so ON so.id = ro.sale_order_id'
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM refund_orders ro ${joins} WHERE ${where}`, params)
  const [rows] = await pool.query(
    `SELECT ro.* FROM refund_orders ro ${joins} WHERE ${where} ORDER BY ro.created_at DESC LIMIT ? OFFSET ?`,
    [...params, ps, offset],
  )
  return { list: rows.map(fmt), pagination: { page, pageSize: ps, total: Number(total) } }
}

async function findById(id, scopeWarehouseIds = null) {
  const [[row]] = await pool.query('SELECT * FROM refund_orders WHERE id = ? AND deleted_at IS NULL', [Number(id)])
  if (!row) throw new AppError('退款单不存在', 404)
  // 读路径越权防护：按关联销售单仓库校验（超管/不限仓放行）
  if (Array.isArray(scopeWarehouseIds)) {
    const [[sale]] = await pool.query('SELECT warehouse_id FROM sale_orders WHERE id = ?', [row.sale_order_id])
    assertInScope(scopeWarehouseIds, sale?.warehouse_id ?? null, '退款单')
  }
  return fmt(row)
}

/**
 * 新建退款单（草稿）。
 * @param {object} d - { saleOrderId?, saleOrderNo?, amount, accountId, refundDate, remark }
 *   saleOrderId 与 saleOrderNo 二选一（前端弱关联输入单号，后端按单号反查）。
 * 金额校验：≤ 该销售单已收金额（paid_amount，FOR UPDATE 读，避免并发下超退）。
 */
async function create(d, operator, scopeWarehouseIds = null) {
  const saleOrderId = Number(d.saleOrderId)
  const saleOrderNo = String(d.saleOrderNo ?? '').trim()
  const amount = Number(d.amount)
  if (!(Number.isInteger(saleOrderId) && saleOrderId > 0) && !saleOrderNo) {
    throw new AppError('请选择关联销售单', 400)
  }
  if (!Number.isFinite(amount) || amount <= 0) throw new AppError('退款金额必须大于 0', 400)

  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    // 反查销售单并取账款已收金额（payment_records 无 deleted_at）。有 id 用 id，否则按单号
    const cond = Number.isInteger(saleOrderId) && saleOrderId > 0 ? 'so.id = ?' : 'so.order_no = ?'
    const condParam = Number.isInteger(saleOrderId) && saleOrderId > 0 ? saleOrderId : saleOrderNo
    const [[sale]] = await conn.query(
      `SELECT so.id AS sale_order_id, so.order_no, so.warehouse_id, so.customer_name, pr.id AS payment_record_id, pr.paid_amount
         FROM sale_orders so
         LEFT JOIN payment_records pr ON pr.type = 2 AND pr.order_id = so.id
        WHERE ${cond} AND so.deleted_at IS NULL`,
      [condParam],
    )
    if (!sale) throw new AppError('关联销售单不存在', 404)
    // 跨仓校验：只允许给本仓销售单建退款
    assertInScope(scopeWarehouseIds, sale.warehouse_id, '销售单')
    const paid = Number(sale.paid_amount || 0)
    if (amount > paid + 1e-6) {
      throw new AppError(`退款金额 ¥${amount.toFixed(2)} 超过该销售单已收金额 ¥${paid.toFixed(2)}`, 400, 'REFUND_EXCEED_PAID')
    }

    const refundNo = await genNo(conn)
    const [r] = await conn.query(
      `INSERT INTO refund_orders
         (refund_no, sale_order_id, sale_order_no, customer_name, amount, status,
          payment_record_id, account_id, refund_date, remark, operator_id, operator_name)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)`,
      [refundNo, sale.sale_order_id, sale.order_no, sale.customer_name, amount,
       sale.payment_record_id || null, d.accountId || null, d.refundDate || null, d.remark || null,
       operator?.userId || null, operator?.realName || operator?.username || null],
    )
    await conn.commit()
    return { id: r.insertId, refundNo }
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }
}

/**
 * 锁单后按关联销售单仓库做范围校验（submit/execute/cancel 共用）。
 * 超管/不限仓（scopeWarehouseIds 非数组）直接放行。
 */
async function assertRefundInScope(conn, scopeWarehouseIds, refundId) {
  if (!Array.isArray(scopeWarehouseIds)) return
  const [[refund]] = await conn.query('SELECT sale_order_id FROM refund_orders WHERE id=?', [refundId])
  if (!refund?.sale_order_id) throw new AppError('退款单未关联销售单，无法校验仓库范围', 403, 'WAREHOUSE_SCOPE_DENIED')
  const [[sale]] = await conn.query('SELECT warehouse_id FROM sale_orders WHERE id=?', [refund.sale_order_id])
  assertInScope(scopeWarehouseIds, sale?.warehouse_id ?? null, '退款单')
}

/** 确认退款：草稿 → 已确认（财务认可金额后进入可执行态） */
async function submit(id, operator, scopeWarehouseIds = null) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const row = await lockStatusRow(conn, { table: 'refund_orders', id, columns: 'id, status', entityName: '退款单' })
    await assertRefundInScope(conn, scopeWarehouseIds, id)
    const rule = assertStatusAction('refundOrder', 'submit', row.status)
    await compareAndSetStatus(conn, { table: 'refund_orders', id, fromStatus: rule.from, toStatus: rule.to, entityName: '退款单' })
    await conn.query(
      'UPDATE refund_orders SET confirmed_by=?, confirmed_by_name=?, confirmed_at=NOW() WHERE id=?',
      [operator?.userId || null, operator?.realName || operator?.username || null, id],
    )
    await conn.commit()
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }
}

/**
 * 执行退款：已确认 → 已完成。事务内做四件事（同生共死）：
 *   锁账款 → 校验 → 冲减已收 → 写退款流水 + 账户出账 → 状态推进。
 */
async function execute(id, operator, scopeWarehouseIds = null) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const row = await lockStatusRow(conn, {
      table: 'refund_orders', id,
      columns: 'id, refund_no, sale_order_id, sale_order_no, customer_name, amount, status, payment_record_id, account_id, refund_date',
      entityName: '退款单',
    })
    await assertRefundInScope(conn, scopeWarehouseIds, id)
    const rule = assertStatusAction('refundOrder', 'execute', row.status)
    const amount = Number(row.amount)

    // 锁账款记录（FOR UPDATE），校验可退金额
    if (!row.payment_record_id) {
      // 无关联账款（期初/手工）：只允许已收金额为 0 的特殊场景——实际不放行，退款必须有账款基准
      throw new AppError('该退款单未关联账款记录，无法执行退款', 400)
    }
    const [[record]] = await conn.query(
      'SELECT * FROM payment_records WHERE id = ? FOR UPDATE', [row.payment_record_id],
    )
    if (!record) throw new AppError('关联账款记录不存在，无法执行退款', 404)
    const paid = Number(record.paid_amount)
    if (amount > paid + 1e-6) {
      throw new AppError(`退款金额 ¥${amount.toFixed(2)} 超过该账款已收金额 ¥${paid.toFixed(2)}，无法退款`, 409, 'REFUND_EXCEED_PAID')
    }

    // 冲减已收：paid_amount 减回，balance 增大，status 重算
    const newPaid = Number((paid - amount).toFixed(4))
    const newBalance = Number((Number(record.total_amount) - newPaid).toFixed(4))
    const newStatus = newBalance <= 1e-6 ? 3 : newPaid > 0 ? 2 : 1
    await conn.query(
      'UPDATE payment_records SET paid_amount=?, balance=?, status=? WHERE id=?',
      [newPaid, Math.max(0, newBalance), newStatus, row.payment_record_id],
    )

    // 负向 payment_entries 留痕（退款金额为负，与收款登记对称可对账）
    await conn.query(
      `INSERT INTO payment_entries (record_id, amount, payment_date, method, remark, operator_id, operator_name)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [row.payment_record_id, -amount, row.refund_date || (d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`)(new Date()), 'refund',
       `退货退款 ${row.refund_no}`, operator?.userId || null, operator?.realName || operator?.username || null],
    )

    // 资金账户出账（退款）：钱出去与单据状态同生共死
    if (row.account_id) {
      await accountSvc.recordTransaction(conn, {
        accountId: row.account_id,
        direction: accountSvc.DIRECTION.OUT,
        amount,
        bizType: accountSvc.BIZ_TYPE.REFUND,
        bizId: Number(id),
        bizNo: row.refund_no,
        partyName: row.customer_name,
        happenedAt: row.refund_date || (d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`)(new Date()),
        remark: `退货退款 ${row.refund_no}（销售单 ${row.sale_order_no}）`,
      }, { operatorId: operator?.userId, operatorName: operator?.realName || operator?.username })
    }

    // 对账单投影刷新（2026-08-21 审计 E.3 修复）：退款冲减 paid_amount 后，
    // 若该账款属于某对账单，同事务刷新 settled_amount/状态——否则 unlock 用
    // 过期存储列误拒（已核销完的账款退款后永远无法解锁回草稿）。
    const [stmtRows] = await conn.query(
      'SELECT DISTINCT statement_id FROM reconciliation_statement_items WHERE record_id = ? ORDER BY statement_id',
      [row.payment_record_id],
    )
    for (const s of stmtRows) {
      await conn.query('SELECT id FROM reconciliation_statements WHERE id=? FOR UPDATE', [s.statement_id])
    }
    for (const s of stmtRows) {
      await statementSvc.refreshSettlement(conn, s.statement_id)
    }

    await recordPaymentEvent(conn, {
      paymentRecordId: Number(row.payment_record_id),
      orderNo: record.order_no,
      eventType: PAYMENT_EVENT.REFUND,
      title: '退货退款',
      description: `退款单 ${row.refund_no} 已退 ¥${amount.toFixed(2)}，已收 ¥${paid.toFixed(2)} → ¥${newPaid.toFixed(2)}`,
      operatorId: operator?.userId,
      operatorName: operator?.realName || operator?.username,
      requestId: getRequestId(),
      payload: { refundId: Number(id), refundNo: row.refund_no, amount, paidBefore: paid, paidAfter: newPaid },
    })

    await compareAndSetStatus(conn, { table: 'refund_orders', id, fromStatus: rule.from, toStatus: rule.to, entityName: '退款单' })
    await conn.query('UPDATE refund_orders SET refunded_at=NOW() WHERE id=?', [id])
    await conn.commit()
    return { id: Number(id), refundNo: row.refund_no, amount }
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }
}

/** 取消：草稿/已确认 → 已取消 */
async function cancel(id, scopeWarehouseIds = null) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const row = await lockStatusRow(conn, { table: 'refund_orders', id, columns: 'id, status', entityName: '退款单' })
    await assertRefundInScope(conn, scopeWarehouseIds, id)
    const rule = assertStatusAction('refundOrder', 'cancel', row.status)
    await compareAndSetStatus(conn, { table: 'refund_orders', id, fromStatus: rule.from, toStatus: rule.to, entityName: '退款单' })
    await conn.commit()
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }
}

module.exports = { findAll, findById, create, submit, execute, cancel }
