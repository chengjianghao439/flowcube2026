'use strict'
// Real pure period projector and finite loader rows. No DB, HTTP or credentials.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm')
const { createRequire } = require('node:module')
const file = path.resolve(__dirname, '../backend/src/modules/accounting/voucher-sale-periods.js')
let source = fs.readFileSync(process.env.ACCOUNTING_CASH_SOURCE || file, 'utf8')
if (process.env.ACCOUNTING_CASH_MUTANT === 'ordinary_raw') source = source.replace('if (useOrdinaryCash) net = cashNet', 'if (false) net = cashNet')
if (process.env.ACCOUNTING_CASH_MUTANT === 'kit_double_round') source = source.replace("} else if (order.cashPolicy === 'cash-cents-v1' && order.commercialModel === 'kit-v1')", '} else if (false)')
if (process.env.ACCOUNTING_CASH_MUTANT === 'missing_basis') source = source.replace("if (order.cashPolicy === 'cash-cents-v1' && order.commercialModel !== 'kit-v1' && !ordinaryCash)", 'if (false)')
if (process.env.ACCOUNTING_CASH_MUTANT === 'legacy_reproject') source = source.replace("ordinaryCash.basis_origin === 'first_real_ship'", "ordinaryCash.basis_origin === 'legacy_complete_proven'")
const loaded = { exports: {} }
vm.runInNewContext(source, { module: loaded, require: createRequire(file), Date }, { filename: file })
const { projectSaleShipments, loadSaleShipmentFacts } = loaded.exports
const ordinary = require('../backend/src/modules/sale/sale.ordinary-return-money')
function facts(lines, { gross = '1.00', discount = '0.00', origin = 'first_real_ship', policy = 'cash-cents-v1', periods = null } = {}) {
  const rows = lines.map((line, i) => ({ id: i + 1, product_id: i + 11, warehouse_id: 1, quantity: line.q || '1.00', unit_price: line.price, amount: line.amount, unit: '个' }))
  const basis = ordinary.deriveBasis({ id: 1, warehouse_id: 1, total_amount: gross, discount_amount: discount }, rows, origin)
  const shipments = periods || rows.map((row, i) => ({ taskId: 1, soId: 1, taskItemId: i + 1, saleItemId: row.id, qty: row.quantity, shippedAt: '2026-10-14' }))
  const quantities = new Map()
  for (const s of shipments) quantities.set(s.saleItemId, (quantities.get(s.saleItemId) || 0) + Number(s.qty))
  return { orders: [{ soId: 1, order_no: 'SYN-CENTS', warehouseId: 1, customer_id: 1, cashPolicy: policy, orderGross: gross, discount, ordinaryCashBasis: basis }],
    items: rows.map(row => ({ ...row, order_id: 1, shipped_qty: String(quantities.get(row.id) || 0), cost_snapshot: '0.2000' })), shipments }
}
function revenue(rows) { return Array.from(rows).filter(row => row.sourceType === 'sale_revenue').map(row => [row.sourcePeriod, row.legs.find(leg => leg.code === '1122').amount]) }
test('ten zero-cent line budgets never create five cents of phantom revenue', () => {
  const f = facts([...Array.from({ length: 10 }, () => ({ price: '0.0049', amount: '0.00' })), { price: '1.00', amount: '1.00' }])
  const result = projectSaleShipments(f)
  assert.deepEqual(revenue(result), [['202610', '1.00']])
  assert.equal(result.find(row => row.sourceType === 'sale_cogs').legs[0].amount, '2.20')
})
test('raw .9999/head1 discounted shipment uses exact .90 source budget across periods', () => {
  const f = facts([{ q: '3.00', price: '0.3333', amount: '1.00' }], { discount: '0.10', periods: [
    { taskId: 1, soId: 1, taskItemId: 1, saleItemId: 1, qty: '1.00', shippedAt: '2026-10-01' },
    { taskId: 2, soId: 1, taskItemId: 2, saleItemId: 1, qty: '2.00', shippedAt: '2026-11-01' },
  ] })
  assert.deepEqual(revenue(projectSaleShipments(f)), [['202610', '0.30'], ['202611', '0.60']])
  assert.equal(f.items[0].unit_price, '0.3333')
})
test('closing current head cannot replace immutable original gross and discount budget', () => {
  const f = facts([{ q: '3.00', price: '0.3333', amount: '1.00' }], { discount: '0.10', periods: [
    { taskId: 1, soId: 1, taskItemId: 1, saleItemId: 1, qty: '1.00', shippedAt: '2026-10-01' },
  ] })
  f.orders[0].orderGross = '0.00'; f.orders[0].discount = '0.00'
  assert.deepEqual(revenue(projectSaleShipments(f)), [['202610', '0.30']])
})
test('zero cash with positive high-precision price still projects real unchanged cost', () => {
  const result = projectSaleShipments(facts([{ price: '0.0001', amount: '0.00' }], { gross: '0.00' }))
  assert.deepEqual(revenue(result), [])
  assert.equal(result.find(row => row.sourceType === 'sale_cogs').legs[0].amount, '0.20')
})
test('new policy missing source or changed product/warehouse/price fails closed', () => {
  const base = facts([{ price: '1.00', amount: '1.00' }])
  for (const change of [f => { delete f.orders[0].ordinaryCashBasis }, f => { f.items[0].product_id = 99 }, f => { f.items[0].warehouse_id = 2 }, f => { f.items[0].unit_price = '2.0000' }]) {
    const f = structuredClone(base); change(f)
    assert.throws(() => projectSaleShipments(f), error => error.code === 'ACCT_SALE_SOURCE_INVALID')
  }
})
test('new kit net uses one exact-cent rounding; legacy period target stays original', () => {
  const f = { orders: [{ soId: 1, order_no: 'SYN-KIT', commercialModel: 'kit-v1', cashPolicy: 'cash-cents-v1', orderGross: '2.01', discount: '2.00' }],
    items: [{ id: 1, order_id: 1, shipped_qty: '201.00', unit_price: '0.01', cost_snapshot: '0.0000' }], shipments: [
      { taskId: 1, soId: 1, taskItemId: 1, saleItemId: 1, qty: '100.00', shippedAt: '2026-10-01', confirmedGross: '1.00' },
      { taskId: 2, soId: 1, taskItemId: 2, saleItemId: 1, qty: '101.00', shippedAt: '2026-11-01', confirmedGross: '1.01' },
    ] }
  assert.deepEqual(revenue(projectSaleShipments(f)), [['202611', '0.01']])
  f.orders[0].cashPolicy = null
  assert.deepEqual(revenue(projectSaleShipments(f)), [['202610', '0.01']])
})
test('legacy proven basis2 cannot silently reproject a differing historical period cut', () => {
  const f = facts([...Array.from({ length: 10 }, () => ({ price: '0.0049', amount: '0.00' })), { price: '1.00', amount: '1.00' }], { origin: 'legacy_complete_proven', policy: null })
  assert.throws(() => projectSaleShipments(f), error => error.code === 'ACCT_SALE_SOURCE_INVALID' && error.message.includes('保留历史待核'))
})
test('legacy within-period task rounding differences may cancel without changing original period money', () => {
  const lines = [...Array.from({ length: 10 }, () => ({ price: '0.0049', amount: '0.00' })), ...Array.from({ length: 10 }, () => ({ price: '0.0951', amount: '0.10' }))]
  const periods = lines.map((line, index) => ({ taskId: index < 10 ? 1 : 2, soId: 1, taskItemId: index + 1, saleItemId: index + 1, qty: '1.00', shippedAt: index < 10 ? '2026-10-01' : '2026-10-02' }))
  assert.deepEqual(revenue(projectSaleShipments(facts(lines, { origin: 'legacy_complete_proven', policy: null, periods }))), [['202610', '1.00']])
})
test('existing loader batch carries exact basis and permits new zero-gross kit source', async () => {
  const f = facts([{ price: '1.00', amount: '1.00' }]), b = f.orders[0].ordinaryCashBasis
  const order = { ...f.orders[0], ordinaryCashBasis: undefined, ordinaryBasisOrderId: 1, ordinaryGrossBasis: b.gross_basis, ordinaryDiscountBasis: b.discount_basis,
    ordinaryNetBasis: b.net_basis, ordinarySourceSnapshot: b.snapshot, ordinaryBasisOrigin: b.basis_origin }
  let call = 0
  const loadedFacts = await loadSaleShipmentFacts({ query: async () => [[ [order], f.items, f.shipments, [] ][call++]] })
  assert.equal(call, 4)
  assert.deepEqual(revenue(projectSaleShipments(loadedFacts)), [['202610', '1.00']])
  call = 0
  const kit = { soId: 2, order_no: 'SYN-ZERO', commercialModel: 'kit-v1', cashPolicy: 'cash-cents-v1', orderGross: '0.00', discount: '0.00' }
  const rows = [[kit], [], [], [{ task_id: 2, order_id: 2, gross: '0.00', unknown_basis: 0, missing_basis: 0, gross_basis: '0.00', max_gross_basis: '0.00', discount_basis: '0.00', max_discount_basis: '0.00' }]]
  assert.equal((await loadSaleShipmentFacts({ query: async () => [rows[call++]] })).orders[0].orderGross, '0.00')
})
