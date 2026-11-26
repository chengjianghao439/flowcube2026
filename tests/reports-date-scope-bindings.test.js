'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm')
const helpers = require('../backend/src/modules/reports/reports.helpers')
const projection = require('../backend/src/modules/inventory/inventoryProjection')
const file = path.resolve(__dirname, '../backend/src/modules/reports/reports.query.js')
const methods = ['fetchPurchaseStatsRows', 'fetchSaleStatsRows', 'fetchInventoryStatsRows', 'fetchWavePerformanceRows', 'fetchPurchasePriceTrend']
const plain = value => JSON.parse(JSON.stringify(value))
// Exercise the real document-scope SQL builder without loading the database pool.
const scopeFile = require.resolve('../backend/src/utils/saleDocumentScope')
const requireScope = require('node:module').createRequire(scopeFile)
const scopeModule = { exports: {} }
vm.runInNewContext(fs.readFileSync(scopeFile, 'utf8'), { module: scopeModule,
  require: name => name === './warehouseScope' ? {} : requireScope(name) }, { filename: scopeFile })
function load(code = fs.readFileSync(file, 'utf8'), dateHelpers = helpers, turnoverRow = null) {
  const calls = [], module = { exports: {} }
  const mocks = {
    '../../config/db': { pool: { query: async (sql, params) => {
      calls.push({ sql, params: plain(params) })
      return turnoverRow && sql.includes('AS inbound_qty') ? [[turnoverRow]] : [[]]
    } } },
    './reports.helpers': dateHelpers,
    '../../utils/saleDocumentScope': scopeModule.exports,
    '../../utils/backendTime': { beijingTodayYmd: () => '2026-11-18' },
    '../inventory/inventoryProjection': projection,
    '../../utils/warehouseScope': { scopeFilter: (ids, column) => !Array.isArray(ids) ? { sql: '', params: [] } : !ids.length ? { sql: ' AND 1=0', params: [] } : { sql: ` AND ${column} IN (?)`, params: [ids] } },
  }
  vm.runInNewContext(code, { module, process: { env: {} }, require: name => mocks[name] || {} }, { filename: file })
  return { svc: module.exports, calls }
}
function expected(call, params) {
  const dated = /(?:o|l|pw)\.created_at >= \?|(?:o|l|pw)\.created_at < DATE_ADD\(\?, INTERVAL 1 DAY\)/.test(call.sql)
  const turnover = call.sql.includes('AS proof_start')
  const bounded = params.startDate && params.endDate
  const out = turnover ? (bounded ? [params.startDate, params.endDate] : [null, null])
    : call.sql.includes('i.product_id = ?') ? [99] : []
  if (dated) { if (params.startDate) out.push(params.startDate); if (params.endDate) out.push(params.endDate) }
  if (Array.isArray(params.scopeWarehouseIds) && params.scopeWarehouseIds.length) {
    out.push(params.scopeWarehouseIds)
    // Sales reports bind the same warehouse scope to the header and every saved line.
    if (/(?:FROM|JOIN) sale_orders o\b/i.test(call.sql)) out.push(params.scopeWarehouseIds)
    if (turnover) out.push(params.scopeWarehouseIds, params.scopeWarehouseIds)
  }
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

// Known same-scope period endpoints and complete movements only. These aggregate
// fixtures do not establish that today's cache is a historical endpoint, execute
// SQL, or choose how incomplete historical windows should be presented.
// Reverse verification: before the sign fix, five of these eight cases fail.
const turnoverCases = [
  { name: 'opening100 in20 out20 ending100 control', incoming: '20.00', outgoing: '20.00', ending: '100.00', average: 100, rate: 0.2, days: 150 },
  { name: 'opening110 in20 out30 ending100', incoming: '20.00', outgoing: '30.00', ending: '100.00', average: 105, rate: 0.29, days: 105 },
  { name: 'opening100 inbound-only20 ending120', incoming: '20.00', outgoing: '0.00', ending: '120.00', average: 110, rate: 0, days: null },
  { name: 'opening100 outbound-only20 ending80', incoming: '0.00', outgoing: '20.00', ending: '80.00', average: 90, rate: 0.22, days: 135 },
  { name: 'missing dates preserve scoped current stock with unavailable turnover', incoming: '20.00', outgoing: '20.00', ending: '100.00', average: null, rate: null, days: null, noDates: true },
  { name: 'allowed two-decimal quantities opening1.25 in0.25 out0.50 ending1', incoming: '0.25', outgoing: '0.50', ending: '1.00', average: 1.125, rate: 0.44, days: 67.5 },
  { name: 'zero endpoint average retains zero rate control', incoming: '10.00', outgoing: '10.00', ending: '0.00', average: 0, rate: 0, days: null },
  { name: 'opening10 outbound10 ending0 has positive average', incoming: '0.00', outgoing: '10.00', ending: '0.00', average: 5, rate: 2, days: 15 },
]
for (const fixture of turnoverCases) {
  test(`inventory turnover respects known endpoint conservation: ${fixture.name}`, async () => {
    const f = load(undefined, helpers, {
      code: 'SYN-TURNOVER', name: '合成守恒', unit: '件',
      inbound_qty: fixture.incoming, outbound_qty: fixture.outgoing, current_qty: fixture.ending,
      period_end_qty: fixture.ending, period_change: Number(fixture.incoming) - Number(fixture.outgoing), history_gaps: 0, log_count: 2,
    })
    const params = fixture.noDates ? {} : { startDate: '2026-09-01', endDate: '2026-09-30' }
    const { turnover } = plain(await f.svc.fetchInventoryStatsRows(params))
    assert.equal(f.calls.length, 2, 'only the existing turnover and warehouse valuation reads')
    assert.match(f.calls[0].sql, /AS inbound_qty/)
    assert.match(f.calls[1].sql, /AS total_value/)
    assert.equal(turnover.length, 1)
    const row = turnover[0]
    assert.deepEqual({ currentQty: row.currentQty, avgStock: row.avgStock, turnRate: row.turnRate, turnDays: row.turnDays },
      { currentQty: Number(fixture.ending), avgStock: fixture.average, turnRate: fixture.rate, turnDays: fixture.days })
  })
}

test('history endpoint is distinct from current scoped stock and carries the selected warehouse', async () => {
  const f = load(undefined, helpers, {
    code: 'HIST', name: '合成', unit: '件', inbound_qty: '20.00', outbound_qty: '30.00',
    current_qty: '140.00', period_end_qty: '100.00', period_change: '-10.00', history_gaps: 0, log_count: 2,
  })
  const result = await f.svc.fetchInventoryStatsRows({ startDate: '2026-10-01', endDate: '2026-10-31', scopeWarehouseIds: [2] })
  const row = result.turnover[0]
  assert.equal(row.currentQty, 140)
  assert.equal(row.periodEndQty, 100)
  assert.equal(row.avgStock, 105)
  assert.match(f.calls[0].sql, /inventory_stock ip.*ip\.warehouse_id IN \(\?\)/s)
})

test('turnover marks incomplete history and a single movement unavailable without hiding current stock', async () => {
  for (const fixture of [
    { history_gaps: 1, log_count: 2, reason: 'stock_history_unavailable' },
    { history_gaps: 0, log_count: 1, reason: 'insufficient_movements' },
  ]) {
    const f = load(undefined, helpers, {
      code: 'HIST', name: '合成', unit: '件', current_qty: '120.00', period_end_qty: '100.00',
      inbound_qty: '20.00', outbound_qty: '0.00', period_change: '20.00', ...fixture,
    })
    const result = await f.svc.fetchInventoryStatsRows({ startDate: '2026-10-01', endDate: '2026-10-31' })
    const row = result.turnover[0]
    assert.deepEqual([row.currentQty, row.periodEndQty, row.avgStock, row.turnRate, row.turnDays, row.unavailableReason],
      [120, null, null, null, null, fixture.reason])
  }
})
