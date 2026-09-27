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

/** 造一张有应付基准的采购单（直接插 payment_records type=1，模拟收货后的权威应付） */
async function seedPurchaseWithPayable(pool, baseAmount) {
  const orderNo = `PO-${randomRef('P').slice(0, 14)}`
  const [r] = await pool.query(
    `INSERT INTO purchase_orders (order_no, supplier_id, supplier_name, warehouse_id, warehouse_name, status, total_amount, need_approval, operator_id, operator_name)
     VALUES (?, 1, '发票归属测试供应商', 1, '测试仓', 3, ?, 0, 1, '发票归属测试')`,
    [orderNo, baseAmount],
  )
  const orderId = r.insertId
  await pool.query(
    `INSERT INTO payment_records (type, order_id, order_no, party_name, total_amount, paid_amount, balance, status, confirm_status)
     VALUES (1, ?, ?, '发票归属测试供应商', ?, 0, ?, 1, 1)`,
    [orderId, orderNo, baseAmount, baseAmount],
  )
  return { orderId, orderNo }
}

/**
 * 复刻 `voucher-engine.loadTaxMaps` 的筛选谓词（该函数未导出，故按其 SQL 逐字复刻），
 * 返回「该业务单被计入的税额合计」：
 *   进项 `invoice_type=1 AND source_type='purchase_order' AND source_id IS NOT NULL AND status IN (2,3)`
 *   销项 `invoice_type=2 AND source_type='sale_order'   AND source_id IS NOT NULL AND status<>2`
 * 均为 `deleted_at IS NULL AND company_id=?`。
 *
 * 注意这是**谓词级**验证：证明「发票行是否落在凭证引擎的筛选条件内」；
 * **真实凭证生成（generateVouchers）本套件未跑**——它会写销售凭证、污染共享库。
 */
async function taxedAmountOf(pool, invoiceType, orderId, companyId = 1) {
  const sourceType = invoiceType === 2 ? 'sale_order' : 'purchase_order'
  const statusClause = invoiceType === 2 ? 'status<>2' : 'status IN (2,3)'
  const [row] = await dbQuery(
    pool,
    `SELECT COALESCE(SUM(tax_amount),0) tax FROM fin_invoices
      WHERE invoice_type=? AND source_type=? AND source_id IS NOT NULL
        AND ${statusClause} AND deleted_at IS NULL AND company_id=? AND source_id=?`,
    [invoiceType, sourceType, companyId, orderId],
  )
  return Number(row?.tax ?? 0)
}

/**
 * 发票 source_type 必须按仓库设计约定取值（2026-09-27）。
 *
 * 权威依据（仓库内）：迁移 `182_fin_invoices.sql` 的列注释写明
 *   `source_type ... COMMENT '关联业务：purchase_order/sale_order（可空，允许无单发票）'`
 * 而 `voucher-engine.loadTaxMaps` 正是按这两个值把发票税额归到对应业务单。
 *
 * 界面路径（frontend/src/pages/accounting/invoices/index.tsx 的 submit）只发 sourceNo、不发 sourceType；
 * 修复前 `createInvoice` 在 `assertInvoiceQuota` 反查成功时写的是字面量 `'invoice_order'`——既不在 182 的
 * 约定内，也不被 loadTaxMaps 识别，于是**已正确关联订单的发票税额也不进凭证**。
 * 与「发票未关联单号（source_id 为 NULL）」「无单发票（迁移 182 明示允许）」是**不同因果**，本套件不混为一谈。
 */
