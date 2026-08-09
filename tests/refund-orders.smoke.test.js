#!/usr/bin/env node
'use strict'

/**
 * 已收款退货退款单回归（P2-6）：专用红冲退款链路。
 *
 * 退款直接动钱（paid_amount 减回 + 负向 payment_entries + 资金账户出账），
 * 错法和库存的「静默出错」同性质。本测试锁死几条违反即事故的口径：
 *
 *   1. 退款金额 ≤ 该销售单已收金额（paid_amount）——超收拒绝（不能退没收到/已退的钱）；
 *   2. 执行退款：paid_amount 减回、payment_entries 落一条负数流水、资金账户出账（OUT/REFUND）；
 *   3. 幂等：已执行的退款单重复执行被 409 拒绝（不重复退钱）；
 *   4. 退款完成后，销售退货链路的负余额守卫可通过（此前被 returns.helpers 卡死）。
 *
 * 运行：node tests/refund-orders.smoke.test.js
 */

const { createLogger, prepareSmokeContext, dbQuery, login, randomRef } = require('./helpers/smokeTestKit')

const money = n => Number(Number(n).toFixed(2))

/** 造销售单 + 已收账款（直接插 payment_records type=2 且 paid_amount>0，模拟已收款） */
async function seedSaleWithPaid(pool, totalAmount, paidAmount) {
  const orderNo = `SO-${randomRef('R').slice(0, 14)}`
  const [r] = await pool.query(
    `INSERT INTO sale_orders (order_no, customer_id, customer_name, warehouse_id, warehouse_name, status, total_amount, operator_id, operator_name)
     VALUES (?, 1, '退款测试客户', 1, '测试仓', 3, ?, 1, '退款测试')`,
    [orderNo, totalAmount],
  )
  const orderId = r.insertId
  await pool.query(
    `INSERT INTO payment_records (type, order_id, order_no, party_name, total_amount, paid_amount, balance, status, confirm_status)
     VALUES (2, ?, ?, '退款测试客户', ?, ?, ?, ?, 1)`,
    [orderId, orderNo, totalAmount, paidAmount, totalAmount - paidAmount, paidAmount >= totalAmount ? 3 : 2],
  )
  const recRows = await dbQuery(pool, 'SELECT id FROM payment_records WHERE order_id=? AND type=2', [orderId])
  return { orderId, orderNo, paymentRecordId: recRows[0].id }
}

async function readPaid(pool, orderId) {
  const rows = await dbQuery(pool, 'SELECT paid_amount, balance, status FROM payment_records WHERE order_id=? AND type=2', [orderId])
  return rows[0] ? { paid: money(rows[0].paid_amount), balance: money(rows[0].balance), status: Number(rows[0].status) } : null
}

