'use strict'

// Runs only with the existing owned go-live runner. The browser-client request
// builders are covered by the Vitest HTTP contract, while this test uses the
// production Express app, Xiaoman transport and MySQL writes and readback.
const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { makeGoLiveRuntimeFixture, must } = require('./helpers/goLiveRuntimeFixture')
const { SALE_STATUS } = require('../backend/src/constants/saleOrderStatus')

const ctx = makeGoLiveRuntimeFixture()
before(async () => { await ctx.setup() })
after(async () => { await ctx.close() })

test('销售草稿、收款登记、核销同一请求键重放返回原结果，数据库各只写一次', async () => {
  const { FlowClient } = await import('../agent/src/flow.js')
  const { getTool } = await import('../agent/src/tools.js')
  const origin = `http://127.0.0.1:${ctx.server.address().port}`
  const client = new FlowClient(origin, ctx.users.creator.token, { clientId: ctx.clientId })
  const saleTool = getTool('sale.create_draft')
  const paymentTool = getTool('payments.receipt_suggest')

  const product = await ctx.product()
  const saleBody = ctx.saleBody(product, 2, { remark: `API契约-${ctx.mark}` })
  const saleKey = randomUUID()
  const saleResponse = await ctx.post('/sale', saleBody, { key: saleKey })
  assert.equal(saleResponse.status, 201)
  const sale = must(saleResponse)
  ctx.remember('sales', sale.id)
  assert.ok(typeof sale.orderNo === 'string' && sale.orderNo.length > 0)
  const saleRetry = await saleTool.run(client, { payload: saleBody, requestKey: saleKey })
  assert.deepEqual(saleRetry.created, sale)
  assert.equal(saleRetry.verificationError, null)
  assert.equal(saleRetry.verified.id, sale.id)
  assert.equal(saleRetry.verified.status, SALE_STATUS.DRAFT)
  assert.equal((await client.requestStatus(saleKey, 'sale.create')).resourceId, sale.id)
  const sales = await ctx.rows('SELECT id,order_no FROM sale_orders WHERE customer_id=? AND remark=?', [ctx.customer.id, saleBody.remark])
  assert.deepEqual(sales.map(row => [Number(row.id), row.order_no]), [[sale.id, sale.orderNo]])

  // Seed the existing overdue balance for the finance contract. Its order
  // identity must resolve to the same synthetic customer as the receipt.
  const orderNo = sale.orderNo
  const [seeded] = await ctx.pool.query(
    `INSERT INTO payment_records (type, order_id, order_no, party_name, total_amount, balance, status, settlement_type)
     VALUES (2, ?, ?, ?, 40, 40, 1, 1)`,
    [sale.id, orderNo, ctx.customer.name],
  )
  const recordId = Number(seeded.insertId)
  const receiptBody = { type: 2, partyId: ctx.customer.id, partyName: ctx.customer.name, amount: 25.5, accountId: ctx.income.id, paymentDate: ctx.today }
  const receiptKey = randomUUID()
  const { created } = await paymentTool.run(client, { payload: receiptBody, requestKey: receiptKey })
  assert.equal(created.amount, 25.5)
  assert.equal(created.settledAmount, 0)
  assert.equal(created.balance, 25.5)
  assert.deepEqual(created.applied, [])
  assert.ok(typeof created.receiptNo === 'string' && created.receiptNo.length > 0)

  const settleKey = randomUUID(), allocations = [{ recordId, amount: 12.25 }]
  const settledResponse = await ctx.post(`/payments/receipts/${created.id}/settle`, { allocations }, { key: settleKey })
  assert.equal(settledResponse.status, 200)
  const settled = must(settledResponse)
  assert.deepEqual(settled, {
    id: created.id, receiptNo: created.receiptNo, settledAmount: 12.25, balance: 13.25,
    applied: [{ recordId, orderNo, amount: 12.25, settled: false }],
  })
  const settleReplay = await paymentTool.settle(client, { receiptId: created.id, allocations, requestKey: settleKey })
  assert.deepEqual(settleReplay.result, settled)
  const receiptReplay = await ctx.post('/payments/receipts', { ...receiptBody, allocations: [] }, { key: receiptKey })
  assert.equal(receiptReplay.status, 201)
  assert.deepEqual(must(receiptReplay), created, '登记重试回的是登记时原回执，详情反映后续核销')

  const receiptReply = await client.requestStatus(receiptKey, 'payment.receipt.create')
  const settleReply = await client.requestStatus(settleKey, `payment.receipt.settle.${created.id}`)
  for (const [reply, expected] of [[receiptReply, created], [settleReply, settled]]) {
    assert.equal(reply.resourceId, created.id)
    assert.equal(reply.resourceType, 'payment_receipt')
    assert.deepEqual(reply.data, expected)
  }
  const detail = await paymentTool.detail(client, { receiptId: created.id })
  assert.equal(detail.settledAmount, 12.25)
  assert.equal(detail.balance, 13.25)
  assert.equal(detail.settlements.length, 1)
  assert.equal(detail.settlements[0].recordId, recordId)
  assert.equal(detail.settlements[0].orderPaid, 12.25)
  assert.equal(detail.settlements[0].orderBalance, 27.75)
  const receipts = await ctx.rows('SELECT id FROM payment_receipts WHERE account_id=? AND party_id=?', [ctx.income.id, ctx.customer.id])
  assert.deepEqual(receipts.map(row => Number(row.id)), [created.id])
  const cash = await ctx.rows('SELECT biz_id,amount FROM finance_account_transactions WHERE biz_type=1 AND account_id=?', [ctx.income.id])
  assert.deepEqual(cash.map(row => [Number(row.biz_id), Number(row.amount)]), [[created.id, 25.5]])
})
