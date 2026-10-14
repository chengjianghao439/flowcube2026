'use strict'
// Actual readonly builder + actual source validator and cash projector; finite
// SQL boundary fixtures only. This does not claim native DB or HTTP execution.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm')
const { createRequire } = require('node:module')
const AppError = require('../backend/src/utils/AppError')
const { SOURCE_TYPES, DIR } = require('../backend/src/constants/voucherSource')
const purchaseCash = require('../backend/src/modules/purchase/purchase.cash-money')
const file = path.resolve(__dirname, '../backend/src/modules/accounting/voucher-engine.js')

function fixture({ lines = null, quantities = null, legacy = false, gross = '1.00', rawGross = '1.05' } = {}) {
  const items = (lines || [...Array.from({ length: 10 }, () => ({ price: '0.0049', amount: '0.00' })), { price: '1.00', amount: '1.00' }])
    .map((line, index) => ({ id: index + 1, order_id: 30, product_id: index + 100, unit: '个', quantity: line.quantity || '1.00', unit_price: line.price, amount: line.amount }))
  const order = { id: 30, supplier_id: 1, warehouse_id: 2, total_amount: gross }
  const basis = purchaseCash.freezeBasis(order, items)
  const state = {
    rows: [{ poId: 30, order_no: 'SYN-PO-CASH', vdate: '2026-10-14', supplier_id: 1, supplier_name: 'Synthetic', warehouse_id: 2, order_total: gross,
      gross: rawGross, total_amount: '0.00', cash_basis: legacy ? null : basis }],
    items,
    receipts: items.map((row, index) => ({ orderId: 30, itemId: row.id, productId: row.product_id, warehouseId: 2, quantity: quantities?.[index] ?? row.quantity })),
    queries: [], invalidSource: false,
  }
  let source = fs.readFileSync(process.env.PURCHASE_CASH_BUILDER_SOURCE || file, 'utf8')
  const start = source.indexOf('async function buildPurchaseSettle('), end = source.indexOf('\n/**\n * 事件2', start)
  assert.ok(start > 0 && end > start)
  source = source.slice(start, end)
  if (process.env.PURCHASE_CASH_BUILDER_MUTANT === 'raw') source = source.replace('cashGrossByPO.has(Number(r.poId))', 'false')
  if (process.env.PURCHASE_CASH_BUILDER_MUTANT === 'price') source = source.replace('decimalUnits(source.unit_price, 8) !== decimalUnits(original.unitPrice, 8)', 'false')
  if (process.env.PURCHASE_CASH_BUILDER_MUTANT === 'source') source = source.replace('await assertPurchaseSettlementSources(conn, Number(r.poId))', 'void 0')
  const module = { exports: {} }
  vm.runInNewContext(source + '\nmodule.exports=buildPurchaseSettle', {
    module, AppError, SOURCE_TYPES, DIR, require: createRequire(file), round2: n => Math.round((Number(n) || 0) * 100) / 100,
  }, { filename: file })
  const conn = { async query(sql, params = []) {
    state.queries.push({ sql, params })
    assert.ok(!/^\s*(INSERT|UPDATE|DELETE|ALTER)/i.test(sql), 'Accounting projection stays readonly')
    if (/pr.order_id AS poId/.test(sql)) return [state.rows.filter(row => !sql.includes('pr.order_id IN (?)') || Array.from(params[0]).includes(row.poId))]
    if (/FROM inbound_task_items i\s/.test(sql)) return [[{ purchase_order_id: 30, purchase_item_id: 1, product_id: 100,
      source_item_id: state.invalidSource ? null : 1, source_order_id: 30, source_product_id: 100 }]]
    if (/FROM inventory_containers/.test(sql)) return [[]]
    if (/FROM purchase_order_items/.test(sql)) return [state.items]
    if (/FROM inbound_task_items iti/.test(sql)) return [state.receipts]
    throw Error('Unexpected SQL ' + sql)
  } }
  return { state, conn, build: module.exports }
}
const payable = result => result[0].legs.find(leg => leg.code === '2202').amount