async function scenarioSourceTypeSale(ctx, log, token, cleanup) {
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

  const [row] = await dbQuery(pool, 'SELECT source_type, source_id FROM fin_invoices WHERE id=?', [invId])
  const taxed = await taxedAmountOf(pool, 2, orderId)
  console.log(`\n[§T-销项] source_type=${row?.source_type} source_id=${row?.source_id}（订单 ${orderId}）；谓词汇总税额=${taxed}（期望 ${taxAmount}）`)

  log.assert(
    '★ 销项：关联成功的发票 source_type 必须是 sale_order（迁移 182 的列约定）',
    row?.source_type === 'sale_order',
    `实际 ${row?.source_type}`,
  )
  log.assert(
    '★ 销项：source_id 必须指向被关联的销售单',
    Number(row?.source_id) === Number(orderId),
    `实际 ${row?.source_id}，期望 ${orderId}`,
  )
  log.assert(
    '★ 销项：该单税额必须落在 loadTaxMaps 的筛选谓词内',
    Math.abs(taxed - taxAmount) < 0.01,
    `实际 ${taxed}，期望 ${taxAmount}`,
  )
}

/** 进项：同一缺陷在采购侧同样成立，且进项还需认证（status 1→2）才被谓词计入 */
async function scenarioSourceTypePurchase(ctx, log, token, cleanup) {
  const { http, pool } = ctx
  const { orderId, orderNo } = await seedPurchaseWithPayable(pool, 2000)
  cleanup.poIds.push(orderId)

  const amountWithTax = 1130
  const taxAmount = round2(amountWithTax - amountWithTax / 1.13) // 130.00
  const invNo = `P${randomRef('T').slice(0, 10)}`
  const created = await http.post('/api/accounting/invoices', {
    token,
    json: {
      invoiceType: 1, invoiceCode: 'INV-CODE-P', invoiceNo: invNo,
      partyName: '发票归属测试供应商', partyTaxNo: '91110000PTEST',
      amountNoTax: round2(amountWithTax / 1.13), taxRate: 0.13, taxAmount,
      amountWithTax, invoiceDate: '2026-08-09', sourceNo: orderNo,
    },
  })
  const invId = Number(created.data?.data?.id)
  if (!Number.isInteger(invId)) throw new Error(`建进项票失败: ${JSON.stringify(created.data)}`)
  cleanup.invoiceIds.push(invId)

  const [row] = await dbQuery(pool, 'SELECT source_type, source_id FROM fin_invoices WHERE id=?', [invId])
  console.log(`\n[§T-进项] source_type=${row?.source_type} source_id=${row?.source_id}（采购单 ${orderId}）`)
  log.assert(
    '★ 进项：关联成功的发票 source_type 必须是 purchase_order（迁移 182 的列约定）',
    row?.source_type === 'purchase_order',
    `实际 ${row?.source_type}`,
  )

  const cert = await http.post(`/api/accounting/invoices/${invId}/status`, { token, json: { action: 'certify' } })
  log.assert('进项认证成功（status → 2）', cert.status === 200, `status=${cert.status}`)
  const taxed = await taxedAmountOf(pool, 1, orderId)
  console.log(`[§T-进项] 认证后谓词汇总税额=${taxed}（期望 ${taxAmount}）`)
  log.assert(
    '★ 进项：认证后该单税额必须落在 loadTaxMaps 的筛选谓词内',
    Math.abs(taxed - taxAmount) < 0.01,
    `实际 ${taxed}，期望 ${taxAmount}`,
  )
}

/** 编辑自愈：历史 source_type='invoice_order' 的票，编辑一次即回到约定值（不需要改写存量数据的迁移） */
async function scenarioEditSelfHealsSourceType(ctx, log, token, cleanup) {
  const { http, pool } = ctx
  const { orderId, orderNo } = await seedSaleWithReceivable(pool, 1000)
  cleanup.orderIds.push(orderId)

  const invNo = `Q${randomRef('H').slice(0, 10)}`
  const ok = await issueInvoice(http, token, { sourceNo: orderNo, amountWithTax: 565, invoiceNo: invNo })
  const invId = Number(ok.data?.data?.id)
  cleanup.invoiceIds.push(invId)

  // 只在**测试样本内**造出历史错误值（不改存量数据的迁移、不碰旧数据）
  await pool.query("UPDATE fin_invoices SET source_type='invoice_order' WHERE id=?", [invId])
  const [before] = await dbQuery(pool, 'SELECT source_type FROM fin_invoices WHERE id=?', [invId])
  log.assert('前置：样本已置为历史值 invoice_order', before?.source_type === 'invoice_order', String(before?.source_type))

  // 编辑**不重新输入单号**（只改备注）——自愈应来自「派生值重算」，而非用户重填
  const edit = await http.put(`/api/accounting/invoices/${invId}`, { token, json: { remark: '自愈验证' } })
  log.assert('编辑成功', edit.status === 200, `status=${edit.status}`)
  const [after] = await dbQuery(pool, 'SELECT source_type, source_id FROM fin_invoices WHERE id=?', [invId])
  console.log(`[§T-自愈] 编辑后 source_type=${after?.source_type} source_id=${after?.source_id}`)
  log.assert(
    '★ 未重填单号也要自愈为 sale_order（派生值重算，不沿用 cur）',
    after?.source_type === 'sale_order',
    `实际 ${after?.source_type}`,
  )
  log.assert(
    '★ 自愈后 source_id 仍指向原订单',
    Number(after?.source_id) === Number(orderId),
    `实际 ${after?.source_id}`,
  )
}

