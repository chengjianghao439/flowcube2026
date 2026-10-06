// R10: execute the real service/controller/routes/receipt guard with SQL and engine boundaries only.
// No app/config/db module is required; undeclared require edges fail instead of loading credentials.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const AppError = require('../backend/src/utils/AppError')
const base = path.resolve(__dirname, '../backend/src')
function load(file, deps = {}) {
  const filename = path.join(base, file), module = { exports: {} }
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module, require: name => {
    if (Object.hasOwn(deps, name)) return deps[name]
    if (name.startsWith('node:')) return require(name)
    throw Error(`Unstubbed require ${file}: ${name}`)
  } }, { filename })
  return module.exports
}
const pure = file => load(file, { './AppError': AppError, './sqlIdentifier': require('../backend/src/utils/sqlIdentifier') })
const status = load('constants/documentStatusRules.js', { '../utils/AppError': AppError })
const scope = load('utils/warehouseScope.js', { '../config/db': {}, './AppError': AppError })
const precision = pure('utils/qtyPrecision.js')
const handlingGuards = load('modules/disposal/disposal.handling.target-guards.js', { '../../utils/AppError': AppError, '../../utils/warehouseScope': scope, '../../utils/qtyPrecision': precision })
const transition = pure('utils/statusTransition.js')
const normalizePagination = pure('utils/pagination.js').normalizePagination
const clean = value => JSON.parse(JSON.stringify(value))
const item = (type = 3, productId = 3) => ({ id: productId, disposal_id: 11, product_id: productId, product_code: `P${productId}`, product_name: 'fixture', unit: '个', quantity: 2, unit_value: 5, dispose_type: type })
const original = { id: 11, disposalNo: 'DP11', disposedValue: 10 }
function fixture({ items = [item()], state = 3, replay = false, failStock = false, failRollback = false, beforeLockItems = null, receiptType = "inventory_disposal", receiptId = 11, receiptAction = "disposal.dispose.11", oldSnapshotReceipt = false, converted = false } = {}) {
  const events = [], sqls = [], row = { id: 11, warehouse_id: 8, warehouse_name: 'fixture', disposal_no: 'DP11', status: state, operator_id: 7, disposal_handling_link_id: null }
  const expectedResult = { ...original, disposedValue: items.reduce((sum, row) => sum + Number(row.quantity) * Number(row.unit_value), 0) }
  let locked = false
  const conn = {
    async beginTransaction() { events.push('begin') }, async commit() { events.push('commit') },
    async rollback() { events.push('rollback'); if (failRollback) throw Error('rollback uncertain') }, release() { events.push('release') },
    async query(sql, params = []) {
      sqls.push({ sql, params: clean(params) })
      if (sql.includes('FROM inventory_disposal_orders')) { if (/FOR UPDATE/.test(sql)) { locked = true; events.push('head') }; return [[row]] }
      if (sql === 'SELECT id FROM inventory_disposal_conversions WHERE original_disposal_id=? FOR SHARE') { assert.deepEqual(clean(params), [11]); events.push('conversion'); return [converted ? [{ id:81 }] : []] }
      if (sql.includes('FROM inventory_disposal_items')) { events.push('items'); return [beforeLockItems && !/FOR SHARE|FOR UPDATE/.test(sql) ? beforeLockItems : items] }
      if (sql.includes('FROM operation_requests')) return [[{ id: 31, action: receiptAction, resource_type: oldSnapshotReceipt && !/FOR SHARE|FOR UPDATE/.test(sql) ? 'wrong' : receiptType, resource_id: receiptId, status: 1, user_id: 9, response_json: JSON.stringify(original) }]]
      if (sql.includes('FROM product_items')) return [[{ id: 3, code: 'P3', name: 'fixture', unit: '个', unit_value: 5, allow_decimal_qty: 0 }]]
      if (sql.includes('FROM inventory_warehouses')) return [[{ id: 8, name: 'fixture' }]]
      if (sql.includes('INSERT INTO inventory_disposal_orders')) return [{ insertId: 11 }]
      if (sql.includes('INSERT INTO disposal_scrapped')) events.push('ledger')
      else if (/INSERT|UPDATE|DELETE/.test(sql)) events.push('write')
      return [{ affectedRows: 1 }]
    },
  }
  const requests = load('utils/operationRequest.js', { '../config/db': {}, './AppError': AppError })
  const deps = {
    './disposal.handling.target-guards': handlingGuards,
    '../../config/db': { pool: { getConnection: async () => conn } }, '../../utils/AppError': AppError,
    '../../utils/qtyPrecision': precision, '../../utils/warehouseScope': scope, '../../utils/statusTransition': transition,
    '../../constants/documentStatusRules': status, '../../utils/pagination': { normalizePagination },
    '../../utils/selfApprove': { assertNotSelfApproval: async (creator, actor) => { events.push('self'); if (creator === actor) throw new AppError('self', 403, 'SELF_APPROVAL_DENIED') } },
    '../../utils/codeGenerator': { generateDailyCode: async () => 'DP11' },
    '../../engine/inventoryEngine': { MOVE_TYPE: { DISPOSAL: 'disposal' }, writeInventoryLog: async (actual) => { assert.equal(actual, conn); events.push('log') } },
    '../../engine/containerEngine': { SOURCE_TYPE: { DISPOSAL: 'disposal' }, lockStockDimension: async (actual, productId) => { assert.equal(actual, conn); events.push(`dimension:${productId}`) }, adjustContainerStock: async actual => { assert.equal(actual, conn); events.push('stock'); if (failStock) throw new AppError('unavailable', 400); return { before: 10, after: 8, primaryDeductContainerId: 50 } } },
    '../../utils/operationRequest': { ...requests, beginResourceOperationRequest: async (actual, input) => { assert.equal(actual, conn); assert.equal(locked, true); assert.equal(input.action, 'disposal.dispose'); assert.equal(input.resourceId, 11); assert.equal(input.requestKey, 'original'); events.push('request'); return { enabled: true, id: 31, action: 'disposal.dispose.11', userId: 9, replay, responseData: original } }, completeOperationRequest: async (actual, _state, data) => { assert.equal(actual, conn); assert.equal(data.resourceType, 'inventory_disposal'); assert.equal(data.resourceId, 11); assert.deepEqual(clean(data.data), expectedResult); events.push('receipt') } },
  }
  if (fs.existsSync(path.join(base, 'modules/disposal/disposal.receipt.js'))) deps['./disposal.receipt'] = load('modules/disposal/disposal.receipt.js', { '../../utils/AppError': AppError, '../../utils/warehouseScope': scope })
  return { service: load('modules/disposal/disposal.service.js', deps), events, sqls, conn }
}
const operator = { userId: 9, realName: 'fixture' }
const input = { warehouseId: 8, items: [{ productId: 3, quantity: 2, disposeType: 3 }], operator, scopeWarehouseIds: [8] }
test('new independent create rejects 1/2 before any inventory or document write', async () => {
  for (const disposeType of [1, 2]) { const f = fixture(); await assert.rejects(f.service.create({ ...input, items: [{ ...input.items[0], disposeType }] }), e => e.code === 'DISPOSAL_SCRAP_ONLY'); assert.ok(!f.events.includes('write')); assert.ok(!f.events.includes('stock')) }
})
test('update/submit/approve reject legacy and mixed complete original items after head lock', async () => {
  for (const items of [[item(1)], [item(2)], [item(), item(1, 4)], [], [item(99)]]) {
    for (const action of ['update', 'submit', 'approve']) {
      const f = fixture({ items, state: action === 'approve' ? 2 : 1, beforeLockItems: [item()] })
      await assert.rejects(action === 'update' ? f.service.update(11, input, [8]) : action === 'submit' ? f.service.submit(11, [8]) : f.service.approve(11, operator, [8]), e => e.code === 'DISPOSAL_SCRAP_ONLY')
      assert.ok(f.events.indexOf('head') < f.events.indexOf('items')); assert.ok(!f.events.includes('write')); assert.ok(!f.events.includes('stock'))
    }
  }
})
test('old 1/2 pending reject/cancel remain legal, self and scope rules remain', async () => {
  for (const action of ['reject', 'cancel']) { const f = fixture({ items: [item(1)], state: 2 }); await (action === 'reject' ? f.service.reject(11, { operator, reason: 'fixture' }, [8]) : f.service.cancel(11, [8])); assert.ok(f.events.includes('commit')) }
  await assert.rejects(fixture({ state: 2 }).service.reject(11, { operator: { userId: 7 } }, [8]), e => e.code === 'SELF_APPROVAL_DENIED')
  await assert.rejects(fixture({ state: 2 }).service.approve(11, operator, []), e => e.code === 'WAREHOUSE_SCOPE_DENIED')
})
test('execute rejects legacy/mixed/empty/unknown before any dimension/container/log/ledger write', async () => {
  for (const items of [[item(1)], [item(2)], [item(), item(2, 4)], [], [item(99)]]) { const f = fixture({ items, beforeLockItems: [item()] }); await assert.rejects(f.service.dispose(11, operator, [8], 'original'), e => e.code === 'DISPOSAL_SCRAP_ONLY'); assert.ok(!f.events.some(e => e.startsWith('dimension') || ['stock', 'ledger', 'log'].includes(e))) }
})
test('new execute requires key; scope denied before replay; original successful key before terminal guard', async () => {
  await assert.rejects(fixture().service.dispose(11, operator, [8]), e => e.code === 'REQUEST_KEY_REQUIRED')
  const denied = fixture({ replay: true, state: 4 }); await assert.rejects(denied.service.dispose(11, operator, [], 'original'), e => e.code === 'WAREHOUSE_SCOPE_DENIED'); assert.ok(!denied.events.includes('request'))
  const replay = fixture({ replay: true, state: 4 }); assert.deepEqual(clean(await replay.service.dispose(11, operator, [8], 'original')), original); assert.ok(!replay.events.includes('stock')); assert.equal(replay.events.filter(e => e === 'commit').length, 1)
  await assert.rejects(fixture({ state: 4 }).service.dispose(11, operator, [8], 'original'), e => e.statusCode === 400 || e.statusCode === 409)
})
test('scrap stock/ledger/log/CAS/receipt share one connection and commit, rollback proof only fresh rollback', async () => {
  const f = fixture(); assert.deepEqual(clean(await f.service.dispose(11, operator, [8], 'original')), original)
  assert.ok(f.events.indexOf('head') < f.events.indexOf('dimension:3')); assert.ok(f.events.indexOf('dimension:3') < f.events.indexOf('stock')); assert.ok(f.events.indexOf('receipt') < f.events.indexOf('commit')); assert.equal(f.events.filter(e => e === 'commit').length, 1)
  const fail = fixture({ failStock: true }); await assert.rejects(fail.service.dispose(11, operator, [8], 'original'), e => e.data?.disposalNotExecuted === true); assert.ok(!fail.events.includes('commit')); assert.ok(fail.events.includes('rollback'))
  await assert.rejects(fixture({ failStock: true, failRollback: true }).service.dispose(11, operator, [8], 'original'), e => !e.data?.disposalNotExecuted)
})
test('suggestion basic-unit reference is independent of container qty, stock/reserved/reference quantities distinct', async () => {
  const queries = [], pool = { async query(sql) { queries.push(sql); if (sql.includes('COUNT(*)')) return [[{ total: 1 }]]; return [[{ product_id: 3, warehouse_id: 8, unit_value: /MAX\(c.remaining_qty \*/.test(sql) ? 150 : 5, total_qty: 18, on_hand_qty: 30, reserved_qty: 12, total_value: 150, valuation_basis: 'avg_cost' }]] } }
  const service = load('modules/disposal/disposal.service.js', { './disposal.handling.target-guards': handlingGuards, '../../config/db': { pool }, '../../utils/AppError': AppError, '../../utils/qtyPrecision': precision, '../../utils/warehouseScope': scope, '../../utils/statusTransition': transition, '../../constants/documentStatusRules': status, '../../utils/pagination': { normalizePagination }, '../../utils/selfApprove': {}, '../../utils/codeGenerator': {}, '../../engine/inventoryEngine': {}, '../../engine/containerEngine': {}, '../../utils/operationRequest': {}, './disposal.receipt': {} })
  const r = await service.getSuggestions({ warehouseId: 8, scopeWarehouseIds: [8] }); assert.equal(r.list[0].unitValue, 5); assert.equal(r.list[0].totalQty, 18); assert.equal(r.list[0].onHandQty, 30); assert.equal(r.list[0].reservedQty, 12); assert.equal(r.list[0].totalValue, 150); assert.equal(r.list[0].valuationBasis, 'avg_cost'); assert.equal(queries.length, 2)
})
test('routes accept only scrap DTO; controller passes exact original request key/operator/scope', async () => {
  const registrations = [], router = { use() {}, get() {}, put: (p, ...h) => registrations.push({ method: 'put', p, h }), post: (p, ...h) => registrations.push({ method: 'post', p, h }) }
  const z = require('../backend/node_modules/zod').z
  load('modules/disposal/disposal.routes.js', { express: { Router: () => router }, zod: { z }, './disposal.handling.contracts': load('modules/disposal/disposal.handling.contracts.js', { zod: { z }, '../../utils/AppError': AppError, './disposal.handling.rules': {} }), './disposal.controller': {}, '../../middleware/auth': { authMiddleware() {}, requirePermission: permission => ({ permission }), requireAnyPermission: any => ({ any }) }, '../../constants/permissions': { PERMISSIONS: require('../backend/src/constants/permissions').PERMISSIONS }, '../../utils/route': { validateBody: schema => ({ schema }) } })
  const schema = registrations.find(r => r.method === 'post' && r.p === '/').h[1].schema
  assert.equal(schema.safeParse({ ...input, warehouseName: 'fixture', items: [{ ...input.items[0], disposeType: 1 }] }).success, false)
  let args
  const controller = load('modules/disposal/disposal.controller.js', { './disposal.handling': {}, './disposal.service': { dispose: async (...value) => { args = value; return original } }, '../../utils/response': { successResponse() {} }, '../../utils/operator': { getOperatorFromRequest: () => operator }, '../../utils/requestKey': require('../backend/src/utils/requestKey') })
  await controller.dispose({ params: { id: '11' }, headers: { 'x-request-key': 'original' }, user: { warehouseIds: [] } }, {}, e => { throw e }); assert.deepEqual(clean(args), [11, operator, [], 'original'])
})

test('write replay verifies actual stored resource/action via current read after locks', async () => {
  const current = fixture({ replay: true, state: 4, oldSnapshotReceipt: true }); assert.deepEqual(clean(await current.service.dispose(11, operator, [8], 'original')), original)
  assert.ok(current.sqls.some(q => q.sql.includes('operation_requests') && /FOR SHARE|FOR UPDATE/.test(q.sql)))
  for (const options of [{ receiptType: 'sale_order' }, { receiptId: 12 }, { receiptAction: 'disposal.dispose.12' }]) await assert.rejects(fixture({ ...options, replay: true, state: 4 }).service.dispose(11, operator, [8], 'original'), e => e.code === 'DISPOSAL_RECEIPT_INVALID')
})
function systemReceipt(receipt, context, warehouses = [8], head = { id: 11, warehouse_id: 8, disposal_no: 'DP11' }) {
  let sent, error, reads = 0
  const pool = { query: async () => { reads++; return head ? [[head]] : [[]] } }
  const deps = { '../../utils/response': { successResponse: (_r, data) => { sent = data } }, '../../utils/operationRequest': { getScopedOperationRequestStatus: async options => { options.receiptContext.matchedAction = context.matchedAction; return receipt } }, '../packages/packages.receipt-guard': { assertPrintLabelReceiptConsistent() {} }, '../../utils/logger': {}, './system.split-device': { ensureSplitReceiptDevice() {} }, '../inventory/inventory.split-receipt': { assertSplitReceipt() {} }, '../sale/sale.commercial-receipts': { assertReceiptScope() {} }, '../../config/db': { pool } }
  if (fs.existsSync(path.join(base, 'modules/disposal/disposal.receipt.js'))) deps['../disposal/disposal.receipt'] = load('modules/disposal/disposal.receipt.js', { '../../utils/AppError': AppError, '../../utils/warehouseScope': scope })
  const controller = load('modules/system/system.controller.js', deps)
  return controller.requestStatus({ params: { key: 'original' }, query: { action: context.requestedAction }, user: { userId: 9, warehouseIds: warehouses } }, {}, e => { error = e }).then(() => ({ sent, error, reads }))
}
const receipt = { status: 'success', resourceType: 'inventory_disposal', resourceId: 11, data: original }
const receiptContext = { requestedAction: 'disposal.dispose.11', matchedAction: 'disposal.dispose.11' }
test('own status matched disposal domain rejects cross resource/wide prefix/missing head/current scope', async () => {
  for (const [value, context, warehouses, head] of [[{ ...receipt, resourceId: 12 }, receiptContext], [{ ...receipt, resourceType: 'sale_order' }, receiptContext], [receipt, { ...receiptContext, requestedAction: 'disposal' }], [receipt, { ...receiptContext, matchedAction: 'disposal.dispose.12' }], [receipt, receiptContext, []], [receipt, receiptContext, [8], null]]) {
    const r = await systemReceipt(value, context, warehouses, head); assert.ok(r.error, 'domain guard must reject instead of sending success'); assert.equal(r.sent, undefined)
  }
  const legal = await systemReceipt(receipt, receiptContext); assert.deepEqual(clean(legal.sent), receipt)
})
test('pending/not_found own query keeps original auth contract and does not read business detail or forge resource', async () => {
  for (const status of ['pending', 'not_found']) { const data = { status, data: null }; const r = await systemReceipt(data, { requestedAction: 'disposal.dispose.11', matchedAction: status === 'pending' ? 'disposal.dispose.11' : undefined }, []); assert.deepEqual(clean(r.sent), data); assert.equal(r.reads, 0) }
})
test('multiple scrap items lock all dimensions ascending before containers and batch ledger once', async () => {
  const f = fixture({ items: [item(3, 9), item(3, 3)] })
  const result = await f.service.dispose(11, operator, [8], 'original'); assert.equal(result.disposedValue, 20)
  const firstStock = f.events.indexOf('stock'); assert.ok(f.events.indexOf('dimension:3') < f.events.indexOf('dimension:9')); assert.ok(f.events.indexOf('dimension:9') < firstStock)
  const ledger = f.sqls.filter(q => q.sql.includes('INSERT INTO disposal_scrapped')); assert.equal(ledger.length, 1); assert.match(ledger[0].sql, /VALUES \?/); assert.equal(ledger[0].params[0].length, 2); assert.equal(ledger[0].params[0][0].length, 13)
})

test('converted old head new dispose refuses before stock, while original successful ACK skips conversion gate', async () => {
  const f=fixture({ converted:true }); await assert.rejects(f.service.dispose(11,operator,[8],'original'),e=>e.code==='DISPOSAL_ALREADY_CONVERTED'); assert.ok(!f.events.includes('stock')); assert.ok(!f.events.includes('commit'));
  const replay=fixture({converted:true,replay:true,state:4}); assert.deepEqual(clean(await replay.service.dispose(11,operator,[8],'original')),original); assert.ok(!replay.events.includes('conversion')); assert.ok(!replay.events.includes('stock'));
})
