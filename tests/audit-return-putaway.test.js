'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { createRequire } = require('node:module')
const root = path.resolve(__dirname, '..')
function load(rel, mocks) {
  const filename = path.join(root, rel)
  const realRequire = createRequire(filename)
  const module = { exports: {} }
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module, exports: module.exports,
    require: name => Object.hasOwn(mocks, name) ? mocks[name] : realRequire(name), console,
  }, { filename })
  return module.exports
}
function fixture({ task = {}, container = {}, location = {}, deleteBeforeLock = false } = {}) {
  const taskRow = { id: 31, status: 4, warehouse_id: 2, return_type: 'sale', ...task }
  const containerRow = { id: 917, barcode: 'I000123', status: 4, warehouse_id: 2, source_ref_type: 'sale_return', source_ref_id: 31, ...container }
  const locationRow = { id: 804, code: 'LOC-A01', barcode: 'R000456', status: 1, warehouse_id: 2, ...location }
  const calls = []
  const pool = { query: async (sql, params) => {
    calls.push({ sql, params })
    if (sql.includes('FROM return_tasks')) return [[taskRow]]
    if (sql.includes('FROM return_task_items')) return [[]]
    if (sql.includes('c.source_ref_type')) return [[containerRow].filter(r => r.source_ref_id === params[0] && r.status === params[1])]

    if (sql.includes('FROM inventory_containers') && deleteBeforeLock && sql.includes('FOR UPDATE')) containerRow.deleted_at = '2026-09-04 12:00:00'
    if (sql.includes('FROM inventory_containers') && sql.includes('deleted_at IS NULL') && containerRow.deleted_at) return [[]]
    if (sql.includes('FROM inventory_containers')) return [[containerRow].filter(r => typeof params[0] === 'number'
      ? r.id === params[0] && r.source_ref_type === 'sale_return' && r.source_ref_id === params[1]
      : r.barcode.toUpperCase() === String(params[0]).toUpperCase())]
    if (sql.includes('FROM warehouse_locations')) return [[locationRow].filter(r => [r.code, r.barcode].includes(params[0]))]
    throw new Error(`Unexpected SQL ${sql}`)
  } }
  const base = { '../../config/db': { pool } }
  base['../../utils/warehouseScope'] = load('backend/src/utils/warehouseScope.js', { '../config/db': { pool } })
  const locations = load('backend/src/modules/locations/locations.service.js', base)
  const svc = load('backend/src/modules/return-tasks/return-tasks.service.js', {
    ...base, '../../engine/containerEngine': { CONTAINER_STATUS: { PENDING_PUTAWAY: 4 }, lockStockDimension: async () => {} },
    '../../utils/codeGenerator': {}, '../../utils/statusTransition': { lockStatusRow: async () => taskRow }, '../../utils/operationRequest': {},
    '../locations/locations.service': locations,
    './return-tasks.labels': { queueReturnLabels: async () => { throw new Error('Lookup/putaway must not enqueue a receive/QA label') } },
  })
  return { svc, calls, pool }
}
const access = { pdaWarehouseId: 2, scopeWarehouseIds: [2] }
test('container lookup uses the full barcode and returns the actual unrelated primary key', async () => {
  for (const barcode of ['I000123', 'CNT000123']) {
    const h = fixture({ container: { barcode } })
    const found = await h.svc.findPutawayContainer(31, barcode, access)
    assert.equal(found.containerId, 917)
    assert.equal(found.barcode, barcode)
    assert.equal(found.taskId, 31)
    assert.equal(h.calls[1].params[0], barcode)
  }
})
test('location lookup resolves R and LOC codes to actual primary key', async () => {
  for (const code of ['R000456', 'LOC-A01']) {
    const h = fixture()
    const found = await h.svc.findPutawayLocation(31, code, access)
    assert.equal(Number(found.id), 804)
    assert.equal(Number(found.warehouseId), 2)
  }
})
test('container lookup rejects different task, source, warehouse, and consumed state', async () => {
  for (const container of [{ source_ref_id: 99 }, { source_ref_type: 'purchase' }, { warehouse_id: 9 }, { status: 1 }]) {
    const h = fixture({ container })
    await assert.rejects(() => h.svc.findPutawayContainer(31, 'I000123', access), /容器|仓库/)
  }
})
test('both lookups enforce task state, warehouse scope and device binding', async () => {
  for (const fn of ['findPutawayContainer', 'findPutawayLocation']) {
    for (const opts of [{ ...access, pdaWarehouseId: 9 }, { ...access, pdaWarehouseId: null }, { ...access, scopeWarehouseIds: [9] }]) {
      await assert.rejects(() => fixture().svc[fn](31, 'I000123', opts), /仓库|绑定|设备/)
    }
    await assert.rejects(() => fixture({ task: { status: 5 } }).svc[fn](31, 'I000123', access), /待上架/)
  }
})
test('location lookup rejects disabled or other-warehouse locations', async () => {
  for (const location of [{ status: 0 }, { warehouse_id: 9 }]) {
    await assert.rejects(() => fixture({ location }).svc.findPutawayLocation(31, 'R000456', access), /停用|仓库/)
  }
})
test('lookup routes require authentication, return execute permission, PDA client and device session', () => {
  const routes = []; const uses = []
  const auth = () => {}; const pda = () => {}; const device = () => {}; const permission = () => {}
  const router = { use: fn => uses.push(fn), get: (url, ...handlers) => routes.push({ url, handlers }), post() {} }
  load('backend/src/modules/return-tasks/return-tasks.routes.js', {
    express: { Router: () => router }, './return-tasks.controller': {},
    '../../middleware/auth': { authMiddleware: auth, requirePermission: code => code === 'return:execute' ? permission : () => {} },
    '../../constants/permissions': { PERMISSIONS: { RETURN_ORDER_EXECUTE: 'return:execute' } },
    '../../middleware/pdaSession': { pdaSessionRequired: () => device }, '../../middleware/pdaOnly': { pdaOnly: pda },
  })
  assert.ok(uses.includes(auth))
  for (const url of ['/:id/putaway-container', '/:id/putaway-location']) {
    const route = routes.find(r => r.url === url)
    assert.ok(route, `missing ${url}`)
    for (const middleware of [permission, pda, device]) assert.ok(route.handlers.includes(middleware))
  }
})