/** 清空关联单号：单号与派生值必须**一并**清空，不能只清单号却留下旧 source_id */
async function scenarioClearingSourceNoClearsLink(ctx, log, token, cleanup) {
  const { http, pool } = ctx
  const { orderId, orderNo } = await seedSaleWithReceivable(pool, 1000)
  cleanup.orderIds.push(orderId)

  const invNo = `Q${randomRef('C').slice(0, 10)}`
  const ok = await issueInvoice(http, token, { sourceNo: orderNo, amountWithTax: 565, invoiceNo: invNo })
  const invId = Number(ok.data?.data?.id)
  cleanup.invoiceIds.push(invId)

  const clear = await http.put(`/api/accounting/invoices/${invId}`, { token, json: { sourceNo: null } })
  log.assert('清空关联单号成功', clear.status === 200, `status=${clear.status}`)
  const [row] = await dbQuery(pool, 'SELECT source_type, source_id, source_no FROM fin_invoices WHERE id=?', [invId])
  console.log(`[§T-清空] source_type=${row?.source_type} source_id=${row?.source_id} source_no=${row?.source_no}`)
  log.assert('★ 清空后 source_no 为 NULL', row?.source_no === null, String(row?.source_no))
  log.assert('★ 清空后不得残留旧 source_id（旧关联会指向已不再声明的单）', row?.source_id === null, String(row?.source_id))
  log.assert(
    '★ 清空后 source_type 为 NULL（无单发票是迁移 182 明确允许的合法状态）',
    row?.source_type === null,
    String(row?.source_type),
  )
}

/** 通用建票（可传 sourceType/sourceId 等覆盖项，用于验证显式输入契约） */
async function postInvoice(http, token, overrides = {}) {
  const base = {
    invoiceType: 2, invoiceCode: 'INV-CODE', invoiceNo: `Q${randomRef('Z').slice(0, 10)}`,
    partyName: '开票量测试客户', partyTaxNo: '91110000TEST',
    amountNoTax: round2(565 / 1.13), taxRate: 0.13, taxAmount: round2(565 - 565 / 1.13),
    amountWithTax: 565, invoiceDate: '2026-08-09',
  }
  return http.post('/api/accounting/invoices', { token, json: { ...base, ...overrides } })
}

/**
 * 「先开票后发货」必须保留确定的订单身份（2026-09-27）。
 *
 * 订单已建但**尚未出库** ⇒ 没有 `payment_records` 账款基准。此前 `assertInvoiceQuota` 在这种
 * 情形返回 null，派生逻辑随之把 `source_id`/`source_type` 置空，且之后**没有自动回连**——
 * 发货后才产生的税额永远进不了凭证。故反查到的**订单身份**必须与「有无基准」解耦。
 */
