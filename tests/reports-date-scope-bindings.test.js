'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm')
const helpers = require('../backend/src/modules/reports/reports.helpers')
const projection = require('../backend/src/modules/inventory/inventoryProjection')
const file = path.resolve(__dirname, '../backend/src/modules/reports/reports.query.js')
const methods = ['fetchPurchaseStatsRows', 'fetchSaleStatsRows', 'fetchInventoryStatsRows', 'fetchWavePerformanceRows', 'fetchPurchasePriceTrend']
const plain = value => JSON.parse(JSON.stringify(value))
function load(code = fs.readFileSync(file, 'utf8'), dateHelpers = helpers) {
  const calls = [], module = { exports: {} }
  const mocks = {
    '../../config/db': { pool: { query: async (sql, params) => { calls.push({ sql, params: plain(params) }); return [[]] } } },
    './reports.helpers': dateHelpers,
    '../inventory/inventoryProjection': projection,
    '../../utils/warehouseScope': { scopeFilter: (ids, column) => !Array.isArray(ids) ? { sql: '', params: [] } : !ids.length ? { sql: ' AND 1=0', params: [] } : { sql: ` AND ${column} IN (?)`, params: [ids] } },
  }
  vm.runInNewContext(code, { module, require: name => mocks[name] || {} }, { filename: file })
  return { svc: module.exports, calls }
}
function expected(call, params) {
  const dated = /(?:o|l|pw)\.created_at >= \?|(?:o|l|pw)\.created_at < DATE_ADD\(\?, INTERVAL 1 DAY\)/.test(call.sql)
  const out = call.sql.includes('i.product_id = ?') ? [99] : []
  if (dated) { if (params.startDate) out.push(params.startDate); if (params.endDate) out.push(params.endDate) }
  if (Array.isArray(params.scopeWarehouseIds) && params.scopeWarehouseIds.length) out.push(params.scopeWarehouseIds)
  return out
}
const dates = [{}, { startDate: '2026-10-10' }, { endDate: '2026-10-12' }, { startDate: '2026-10-10', endDate: '2026-10-12' }]
for (const date of dates) for (const scopeWarehouseIds of [null, [], [2], [2, 3]]) {
  test(`five actual query functions bind dates and scope in order: ${JSON.stringify({ ...date, scopeWarehouseIds })}`, async () => {
    const f = load(), params = { ...date, scopeWarehouseIds, productId: 99 }
    for (const name of methods) await f.svc[name](params)
    assert.equal(f.calls.length, 11, 'nine date-dependent and two existing date-independent statements')
    for (const call of f.calls) {
      assert.deepEqual(call.params, expected(call, params), call.sql)
      assert.equal((call.sql.match(/\?/g) || []).length, call.params.length, call.sql)
      if (Array.isArray(scopeWarehouseIds) && !scopeWarehouseIds.length) assert.match(call.sql, /AND 1=0/)
    }
  })
}
test('existing date-independent warehouse valuation, wave 30-day summary and price-trend fallback remain explicit', async () => {
  const f = load(), params = { startDate: '2026-10-10', endDate: '2026-10-12', scopeWarehouseIds: [2], productId: 99 }
  await f.svc.fetchInventoryStatsRows(params); await f.svc.fetchWavePerformanceRows(params)
  const valuation = f.calls.find(c => c.sql.includes('AS total_value'))
  assert.deepEqual(valuation.params, [[2]])
  const summary = f.calls.find(c => c.sql.includes('AS total_waves'))
  assert.match(summary.sql, /INTERVAL 30 DAY/); assert.deepEqual(summary.params, [[2]])
  const trend = load(); await trend.svc.fetchPurchasePriceTrend({ productId: 99, scopeWarehouseIds: [2] })
  assert.match(trend.calls[0].sql, /INTERVAL 12 MONTH/); assert.deepEqual(trend.calls[0].params, [99, [2]])
})
test('restoring the extra end-date value is detected in all nine date-dependent actual statements', async () => {
  const broken = { ...helpers, buildTimestampDateFilter: (column, start, end) => {
    const value = helpers.buildTimestampDateFilter(column, start, end)
    if (start && end) value.params.push(end)
    return value
  } }
  const f = load(undefined, broken), params = { startDate: '2026-10-10', endDate: '2026-10-12', scopeWarehouseIds: [2, 3], productId: 99 }
  for (const name of methods) await f.svc[name](params)
  const invalid = f.calls.filter(call => { try { assert.deepEqual(call.params, expected(call, params)); return false } catch { return true } })
  assert.equal(invalid.length, 9)
  assert.throws(() => assert.deepEqual(invalid[0].params, expected(invalid[0], params)), assert.AssertionError)
})