test('direct putaway cannot bypass device binding, scope or task/container warehouse checks', async () => {
  for (const entry of [
    { patch: {}, access: { ...access, pdaWarehouseId: null }, message: /设备|绑定/ },
    { patch: {}, access: { ...access, scopeWarehouseIds: [9] }, message: /仓库/ },
    { patch: { container: { warehouse_id: 9 } }, access, message: /仓库/ },
    { patch: { container: { source_ref_id: 99 } }, access, message: /容器/ },
    { patch: { container: { status: 1 } }, access, message: /待上架/ },
  ]) {
    const h = fixture(entry.patch)
    await assert.rejects(() => h.svc.putaway(h.pool, 31, { containerId: 917, locationId: 804, ...entry.access }), entry.message)
    assert.ok(h.calls.every(c => !/^\s*(UPDATE|INSERT)\b/.test(c.sql)))
  }
})

test('soft-deleted batch labels cannot be looked up or put away, including deletion before the locked read', async () => {
  const deleted = { container: { deleted_at: '2026-09-04 12:00:00' } }
  await assert.rejects(() => fixture(deleted).svc.findPutawayContainer(31, 'I000123', access), /容器.*不存在/)
  for (const patch of [deleted, { deleteBeforeLock: true }]) {
    const h = fixture(patch)
    await assert.rejects(() => h.svc.putaway(h.pool, 31, { containerId: 917, locationId: 804, ...access }), /容器不存在/)
    assert.ok(h.calls.every(c => !/^\s*(UPDATE|INSERT)\b/.test(c.sql)))
  }
})

test('task detail exposes the real pending container barcode after quality-check splitting', async () => {
  const h = fixture({ container: { barcode: 'I000918', remaining_qty: '4.0000', product_id: 8, product_name: '测试商品' } })
  const detail = await h.svc.findById(31, [2])
  assert.equal(detail.pendingPutawayContainers?.length, 1)
  assert.equal(detail.pendingPutawayContainers[0].barcode, 'I000918')
  assert.equal(detail.pendingPutawayContainers[0].qty, 4)
})