async function scenarioInvoiceBeforeShipmentKeepsLink(ctx, log, token, cleanup) {
  const { http, pool } = ctx
  const orderNo = `SO-${randomRef('K').slice(0, 14)}`
  const [r] = await pool.query(
    `INSERT INTO sale_orders (order_no, customer_id, customer_name, warehouse_id, warehouse_name, status, total_amount, operator_id, operator_name)
     VALUES (?, 1, '先开票后发货客户', 1, '测试仓', 2, 1000, 1, '开票量测试')`,
    [orderNo],
  )
  const orderId = r.insertId
  cleanup.orderIds.push(orderId)

  const amountWithTax = 565
  const taxAmount = round2(amountWithTax - amountWithTax / 1.13)
  const ok = await postInvoice(http, token, { sourceNo: orderNo, amountWithTax })
  const invId = Number(ok.data?.data?.id)
  if (!Number.isInteger(invId)) throw new Error(`建票失败: ${JSON.stringify(ok.data)}`)
  cleanup.invoiceIds.push(invId)
  log.assert('先开票后发货：录票成功（无基准不拦配额）', ok.status === 201, `status=${ok.status} msg=${ok.message}`)

  const [row] = await dbQuery(pool, 'SELECT source_type, source_id FROM fin_invoices WHERE id=?', [invId])
  console.log(`\n[§T-先开票] source_type=${row?.source_type} source_id=${row?.source_id}（订单 ${orderId}，尚无账款基准）`)
  log.assert(
    '★ 无账款基准时仍必须保留确定的订单身份（source_id）',
    Number(row?.source_id) === Number(orderId),
    `实际 ${row?.source_id}，期望 ${orderId}`,
  )
  log.assert(
    '★ 此时 source_type 同样按发票类型写入 sale_order',
    row?.source_type === 'sale_order',
    String(row?.source_type),
  )
  log.assert(
    '★ 税额落在 loadTaxMaps 谓词内（发货产生基准后即会被计入）',
    Math.abs(await taxedAmountOf(pool, 2, orderId) - taxAmount) < 0.01,
    `实际 ${await taxedAmountOf(pool, 2, orderId)}，期望 ${taxAmount}`,
  )
}

/**
 * 显式 `sourceType`/`sourceId` 的 API 契约（2026-09-27）。
 *
 * `invoiceSchema` 一直接受这两个字段，故不能无提示忽略：与反查一致则通过，冲突则明确 400；
 * 另外 `invoice_type` 列不可修改，编辑时传不同类型必须拒绝而不是照另一类反查订单。
 */
