#!/usr/bin/env node
'use strict'

/**
 * 出库环节信用复查回归测试（审计 4.8）。
 *   node tests/credit-outbound.smoke.test.js
 *
 * 占库时校验过信用，但占库→出库之间客户可能又开新单/未清应收变多，额度可能已超限。
 * 出库确认是货物真正离仓的时点，此时复查比占库更贴近「钱能不能收回来」。
 * 本测试直接调 ship 的 assertCreditWithinLimit（抽出的独立函数）：
 *
 *   1. 客户有信用额度且未超限 → 放行
 *   2. 客户信用超限且操作者无 override 权限 → 拦（CREDIT_LIMIT_EXCEEDED）
 *   3. 客户信用超限但操作者超管（roleId=1）→ 放行（超管恒有 override）
 *   4. 客户无信用额度（NULL）→ 放行
 *   5. 已用额度计入未清应收（payment_records type=2）→ 有欠款即算已用
 */

const {
  createLogger,
  prepareSmokeContext,
  randomRef,
} = require('./helpers/smokeTestKit')
const { assertCreditWithinLimit } = require('../backend/src/modules/warehouse-tasks/warehouse-tasks.ship')

async function main() {
  const log = createLogger()
  const ctx = await prepareSmokeContext()
  const { pool } = ctx
  const conn = await pool.getConnection()
  const code = randomRef('CR').slice(0, 12)

  // 建一个额度 1000 的测试客户
  const [cust] = await pool.query(
    "INSERT INTO sale_customers (name, code, credit_limit) VALUES (?, ?, 1000)",
    ['信用复查客户', `CRC-${code}`],
  )
  const customerId = cust.insertId
  // 建一个无额度客户（credit_limit NULL）
  const [custNoLimit] = await pool.query(
    "INSERT INTO sale_customers (name, code, credit_limit) VALUES (?, ?, NULL)",
    ['无额度客户', `CRN-${code}`],
  )
  const noLimitId = custNoLimit.insertId

  try {
    // 1. 无欠款、本单 800 ≤ 1000 → 放行（用 role 5 只读用户，无 override 权限）
    await assertCreditWithinLimit(conn, customerId, 800, { userId: 9, roleId: 5 })
    log.assert('信用内（800≤1000）放行', true, '')

    // 2. 无欠款、本单 1200 > 1000、role 5 无 override → 拦
    //    （sale.credit.override 授给了 role 3/4/7，role 5 只读用户没有）
    let blocked = false
    try {
      await assertCreditWithinLimit(conn, customerId, 1200, { userId: 9, roleId: 5 })
    } catch (e) {
      blocked = e.code === 'CREDIT_LIMIT_EXCEEDED' && e.statusCode === 409
    }
    log.assert('★ 超限且无 override 权限 → 拦截（CREDIT_LIMIT_EXCEEDED）', blocked, '')

    // 3. 超限但操作者是超管（roleId=1）→ 放行
    await assertCreditWithinLimit(conn, customerId, 1200, { userId: 1, roleId: 1 })
    log.assert('超限但超管操作 → 放行', true, '')

    // 3b. 超限但有 override 权限的角色（role 4 销售员）→ 放行
    await assertCreditWithinLimit(conn, customerId, 1200, { userId: 9, roleId: 4 })
    log.assert('超限但有 sale.credit.override 权限 → 放行', true, '')

    // 4. 客户无信用额度 → 放行
    await assertCreditWithinLimit(conn, noLimitId, 99999, { userId: 9, roleId: 5 })
    log.assert('无信用额度客户 → 放行', true, '')

    // 5. 已用额度计入未清应收：给客户挂一笔 400 的应收（payment_records type=2）
    const [po] = await pool.query(
      `INSERT INTO sale_orders (order_no, customer_id, customer_name, warehouse_id, warehouse_name, total_amount, status, operator_id, operator_name)
       VALUES (?, ?, '信用复查客户', 1, '测试仓', 400, 4, 1, '测试员')`,
      [randomRef('CRSO').slice(0, 20), customerId],
    )
    await pool.query(
      `INSERT INTO payment_records (type, order_id, order_no, party_name, total_amount, paid_amount, balance, status)
       VALUES (2, ?, ?, '信用复查客户', 400, 0, 400, 1)`,
      [po.insertId, `CRPR-${randomRef('').slice(0, 8)}`],
    )
    // 已用 400 + 本单 700 = 1100 > 1000，role 5 无 override → 拦
    let blocked2 = false
    try {
      await assertCreditWithinLimit(conn, customerId, 700, { userId: 9, roleId: 5 })
    } catch (e) {
      blocked2 = e.code === 'CREDIT_LIMIT_EXCEEDED'
    }
    log.assert('★ 已用额度计入未清应收（400+700>1000 → 拦截）', blocked2, '')

    // 清理
    await pool.query('DELETE FROM payment_records WHERE order_id=?', [po.insertId])
    await pool.query('DELETE FROM sale_orders WHERE id=?', [po.insertId])
  } finally {
    await pool.query('DELETE FROM sale_customers WHERE id IN (?, ?)', [customerId, noLimitId])
    conn.release()
    await ctx.close()
  }
  const counts = log.summary()
  process.exit(counts.failed > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error('[CREDIT-OUTBOUND] 未捕获异常：', e)
  process.exit(1)
})
