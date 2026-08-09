#!/usr/bin/env node
'use strict'

/**
 * 开票量校验回归（P2-5）：防多开票税务风险。
 *
 * 发票关联业务单时，累计已开票价税合计不得超过该单的应收/应付基准
 * （payment_records.total_amount，出库/收货后按实发/实收量重算的权威口径）。
 *
 * 本测试锁死的是几条违反即事故的口径：
 *
 *   1. 销项发票累计开票量 ≤ 该销售单应收基准——超量硬拦截（多开票违法）；
 *   2. 红冲（status=2）的销项发票不计入已开票合计——红冲后额度恢复；
 *   3. 编辑发票时排除自身——改大本次金额不被自己挡住，但仍受总额约束；
 *   4. 查不到单据或该单无账款基准（未结算）时不拦截——保留「先开票后发货」合法场景。
 *
 * 运行：node tests/invoice-quota.smoke.test.js
 */

const { createLogger, prepareSmokeContext, dbQuery, login, randomRef } = require('./helpers/smokeTestKit')

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100

/** 造一张有应收基准的销售单（直接插 payment_records type=2，模拟出库后的权威应收） */
async function seedSaleWithReceivable(pool, baseAmount) {
  const orderNo = `SO-${randomRef('Q').slice(0, 14)}`
  const [r] = await pool.query(
    `INSERT INTO sale_orders (order_no, customer_id, customer_name, warehouse_id, warehouse_name, status, total_amount, operator_id, operator_name)
     VALUES (?, 1, '开票量测试客户', 1, '测试仓', 3, ?, 1, '开票量测试')`,
    [orderNo, baseAmount],
  )
  const orderId = r.insertId
  await pool.query(
    `INSERT INTO payment_records (type, order_id, order_no, party_name, total_amount, paid_amount, balance, status, confirm_status)
     VALUES (2, ?, ?, '开票量测试客户', ?, 0, ?, 1, 1)`,
    [orderId, orderNo, baseAmount, baseAmount],
  )
  return { orderId, orderNo }
}

/** 录一张销项发票（通过真实 API） */
async function issueInvoice(http, token, { sourceNo, amountWithTax, invoiceNo }) {
  return http.post('/api/accounting/invoices', {
    token,
    json: {
      invoiceType: 2,
      invoiceCode: 'INV-CODE',
      invoiceNo,
      partyName: '开票量测试客户',
      partyTaxNo: '91110000TEST',
      amountNoTax: round2(amountWithTax / 1.13),
      taxRate: 0.13,
      taxAmount: round2(amountWithTax - amountWithTax / 1.13),
      amountWithTax,
      invoiceDate: '2026-08-09',
      sourceNo,
    },
  })
}

async function scenarioOverQuotaBlocked(ctx, log, token) {
  const { http, pool } = ctx
  const { orderNo } = await seedSaleWithReceivable(pool, 1000)

  // 1. 开票 600 ≤ 应收 1000 → 成功
  const ok1 = await issueInvoice(http, token, { sourceNo: orderNo, amountWithTax: 600, invoiceNo: `Q${randomRef('A').slice(0, 10)}` })
  log.assert('开票 600（≤应收1000）成功', ok1.status === 201 || ok1.status === 200, `status=${ok1.status} msg=${ok1.message}`)

  // 2. 再开 500 → 600+500 > 1000 → 拦截
  const over = await issueInvoice(http, token, { sourceNo: orderNo, amountWithTax: 500, invoiceNo: `Q${randomRef('B').slice(0, 10)}` })
  log.assert('累计超应收被拒（600+500>1000）', over.status === 400 && over.data?.code === 'INVOICE_OVER_QUOTA',
    `status=${over.status} code=${over.data?.code} msg=${over.message}`)

  // 3. 恰好补足 400 → 1000 = 应收 → 成功
  const ok2 = await issueInvoice(http, token, { sourceNo: orderNo, amountWithTax: 400, invoiceNo: `Q${randomRef('C').slice(0, 10)}` })
  log.assert('补足到应收上限（600+400=1000）成功', ok2.status === 201 || ok2.status === 200, `status=${ok2.status} msg=${ok2.message}`)
}