async function scenarioExplicitSourceInputContract(ctx, log, token, cleanup) {
  const { http, pool } = ctx
  const { orderId, orderNo } = await seedSaleWithReceivable(pool, 100000)
  cleanup.orderIds.push(orderId)

  // 1) 与反查一致的显式输入 → 通过
  const okExplicit = await postInvoice(http, token, { sourceNo: orderNo, sourceType: 'sale_order', sourceId: orderId })
  const invId = Number(okExplicit.data?.data?.id)
  if (Number.isInteger(invId)) cleanup.invoiceIds.push(invId)
  log.assert(
    '显式传入与反查一致的类型/ id → 通过（该字段不被无提示忽略）',
    okExplicit.status === 201,
    `status=${okExplicit.status} msg=${okExplicit.message}`,
  )

  // 2) 类型冲突：销项票却传 purchase_order
  const badType = await postInvoice(http, token, { sourceNo: orderNo, sourceType: 'purchase_order' })
  log.assert(
    '★ 类型冲突被明确拒绝（销项票传 purchase_order）',
    badType.status === 400 && badType.data?.code === 'INVOICE_SOURCE_TYPE_MISMATCH',
    `status=${badType.status} code=${badType.data?.code}`,
  )

  // 3) id 与单号反查不符
  const badId = await postInvoice(http, token, { sourceNo: orderNo, sourceId: orderId + 1 })
  log.assert(
    '★ id 与单号反查不符被明确拒绝',
    badId.status === 400 && badId.data?.code === 'INVOICE_SOURCE_ID_CONFLICT',
    `status=${badId.status} code=${badId.data?.code}`,
  )

  // 4) **仅给 type+id、不给单号** → 这是 schema 既有的显式关联用法，必须继续支持；
  //    且同样走配额校验（按 id 反查真实单号），不能成为绕开额度的旁路。
  const onlyId = await postInvoice(http, token, { sourceType: 'sale_order', sourceId: orderId })
  const onlyIdInv = Number(onlyId.data?.data?.id)
  if (Number.isInteger(onlyIdInv)) cleanup.invoiceIds.push(onlyIdInv)
  log.assert(
    '★ 仅给 type+id（不给单号）也能建立关联（既有契约不被无提示改变）',
    onlyId.status === 201,
    `status=${onlyId.status} msg=${onlyId.message}`,
  )
  const [rowOnlyId] = await dbQuery(pool, 'SELECT source_type, source_id, source_no FROM fin_invoices WHERE id=?', [onlyIdInv])
  console.log(`[§T-仅id] source_type=${rowOnlyId?.source_type} source_id=${rowOnlyId?.source_id} source_no=${rowOnlyId?.source_no}`)
  log.assert(
    '★ 仅给 id 时关联正确、且单号被回填为反查到的真实单号',
    rowOnlyId?.source_type === 'sale_order'
      && Number(rowOnlyId?.source_id) === Number(orderId)
      && rowOnlyId?.source_no === orderNo,
    JSON.stringify(rowOnlyId),
  )

  // 5) 显式 id 不存在 → 明确拒绝（不是静默忽略）
  const badOnlyId = await postInvoice(http, token, { sourceId: 99999999 })
  log.assert(
    '★ 显式 id 不存在被明确拒绝',
    badOnlyId.status === 400 && badOnlyId.data?.code === 'INVOICE_SOURCE_NOT_FOUND',
    `status=${badOnlyId.status} code=${badOnlyId.data?.code}`,
  )

  // 5b) 单号打错 + 同时给了 id → 必须报冲突，不得「按 id 兜底」把错单号悄悄吞掉
  const wrongNoWithId = await postInvoice(http, token, { sourceNo: 'NO-SUCH-ORDER-888', sourceId: orderId })
  log.assert(
    '★ 单号查不到却给了 id 必须报冲突（不得按 id 兜底、吞掉打错的单号）',
    wrongNoWithId.status === 400 && wrongNoWithId.data?.code === 'INVOICE_SOURCE_ID_CONFLICT',
    `status=${wrongNoWithId.status} code=${wrongNoWithId.data?.code}`,
  )

  // 5c) 只给 sourceType（无单号、无 id）→ 明确拒绝，不能静默返回空关联
  const typeOnly = await postInvoice(http, token, { sourceType: 'sale_order' })
  log.assert(
    '★ 只给 sourceType 而无单号/ id 被明确拒绝（不静默返回空关联）',
    typeOnly.status === 400 && typeOnly.data?.code === 'INVOICE_SOURCE_INCOMPLETE',
    `status=${typeOnly.status} code=${typeOnly.data?.code}`,
  )

  // 6) 单号查不到且给了 id → 按 id 路径继续（不丢关联），但单号与 id 不匹配时已在上一条挡掉；
  //    这里验证「单号查不到、也没给 id」仍是既有行为：保留单号快照、不建立关联。
  const noSuchNo = await postInvoice(http, token, { sourceNo: 'NO-SUCH-ORDER-777' })
  const noSuchInv = Number(noSuchNo.data?.data?.id)
  if (Number.isInteger(noSuchInv)) cleanup.invoiceIds.push(noSuchInv)
  log.assert('单号查不到且无 id → 仍放行（期初/无单发票的既有行为）', noSuchNo.status === 201, `status=${noSuchNo.status}`)
  const [rowNoSuch] = await dbQuery(pool, 'SELECT source_type, source_id, source_no FROM fin_invoices WHERE id=?', [noSuchInv])
  log.assert(
    '★ 此时保留单号快照但 source_id/source_type 为 NULL（不进税额，与原行为一致）',
    rowNoSuch?.source_no === 'NO-SUCH-ORDER-777' && rowNoSuch?.source_id === null && rowNoSuch?.source_type === null,
    JSON.stringify(rowNoSuch),
  )

  // 7) 仅给 id 同样受配额约束——这正是「不给单号就绕过额度」的历史缺口
  const { orderId: smallId } = await seedSaleWithReceivable(pool, 1000)
  cleanup.orderIds.push(smallId)
  const overById = await postInvoice(http, token, {
    sourceId: smallId, amountWithTax: 1200,
    amountNoTax: round2(1200 / 1.13), taxAmount: round2(1200 - 1200 / 1.13),
  })
  log.assert(
    '★ 仅给 id 也受配额约束（不能绕过额度）',
    overById.status === 400 && overById.data?.code === 'INVOICE_OVER_QUOTA',
    `status=${overById.status} code=${overById.data?.code}`,
  )

  // 8) invoice_type 不可修改：编辑时传不同类型必须拒绝（不能照另一类去反查订单）
  const typeChange = await http.put(`/api/accounting/invoices/${invId}`, { token, json: { invoiceType: 1 } })
  log.assert(
    '★ 编辑时改发票类型被明确拒绝（invoice_type 不可修改）',
    typeChange.status === 400 && typeChange.data?.code === 'INVOICE_TYPE_IMMUTABLE',
    `status=${typeChange.status} code=${typeChange.data?.code}`,
  )
  const [still] = await dbQuery(pool, 'SELECT invoice_type, source_type FROM fin_invoices WHERE id=?', [invId])
  log.assert(
    '★ 被拒后发票类型与关联均未变',
    Number(still?.invoice_type) === 2 && still?.source_type === 'sale_order',
    `type=${still?.invoice_type} sourceType=${still?.source_type}`,
  )
}

