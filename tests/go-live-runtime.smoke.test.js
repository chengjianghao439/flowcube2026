'use strict'

/**
 * H1–H6/F1–F6 runtime acceptance. Only the root-owned ephemeral runner may execute.
 * No migrations, shared fixtures, full-table deletion, business mocks, worker startup or forced exit.
 * Credentials are synthetic and never emitted; IDs/quantities are retained for root-side diagnosis.
 * Automated PDA headers / print client ACK are API evidence, not physical-device/paper evidence.
 */
const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { makeGoLiveRuntimeFixture, must, units4, text4 } = require('./helpers/goLiveRuntimeFixture')
const { PERMISSIONS: P } = require('../backend/src/constants/permissions')
const ctx = makeGoLiveRuntimeFixture()

before(async () => { await ctx.setup() })
after(async () => { await ctx.close() })

function rejected(response, status, code, message) {
  assert.equal(response.status, status, `[BUSINESS] 预期拒绝HTTP ${status}，实际${response.status}: ${response.data?.message ?? ''}`)
  assert.equal(response.data.success, false)
  if (code) assert.equal(response.data.code, code)
  if (message) assert.equal(response.data.message, message)
}
async function source(product, handlingType, quantity) {
  const body = { intentUuid: randomUUID(), operationUuid: randomUUID(), productId: product.id, warehouseId: ctx.warehouse.id, unit: product.unit, handlingType, quantity }
  const key = randomUUID(), ack = must(await ctx.post('/disposals/handling-sources', body, { key }))
  ctx.remember('sources', ack.id)
  assert.equal(ack.revision, 1)
  assert.deepEqual(await ctx.ok('POST', '/disposals/handling-sources', body, { key }), ack)
  const own = await handlingOwn(body.operationUuid, 'disposal.handling.source.create', key, body.intentUuid)
  assert.equal(own.status, 'success'); assert.deepEqual(own.data, ack)
  return { ...ack, body, key }
}
const sourceView = id => ctx.ok('GET', `/disposals/handling-sources/${id}`)
async function reference(s) {
  return { sourceId: s.id, expectedRevision: (await sourceView(s.id)).revision, operationUuid: randomUUID() }
}
const linkFor = sourceId => ctx.one('SELECT * FROM disposal_handling_links WHERE source_id=? ORDER BY id DESC LIMIT 1', [sourceId])
async function handlingOwn(operationUuid, action, requestKey, intentUuid, user = 'creator') {
  const query = new URLSearchParams({ action, requestKey, ...(intentUuid ? { intentUuid } : {}) })
  return ctx.ok('GET', `/disposals/handling-operations/${operationUuid}?${query}`, undefined, { user })
}
async function release(s, { user = 'creator' } = {}) {
  const current = await sourceView(s.id), link = await linkFor(s.id)
  const key = randomUUID(), body = { operationUuid: randomUUID(), expectedRevision: current.revision, reason: '验收合成：准确原目标及实物已闭合，解除未执行基本量' }
  const route = `/disposals/handling-sources/${s.id}/links/${link.id}/release`
  const beforeStock = await ctx.stock(s.productId), beforeFunds = await ctx.rows('SELECT id,amount FROM finance_account_transactions WHERE account_id IN (?,?) ORDER BY id', [ctx.payer.id, ctx.income.id])
  const ack = await ctx.ok('POST', route, body, { key, user })
  assert.equal(await ctx.stock(s.productId), beforeStock, '[BUSINESS] 来源解除不能替代实物执行')
  assert.deepEqual(await ctx.rows('SELECT id,amount FROM finance_account_transactions WHERE account_id IN (?,?) ORDER BY id', [ctx.payer.id, ctx.income.id]), beforeFunds, '[BUSINESS] 来源解除不能生成现金')
  assert.deepEqual(await ctx.ok('POST', route, body, { key, user }), ack, '[BUSINESS] 解除同键必须返原永久ACK')
  const own = await handlingOwn(body.operationUuid, `disposal.handling.link.release.${link.id}`, key, s.intentUuid, user)
  assert.equal(own.status, 'success'); assert.deepEqual(own.data, ack)
  return ack
}
function budget(view, expected) {
  for (const [name, value] of Object.entries(expected)) assert.equal(view.budget[name], value, `[BUSINESS] ${name}`)
}
async function statement(purchase) {
  const result = await ctx.ok('POST', '/payments/statements', { type: 1, partyName: ctx.supplier.name, recordIds: [purchase.apId] }, {}, 'FIXTURE')
  await ctx.ok('POST', `/payments/statements/${result.id}/confirm`, {}, { user: 'approver' }, 'FIXTURE')
  return result
}
async function pay(purchase, amount, { receipt = false, statementId = null } = {}) {
  if (receipt) {
    const result = await ctx.ok('POST', '/payments/receipts', { type: 1, partyId: ctx.supplier.id, partyName: ctx.supplier.name, amount, paymentDate: ctx.today,
      accountId: ctx.payer.id, allocations: [{ ...(statementId ? { statementId } : { recordId: purchase.apId }), amount }] }, {}, 'FIXTURE')
    const entry = await ctx.one('SELECT * FROM payment_entries WHERE receipt_id=? AND record_id=?', [result.id, purchase.apId])
    assert.ok(entry, '[FIXTURE] 真实汇款核销未返回准确原分配')
    return entry
  }
  const result = await ctx.ok('POST', `/payments/${purchase.apId}/pay`, { amount, paymentDate: ctx.today, accountId: ctx.payer.id }, {}, 'FIXTURE')
  const entry = await ctx.one('SELECT * FROM payment_entries WHERE id=? AND record_id=?', [result.entryId, purchase.apId])
  assert.ok(entry, '[FIXTURE] 真实直付未返回准确原分配')
  return entry
}
async function originalPayments(purchase) {
  const entries = await ctx.rows('SELECT * FROM payment_entries WHERE record_id=? ORDER BY id', [purchase.apId])
  const receiptIds = entries.filter(row => row.receipt_id != null).map(row => Number(row.receipt_id))
  const receipts = receiptIds.length ? await ctx.rows('SELECT * FROM payment_receipts WHERE id IN (?) ORDER BY id', [receiptIds]) : []
  const outputs = await ctx.rows('SELECT * FROM finance_account_transactions WHERE biz_type=2 AND (biz_no=? OR biz_no IN (?)) ORDER BY id', [purchase.orderNo, receipts.length ? receipts.map(row => row.receipt_no) : ['unmatched-synthetic-number']])
  return { entries, receipts, outputs }
}
async function refund(pr, entry, amount, { date = ctx.today, allocations } = {}) {
  const body = { operationUuid: randomUUID(), purchaseReturnId: pr.id, incomeAccountId: ctx.income.id, refundDate: date, amount, allocations: allocations || [{ entryId: Number(entry.id), amount }] }
  const key = randomUUID(), ack = await ctx.ok('POST', '/supplier-refunds', body, { key })
  ctx.remember('refunds', ack.id)
  assert.deepEqual(ack, { id: ack.id, refundNo: ack.refundNo, status: 1 })
  assert.equal(ack.refundNo.length, 27)
  const query = await refundOwn(body.operationUuid, 'supplier.refund.create', key)
  assert.equal(query.status, 'success'); assert.deepEqual(query.data, ack)
  return { ...ack, body, key }
}
async function confirmRefund(rf) {
  const body = { operationUuid: randomUUID() }, key = randomUUID()
  rejected(await ctx.post(`/supplier-refunds/${rf.id}/confirm`, body, { key }), 403, 'SELF_APPROVAL_FORBIDDEN')
  const ack = await ctx.ok('POST', `/supplier-refunds/${rf.id}/confirm`, body, { key, user: 'approver' })
  assert.equal(ack.status, 2)
  return ack
}
async function refundOwn(operationUuid, action, requestKey, user = 'creator') {
  const query = new URLSearchParams({ action, requestKey })
  return ctx.ok('GET', `/supplier-refunds/operations/${operationUuid}?${query}`, undefined, { user })
}
async function funds(purchase) {
  return {
    ap: await ctx.one('SELECT total_amount,paid_amount,balance,status,confirm_status FROM payment_records WHERE id=?', [purchase.apId]),
    account: await ctx.one('SELECT opening_balance,current_balance FROM finance_accounts WHERE id=?', [ctx.income.id]),
    incoming: await ctx.rows('SELECT t.* FROM finance_account_transactions t JOIN supplier_refund_orders r ON r.id=t.biz_id WHERE t.biz_type=6 AND r.payment_record_id=? ORDER BY t.id', [purchase.apId]),
  }
}
async function receive(rf, { user = 'creator' } = {}) {
  const body = { operationUuid: randomUUID() }, key = randomUUID()
  const ack = await ctx.ok('POST', `/supplier-refunds/${rf.id}/receive`, body, { user, key })
  assert.deepEqual(ack, { id: rf.id, refundNo: rf.refundNo, status: 3, fundTransactionId: ack.fundTransactionId, amount: text4(rf.body.amount), message: '回款已登记，凭证结果见详情' })
  const own = await refundOwn(body.operationUuid, `supplier.refund.receive.${rf.id}`, key, user)
  assert.equal(own.status, 'success'); assert.deepEqual(own.data, ack)
  return { ack, body, key, user }
}
async function assertReceived(purchase, rf, received, before, original) {
  const after = await funds(purchase), amount = units4(rf.body.amount)
  assert.equal(units4(after.ap.paid_amount), units4(before.ap.paid_amount) - amount)
  assert.equal(units4(after.ap.balance), units4(before.ap.balance) + amount)
  assert.equal(after.ap.total_amount, before.ap.total_amount)
  assert.equal(after.ap.confirm_status, before.ap.confirm_status)
  assert.equal(units4(after.account.current_balance), units4(before.account.current_balance) + amount)
  assert.deepEqual(await originalPayments(purchase), original, '[BUSINESS] 原entry/receipt/OUT本金与日期必须保持')
  const transaction = await ctx.one('SELECT * FROM finance_account_transactions WHERE id=?', [received.ack.fundTransactionId])
  assert.deepEqual([Number(transaction.direction), Number(transaction.biz_type), Number(transaction.biz_id), transaction.biz_no, Number(transaction.account_id)], [1, 6, rf.id, rf.refundNo, ctx.income.id])
  assert.equal(text4(transaction.amount), text4(rf.body.amount))
  assert.equal(transaction.happened_at.slice(0, 10), rf.body.refundDate)
  const allocations = await ctx.rows('SELECT entry_id,amount,budget_state FROM supplier_refund_allocations WHERE refund_id=? ORDER BY entry_id', [rf.id])
  assert.deepEqual(allocations.map(row => [Number(row.entry_id), text4(row.amount), row.budget_state]), rf.body.allocations.map(row => [row.entryId, text4(row.amount), 'received']).sort((a, b) => a[0] - b[0]))
  const events = await ctx.rows("SELECT * FROM party_ledger_events WHERE event_type='SUPPLIER_REFUND_IN' AND baseline_key=?", [`supplier_refund:${rf.id}`])
  assert.equal(events.length, 1)
  assert.deepEqual([Number(events[0].party_id), Number(events[0].record_id), Number(events[0].order_id), text4(events[0].delta), events[0].business_date], [ctx.supplier.id, purchase.apId, purchase.id, text4(rf.body.amount), rf.body.refundDate])
  const read = await ctx.ok('GET', `/finance/accounts/${ctx.income.id}/transactions?bizType=6&keyword=${encodeURIComponent(rf.refundNo)}`)
  assert.equal(read.list.length, 1)
  assert.equal(read.list[0].id, received.ack.fundTransactionId)
  assert.equal(read.list[0].bizTypeName, '供应商退款')
  assert.equal(text4(read.list[0].amount), text4(rf.body.amount))
  return after
}
async function assertVoucher(rf, received, projected, voucherDate = rf.body.refundDate) {
  const head = await ctx.one('SELECT voucher_id,voucher_generate_error FROM supplier_refund_orders WHERE id=?', [rf.id])
  const vouchers = await ctx.rows("SELECT * FROM acct_vouchers WHERE company_id=1 AND source_type='supplier_refund_in' AND source_id=? ORDER BY id", [received.ack.fundTransactionId])
  if (projected === '0.00') {
    assert.equal(vouchers.length, 0, '[BUSINESS] 零分真实回款不得生成零额凭证')
    assert.equal(head.voucher_id, null)
    assert.equal(head.voucher_generate_error, '零分投影已核对/无需凭证')
    return
  }
  assert.equal(vouchers.length, 1, '[BUSINESS] 已收资金应准确对应唯一分位凭证')
  const voucher = vouchers[0]
  assert.equal(Number(voucher.id), Number(head.voucher_id))
  assert.equal(head.voucher_generate_error, null)
  assert.equal(voucher.source_no, rf.refundNo)
  assert.equal(voucher.voucher_date, voucherDate)
  assert.equal(voucher.period, voucherDate.replaceAll('-', '').slice(0, 6))
  assert.equal(text4(voucher.total_debit), text4(projected))
  assert.equal(text4(voucher.total_credit), text4(projected))
  const legs = await ctx.rows('SELECT account_code,direction,amount,aux_type,aux_id,aux_name FROM acct_voucher_entries WHERE voucher_id=? ORDER BY line_no', [voucher.id])
  assert.deepEqual(legs.map(row => [row.account_code, Number(row.direction), text4(row.amount)]), [['1002', 1, text4(projected)], ['2202', 2, text4(projected)]])
  assert.deepEqual([Number(legs[1].aux_type), Number(legs[1].aux_id), legs[1].aux_name], [1, ctx.supplier.id, ctx.supplier.name])
}

