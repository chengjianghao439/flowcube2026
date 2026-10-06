'use strict'
const { test } = require('node:test'), assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm')
const { createRequire } = require('node:module')
const root = path.resolve(__dirname, '..')
function load(rel, mocks) {
  const file = path.join(root, rel), module = { exports: {} }, real = createRequire(file)
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), { module, exports: module.exports, require: n => Object.hasOwn(mocks, n) ? mocks[n] : real(n) }, { filename: file })
  return module.exports
}
function fixture(file) {
  const calls = [], pool = { query: async (sql, params) => { calls.push({ sql, params }); return /COUNT\(\*\)|COALESCE\(SUM/.test(sql) ? [[{ total: 0 }]] : [[]] } }
  const scope = load('backend/src/utils/warehouseScope.js', { '../config/db': { pool } })
  return { calls, svc: load(file, {
    '../../config/db': { pool }, '../../utils/warehouseScope': scope, '../../utils/codeGenerator': {},
    './logistics.direct': {}, './finance-accounts.service': {}, '../accounting/finance-period.guard': {},
    '../../utils/logger': {}, '../../utils/statusTransition': {}, '../../utils/selfApprove': {}, '../../engine/containerEngine': { CONTAINER_STATUS: {} },
  }) }
}
for (const [file, method, cap] of [
  ['backend/src/modules/logistics/logistics.service.js', 'listWaybills', 500],
  ['backend/src/modules/logistics/logistics.freight.js', 'listFreightBills', 500],
  ['backend/src/modules/logistics/logistics.freight.js', 'listSettlements', 500],
  ['backend/src/modules/finance/expense-claims.service.js', 'findAll', 500],
  ['backend/src/modules/inventory/inventory.aging.js', 'getInventoryAging', 500],
  ['backend/src/modules/reports/reports.query.js', 'fetchReconciliationRows', 200],
]) {
  test(`${method} bounds pageSize at the service boundary`, async () => {
    const h = fixture(file)
    await h.svc[method]({ page: 2, pageSize: 999999 })
    const q = h.calls.find(c => /LIMIT \? OFFSET \?/.test(c.sql))
    assert.equal(q.params.at(-2), cap)
    assert.equal(q.params.at(-1), cap)
  })
  test(`${method} rejects non-integer, non-finite and unsafe pagination before SQL`, async () => {
    for (const options of [{ pageSize: Infinity }, { pageSize: 1.5 }, { page: NaN }, { page: 'x' }, { page: Number.MAX_SAFE_INTEGER, pageSize: 500 }]) {
      const h = fixture(file)
      await assert.rejects(() => h.svc[method](options), e => e.statusCode === 400)
      assert.equal(h.calls.length, 0)
    }
  })
}
test('reconciliation summary, count and rows apply identical authoritative source-warehouse predicates', async () => {
  for (const scopeWarehouseIds of [[2], []]) {
    const h = fixture('backend/src/modules/reports/reports.query.js')
    await h.svc.fetchReconciliationRows({ type: 2, scopeWarehouseIds })
    assert.equal(h.calls.length, 3)
    for (const q of h.calls) {
      if (!scopeWarehouseIds.length) assert.match(q.sql, /1=0/)
      else {
        assert.match(q.sql, /EXISTS.*purchase_orders/s)
        assert.match(q.sql, /EXISTS.*sale_orders/s)
        assert.match(q.sql, /sale_order_items/)
        assert.equal(q.params.filter(p => Array.isArray(p)).length, 3)
      }
    }
  }
})
test('reconciliation controller forwards trusted scope and public pagination', async () => {
  let options
  const svc = load('backend/src/modules/reports/reports.controller.js', { '../../utils/response': { successResponse: () => {} }, './reports.service': { reconciliationReport: async q => { options = q; return {} } } })
  await svc.reconciliation({ query: { page: 2, pageSize: 75, scopeWarehouseIds: [9] }, user: { warehouseIds: [2] } }, { json: () => {} }, e => { throw e })
  assert.equal(options.scopeWarehouseIds[0], 2)
  assert.equal(Number(options.page), 2)
  assert.equal(Number(options.pageSize), 75)
})
test('reconciliation export preserves scope/filters and collects all bounded report pages', async () => {
  const calls = [], file = 'backend/src/modules/export/export.service.js', filename = path.join(root, file), real = createRequire(filename)
  const source = fs.readFileSync(filename, 'utf8'), module = { exports: {} }
  vm.runInNewContext(source, { module, require: n => {
    if (n === '../reports/reports.service') return { reconciliationReport: async q => {
      calls.push(q)
      const start = (q.page - 1) * 200
      return { type: 2, pagination: { total: 450 }, list: Array.from({ length: Math.min(200, 450 - start) }, (_, i) => ({ id: start + i + 1 })) }
    } }
    if (n.startsWith('../') && !n.startsWith('../../')) return {}
    if (n.startsWith('../') && n.endsWith('.service')) return {}
    if (n === '../../config/db') return { pool: {} }
    if (n === '../../utils/warehouseScope') return {}
    return real(n)
  } }, { filename })
  const result = await module.exports.getReconciliationExportPayload({ type: 2, scopeWarehouseIds: [2], orderNo: 'SO', partyName: '测试', dueStart: '2026-10-01' })
  assert.equal(result.rows.length, 450)
  assert.equal(calls.length, 3)
  for (const q of calls) { assert.equal(q.scopeWarehouseIds[0], 2); assert.equal(q.orderNo, 'SO'); assert.equal(q.partyName, '测试'); assert.equal(q.dueStart, '2026-10-01') }
})
