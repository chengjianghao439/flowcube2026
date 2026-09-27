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

/**
 * 发票 source_type 必须按仓库设计约定取值（2026-09-27）。
 *
 * 权威依据（仓库内）：迁移 `182_fin_invoices.sql` 的列注释写明
 *   `source_type ... COMMENT '关联业务：purchase_order/sale_order（可空，允许无单发票）'`
 * 而 `voucher-engine.loadTaxMaps` 正是按这两个值把发票税额归到对应业务单
 * （进项 `invoice_type=1 AND source_type='purchase_order' AND status IN (2,3)`；
 *  销项 `invoice_type=2 AND source_type='sale_order' AND status<>2`；两者都要求 `source_id IS NOT NULL`）。
 *
 * 界面路径（frontend/src/pages/accounting/invoices/index.tsx 的 submit）只发 sourceNo、不发 sourceType；
 * `createInvoice` 在 `assertInvoiceQuota` 反查成功时写的是字面量 `'invoice_order'`——既不在 182 的约定内，
 * 也不被 loadTaxMaps 识别。本条用例即验证：**界面路径录入且已正确关联订单的发票，其 source_type 是否合规、
 * 税额是否真的被计入。** 与「发票未关联单号（source_id 为 NULL）」是**不同因果**，不混为一谈。
 */
async function scenarioSourceTypeRecognized(ctx, log, token, cleanup) {
  const { http, pool } = ctx
  const { orderId, orderNo } = await seedSaleWithReceivable(pool, 1000)
  cleanup.orderIds.push(orderId)

  const amountWithTax = 565
  const taxAmount = round2(amountWithTax - amountWithTax / 1.13) // 65.00
  const invNo = `Q${randomRef('T').slice(0, 10)}`
  const ok = await issueInvoice(http, token, { sourceNo: orderNo, amountWithTax, invoiceNo: invNo })
  const invId = Number(ok.data?.data?.id)
  if (!Number.isInteger(invId)) throw new Error(`建票失败: ${JSON.stringify(ok.data)}`)
  cleanup.invoiceIds.push(invId)

  const [row] = await dbQuery(
    pool, 'SELECT source_type, source_id, tax_amount FROM fin_invoices WHERE id=?', [invId],
  )
  console.log(`\n[§T] 发票 source_type=${row?.source_type} source_id=${row?.source_id} tax=${row?.tax_amount}（订单 id=${orderId}）`)

  log.assert(
    '★ 关联成功的发票 source_type 必须是 sale_order（迁移 182 的列约定）',
    row?.source_type === 'sale_order',
    `实际 ${row?.source_type}`,
  )
  log.assert(
    '★ source_id 必须指向被关联的销售单',
    Number(row?.source_id) === Number(orderId),
    `实际 ${row?.source_id}，期望 ${orderId}`,
  )

  // 复刻 loadTaxMaps 销项分支的原文条件（该函数未导出，故按其 SQL 逐字复刻），
  // 断言这张票的税额确实能进入该销售单的税额合计。
  const [agg] = await dbQuery(
    pool,
    `SELECT COALESCE(SUM(tax_amount),0) tax FROM fin_invoices
      WHERE invoice_type=2 AND source_type='sale_order' AND source_id IS NOT NULL
        AND status<>2 AND deleted_at IS NULL AND source_id=?`,
    [orderId],
  )
  console.log(`[§T] 按 loadTaxMaps 同条件汇总该单税额 = ${agg?.tax}（期望 ${taxAmount}）`)
  log.assert(
    '★ 该销售单的销项发票税额必须被 loadTaxMaps 计入',
    Math.abs(Number(agg?.tax) - taxAmount) < 0.01,
    `实际 ${agg?.tax}，期望 ${taxAmount}`,
  )
}

async function main() {
  const log = createLogger()
  const ctx = await prepareSmokeContext()
  const { pool } = ctx
  // 本场景自建夹具的精确 ID，收尾自洁（本文件此前无清理，新场景不依赖也不改变既有场景的行为）
  const cleanup = { orderIds: [], invoiceIds: [] }
  try {
    const { token } = await login(ctx.http, 'smoke_admin', 'SmokeAdmin123!')
    if (!token) throw new Error('登录失败，无法执行开票量校验回归')

    await scenarioOverQuotaBlocked(ctx, log, token)
    await scenarioRedFlushRestoresQuota(ctx, log, token)
    await scenarioEditExcludesSelf(ctx, log, token)
    await scenarioNoQuotaBypass(ctx, log, token)
    await scenarioSourceTypeRecognized(ctx, log, token, cleanup)
  } finally {
    // 按精确 ID 清理本轮自建夹具（共享库自洁）
    const safe = async (sql, params) => { try { await pool.query(sql, params) } catch (e) { console.error(`[清理告警] ${e.message}`) } }
    for (const id of cleanup.invoiceIds) await safe('DELETE FROM fin_invoices WHERE id=?', [id])
    for (const id of cleanup.orderIds) {
      await safe('DELETE FROM payment_records WHERE type=2 AND order_id=?', [id])
      await safe('DELETE FROM sale_orders WHERE id=?', [id])
    }
    await ctx.close()
  }
  const counts = log.summary()
  process.exit(counts.failed > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error('[INVOICE-QUOTA] 未捕获异常：', e)
  process.exit(1)
})
