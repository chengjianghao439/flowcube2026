'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { createRequire } = require('node:module')

const source = path.join(__dirname, '../backend/src/modules/accounting/accounting.ledger.service.js')
const plain = value => JSON.parse(JSON.stringify(value))
const normalized = sql => sql.replace(/\s+/g, ' ').trim()
const expectedSql = 'SELECT biz_type, direction, COALESCE(SUM(amount),0) amt FROM finance_account_transactions WHERE happened_at BETWEEN ? AND ? GROUP BY biz_type, direction'
function fixture(rows = [], queryError = null) {
  const calls = []
  const pool = { query: async (sql, params) => {
    calls.push({ sql: normalized(sql), params: plain(params) })
    assert.equal(normalized(sql), expectedSql, 'period-only company-wide cash query must not join allocations or filter current accounts')
    if (queryError) throw queryError
    return [plain(typeof rows === 'function' ? rows(params) : rows)]
  } }
  const module = { exports: {} }, real = createRequire(source)
  vm.runInNewContext(fs.readFileSync(source, 'utf8'), {
    module, require: name => name === '../../config/db' ? { pool } : real(name),
  }, { filename: source })
  return { service: module.exports, calls }
}
const row = (biz_type, direction, amt = '12.3400') => ({ biz_type, direction, amt })
const amount = (result, name) => result.rows.find(r => r.name.trim() === name)?.amount
function assertNet(result, expected) {
  assert.equal(result.net, expected)
  assert.equal(result.rows.at(-1).amount, expected)
  assert.equal(amount(result, '经营活动现金流量净额'), expected)
  for (const r of result.rows) assert.equal(typeof r.amount, 'number')
}
async function report(rows, args = { period: '202610' }) {
  const f = fixture(rows), result = await f.service.getCashFlow(args)
  assert.equal(f.calls.length, 1)
  return plain(result)
}

// Original 13-case reproduction: controls plus the three observed supplier-refund failures.
test('cash-flow empty source publishes zero net', async () => assertNet(await report([]), 0))
for (const [name, biz, direction, expected] of [
  ['receipt', 1, 1, 12.34], ['supplier payment', 2, 2, -12.34],
  ['expense', 3, 2, -12.34], ['adjustment IN', 4, 1, 12.34],
  ['adjustment OUT', 4, 2, -12.34], ['customer refund', 5, 2, -12.34],
]) test(`cash-flow original ${name} control`, async () => assertNet(await report([row(biz, direction)]), expected))
const baseline = [row(1, 1, '100.0000'), row(2, 2, '40.0000'), row(3, 2, '10.0000'), row(5, 2, '5.0000'), row(4, 1, '3.0000'), row(4, 2, '2.0000')]
test('cash-flow original mixed baseline remains46', async () => assertNet(await report(baseline), 46))
test('CF-BIZ6-IN supplier refund12.34 contributes to net once', async () => assertNet(await report([row(6, 1)]), 12.34))
test('CF-BIZ6-MIN-CENT supplier refund0.01 contributes to net', async () => assertNet(await report([row(6, 1, '0.0100')]), 0.01))
test('CF-MIXED-BIZ6 mixed source increases net from46 to58.34', async () => assertNet(await report([...baseline, row(6, 1)]), 58.34))
test('cash-flow invalid month rejects before query', async () => {
  const f = fixture()
  await assert.rejects(f.service.getCashFlow({ period: '202613' }), /月份非法/)
  assert.equal(f.calls.length, 0)
})
test('cash-flow read failure propagates instead of zero success', async () => {
  const f = fixture([], Error('CONTROLLED_CASH_FLOW_READ_FAILURE'))
  await assert.rejects(f.service.getCashFlow({ period: '202610' }), /CONTROLLED_CASH_FLOW_READ_FAILURE/)
  assert.equal(f.calls.length, 1)
})