/**
 * 编辑时的「关联意图」三类输入（2026-09-27）。
 *
 * `updateInvoice` 原先把 `{...cur,...d}` 直接交给配额校验，由此两个错：
 *   ① 改成新单号时旧 `cur.sourceId` 一并传入 → 与新单号的反查结果冲突，误报「不一致」；
 *   ② 清空单号时旧 `cur.sourceId` 仍触发按 id 反查 → 刚清掉的关联又被建回来。
 * 现按「本次是否显式给出 sourceNo」决定能否沿用旧 id，本场景逐一锁定这三类。
 */
async function scenarioUpdateSourceIntent(ctx, log, token, cleanup) {
  const { http, pool } = ctx
  const a = await seedSaleWithReceivable(pool, 100000)
  const b = await seedSaleWithReceivable(pool, 100000)
  cleanup.orderIds.push(a.orderId, b.orderId)

  const created = await postInvoice(http, token, { sourceNo: a.orderNo })
  const invId = Number(created.data?.data?.id)
  cleanup.invoiceIds.push(invId)
  log.assert('建票关联到 A 成功', created.status === 201, `status=${created.status}`)

  // ① 改关联 A → B（旧 cur.sourceId 不得与新单号冲突而误报）
  const re = await http.put(`/api/accounting/invoices/${invId}`, { token, json: { sourceNo: b.orderNo } })
  log.assert('★ 改关联（A→B）成功，旧 id 不误报冲突', re.status === 200, `status=${re.status} msg=${re.message}`)
  const [rowB] = await dbQuery(pool, 'SELECT source_type, source_id, source_no FROM fin_invoices WHERE id=?', [invId])
  log.assert(
    '★ 改后关联指向新单 B',
    Number(rowB?.source_id) === Number(b.orderId) && rowB?.source_no === b.orderNo,
    JSON.stringify(rowB),
  )

  // ② 部分更新：只改备注、不涉及关联 → 原关联保持
  const partial = await http.put(`/api/accounting/invoices/${invId}`, { token, json: { remark: '只改备注' } })
  log.assert('部分更新成功', partial.status === 200, `status=${partial.status}`)
  const [rowKeep] = await dbQuery(pool, 'SELECT source_id, source_no FROM fin_invoices WHERE id=?', [invId])
  log.assert(
    '★ 未提供 sourceNo 的部分更新保持原关联',
    Number(rowKeep?.source_id) === Number(b.orderId) && rowKeep?.source_no === b.orderNo,
    JSON.stringify(rowKeep),
  )

  // ③ 清关联：显式传 null → 必须真清空（旧 id 不得复活）
  const cleared = await http.put(`/api/accounting/invoices/${invId}`, { token, json: { sourceNo: null } })
  log.assert('清空关联成功', cleared.status === 200, `status=${cleared.status}`)
  const [rowNull] = await dbQuery(pool, 'SELECT source_type, source_id, source_no FROM fin_invoices WHERE id=?', [invId])
  log.assert(
    '★ 清空后关联真为 NULL（旧 cur.sourceId 不得把它建回来）',
    rowNull?.source_id === null && rowNull?.source_type === null && rowNull?.source_no === null,
    JSON.stringify(rowNull),
  )

  // ④ 仅给 id 建票（单号已回填）→ 该行必须能再次编辑且关联仍在
  const onlyId = await postInvoice(http, token, { sourceType: 'sale_order', sourceId: a.orderId })
  const onlyIdInv = Number(onlyId.data?.data?.id)
  if (Number.isInteger(onlyIdInv)) cleanup.invoiceIds.push(onlyIdInv)
  log.assert('仅给 id 建票成功', onlyId.status === 201, `status=${onlyId.status}`)
  const again = await http.put(`/api/accounting/invoices/${onlyIdInv}`, { token, json: { remark: '再次编辑' } })
  log.assert('★ 仅给 id（单号已回填）的行可再次编辑', again.status === 200, `status=${again.status}`)
  const [rowAgain] = await dbQuery(pool, 'SELECT source_type, source_id, source_no FROM fin_invoices WHERE id=?', [onlyIdInv])
  log.assert(
    '★ 再次编辑后关联仍在',
    Number(rowAgain?.source_id) === Number(a.orderId) && rowAgain?.source_no === a.orderNo,
    JSON.stringify(rowAgain),
  )
}