test('本轮真实事务与API验收', { concurrency: false }, async t => {
  await t.test('H普通销售：当前来源Q10/A6，真实部分出库2后终结仅解除4', async () => {
    const purchase = await ctx.purchase({ packages: [2, 8] }), product = purchase.product
    const s = await source(product, 1, 10)
    assert.equal(await ctx.stock(product.id), 10, '创建意图不是扣库或预占')
    const ref = await reference(s), body = ctx.saleBody(product, 6, { disposalSource: ref }), key = randomUUID()
    const sale = await ctx.ok('POST', '/sale', body, { key }); ctx.remember('sales', sale.id)
    assert.deepEqual(await ctx.ok('POST', '/sale', body, { key }), sale)
    const link = await linkFor(s.id), line = await ctx.one('SELECT * FROM sale_order_items WHERE order_id=?', [sale.id])
    assert.deepEqual([link.target_type, Number(link.target_id), Number(link.target_line_id), Number(link.allocated_quantity)], ['sale_order', sale.id, Number(line.id), 6])
    assert.equal(Number((await ctx.one('SELECT disposal_handling_link_id FROM sale_orders WHERE id=?', [sale.id])).disposal_handling_link_id), Number(link.id))
    budget(await sourceView(s.id), { availableQuantity: 4, actualExecutedQuantity: 0, progress: '已关联待执行' })
    const beforeFailed = await ctx.rows('SELECT * FROM disposal_handling_links WHERE source_id=?', [s.id])
    rejected(await ctx.put(`/sale/${sale.id}`, ctx.saleBody(product, 6)), 409, 'DISPOSAL_HANDLING_TARGET_EDIT_FORBIDDEN')
    assert.deepEqual(await ctx.rows('SELECT * FROM disposal_handling_links WHERE source_id=?', [s.id]), beforeFailed)
    await ctx.ok('POST', `/sale/${sale.id}/reserve`, { items: [{ id: Number(line.id), warehouseId: ctx.warehouse.id, warehouseName: ctx.warehouse.name, qty: 6 }] })
    budget(await sourceView(s.id), { actualExecutedQuantity: 0, availableQuantity: 4 })
    rejected(await ctx.post(`/disposals/handling-sources/${s.id}/links/${link.id}/release`, { operationUuid: randomUUID(), expectedRevision: 2, reason: '尚未终结不能解除' }), 409, 'DISPOSAL_HANDLING_RELEASE_PENDING')
    await ctx.ok('POST', `/sale/${sale.id}/ship`, { items: [{ id: Number(line.id), qty: 2 }] })
    const task = await ctx.one('SELECT id FROM warehouse_tasks WHERE sale_order_id=?', [sale.id])
    await ctx.shipTask(Number(task.id), purchase.containers[0])
    assert.equal(await ctx.stock(product.id), 8)
    budget(await sourceView(s.id), { actualExecutedQuantity: 2, progress: '部分执行', availableQuantity: 4 })
    const logs = await ctx.rows("SELECT quantity FROM inventory_logs WHERE ref_type='warehouse_task' AND ref_id=? AND move_type=8 AND type=2", [task.id])
    assert.equal(logs.reduce((sum, row) => sum + Number(row.quantity), 0), 2)
    await ctx.ok('POST', `/sale/${sale.id}/cancel`, {})
    assert.equal(Number((await ctx.one('SELECT status FROM sale_orders WHERE id=?', [sale.id])).status), 4)
    const released = await release(s)
    assert.deepEqual([released.executedQuantity, released.releasedQuantity], [2, 4])
    budget(await sourceView(s.id), { intentionQuantity: 10, allocatedQuantity: 6, releasedQuantity: 4, consumedQuantity: 2, availableQuantity: 8, actualExecutedQuantity: 2 })
    const fixed = await linkFor(s.id)
    assert.deepEqual([fixed.state, Number(fixed.allocated_quantity), Number(fixed.final_executed_quantity), Number(fixed.released_quantity)], ['TERMINATED', 6, 2, 4])
    // Frozen original create ACK survives current line shrink and source revision growth.
    assert.deepEqual((await handlingOwn(ref.operationUuid, 'disposal.handling.sale.create', key, s.intentUuid)).data, sale)
  })

  await t.test('H准确采购退货：真实全量实发可冻结R0，未发取消只解除A且不动钱', async () => {
    const purchase = await ctx.purchase({ packages: [2, 8] })
    const s = await source(purchase.product, 2, 4)
    const pr = await ctx.returnPurchase(purchase, 2, { disposalSource: await reference(s) })
    const link = await linkFor(s.id), line = await ctx.one('SELECT * FROM purchase_return_items WHERE return_id=?', [pr.id])
    assert.equal(Number(line.purchase_item_id), purchase.itemId)
    assert.equal(Number(link.target_line_id), Number(line.id))
    await ctx.ok('POST', `/returns/purchase/${pr.id}/confirm`, {}, { user: 'approver' })
    const task = await ctx.one("SELECT id FROM warehouse_tasks WHERE task_type='purchase_return' AND return_id=?", [pr.id])
    const beforeCash = await ctx.rows('SELECT id FROM finance_account_transactions WHERE account_id IN (?,?) ORDER BY id', [ctx.payer.id, ctx.income.id])
    await ctx.shipTask(Number(task.id), purchase.containers[0])
    assert.equal(Number((await ctx.one('SELECT status FROM purchase_returns WHERE id=?', [pr.id])).status), 3)
    assert.equal(await ctx.stock(purchase.product.id), 8)
    const full = await release(s)
    assert.deepEqual([full.executedQuantity, full.releasedQuantity], [2, 0])
    budget(await sourceView(s.id), { availableQuantity: 2, actualExecutedQuantity: 2, releasedQuantity: 0 })
    assert.equal((await linkFor(s.id)).state, 'TERMINATED', 'R0仍是已终结冻结')
    const cancelFacts = async () => ({ head: await ctx.one('SELECT * FROM purchase_returns WHERE id=?', [pr.id]),
      tasks: await ctx.rows("SELECT * FROM warehouse_tasks WHERE task_type='purchase_return' AND return_id=? ORDER BY id", [pr.id]),
      link: await linkFor(s.id), source: await sourceView(s.id), stock: await ctx.stock(purchase.product.id), money: await funds(purchase),
      logs: await ctx.rows("SELECT * FROM inventory_logs WHERE ref_type='warehouse_task' AND ref_id=? ORDER BY id", [task.id]) })
    const beforeCancel = await cancelFacts()
    rejected(await ctx.post(`/returns/purchase/${pr.id}/cancel`, {}), 400, null, '已退货的单据不能取消')
    assert.deepEqual(await cancelFacts(), beforeCancel, '已实发PR取消拒绝不得改原单、任务、冻结来源、库存、日志或资金')
    const s2 = await source(purchase.product, 2, 3), stopped = await ctx.returnPurchase(purchase, 1, { disposalSource: await reference(s2) })
    await ctx.ok('POST', `/returns/purchase/${stopped.id}/cancel`, {})
    const zero = await release(s2)
    assert.deepEqual([zero.executedQuantity, zero.releasedQuantity], [0, 1])
    budget(await sourceView(s2.id), { availableQuantity: 3, actualExecutedQuantity: 0 })
    assert.deepEqual(await ctx.rows('SELECT id FROM finance_account_transactions WHERE account_id IN (?,?) ORDER BY id', [ctx.payer.id, ctx.income.id]), beforeCash)
  })

  await t.test('H普通报废：取消解除与重新审批执行，不把批准当E', async () => {
    const purchase = await ctx.purchase({ quantity: 8 }), s = await source(purchase.product, 3, 5)
    const create = async quantity => {
      const made = await ctx.ok('POST', '/disposals', { warehouseId: ctx.warehouse.id, warehouseName: ctx.warehouse.name,
        disposalSource: await reference(s), items: [{ productId: purchase.product.id, quantity, disposeType: 3 }] })
      ctx.remember('disposals', made.id); return made
    }
    const stopped = await create(2)
    await ctx.ok('POST', `/disposals/${stopped.id}/cancel`, {})
    const cancelled = await release(s)
    assert.deepEqual([cancelled.executedQuantity, cancelled.releasedQuantity], [0, 2])
    budget(await sourceView(s.id), { availableQuantity: 5, actualExecutedQuantity: 0 })
    const active = await create(3)
    await ctx.ok('POST', `/disposals/${active.id}/submit`, {})
    rejected(await ctx.post(`/disposals/${active.id}/approve`, {}), 403)
    await ctx.ok('POST', `/disposals/${active.id}/approve`, {}, { user: 'approver' })
    budget(await sourceView(s.id), { actualExecutedQuantity: 0, availableQuantity: 2 })
    assert.equal(await ctx.stock(purchase.product.id), 8)
    const key = randomUUID(), disposed = await ctx.ok('POST', `/disposals/${active.id}/dispose`, {}, { key })
    assert.deepEqual(await ctx.ok('POST', `/disposals/${active.id}/dispose`, {}, { key }), disposed)
    assert.equal(await ctx.stock(purchase.product.id), 5)
    const scrap = await ctx.rows('SELECT quantity FROM disposal_scrapped WHERE disposal_id=?', [active.id])
    assert.equal(scrap.length, 1); assert.equal(Number(scrap[0].quantity), 3)
    const executed = await release(s)
    assert.deepEqual([executed.executedQuantity, executed.releasedQuantity], [3, 0])
    budget(await sourceView(s.id), { availableQuantity: 2, actualExecutedQuantity: 3 })
  })

  await t.test('H旧批准mixed整单：逐原行签认不可变意图，mixed3重走新草稿审批', async () => {
    const purchase = await ctx.purchase(), product = purchase.product
    // This is a historical evidence fixture, never a simulated new approval/execution.
    const [inserted] = await ctx.pool.query(`INSERT INTO inventory_disposal_orders(disposal_no,warehouse_id,warehouse_name,status,total_value,operator_id,operator_name,approved_by,approved_by_name,approved_at)
      VALUES (?,?,?,3,42.7500,?,?,?,?,?)`, [`${ctx.mark}-LEGACY`, ctx.warehouse.id, ctx.warehouse.name, ctx.users.creator.id, ctx.users.creator.username, ctx.users.approver.id, ctx.users.approver.username, '2026-09-01 10:00:00'])
    const id = ctx.remember('disposals', inserted.insertId)
    await ctx.pool.query('INSERT INTO inventory_disposal_items(disposal_id,product_id,product_code,product_name,unit,quantity,unit_value,dispose_type) VALUES ?',
      [[1, 2, 3].map((type, index) => [id, product.id, product.code, `${product.name}-历史行${index}`, product.unit, [2, 3, 1][index], '7.1250', type])])
    const before = { head: await ctx.one('SELECT * FROM inventory_disposal_orders WHERE id=?', [id]), items: await ctx.rows('SELECT * FROM inventory_disposal_items WHERE disposal_id=? ORDER BY id', [id]) }
    const physical = await ctx.stock(product.id), fundsBefore = await ctx.rows('SELECT id FROM finance_account_transactions WHERE account_id IN (?,?) ORDER BY id', [ctx.payer.id, ctx.income.id])
    const preview = await ctx.ok('GET', `/disposals/${id}/conversion-snapshot`)
    assert.equal(preview.snapshot.items.length, 3)
    const key = randomUUID(), body = { operationUuid: randomUUID(), snapshotFingerprint: preview.snapshotFingerprint, reason: '验收合成：整单原批准mixed1/2/3仅签认处理意图' }
    rejected(await ctx.post(`/disposals/${id}/sign-conversion`, body, { key }), 403, 'SELF_APPROVAL_DENIED')
    const ack = await ctx.ok('POST', `/disposals/${id}/sign-conversion`, body, { key, user: 'approver' })
    assert.equal(ack.sources.length, 3)
    assert.deepEqual(ack.sources.map(row => [row.legacyItemId, row.handlingType, row.quantity, row.revision]), before.items.map(row => [Number(row.id), Number(row.dispose_type), Number(row.quantity), 1]))
    for (const s of ack.sources) ctx.remember('sources', s.sourceId)
    assert.deepEqual(await ctx.one('SELECT * FROM inventory_disposal_orders WHERE id=?', [id]), before.head)
    assert.deepEqual(await ctx.rows('SELECT * FROM inventory_disposal_items WHERE disposal_id=? ORDER BY id', [id]), before.items)
    assert.equal(await ctx.stock(product.id), physical)
    assert.deepEqual(await ctx.rows('SELECT id FROM finance_account_transactions WHERE account_id IN (?,?) ORDER BY id', [ctx.payer.id, ctx.income.id]), fundsBefore)
    assert.equal((await ctx.rows("SELECT id FROM inventory_logs WHERE ref_type='disposal' AND ref_id=?", [id])).length, 0)
    assert.deepEqual(await ctx.ok('POST', `/disposals/${id}/sign-conversion`, body, { key, user: 'approver' }), ack)
    rejected(await ctx.post(`/disposals/${id}/sign-conversion`, { ...body, operationUuid: randomUUID() }, { user: 'approver' }), 409, 'DISPOSAL_ALREADY_CONVERTED')
    rejected(await ctx.post(`/disposals/${id}/dispose`, {}), 409, 'DISPOSAL_ALREADY_CONVERTED')
    const scrapSource = ack.sources.find(row => row.handlingType === 3), s = { ...scrapSource, id: scrapSource.sourceId }
    const fresh = await ctx.ok('POST', '/disposals', { warehouseId: ctx.warehouse.id, warehouseName: ctx.warehouse.name,
      disposalSource: await reference(s), items: [{ productId: product.id, quantity: 1, disposeType: 3 }] })
    ctx.remember('disposals', fresh.id)
    assert.equal(Number((await ctx.one('SELECT status FROM inventory_disposal_orders WHERE id=?', [fresh.id])).status), 1)
    const draftFacts = async () => ({ head: await ctx.one('SELECT * FROM inventory_disposal_orders WHERE id=?', [fresh.id]),
      items: await ctx.rows('SELECT * FROM inventory_disposal_items WHERE disposal_id=? ORDER BY id', [fresh.id]),
      containers: await ctx.rows('SELECT * FROM inventory_containers WHERE product_id=? AND warehouse_id=? ORDER BY id', [product.id, ctx.warehouse.id]),
      source: await sourceView(s.id), stock: await ctx.stock(product.id), money: await funds(purchase),
      logs: await ctx.rows("SELECT * FROM inventory_logs WHERE ref_type='disposal' AND ref_id=? ORDER BY id", [fresh.id]),
      scrap: await ctx.rows('SELECT * FROM disposal_scrapped WHERE disposal_id=? ORDER BY id', [fresh.id]),
      operations: await ctx.rows("SELECT * FROM operation_requests WHERE resource_type='inventory_disposal' AND resource_id=? ORDER BY id", [fresh.id]) })
    const beforeDraft = await draftFacts()
    rejected(await ctx.post(`/disposals/${fresh.id}/dispose`, {}), 400, null, '处置单尚未提交')
    assert.deepEqual(await draftFacts(), beforeDraft, '未提交mixed3新草稿拒绝执行不得产生扣库、报废日志、操作回执或资金')
    await ctx.ok('POST', `/disposals/${fresh.id}/submit`, {})
    await ctx.ok('POST', `/disposals/${fresh.id}/approve`, {}, { user: 'approver' })
    await ctx.ok('POST', `/disposals/${fresh.id}/dispose`, {})
    const final = await release(s, { user: 'approver' })
    assert.deepEqual([final.executedQuantity, final.releasedQuantity], [1, 0])
    const original = await handlingOwn(body.operationUuid, `disposal.handling.legacy.convert.${id}`, key, null, 'approver')
    assert.equal(original.status, 'success'); assert.deepEqual(original.data, ack, '签认原ACK仍是revision1全行')
  })

  await t.test('F准确原付款：部分四位回款、AP/资金/对账/往来/凭证及实物退货无二次现金', async () => {
    const purchase = await ctx.purchase({ packages: [4, 6] }), st = await statement(purchase)
    const direct = await pay(purchase, 60), receipt = await pay(purchase, 40, { receipt: true, statementId: st.id })
    const pr = await ctx.returnPurchase(purchase, 4), original = await originalPayments(purchase)
    assert.equal(original.entries.length, 2); assert.equal(original.outputs.length, 2)
    const invalidConfirm = await ctx.post(`/returns/purchase/${pr.id}/confirm`, {}, { user: 'approver' })
    rejected(invalidConfirm, 409, 'PURCHASE_RETURN_REFUND_REQUIRED')
    assert.equal(invalidConfirm.data.data.purchaseReturnId, pr.id)
    // The wrong entry is a real positive payment/OUT from another real received PO.
    const otherPurchase = await ctx.purchase(), otherEntry = await pay(otherPurchase, 100)
    assert.notEqual(Number(otherEntry.record_id), purchase.apId)
    const otherOriginal = await originalPayments(otherPurchase)
    assert.equal(otherOriginal.entries.length, 1); assert.equal(otherOriginal.outputs.length, 1)
    const unrelated = { operationUuid: randomUUID(), purchaseReturnId: pr.id, incomeAccountId: ctx.income.id,
      refundDate: ctx.today, amount: '1.0000', allocations: [{ entryId: Number(otherEntry.id), amount: '1.0000' }] }
    const bothBefore = [await funds(purchase), await funds(otherPurchase)]
    const cashBefore = await ctx.rows('SELECT * FROM finance_accounts WHERE id IN (?,?) ORDER BY id', [ctx.payer.id, ctx.income.id])
    const transactionsBefore = await ctx.rows('SELECT * FROM finance_account_transactions WHERE account_id IN (?,?) ORDER BY id', [ctx.payer.id, ctx.income.id])
    // Current source.payments rejects an entry outside this AP before assertBudget.
    rejected(await ctx.post('/supplier-refunds', unrelated), 409, 'SUPPLIER_REFUND_SOURCE_INVALID')
    assert.equal((await ctx.rows('SELECT id FROM supplier_refund_orders WHERE purchase_return_id=?', [pr.id])).length, 0)
    assert.equal((await ctx.rows('SELECT id FROM supplier_refund_allocations WHERE purchase_return_id=? OR entry_id=?', [pr.id, otherEntry.id])).length, 0)
    assert.equal((await ctx.rows('SELECT operation_uuid FROM supplier_refund_operations WHERE operation_uuid=?', [unrelated.operationUuid])).length, 0)
    assert.deepEqual([await funds(purchase), await funds(otherPurchase)], bothBefore)
    assert.deepEqual(await ctx.rows('SELECT * FROM finance_accounts WHERE id IN (?,?) ORDER BY id', [ctx.payer.id, ctx.income.id]), cashBefore)
    assert.deepEqual(await ctx.rows('SELECT * FROM finance_account_transactions WHERE account_id IN (?,?) ORDER BY id', [ctx.payer.id, ctx.income.id]), transactionsBefore)
    assert.deepEqual(await originalPayments(purchase), original)
    assert.deepEqual(await originalPayments(otherPurchase), otherOriginal)
    const read = await ctx.ok('GET', `/supplier-refunds/source?purchaseReturnId=${pr.id}`)
    assert.deepEqual([read.purchaseOrderId, read.purchaseReturnId, read.paymentRecordId, read.grossAmount, read.currentPaidAmount, read.availableAmount], [purchase.id, pr.id, purchase.apId, '40.0000', '100.0000', '40.0000'])
    const directProof = read.entries.find(row => row.entryId === Number(direct.id)), receiptProof = read.entries.find(row => row.entryId === Number(receipt.id))
    assert.equal(directProof.receiptId, null)
    assert.equal(directProof.out.bizNo, purchase.orderNo)
    assert.equal(receiptProof.receiptId, Number(receipt.receipt_id))
    assert.equal(receiptProof.entryAccountId, null)
    assert.equal(receiptProof.out.bizNo, original.receipts[0].receipt_no)
    assert.equal(Number(receiptProof.out.bizId), Number(receipt.receipt_id))
    const rf = await refund(pr, direct, '30.1234')
    const before = await funds(purchase)
    await confirmRefund(rf)
    assert.deepEqual(await funds(purchase), before, '确认只占额度，不收钱')
    rejected(await ctx.post(`/returns/purchase/${pr.id}/confirm`, {}, { user: 'approver' }), 409, 'SUPPLIER_REFUND_PENDING')
    const got = await receive(rf)
    const after = await assertReceived(purchase, rf, got, before, original)
    assert.equal(after.ap.paid_amount, '69.8766')
    assert.equal(after.ap.balance, '30.1234')
    await assertVoucher(rf, got, '30.12')
    const storedStatement = await ctx.one('SELECT total_amount,settled_amount,balance FROM reconciliation_statements WHERE id=?', [st.id])
    assert.deepEqual(storedStatement, { total_amount: '100.0000', settled_amount: '69.8766', balance: '30.1234' })
    const statementRead = await ctx.ok('GET', `/payments/statements/${st.id}`)
    assert.equal(text4(statementRead.settledAmount), '69.8766')
    const ledger = await ctx.ok('GET', `/payments/party-ledger?type=1&partyId=${ctx.supplier.id}&pageSize=100`)
    const event = ledger.list.find(row => row.documentNo === rf.refundNo && row.eventType === 'SUPPLIER_REFUND_IN')
    assert.ok(event); assert.equal(text4(event.increase), '30.1234')
    const stable = await funds(purchase)
    assert.deepEqual(await ctx.ok('POST', `/supplier-refunds/${rf.id}/receive`, got.body, { key: got.key }), got.ack)
    assert.deepEqual(await funds(purchase), stable)
    // New writes obey a freshly revoked permission; authenticated exact owned ACK still recovers.
    await ctx.pool.query('DELETE FROM sys_role_permissions WHERE role_id=? AND permission=?', [ctx.users.creator.roleId, P.SUPPLIER_REFUND_RECEIVE])
    try {
      const own = await refundOwn(got.body.operationUuid, `supplier.refund.receive.${rf.id}`, got.key)
      assert.deepEqual(own.data, got.ack)
      rejected(await ctx.post(`/supplier-refunds/${rf.id}/receive`, { operationUuid: randomUUID() }), 403, 'PERMISSION_DENIED')
    } finally { await ctx.pool.query('INSERT INTO sys_role_permissions(role_id,permission) VALUES (?,?)', [ctx.users.creator.roleId, P.SUPPLIER_REFUND_RECEIVE]) }
    const cancelUuid = randomUUID()
    const receivedFacts = async () => ({ head: await ctx.one('SELECT * FROM supplier_refund_orders WHERE id=?', [rf.id]),
      allocations: await ctx.rows('SELECT * FROM supplier_refund_allocations WHERE refund_id=? ORDER BY id', [rf.id]), money: await funds(purchase),
      original: await originalPayments(purchase), accounts: await ctx.rows('SELECT * FROM finance_accounts WHERE id IN (?,?) ORDER BY id', [ctx.payer.id, ctx.income.id]),
      events: await ctx.rows('SELECT * FROM payment_record_events WHERE payment_record_id=? ORDER BY id', [purchase.apId]),
      operation: await ctx.rows('SELECT * FROM supplier_refund_operations WHERE operation_uuid=?', [cancelUuid]) })
    const beforeReceivedCancel = await receivedFacts()
    rejected(await ctx.post(`/supplier-refunds/${rf.id}/cancel`, { operationUuid: cancelUuid }), 400, null, '已收退款不能取消，请财务核对')
    assert.deepEqual(await receivedFacts(), beforeReceivedCancel, '已收RF取消拒绝必须保原RF/分配/原付款、AP/资金和事件，不能留下取消回执')
    rejected(await ctx.post(`/returns/purchase/${pr.id}/confirm`, {}, { user: 'approver' }), 409, 'PURCHASE_RETURN_REFUND_REQUIRED')
    const remainder = await refund(pr, receipt, '9.8766'), beforeRest = await funds(purchase)
    await confirmRefund(remainder)
    const second = await receive(remainder)
    await assertReceived(purchase, remainder, second, beforeRest, original)
    await assertVoucher(remainder, second, '9.88')
    assert.equal((await funds(purchase)).ap.paid_amount, '60.0000')
    const fundsBeforeShip = await funds(purchase)
    await ctx.ok('POST', `/returns/purchase/${pr.id}/confirm`, {}, { user: 'approver' })
    const wt = await ctx.one("SELECT id FROM warehouse_tasks WHERE task_type='purchase_return' AND return_id=?", [pr.id])
    await ctx.shipTask(Number(wt.id), purchase.containers[0])
    assert.equal(await ctx.stock(purchase.product.id), 6)
    const afterShip = await funds(purchase)
    assert.equal(afterShip.ap.total_amount, '60.0000')
    assert.equal(afterShip.ap.paid_amount, '60.0000')
    assert.equal(afterShip.ap.balance, '0.0000')
    assert.deepEqual(afterShip.incoming, fundsBeforeShip.incoming)
    assert.deepEqual(afterShip.account, fundsBeforeShip.account, '实物退货不再收一次退款')
    assert.deepEqual((await refundOwn(got.body.operationUuid, `supplier.refund.receive.${rf.id}`, got.key)).data, got.ack)
    assert.deepEqual(await ctx.ok('POST', `/supplier-refunds/${rf.id}/receive`, got.body, { key: got.key }), got.ack)
    await assertVoucher(rf, got, '30.12')
  })

  await t.test('F零分：0.0001真实IN与永久ACK在合法PR取消后保持，无零额凭证', async () => {
    const purchase = await ctx.purchase(), entry = await pay(purchase, 100), pr = await ctx.returnPurchase(purchase, 1)
    const original = await originalPayments(purchase), rf = await refund(pr, entry, '0.0001')
    await confirmRefund(rf)
    const before = await funds(purchase), got = await receive(rf)
    await assertReceived(purchase, rf, got, before, original)
    assert.equal((await funds(purchase)).ap.paid_amount, '99.9999')
    await assertVoucher(rf, got, '0.00')
    await ctx.ok('POST', `/returns/purchase/${pr.id}/cancel`, {})
    assert.equal(Number((await ctx.one('SELECT status FROM purchase_returns WHERE id=?', [pr.id])).status), 4)
    const stable = await funds(purchase)
    assert.deepEqual((await refundOwn(got.body.operationUuid, `supplier.refund.receive.${rf.id}`, got.key)).data, got.ack)
    assert.deepEqual(await ctx.ok('POST', `/supplier-refunds/${rf.id}/receive`, got.body, { key: got.key }), got.ack)
    assert.deepEqual(await funds(purchase), stable)
    assert.equal((await ctx.ok('POST', `/supplier-refunds/${rf.id}/regenerate-voucher`, {})).status, 'notRequired')
    await assertVoucher(rf, got, '0.00')
  })

  await t.test('F闭期补录：只落申请，另人批准保原申请人/真实日期及首次批准凭证期', async () => {
    const purchase = await ctx.purchase(), entry = await pay(purchase, 100), pr = await ctx.returnPurchase(purchase, 1)
    const historical = ctx.historicalFixture
    const rf = await refund(pr, entry, '2.0001', { date: historical.date }), original = await originalPayments(purchase)
    await confirmRefund(rf)
    assert.equal(await ctx.one('SELECT period FROM acct_periods WHERE company_id=1 AND period=?', [historical.period]), undefined, '[FIXTURE] 本批历史闭期fixture已有冲突')
    await ctx.pool.query('INSERT INTO acct_periods(company_id,period,status,closed_by,closed_by_name,closed_at) VALUES (1,?,2,?,?,NOW())', [historical.period, ctx.users.creator.id, ctx.users.creator.username])
    const createdPeriod = await ctx.one('SELECT closed_at FROM acct_periods WHERE company_id=1 AND period=?', [historical.period])
    assert.ok(typeof createdPeriod?.closed_at === 'string' && createdPeriod.closed_at.length > 0, '[FIXTURE] 新建期间必须保存实际非空结账时间')
    ctx.closedPeriodCleanup = { companyId: 1, period: historical.period, closedBy: ctx.users.creator.id, closedByName: ctx.users.creator.username, closedAt: createdPeriod.closed_at }
    const body = { operationUuid: randomUUID() }, key = randomUUID(), before = await funds(purchase)
    rejected(await ctx.post(`/supplier-refunds/${rf.id}/receive`, body, { key, user: 'approver' }), 409, 'FINANCE_PERIOD_CLOSED')
    assert.deepEqual(await funds(purchase), before)
    const appliedResponse = await ctx.post(`/supplier-refunds/${rf.id}/receive`, { ...body, backfillRequest: true, backfillReason: '验收合成：原回款日所属期间已结，需要他人核对补录' }, { key, user: 'approver' })
    assert.equal(appliedResponse.status, 200, '当前RF申请路由以200返回申请对象；不代表回款完成')
    const applied = must(appliedResponse)
    assert.equal(applied.backfillRequested, true); assert.equal(applied.executed, false)
    ctx.remember('backfills', applied.applicationId)
    assert.deepEqual(await funds(purchase), before, '申请不能先动AP或现金')
    assert.equal((await refundOwn(body.operationUuid, `supplier.refund.receive.${rf.id}`, key, 'approver')).status, 'not_found')
    const query = new URLSearchParams({ action: `supplier.refund.receive.${rf.id}`, requestKey: key })
    const application = await ctx.ok('GET', `/supplier-refunds/backfill-applications/${body.operationUuid}?${query}`, undefined, { user: 'approver' })
    assert.equal(application.applicationId, applied.applicationId); assert.equal(application.executed, false)
    rejected(await ctx.post(`/accounting/backfills/${applied.applicationId}/approve`, {}, { user: 'approver' }), 403, 'FINANCE_BACKFILL_SELF_APPROVE')
    await ctx.ok('POST', `/accounting/backfills/${applied.applicationId}/approve`, {}, { user: 'creator' })
    const saved = await ctx.one("SELECT *,DATE_FORMAT(approved_at,'%Y-%m-%d') AS approved_date FROM finance_period_backfills WHERE id=?", [applied.applicationId])
    assert.equal(Number(saved.applicant_id), ctx.users.approver.id)
    assert.equal(Number(saved.approver_id), ctx.users.creator.id)
    assert.equal(saved.business_date, historical.date); assert.equal(saved.period, historical.period)
    assert.ok(saved.executed_at); assert.equal(saved.posting_period, saved.approved_date.replaceAll('-', '').slice(0, 6))
    assert.ok(saved.voucher_generated_at); assert.equal(saved.voucher_generate_error, null)
    const own = await refundOwn(body.operationUuid, `supplier.refund.receive.${rf.id}`, key, 'approver')
    assert.equal(own.status, 'success')
    const got = { ack: own.data, body, key, user: 'approver' }
    await assertReceived(purchase, rf, got, before, original)
    const receivedHead = await ctx.one('SELECT created_by,received_by FROM supplier_refund_orders WHERE id=?', [rf.id])
    assert.equal(Number(receivedHead.created_by), ctx.users.creator.id)
    assert.equal(Number(receivedHead.received_by), ctx.users.approver.id, '回款经办仍是原申请人')
    const applicationFunds = await ctx.rows('SELECT * FROM finance_account_transactions WHERE backfill_id=?', [applied.applicationId])
    assert.equal(applicationFunds.length, 1)
    assert.equal(Number(applicationFunds[0].id), got.ack.fundTransactionId)
    assert.equal(applicationFunds[0].happened_at.slice(0, 10), historical.date)
    assert.equal(applicationFunds[0].voucher_date_override, saved.approved_date)
    await assertVoucher(rf, got, '2.00', saved.approved_date)
    const stable = await funds(purchase)
    await ctx.ok('POST', `/accounting/backfills/${applied.applicationId}/execute`, {}, { user: 'creator' })
    assert.deepEqual(await funds(purchase), stable)
    const permanentApplication = await ctx.ok('GET', `/supplier-refunds/backfill-applications/${body.operationUuid}?${query}`, undefined, { user: 'approver' })
    assert.equal(permanentApplication.executed, true)
    assert.deepEqual((await refundOwn(body.operationUuid, `supplier.refund.receive.${rf.id}`, key, 'approver')).data, got.ack)
  })

  await t.test('F并发预算与同原键回款：两个超合计草稿最多确认一个，取消释放后只收一次', async () => {
    const purchase = await ctx.purchase(), entry = await pay(purchase, 100), pr = await ctx.returnPurchase(purchase, 4)
    const a = await refund(pr, entry, '30.0000'), b = await refund(pr, entry, '30.0000')
    const attempts = [a, b].map(rf => ({ rf, body: { operationUuid: randomUUID() }, key: randomUUID() }))
    const responses = await Promise.all(attempts.map(({ rf, body, key }) => ctx.post(`/supplier-refunds/${rf.id}/confirm`, body, { key, user: 'approver' })))
    assert.deepEqual(responses.map(row => row.status).sort(), [200, 409])
    const winnerIndex = responses.findIndex(row => row.status === 200), loserIndex = 1 - winnerIndex
    rejected(responses[loserIndex], 409, 'SUPPLIER_REFUND_BUDGET_EXCEEDED')
    const winner = attempts[winnerIndex].rf, loser = attempts[loserIndex].rf
    const current = await ctx.one("SELECT SUM(CASE WHEN budget_state='reserved' THEN amount ELSE 0 END) AS reserved FROM supplier_refund_allocations WHERE purchase_return_id=?", [pr.id])
    assert.equal(current.reserved, '30.0000')
    assert.equal((await funds(purchase)).incoming.length, 0)
    await ctx.ok('POST', `/supplier-refunds/${winner.id}/cancel`, { operationUuid: randomUUID() })
    assert.equal((await ctx.one('SELECT budget_state FROM supplier_refund_allocations WHERE refund_id=?', [winner.id])).budget_state, 'released')
    await ctx.ok('POST', `/supplier-refunds/${loser.id}/confirm`, attempts[loserIndex].body, { key: attempts[loserIndex].key, user: 'approver' })
    const body = { operationUuid: randomUUID() }, key = randomUUID(), before = await funds(purchase), original = await originalPayments(purchase)
    const receives = await Promise.all([ctx.post(`/supplier-refunds/${loser.id}/receive`, body, { key }), ctx.post(`/supplier-refunds/${loser.id}/receive`, body, { key })])
    const ack = must(receives[0]); assert.deepEqual(must(receives[1]), ack)
    await assertReceived(purchase, loser, { ack, body, key }, before, original)
    assert.equal((await funds(purchase)).incoming.length, 1)
    assert.equal((await ctx.rows('SELECT operation_uuid FROM supplier_refund_operations WHERE operation_uuid=?', [body.operationUuid])).length, 1)
    await assertVoucher(loser, { ack }, '30.00')
    const tooMuch = { operationUuid: randomUUID(), purchaseReturnId: pr.id, incomeAccountId: ctx.income.id, refundDate: ctx.today, amount: '10.0001', allocations: [{ entryId: Number(entry.id), amount: '10.0001' }] }
    const stable = await funds(purchase)
    rejected(await ctx.post('/supplier-refunds', tooMuch), 409, 'SUPPLIER_REFUND_BUDGET_EXCEEDED')
    assert.equal((await ctx.rows('SELECT operation_uuid FROM supplier_refund_operations WHERE operation_uuid=?', [tooMuch.operationUuid])).length, 0)
    assert.deepEqual(await funds(purchase), stable)
    rejected(await ctx.get(`/supplier-refunds/${loser.id}`, { user: 'scoped' }), 403, 'WAREHOUSE_SCOPE_DENIED')
    rejected(await ctx.post('/supplier-refunds', { ...tooMuch, operationUuid: randomUUID(), amount: '1.0000', allocations: [{ entryId: Number(entry.id), amount: '1.0000' }] }, { user: 'denied' }), 403, 'PERMISSION_DENIED')
  })

  await t.test('H/F输入、仓范围及会计汇总仍由真实路由与事实权威核对', async () => {
    const product = await ctx.product()
    const body = { intentUuid: randomUUID(), operationUuid: randomUUID(), productId: product.id, warehouseId: ctx.warehouse.id, unit: product.unit, handlingType: 1, quantity: 2.001 }
    rejected(await ctx.post('/disposals/handling-sources', body), 400)
    assert.equal((await ctx.rows('SELECT id FROM disposal_handling_operations WHERE operation_uuid=?', [body.operationUuid])).length, 0)
    rejected(await ctx.post('/disposals/handling-sources', { ...body, quantity: 2, operationUuid: randomUUID() }, { user: 'denied' }), 403, 'PERMISSION_DENIED')
    rejected(await ctx.post('/disposals/handling-sources', { ...body, quantity: 2, operationUuid: randomUUID() }, { user: 'scoped' }), 403, 'WAREHOUSE_SCOPE_DENIED')
    assert.equal((await ctx.rows('SELECT id FROM disposal_handling_sources WHERE product_id=?', [product.id])).length, 0)
    const reconciliation = await ctx.ok('GET', '/accounting/vouchers/reconciliation')
    const sums = await ctx.one("SELECT COALESCE(SUM(amount),0) AS cash FROM supplier_refund_orders WHERE status=3")
    const paid = await ctx.one(`SELECT SUM(r.paid_amount) AS paid FROM payment_records r WHERE r.id IN (SELECT payment_record_id FROM supplier_refund_orders WHERE status=3)`)
    assert.equal(reconciliation.supplierRefunds.cashAmount4, text4(sums.cash))
    assert.equal(reconciliation.supplierRefunds.currentPaid4, text4(paid.paid))
    assert.equal(reconciliation.supplierRefunds.paidDifference4, '0.0000')
    assert.equal(reconciliation.supplierRefunds.balanceDifference4, '0.0000')
    assert.equal(reconciliation.supplierRefunds.mismatchedPaymentCount, 0)
    assert.equal(reconciliation.supplierRefunds.matched, true)
    const balance = await ctx.one(`SELECT a.current_balance,a.opening_balance,COALESCE(SUM(CASE WHEN t.direction=1 THEN t.amount ELSE -t.amount END),0) AS delta
      FROM finance_accounts a LEFT JOIN finance_account_transactions t ON t.account_id=a.id WHERE a.id=? GROUP BY a.id`, [ctx.income.id])
    assert.equal(units4(balance.current_balance), units4(balance.opening_balance) + units4(balance.delta))
  })
})
