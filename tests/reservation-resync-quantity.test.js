// Actual reservation cache helper and current quantity policy; SQL is a double.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm')
const qty = require('../backend/src/utils/qtyPrecision')
const AppError = require('../backend/src/utils/AppError')
const filename = path.join(__dirname, '../backend/src/engine/reservationEngine.js')
function fixture(total, allowDecimal, transform = source => source) {
  const events = [], writes = []
  const conn = { async query(sql, params) {
    if (sql.includes('SUM(qty)')) { events.push('ledger-sum'); return [[{ total }]] }
    if (sql.includes('allow_decimal_qty')) { events.push('current-policy'); return [[{ id: 7, name: '合成商品', allow_decimal_qty: allowDecimal }]] }
    if (sql.includes('ON DUPLICATE KEY UPDATE reserved=?')) { events.push('cache-write'); writes.push(params); return [{}] }
    throw Error('Unexpected SQL: ' + sql)
  } }
  const module = { exports: {} }, deps = { '../utils/qtyPrecision': qty, '../utils/AppError': AppError }
  vm.runInNewContext(transform(fs.readFileSync(filename, 'utf8')), { module, require: name => deps[name] ?? {} }, { filename })
  return { conn, events, writes, engine: module.exports }
}
test('ledger-derived reserved uses current policy before absolute cache write, no rounding', async () => {
  for (const [total, policy, expected] of [['4.00', 0, 4], ['0.30', 1, 0.3], ['0.00', 0, 0]]) {
    const f = fixture(total, policy)
    assert.equal(await f.engine.syncReservedFromLedger(f.conn, 7, 8), expected)
    assert.deepEqual(f.events, ['ledger-sum', 'current-policy', 'cache-write'])
    assert.deepEqual(Array.from(f.writes[0]), [7, 8, expected, expected])
  }
})
test('integer and two-decimal violations stop before reserved upsert; caller can roll back quantity too', async () => {
  for (const [total, policy, code] of [['0.30', 0, 'QTY_INTEGER_REQUIRED'], ['0.001', 1, 'QTY_DECIMALS_EXCEEDED']]) {
    const f = fixture(total, policy)
    await assert.rejects(f.engine.syncReservedFromLedger(f.conn, 7, 8), e => e.code === code)
    assert.equal(f.writes.length, 0)
  }
})
test('negative guard: deleting the real pre-upsert policy call loses the established refusal', async () => {
  const line = "  await assertQtyPrecision(conn, [{ productId, qty, label: '同步预占数量' }])"
  const f = fixture('0.30', 0, source => { assert.equal(source.split(line).length, 2); return source.replace(line, '') })
  await assert.rejects(async () => { await assert.rejects(f.engine.syncReservedFromLedger(f.conn, 7, 8), e => e.code === 'QTY_INTEGER_REQUIRED') }, e => e.code === 'ERR_ASSERTION')
  assert.equal(f.writes.length, 1)
})
