'use strict'

// Real service exits with a transactional DB double. The live MySQL proof is
// recorded separately; these tests guard release ordering and replay semantics.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { createRequire } = require('node:module')

const root = path.resolve(__dirname, '..')
const relative = 'backend/src/modules/stockcheck/stockcheck.service.js'
const source = fs.readFileSync(path.join(root, relative), 'utf8')
const qty = require('../backend/src/utils/qtyPrecision')
const AppError = require('../backend/src/utils/AppError')
const operator = { userId: 4, realName: '事务测试' }

function load(file, text, mocks) {
  const filename = path.join(root, file)
  const real = createRequire(filename), module = { exports: {} }
  vm.runInNewContext(text, {
    module, exports: module.exports,
    require: name => Object.hasOwn(mocks, name) ? mocks[name] : real(name),
  }, { filename })
  return module.exports
}

function harness({ replay = false, status = 1, fault = null, empty = false, inputSource = source } = {}) {
  const calls = [], staged = [], committed = []
  const head = { id: 5, warehouse_id: 3, check_no: 'SC-TX', status }
  const item = { id: 8, product_id: 7, product_name: '事务测试商品', unit: '个', book_qty: 2, actual_qty: 2, diff_qty: 0 }
  const stock = { product_id: 7, product_code: 'TX7', product_name: item.product_name, unit: '个', quantity: 2 }
  const receipt = { itemId: 8, scannedContainers: 1, actualQty: 2, bookQty: 2, diffQty: 0 }
  let active = false
  const conn = {
    async beginTransaction() { assert.equal(active, false); active = true; calls.push('begin') },
    async commit() {
      calls.push('commit')
      if (fault === 'commit') throw new Error('injected commit failure')
      committed.push(...staged); staged.length = 0; active = false
    },
    async rollback() { calls.push('rollback'); staged.length = 0; active = false },
    release() { calls.push('release'); assert.equal(active, false, 'connection returned with an active transaction') },
    async query(sql) {
      calls.push(sql)
      if (fault === 'query' && sql.startsWith('DELETE FROM inventory_check_item_containers')) throw new Error('injected query failure')
      if (/^\s*(INSERT|UPDATE|DELETE)\b/i.test(sql)) { staged.push(sql); return [{ insertId: 5, affectedRows: 1 }] }
      if (sql.startsWith('SET TRANSACTION')) return [{}]
      if (sql.includes('FROM inventory_checks')) return [[head]]
      if (sql.includes('JOIN product_items')) return [empty ? [] : [stock]]
      if (sql.includes('FROM product_items')) return [[{ id: 7, name: item.product_name, allow_decimal_qty: 0 }]]
      if (sql.includes('FROM inventory_check_item_containers')) return [[]]
      if (sql.includes('FROM inventory_check_items')) return [[item]]
      if (sql.includes('FROM inventory_containers')) {
        if (sql.includes('SUM(')) return [[{ qty: 2, product_id: 7, warehouse_id: 3 }]]
        return [[{ id: 9, barcode: 'TX-I', remaining_qty: 2, initial_qty: 2, product_id: 7, warehouse_id: 3, status: 1, container_type: 2 }]]
      }
      throw new Error(`Unexpected SQL: ${sql}`)
    },
  }
  const pool = { getConnection: async () => conn }
  const scopeFile = 'backend/src/utils/warehouseScope.js'
  const scope = load(scopeFile, fs.readFileSync(path.join(root, scopeFile), 'utf8'), { '../config/db': { pool } })
  const statusFile = 'backend/src/utils/statusTransition.js'
  const statusHelpers = load(statusFile, fs.readFileSync(path.join(root, statusFile), 'utf8'), {})
  const api = load(relative, inputSource, {
    '../../config/db': { pool }, '../../utils/warehouseScope': scope,
    '../../utils/qtyPrecision': qty, '../../utils/statusTransition': statusHelpers,
    '../../utils/codeGenerator': { generateDailyCode: async () => 'SC-TX' },
    '../../engine/containerEngine': {
      CONTAINER_STATUS: { ACTIVE: 1 }, SOURCE_TYPE: {},
      lockStockDimension: async () => { calls.push('stock-lock') },
    },
    '../../engine/inventoryEngine': { MOVE_TYPE: {} },
    '../../utils/logger': {},
    '../../utils/operationRequest': {
      beginResourceOperationRequest: async () => { calls.push('receipt'); return { replay, responseData: receipt } },
      completeOperationRequest: async () => {
        calls.push('complete')
        if (fault === 'receipt') throw new Error('injected receipt failure')
      },
    },
  })
  return { api, calls, committed, receipt, item, active: () => active }
}

function invoke(h, method, opts = {}) {
  const scope = opts.scope ?? [3]
  if (method === 'create') return h.api.create({ warehouseId: 3, warehouseName: '事务仓', operator, scopeWarehouseIds: scope })
  if (method === 'updateItems') return h.api.updateItems(5, [{ id: 8, actualQty: opts.actualQty ?? 2 }], scope)
  if (method === 'refreshItem') return h.api.refreshItem(5, 8, scope)
  if (method === 'cancel') return h.api.cancel(5, scope)
  if (method === 'submit') return h.api.submit(5, operator, scope, 'same-key')
  return h.api.saveItemContainerScans(5, 8, opts.scans ?? [{ barcode: 'TX-I', countedQty: 2 }], operator, scope, 'same-key', opts.pdaWarehouseId ?? 3)
}