async function main() {
  const log = createLogger()
  const ctx = await prepareSmokeContext()
  const { pool } = ctx
  // 本场景自建夹具的精确 ID，收尾自洁（本文件既有四个场景原无清理，此处不依赖也不改变其行为）
  const cleanup = { orderIds: [], poIds: [], invoiceIds: [] }
  try {
    const { token } = await login(ctx.http, 'smoke_admin', 'SmokeAdmin123!')
    if (!token) throw new Error('登录失败，无法执行开票量校验回归')

    await scenarioOverQuotaBlocked(ctx, log, token)
    await scenarioRedFlushRestoresQuota(ctx, log, token)
    await scenarioEditExcludesSelf(ctx, log, token)
    await scenarioNoQuotaBypass(ctx, log, token)
    await scenarioSourceTypeSale(ctx, log, token, cleanup)
    await scenarioSourceTypePurchase(ctx, log, token, cleanup)
    await scenarioEditSelfHealsSourceType(ctx, log, token, cleanup)
    await scenarioClearingSourceNoClearsLink(ctx, log, token, cleanup)
    await scenarioInvoiceBeforeShipmentKeepsLink(ctx, log, token, cleanup)
    await scenarioExplicitSourceInputContract(ctx, log, token, cleanup)
    await scenarioUpdateSourceIntent(ctx, log, token, cleanup)
  } finally {
    // 按精确 ID 清理本轮自建夹具（共享库自洁）
    const safe = async (sql, params) => { try { await pool.query(sql, params) } catch (e) { console.error(`[清理告警] ${e.message}`) } }
    for (const id of cleanup.invoiceIds) await safe('DELETE FROM fin_invoices WHERE id=?', [id])
    for (const id of cleanup.orderIds) {
      await safe('DELETE FROM payment_records WHERE type=2 AND order_id=?', [id])
      await safe('DELETE FROM sale_orders WHERE id=?', [id])
    }
    for (const id of cleanup.poIds) {
      await safe('DELETE FROM payment_records WHERE type=1 AND order_id=?', [id])
      await safe('DELETE FROM purchase_orders WHERE id=?', [id])
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