test('approved supplier refund has one operating inflow row and is never netted against supplier payment', async () => {
  const r = await report([...baseline, row(6, 1)])
  assert.equal(amount(r, '供应商退款'), 12.34)
  assert.equal(r.rows.filter(x => x.name.trim() === '供应商退款').length, 1)
  assert.equal(amount(r, '一、经营活动现金流入'), 112.34)
  assert.equal(amount(r, '销售收款'), 100)
  assert.equal(amount(r, '二、经营活动现金流出'), 55)
  assert.equal(amount(r, '采购/供应商付款'), 40)
  assert.equal(amount(r, '退款'), 5)
  assert.equal(amount(r, '三、其他（账户调整）'), 1)
  const inIndex = r.rows.findIndex(x => x.name.startsWith('一、'))
  const outIndex = r.rows.findIndex(x => x.name.startsWith('二、'))
  const refundIndex = r.rows.findIndex(x => x.name.trim() === '供应商退款')
  assert.ok(refundIndex > inIndex && refundIndex < outIndex)
  assertNet(r, 58.34)
})
test('refund row is stable at zero and wrong biz6 OUT is not reclassified as positive IN', async () => {
  const r = await report([row(6, 2, '9.9900')])
  assert.equal(amount(r, '供应商退款'), 0)
  assert.equal(amount(r, '一、经营活动现金流入'), 0)
  assertNet(r, 0)
})
test('refund larger than supplier payment remains gross inflow with negative overall net supported', async () => {
  const r = await report([row(6, 1, '12.3400'), row(2, 2, '1.0000'), row(3, 2, '20.0000')])
  assert.equal(amount(r, '供应商退款'), 12.34)
  assert.equal(amount(r, '采购/供应商付款'), 1)
  assert.equal(amount(r, '一、经营活动现金流入'), 12.34)
  assert.equal(amount(r, '二、经营活动现金流出'), 21)
  assertNet(r, -8.66)
})
test('multiple exact-cent aggregate rows preserve cents and single inclusion', async () => {
  const r = await report([row(6, 1, '0.0100'), row(6, 1, '0.0200'), row(1, 1, '0.1000'), row(2, 2, '0.3000')])
  assert.equal(amount(r, '供应商退款'), 0.03)
  assert.equal(amount(r, '一、经营活动现金流入'), 0.13)
  assertNet(r, -0.17)
})
test('legacy fractional cents are summed before bucket display rounding; no per-row cash validation', async () => {
  const r = await report([row(6, 1, '0.0040'), row(6, 1, '0.0040'), row(1, 1, '0.0040'), row(2, 2, '0.0040')])
  assert.equal(amount(r, '供应商退款'), 0.01)
  assert.equal(amount(r, '销售收款'), 0)
  assert.equal(amount(r, '采购/供应商付款'), 0)
  assertNet(r, 0.01)
})
test('decimal half-cent bucket rounds exactly instead of binary1.005 becoming1.00', async () => {
  const r = await report([row(6, 1, '1.0050')])
  assert.equal(amount(r, '供应商退款'), 1.01)
  assertNet(r, 1.01)
})
test('negative legacy aggregate retains original Math.round tie direction without rejecting read', async () => {
  const r = await report([row(6, 1, '-1.0050'), row(1, 1, '-1.0051')])
  assert.equal(amount(r, '供应商退款'), -1)
  assert.equal(amount(r, '销售收款'), -1.01)
  assertNet(r, -2.01)
})
for (const [period, expected] of [['202402', ['2024-02-01', '2024-02-29']], ['202502', ['2025-02-01', '2025-02-28']], ['202612', ['2026-12-01', '2026-12-31']]]) {
  test(`DATE closed window ${period} binds first and final day`, async () => {
    const f = fixture([row(6, 1, '0.0100')]); const result = await f.service.getCashFlow({ period })
    assert.deepEqual(f.calls[0].params, expected)
    assert.equal(result.start, expected[0]); assert.equal(result.end, expected[1]); assertNet(result, 0.01)
  })
}
test('current company-wide source survives company switch; no account/type/active/warehouse dimension is silently added', async () => {
  const rows = [row(6, 1, '12.3400'), row(1, 1, '7.6600')]
  for (const companyId of [1, 2]) {
    const f = fixture(rows); const result = await f.service.getCashFlow({ period: '202610', companyId })
    assert.deepEqual(f.calls[0].params, ['2026-10-01', '2026-10-31'])
    assertNet(result, 20)
  }
})
test('happened_at SQL parameters drive a finite period model across accounts, independent of voucher date or RF state', async () => {
  // Finite query-boundary model only, not MySQL, RF allocations or real account validation.
  const data = [
    { id: 1, accountId: 7, happenedAt: '2026-10-01', cents: 1n, voucherDate: '2026-11-01', refundStatus: 3 },
    { id: 2, accountId: 8, happenedAt: '2026-10-31', cents: 2n, voucherDate: '2026-10-31', refundStatus: 4 },
    { id: 3, accountId: 7, happenedAt: '2026-09-30', cents: 900n, voucherDate: '2026-10-01', refundStatus: 3 },
    { id: 4, accountId: 8, happenedAt: '2026-11-01', cents: 900n, voucherDate: '2026-10-31', refundStatus: 3 },
  ]
  let selected
  const f = fixture(([start, end]) => {
    selected = data.filter(x => x.happenedAt >= start && x.happenedAt <= end)
    const cents = selected.reduce((sum, x) => sum + x.cents, 0n)
    return [row(6, 1, `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}00`)]
  })
  const r = await f.service.getCashFlow({ period: '202610' })
  assert.deepEqual(selected.map(x => x.id), [1, 2])
  assert.equal(f.calls.length, 1)
  assert.equal(amount(r, '供应商退款'), 0.03)
  assertNet(r, 0.03)
})

test('large exact-cent source is summed in decimal before conversion, not rounded from lost Number cents', async () => {
  const r = await report([row(6, 1, '10000000000000.0100'), row(6, 1, '0.0100')])
  assert.equal(String(amount(r, '供应商退款')), '10000000000000.02')
  assertNet(r, 10000000000000.02)
})
for (const [label, rows] of [
  ['bucket', [row(6, 1, '90071992547409.9100')]],
  ['subtotal', [row(6, 1, '45035996273704.9500'), row(1, 1, '45035996273704.9600')]],
  ['net', [row(6, 1, '45035996273704.9500'), row(4, 1, '45035996273704.9600')]],
  ['negative net', [row(2, 2, '45035996273704.9500'), row(4, 2, '45035996273704.9600')]],
]) test(`unrepresentable ${label} rejects rather than publishing a different cent`, async () => {
  const f = fixture(rows)
  await assert.rejects(f.service.getCashFlow({ period: '202610' }), e => e.code === 'CASH_AMOUNT_OUT_OF_RANGE')
})
