'use strict'

// Real middleware/helpers with isolated query results; no environment or database is loaded.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { createRequire } = require('node:module')
const AppError = require('../backend/src/utils/AppError')
const logger = { info() {}, warn() {}, error() {} }

function load(relative, stubs) {
  const filename = path.resolve(__dirname, '../backend/src', relative)
  const localRequire = createRequire(filename)
  const module_ = { exports: {} }
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module: module_, console, Buffer, process, setInterval, clearInterval,
    require: id => Object.hasOwn(stubs, id) ? stubs[id] : localRequire(id),
  }, { filename })
  return module_.exports
}

test('PDA ticket rejects a different user and accepts its owner', async () => {
  const row = { session_id: 4, device_id: 5, user_id: 21, scopes: [], device_status: 'active',
    session_warehouse_id: 3, device_warehouse_id: 3, expires_at: new Date(Date.now() + 60000) }
  let writes = 0
  const middleware = load('middleware/pdaSession.js', {
    '../config/db': { pool: { query: async sql => sql.includes('SELECT') ? [[row]] : (writes++, [{}]) } },
    '../utils/logger': logger,
    '../modules/pda/pda.sessions.service': { hashToken: () => 'synthetic', normalizeScopes: x => x },
  }).pdaSessionRequired()
  for (const userId of [22, undefined, 21]) {
    let error
    const req = { headers: { 'x-pda-session': 'synthetic' }, user: { userId } }
    await middleware(req, {}, e => { error = e })
    if (userId !== 21) {
      assert.equal(error?.statusCode, 403)
      assert.equal(writes, 0)
    } else {
      assert.equal(error, undefined)
      assert.equal(req.pda.userId, 21)
      assert.equal(writes, 2)
    }
  }
})

test('role permission revocation from another process is visible on the next request', async () => {
  let permissions = ['inventory.view']
  const { loadRolePermissions } = load('middleware/loadRolePermissions.js', {
    '../config/db': { pool: { query: async () => [permissions.map(permission => ({ permission }))] } },
  })
  const req = { user: { roleId: 5 } }
  await loadRolePermissions(req, {}, e => { if (e) throw e })
  assert.equal(req.user.permissions.length, 1)
  permissions = []
  const nextReq = { user: { roleId: 5 } }
  await loadRolePermissions(nextReq, {}, e => { if (e) throw e })
  assert.equal(nextReq.user.permissions.length, 0)
})

test('warehouse revocation from another process is visible on the next request', async () => {
  let warehouses = [1, 2]
  const { loadUserWarehouseScope } = load('utils/warehouseScope.js', {
    '../config/db': { pool: { query: async () => [warehouses.map(warehouse_id => ({ warehouse_id }))] } },
  })
  assert.equal((await loadUserWarehouseScope(8, 5)).length, 2)
  warehouses = [1]
  assert.equal((await loadUserWarehouseScope(8, 5)).length, 1)
})

test('barcode details enforce warehouse scope in service and controller', async () => {
  const scope = load('utils/warehouseScope.js', { '../config/db': { pool: {} } })
  const row = { id: 1, warehouse_id: 9, initial_qty: 2, remaining_qty: 2, barcode: 'I000001' }
  const svc = load('modules/inventory/inventory.service.js', {
    '../../config/db': { pool: { query: async () => [[row]] } },
    '../../utils/warehouseScope': scope,
    '../../engine/inventoryEngine': {}, '../../engine/containerEngine': {},
    '../../utils/expectedStock': {}, '../../utils/operationRequest': {}, './manual-stock-request': {},
  })
  await assert.rejects(svc.getContainerByBarcode(row.barcode, [3]), e => e instanceof AppError && e.statusCode === 403)
  assert.equal((await svc.getContainerByBarcode(row.barcode, [9])).warehouseId, 9)
  assert.equal((await svc.getContainerByBarcode(row.barcode, null)).warehouseId, 9)
  let passedScope
  const ctrl = load('modules/inventory/inventory.controller.js', {
    './inventory.service': { getContainerByBarcode: async (_, scopeIds) => { passedScope = scopeIds; return {} } },
    './inventory.procurement': {}, '../../utils/warehouseScope': scope,
    './inventory.aging': {},
  })
  await ctrl.containerByBarcode({ params: { bc: row.barcode }, user: { warehouseIds: [3] } }, { json() {}, status() { return this } }, e => { throw e })
  assert.deepEqual(passedScope, [3])
})