for (const method of ['create', 'updateItems', 'refreshItem', 'cancel', 'submit', 'saveItemContainerScans']) {
  test(`${method}: success commits once before release`, async () => {
    const h = harness()
    await invoke(h, method)
    assert.equal(h.calls.filter(x => x === 'commit').length, 1)
    assert.equal(h.calls.includes('rollback'), false)
    assert.deepEqual(h.calls.slice(-2), ['commit', 'release'])
    assert.equal(h.active(), false)
  })
  test(`${method}: a commit error rolls back before release`, async () => {
    const h = harness({ fault: 'commit' })
    await assert.rejects(invoke(h, method), /injected commit failure/)
    assert.deepEqual(h.calls.slice(-3), ['commit', 'rollback', 'release'])
    assert.deepEqual(h.committed, [])
  })
  test(`${method}: current warehouse denial has no commit or leaked transaction`, async () => {
    const h = harness()
    await assert.rejects(invoke(h, method, { scope: [99] }), e => e instanceof AppError && e.statusCode === 403)
    assert.equal(h.calls.includes('commit'), false)
    assert.equal(h.calls.includes('receipt'), false)
    assert.equal(h.active(), false)
    assert.deepEqual(h.committed, [])
    if (method !== 'create') assert.deepEqual(h.calls.slice(-2), ['rollback', 'release'])
  })
}

for (const method of ['submit', 'saveItemContainerScans']) {
  test(`${method}: a successful original receipt ends its transaction before release`, async () => {
    const h = harness({ replay: true, status: 2 })
    assert.deepEqual(await invoke(h, method), h.receipt)
    assert.deepEqual(h.calls.slice(-3), ['receipt', 'rollback', 'release'])
    assert.equal(h.calls.includes('complete'), false)
    assert.deepEqual(h.committed, [])
  })
  test(`${method}: revoked current scope rejects even a terminal original receipt`, async () => {
    const h = harness({ replay: true, status: 2 })
    await assert.rejects(invoke(h, method, { scope: [] }), e => e.statusCode === 403)
    assert.equal(h.calls.includes('receipt'), false)
    assert.deepEqual(h.calls.slice(-2), ['rollback', 'release'])
  })
  test(`${method}: receipt write error rolls back all staged writes`, async () => {
    const h = harness({ fault: 'receipt' })
    await assert.rejects(invoke(h, method), /injected receipt failure/)
    assert.equal(h.calls.includes('commit'), false)
    assert.deepEqual(h.calls.slice(-2), ['rollback', 'release'])
    assert.deepEqual(h.committed, [])
  })
}

test('scan body is not reapplied on same-key replay, and device scope still precedes replay', async () => {
  const h = harness({ replay: true, status: 3 })
  assert.deepEqual(await invoke(h, 'saveItemContainerScans', { scans: [{ barcode: 'BAD', countedQty: -1 }] }), h.receipt)
  const denied = harness({ replay: true })
  await assert.rejects(invoke(denied, 'saveItemContainerScans', { pdaWarehouseId: 99 }), { code: 'PDA_WAREHOUSE_MISMATCH' })
  assert.equal(denied.calls.includes('receipt'), false)
  assert.deepEqual(denied.calls.slice(-2), ['rollback', 'release'])
})

test('scan SQL failure ends the transaction and leaves no staged changes', async () => {
  const h = harness({ fault: 'query' })
  await assert.rejects(invoke(h, 'saveItemContainerScans'), /injected query failure/)
  assert.deepEqual(h.calls.slice(-2), ['rollback', 'release'])
  assert.deepEqual(h.committed, [])
})

test('invalid count and empty create are rolled back without changing facts', async () => {
  const h = harness()
  await assert.rejects(invoke(h, 'updateItems', { actualQty: -1 }), e => e.statusCode === 400)
  assert.deepEqual(h.calls.slice(-2), ['rollback', 'release'])
  const empty = harness({ empty: true })
  await assert.rejects(invoke(empty, 'create'), /无需创建盘点单/)
  assert.deepEqual(empty.calls.slice(-2), ['rollback', 'release'])
  assert.deepEqual(empty.committed, [])
})

test('removing the replay rollback is caught by the actual service release guard', async () => {
  const mutant = source.replace(/if \(requestState\.replay\) \{\s*(?:\/\/[^\n]*\n\s*)*await conn\.rollback\(\)\s*return requestState\.responseData\s*\}/, 'if (requestState.replay) return requestState.responseData')
  assert.notEqual(mutant, source, 'mutation must remove a real replay cleanup')
  const h = harness({ replay: true, inputSource: mutant })
  await assert.rejects(invoke(h, 'saveItemContainerScans'), /connection returned with an active transaction/)
})