async function scenarioRedFlushRestoresQuota(ctx, log, token) {
  const { http, pool } = ctx
  const { orderNo } = await seedSaleWithReceivable(pool, 1000)

  const invNo = `Q${randomRef('R').slice(0, 10)}`
  const ok = await issueInvoice(http, token, { sourceNo: orderNo, amountWithTax: 800, invoiceNo: invNo })
  const invId = ok.data?.data?.id
  log.assert('开票 800 成功', ok.status === 201 && Number.isInteger(invId), `status=${ok.status}`)

  // 再开 300 → 800+300 > 1000 → 拦截
  const over = await issueInvoice(http, token, { sourceNo: orderNo, amountWithTax: 300, invoiceNo: `Q${randomRef('R2').slice(0, 10)}` })
  log.assert('800+300 超限被拒', over.status === 400, `status=${over.status}`)

  // 红冲 800 的发票 → 额度恢复
  const red = await http.post(`/api/accounting/invoices/${invId}/status`, { token, json: { action: 'redFlush' } })
  log.assert('红冲成功', red.status === 200, `status=${red.status}`)

  // 红冲后可再开 800 → 不超过应收（红冲不计入已开票）
  const afterRed = await issueInvoice(http, token, { sourceNo: orderNo, amountWithTax: 800, invoiceNo: `Q${randomRef('R3').slice(0, 10)}` })
  log.assert('红冲后额度恢复，可再开 800', afterRed.status === 201 || afterRed.status === 200,
    `status=${afterRed.status} msg=${afterRed.message}`)
}

async function scenarioEditExcludesSelf(ctx, log, token) {
  const { http, pool } = ctx
  const { orderNo } = await seedSaleWithReceivable(pool, 1000)

  const invNo = `Q${randomRef('E').slice(0, 10)}`
  const ok = await issueInvoice(http, token, { sourceNo: orderNo, amountWithTax: 500, invoiceNo: invNo })
  const invId = ok.data?.data?.id

  // 编辑把本次金额改成 900（自己 500 应被排除，但 900 ≤ 基准 1000 → 成功）
  const edit = await http.put(`/api/accounting/invoices/${invId}`, {
    token,
    json: { amountWithTax: 900, amountNoTax: round2(900 / 1.13), taxAmount: round2(900 - 900 / 1.13) },
  })
  log.assert('编辑放大到 900（排除自身后 ≤1000）成功', edit.status === 200, `status=${edit.status} msg=${edit.message}`)

  // 再编辑放大到 1100 → 超过基准 1000 → 拦截
  const over = await http.put(`/api/accounting/invoices/${invId}`, {
    token,
    json: { amountWithTax: 1100, amountNoTax: round2(1100 / 1.13), taxAmount: round2(1100 - 1100 / 1.13) },
  })
  log.assert('编辑放大到 1100（>应收1000）被拒', over.status === 400, `status=${over.status} msg=${over.message}`)
}

async function scenarioNoQuotaBypass(ctx, log, token) {
  const { http, pool } = ctx
  // 无账款基准的销售单（未结算）→ 不拦截（先开票后发货合法）
  const orderNo = `SO-${randomRef('N').slice(0, 14)}`
  await pool.query(
    `INSERT INTO sale_orders (order_no, customer_id, customer_name, warehouse_id, warehouse_name, status, total_amount, operator_id, operator_name)
     VALUES (?, 1, '未结算客户', 1, '测试仓', 2, 500, 1, '开票量测试')`,
    [orderNo],
  )
  // 单号乱填但查不到单据 → 不拦截
  const unknown = await issueInvoice(http, token, { sourceNo: 'NO-SUCH-ORDER-999', amountWithTax: 99999, invoiceNo: `Q${randomRef('U').slice(0, 10)}` })
  log.assert('查不到单据的开票不拦截', unknown.status === 201 || unknown.status === 200, `status=${unknown.status}`)
}

async function main() {
  const log = createLogger()
  const ctx = await prepareSmokeContext()
  try {
    const { token } = await login(ctx.http, 'smoke_admin', 'SmokeAdmin123!')
    if (!token) throw new Error('登录失败，无法执行开票量校验回归')

    await scenarioOverQuotaBlocked(ctx, log, token)
    await scenarioRedFlushRestoresQuota(ctx, log, token)
    await scenarioEditExcludesSelf(ctx, log, token)
    await scenarioNoQuotaBypass(ctx, log, token)
  } finally {
    await ctx.close()
  }
  const counts = log.summary()
  process.exit(counts.failed > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error('[INVOICE-QUOTA] 未捕获异常：', e)
  process.exit(1)
})