test('new cash PO follows frozen line budgets, never five phantom cents or net AP cache', async () => {
  const { build, conn, state } = fixture()
  assert.equal(payable(await build(conn, new Map())), 1)
  assert.equal(state.rows[0].total_amount, '0.00', 'AP net cache is neither trusted nor changed')
  assert.equal(state.items[0].unit_price, '0.0049')
})
test('new cash partial audited quantities round once over original line budgets', async () => {
  const { build, conn } = fixture({ lines: [{ quantity: '3.00', price: '0.33333333', amount: '1.00' }], quantities: ['2.00'], rawGross: '0.66666666' })
  assert.equal(payable(await build(conn, new Map())), 0.67)
})
test('zero cash PO with positive eight-place unit price remains zero', async () => {
  const { build, conn } = fixture({ lines: [{ price: '0.00010001', amount: '0.00' }], gross: '0.00', rawGross: '0.00010001' })
  assert.equal(payable(await build(conn, new Map())), 0)
})
test('legal overreceipt uses original price for the expanded line, never unbounded original-cent extrapolation', async () => {
  const first = fixture({ lines: [{ price: '0.005', amount: '0.01' }], gross: '0.01', quantities: ['2.00'], rawGross: '0.0100' })
  assert.equal(payable(await first.build(first.conn, new Map())), 0.01)
  const zero = fixture({ lines: [{ price: '0.0049', amount: '0.00' }], gross: '0.00', quantities: ['100.00'], rawGross: '0.4900' })
  assert.equal(payable(await zero.build(zero.conn, new Map())), 0.49)
})
test('new cash builder verifies original source identity and immutable quantities/prices/budgets', async () => {
  for (const change of [
    state => { state.items[0].product_id = 999 }, state => { state.items[0].unit = '箱' },
    state => { state.items[0].quantity = '2.00' }, state => { state.items[0].unit_price = '0.00490001' },
    state => { state.items[0].amount = '0.01' }, state => { state.rows[0].warehouse_id = 3 },
    state => { state.rows[0].order_total = '1.01' }, state => { state.items.pop() },
    state => { state.receipts[0].warehouseId = 3 }, state => { state.receipts[0].quantity = '-0.01' },
  ]) {
    const { build, conn, state } = fixture(); change(state)
    await assert.rejects(() => build(conn, new Map()), error => error.statusCode === 409)
  }
})
test('original source validator still blocks malformed source before cash projection', async () => {
  const { build, conn, state } = fixture(); state.invalidSource = true
  await assert.rejects(() => build(conn, new Map()), error => error.code === 'INBOUND_PURCHASE_SOURCE_INVALID')
})
test('source scope and two batched cash reads do not widen a period or add per-order queries', async () => {
  const { build, conn, state } = fixture()
  await build(conn, new Map(), { orderIds: [30] })
  assert.ok(state.queries[0].sql.includes('pr.order_id IN (?)'))
  const cashReads = state.queries.filter(q => /FROM purchase_order_items|FROM inbound_task_items iti/.test(q.sql) && !/pr.order_id AS poId/.test(q.sql))
  assert.equal(cashReads.length, 2)
  for (const read of cashReads) assert.deepEqual(Array.from(read.params[0]), [30])
  state.queries.length = 0
  assert.equal((await build(conn, new Map(), { orderIds: [] })).length, 0)
  assert.equal(state.queries.length, 0)
})
test('legacy PO keeps its old projection and no new cash evidence reads', async () => {
  const { build, conn, state } = fixture({ legacy: true })
  assert.equal(payable(await build(conn, new Map())), 1.05)
  assert.equal(state.queries.length, 3)
})
test('no AP preserves original builder entry boundary without inventing a zero AP or date', async () => {
  const { build, conn, state } = fixture(); state.rows = []
  assert.equal((await build(conn, new Map())).length, 0)
  assert.equal(state.queries.length, 1)
})
