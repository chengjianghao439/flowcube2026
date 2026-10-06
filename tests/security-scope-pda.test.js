'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { createRequire } = require('node:module')
const root = path.resolve(__dirname, '..')
function load(file, mocks) {
  const filename = path.join(root, file), module = { exports: {} }, real = createRequire(filename)
  const source = process.env.SECURITY_SCOPE_BASELINE ? require('node:child_process').execFileSync('git', ['show', `${process.env.SECURITY_SCOPE_BASELINE}:${file}`], { cwd: root, encoding: 'utf8' }) : fs.readFileSync(filename, 'utf8')
  vm.runInNewContext(source, { module, exports: module.exports, require: name => Object.hasOwn(mocks, name) ? mocks[name] : real(name) }, { filename })
  return module.exports
}
function scope(pool) { return load('backend/src/utils/warehouseScope.js', { '../config/db': { pool } }) }
function tx(query) { return { query, beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release() {} } }
function returns(task = { id: 1, warehouse_id: 2, status: 3 }) {
  const calls = [], pool = { query: async (sql, params) => { calls.push({ sql, params }); return [[]] } }
  const svc = load('backend/src/modules/return-tasks/return-tasks.service.js', {
    '../../config/db': { pool }, '../../utils/warehouseScope': scope(pool),
    '../../engine/containerEngine': { CONTAINER_STATUS: {} }, '../../utils/codeGenerator': {}, './return-tasks.labels': {},
    '../../utils/statusTransition': { lockStatusRow: async () => { calls.push('lock'); return task } },
    '../sale/sale.commercial-returns': { lockExecution: async () => {} },
    '../../utils/operationRequest': { beginResourceOperationRequest: async () => { calls.push('receipt'); return { replay: true, responseData: { taskId: 1 } } } },
  })
  return { svc, calls, pool }
}
for (const method of ['receive', 'check', 'putaway']) {
  test(`return ${method} rejects user scope before replay`, async () => {
    const h = returns()
    await assert.rejects(() => h.svc[method](h.pool, 1, { requestKey: 'r', pdaWarehouseId: 2, scopeWarehouseIds: [1] }), e => e.statusCode === 403)
    assert.deepEqual(h.calls, ['lock'])
  })
  test(`return ${method} requires device warehouse before replay`, async () => {
    for (const pdaWarehouseId of [null, 1]) {
      const h = returns()
      await assert.rejects(() => h.svc[method](h.pool, 1, { requestKey: 'r', pdaWarehouseId, scopeWarehouseIds: [2] }), e => e.statusCode === 403)
      assert.deepEqual(h.calls, ['lock'])
    }
  })
  test(`return ${method} preserves an authorized original receipt regardless of terminal task status`, async () => {
    const h = returns({ id: 1, warehouse_id: 2, status: 5 })
    assert.equal((await h.svc[method](h.pool, 1, { requestKey: 'r', pdaWarehouseId: 2, scopeWarehouseIds: [2] })).taskId, 1)
    assert.deepEqual(h.calls, ['lock', 'receipt'])
  })
}
test('return PDA queue intersects device warehouse with user scope and rejects unbound devices', async () => {
  const h = returns()
  await assert.rejects(() => h.svc.findPdaTasks(null, [2]), e => e.statusCode === 403)
  await assert.rejects(() => h.svc.findPdaTasks(2, [1]), e => e.statusCode === 403)
  await h.svc.findPdaTasks(2, [2])
  assert.equal(h.calls.length, 1)
  assert.match(h.calls[0].sql, /warehouse_id = \?/)
  assert.equal(h.calls[0].params[0], 2)
})
function packages(warehouseId = 2) {
  const calls = [], conn = tx(async (sql, params) => {
    calls.push({ sql, params })
    if (sql.includes('FROM warehouse_tasks')) return [[{ id: 1, warehouse_id: warehouseId, status: 5 }]]
    if (sql.includes('JOIN warehouse_tasks')) return [[{ id: 3, warehouse_task_id: 1, warehouse_id: warehouseId }]]
    if (sql.startsWith('INSERT')) return [{ insertId: 3 }]
    return [[]]
  })
  const pool = { query: conn.query, getConnection: async () => conn }, scopes = scope(pool)
  const helper = load('backend/src/modules/warehouse-tasks/warehouse-tasks.helpers.js', { '../../utils/warehouseScope': scopes, '../../utils/codeGenerator': {}, '../../utils/logger': {} })
  const svc = load('backend/src/modules/packages/packages.service.js', {
    '../../config/db': { pool }, '../../utils/warehouseScope': scopes,
    '../warehouse-tasks/warehouse-tasks.helpers': helper, '../print-jobs/print-jobs.service': {},
    '../logistics/logistics.service': {}, '../warehouse-tasks/warehouse-task-events.service': {},
    './packages.receipt-guard': {}, '../../utils/operationRequest': {},
    '../../utils/inboundThresholds': { getInboundClosureThresholds: async () => ({}) },
  })
  return { svc, calls }
}
test('package task list denies other warehouse and null-owner tasks before item/print reads', async () => {
  for (const warehouseId of [2, null]) {
    const h = packages(warehouseId)
    await assert.rejects(() => h.svc.listByTask(1, [1]), e => e.statusCode === 403)
    assert.equal(h.calls.length, 1)
  }
})
test('package barcode denies other warehouse before package/print detail reads', async () => {
  const h = packages()
  await assert.rejects(() => h.svc.getByBarcode('L000003', [1]), e => e.statusCode === 403)
  assert.equal(h.calls.length, 1)
})
test('PDA package creation checks device warehouse even for a multiwarehouse user', async () => {
  for (const pdaWarehouseId of [null, 1]) {
    const h = packages()
    await assert.rejects(() => h.svc.createPackage(1, null, [1, 2], pdaWarehouseId), e => e.statusCode === 403)
    assert.equal(h.calls.length, 1)
  }
})
test('PDA package creation accepts matching user and device warehouse', async () => {
  const h = packages()
  assert.equal((await h.svc.createPackage(1, null, [2], 2)).warehouseTaskId, 1)
  assert.equal(h.calls.filter(c => c.sql.startsWith('INSERT')).length, 1)
})
function stockcheck() {
  const calls = [], conn = tx(async () => { throw new Error('No scan SQL expected') }), pool = { getConnection: async () => conn }
  const svc = load('backend/src/modules/stockcheck/stockcheck.service.js', {
    '../../config/db': { pool }, '../../utils/warehouseScope': scope(pool),
    '../../engine/containerEngine': {}, '../../utils/codeGenerator': {},
    '../../utils/statusTransition': { lockStatusRow: async () => { calls.push('lock'); return { warehouse_id: 2, status: 5 } } },
    '../../utils/operationRequest': { beginResourceOperationRequest: async () => { calls.push('receipt'); return { replay: true, responseData: { scannedContainers: 1 } } } },
  })
  return { svc, calls }
}
test('stockcheck device and current scope are checked before an old successful receipt', async () => {
  for (const [scopeWarehouseIds, pdaWarehouseId] of [[[1, 2], 1], [[1, 2], null], [[1], 2]]) {
    const h = stockcheck()
    await assert.rejects(() => h.svc.saveItemContainerScans(1, 1, [], { userId: 1 }, scopeWarehouseIds, 'r', pdaWarehouseId), e => e.statusCode === 403)
    assert.deepEqual(h.calls, ['lock'])
  }
  const h = stockcheck()
  assert.equal((await h.svc.saveItemContainerScans(1, 1, [], { userId: 1 }, [2], 'r', 2)).scannedContainers, 1)
  assert.deepEqual(h.calls, ['lock', 'receipt'])
})