async function scenarioRefundExecutes(ctx, log, token) {
  const { http, pool } = ctx
  const { orderId, orderNo } = await seedSaleWithPaid(pool, 1000, 800)

  // 建账户（退款出账目标）
  const acc = await http.post('/api/finance/accounts', { token, json: { name: randomRef('退款账户').slice(0, 30), type: 2, openingBalance: 500 } })
  const accountId = Number(acc.data?.data?.id)
  log.assert('建退款账户成功', Number.isInteger(accountId), `status=${acc.status}`)

  // 1. 退款 300（≤已收 800）→ 草稿
  const create = await http.post('/api/refunds', {
    token,
    json: { saleOrderId: orderId, amount: 300, accountId, refundDate: '2026-08-09', remark: '退货退款测试' },
  })
  const refundId = create.data?.data?.id
  log.assert('创建退款单 300 成功', create.status === 200 && Number.isInteger(refundId), `status=${create.status} msg=${create.message}`)

  // 2. 超收被拒：退款 900 > 已收 800
  const over = await http.post('/api/refunds', { token, json: { saleOrderId: orderId, amount: 900 } })
  log.assert('退款超已收被拒（900>800）', over.status === 400, `status=${over.status} msg=${over.message}`)

  // 3. 确认 → 执行
  const sub = await http.post(`/api/refunds/${refundId}/submit`, { token })
  log.assert('确认退款 200', sub.status === 200, `status=${sub.status}`)
  const exec = await http.post(`/api/refunds/${refundId}/execute`, { token })
  log.assert('执行退款 200', exec.status === 200, `status=${exec.status} msg=${exec.message}`)

  // 4. 已收 800 → 500；余额 200 → 500；状态重算
  const after = await readPaid(pool, orderId)
  log.assert('已收 800→500', after.paid === 500, `paid=${after.paid}`)
  log.assert('余额 200→500', after.balance === 500, `balance=${after.balance}`)

  // 5. payment_entries 负向流水
  const prRows = await dbQuery(pool, 'SELECT id FROM payment_records WHERE order_id=? AND type=2', [orderId])
  const entries = await dbQuery(pool, 'SELECT amount, method FROM payment_entries WHERE record_id=? ORDER BY id DESC LIMIT 1', [prRows[0].id])
  log.assert('退款落负向 payment_entries', entries.length === 1 && money(entries[0].amount) === -300 && entries[0].method === 'refund',
    JSON.stringify(entries))

  // 6. 资金账户出账：余额 500 → 200，流水 OUT/REFUND
  const txns = await dbQuery(pool, 'SELECT direction, biz_type, amount FROM finance_account_transactions WHERE account_id=? ORDER BY id DESC LIMIT 1', [accountId])
  log.assert('资金账户出账 OUT/REFUND 300', txns.length === 1 && Number(txns[0].direction) === 2 && Number(txns[0].biz_type) === 5 && money(txns[0].amount) === 300,
    JSON.stringify(txns))
  const accAfter = await dbQuery(pool, 'SELECT current_balance FROM finance_accounts WHERE id=?', [accountId])
  log.assert('账户余额 500→200', money(accAfter[0].current_balance) === 200, `balance=${accAfter[0].current_balance}`)

  // 7. 幂等：重复执行被拒（状态已是 3 已完成，assertStatusAction 抛 400）
  const dup = await http.post(`/api/refunds/${refundId}/execute`, { token })
  log.assert('重复执行被拒', dup.status === 400 || dup.status === 409, `status=${dup.status}`)
  const afterDup = await readPaid(pool, orderId)
  log.assert('重复执行未再次扣款', afterDup.paid === 500, `paid=${afterDup.paid}`)
}

async function scenarioRefundThenReturnPasses(ctx, log, token) {
  const { http, pool } = ctx
  const { orderId, orderNo, paymentRecordId } = await seedSaleWithPaid(pool, 1000, 800)

  // 退款前：退货守卫应拦截（paid 800 > 退货冲减后总额）。这里直接用 returns.helpers 的守卫函数验证
  const { assertReturnPaymentHeadroom } = require('../backend/src/modules/returns/returns.helpers')
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    // 模拟退货冲减 300：总额 1000→700，已收 800 > 700 → 应抛错
    let threw = false
    try {
      await assertReturnPaymentHeadroom(conn, { recordType: 2, orderId, amount: 300 })
    } catch (e) {
      threw = e.statusCode === 409
    }
    log.assert('退款前退货守卫拦截（已收800>冲减后700）', threw, '守卫未拦截')
    await conn.rollback()
  } finally {
    conn.release()
  }

  // 执行退款 200：已收 800→600
  const acc = await http.post('/api/finance/accounts', { token, json: { name: randomRef('退款账户2').slice(0, 30), type: 2, openingBalance: 0 } })
  const accountId = Number(acc.data?.data?.id)
  const refund = await http.post('/api/refunds', { token, json: { saleOrderId: orderId, amount: 200, accountId } })
  const refundId = refund.data?.data?.id
  await http.post(`/api/refunds/${refundId}/submit`, { token })
  await http.post(`/api/refunds/${refundId}/execute`, { token })

  // 退款后：同一守卫放行（已收 600 ≤ 冲减后 700）
  const conn2 = await pool.getConnection()
  try {
    await conn2.beginTransaction()
    let passed = true
    try {
      await assertReturnPaymentHeadroom(conn2, { recordType: 2, orderId, amount: 300 })
    } catch (e) {
      passed = false
    }
    log.assert('退款后退货守卫放行（已收600≤冲减后700）', passed, '守卫仍拦截')
    await conn2.rollback()
  } finally {
    conn2.release()
  }
}

async function main() {
  const log = createLogger()
  const ctx = await prepareSmokeContext()
  try {
    const { token } = await login(ctx.http, 'smoke_admin', 'SmokeAdmin123!')
    if (!token) throw new Error('登录失败，无法执行退款单回归')

    await scenarioRefundExecutes(ctx, log, token)
    await scenarioRefundThenReturnPasses(ctx, log, token)
  } finally {
    await ctx.close()
  }
  const counts = log.summary()
  process.exit(counts.failed > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error('[REFUND-ORDERS] 未捕获异常：', e)
  process.exit(1)
})