test('PDA controllers propagate authenticated scope/device context and ignore body-supplied context', async () => {
  const calls = [], conn = tx(async () => [[]])
  const req = { query: { taskId: 1 }, params: { id: 1, itemId: 1, barcode: 'L1' }, body: { warehouseTaskId: 1, pdaWarehouseId: 9, scopeWarehouseIds: [9], scans: [] }, user: { userId: 8, warehouseIds: [2] }, pda: { warehouseId: 2 }, headers: { 'x-request-key': 'r' } }
  const response = { successResponse: () => {} }
  const record = name => async (...args) => { calls.push({ name, args }); return {} }
  const returns = load('backend/src/modules/return-tasks/return-tasks.controller.js', {
    '../../config/db': { pool: { getConnection: async () => conn } }, '../../utils/response': response,
    './return-tasks.service': Object.fromEntries(['findPdaTasks','receive','check','putaway'].map(n => [n,record(n)])),
  })
  for (const method of ['pdaList','receive','check','putaway']) await returns[method](req, {}, e => { throw e })
  assert.equal(calls[0].args[0],2); assert.equal(calls[0].args[1][0],2)
  for (const c of calls.slice(1)) { assert.equal(c.args[2].scopeWarehouseIds[0],2); assert.equal(c.args[2].pdaWarehouseId,2) }
  calls.length = 0
  const packages = load('backend/src/modules/packages/packages.controller.js', { '../../utils/response': response,
    './packages.service': Object.fromEntries(['listByTask','createPackage','getByBarcode'].map(n => [n,record(n)])),
  })
  for (const method of ['list','create','getByBarcode']) await packages[method](req, {}, e => { throw e })
  assert.equal(calls[0].args[1][0],2); assert.equal(calls[1].args[2][0],2); assert.equal(calls[1].args[3],2); assert.equal(calls[2].args[1][0],2)
  calls.length = 0
  const checks = load('backend/src/modules/stockcheck/stockcheck.controller.js', { '../../utils/response': response,
    './stockcheck.service': { saveItemContainerScans: record('scan') }, './stockcheck.cycle': {},
  })
  await checks.saveItemScans(req, {}, e => { throw e })
  assert.equal(calls[0].args[4][0],2); assert.equal(calls[0].args[6],2)
})
