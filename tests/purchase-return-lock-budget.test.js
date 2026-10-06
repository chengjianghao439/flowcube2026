// E1 real services with explicit SQL/engine/config boundaries. No database/app/env imports.
// The SQL fixture models a commit while waiting for PO/POI; this is not a MySQL experiment.
const { test, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const AppError = require('../backend/src/utils/AppError')
const base = path.resolve(__dirname, '../backend/src')
const unknown = []
afterEach(() => { assert.deepEqual(unknown.splice(0), []) })
function load(file, deps) {
  const filename = path.join(base, file), module = { exports: {} }
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module, require: name => {
    if (Object.hasOwn(deps, name)) return deps[name]
    unknown.push(`require ${file}: ${name}`); throw Error(`Unstubbed require ${file}: ${name}`)
  } }, { filename })
  return module.exports
}
const transition = load('utils/statusTransition.js', { './AppError': AppError, './sqlIdentifier': require('../backend/src/utils/sqlIdentifier') })
const status = load('constants/documentStatusRules.js', { '../utils/AppError': AppError })
const warehouseStatus = load('constants/warehouseTaskStatus.js', { '../utils/AppError': AppError })
const scope = load('utils/warehouseScope.js', { '../config/db': {}, './AppError': AppError })
const operator = { userId: 9, realName: 'fixture' }
const input = { supplierId: 4, supplierName: 'fixture', warehouseId: 8, warehouseName: 'fixture', purchaseOrderId: 10, purchaseOrderNo: 'PO10', operator, scopeWarehouseIds: [8], items: [{ sourceItemId: 101, productId: 3, productName: 'fixture', quantity: 3, unitPrice: 99, unit: '个' }] }
function fixture({ waitBudget = false, legacy = false, orphan = false, driftPR = false, driftWT = false, pendingCancel = false, tasks, wrongPOWarehouse = false } = {}) {
  const events = [], sqls = [], moves = [], inserts = [], cancelOptions = [], poLockIds = [], headroomInputs = []
  let isolation = 'RR', pendingRC = false, returned = 0
  const po = { id: 10, order_no: 'PO10', supplier_id: 4, supplier_name: 'fixture', warehouse_id: wrongPOWarehouse ? 9 : 8, status: 2 }
  const pr = { id: 11, return_no: 'PR11', purchase_order_id: legacy ? null : 10, purchase_order_no: legacy ? '历史文本' : 'PO10', supplier_id: 4, warehouse_id: 8, status: 2, total_amount: 8 }
  const pri = [{ id: 21, return_id: 11, purchase_item_id: legacy && !orphan ? null : 101, product_id: 3, product_name: 'fixture', quantity: 2, unit_price: 4 }]
  const wt = tasks || [{ id: 31, task_no: 'WT31', task_type: 'purchase_return', return_id: 11, sale_order_id: null, status: 6, warehouse_id: 8 }]
  const conn = {
    beginTransaction: async () => { isolation = pendingRC ? 'RC' : 'RR'; pendingRC = false; events.push(`begin:${isolation}`) },
    commit: async () => events.push('commit'), rollback: async () => events.push('rollback'), release: () => events.push('release'),
    query: async (sql, args = []) => {
      sqls.push(sql)
      if (sql.includes('sale_order_expected_bindings')) return [[]]
      if (sql.startsWith('SET TRANSACTION ISOLATION LEVEL READ COMMITTED')) { pendingRC = true; events.push('nextRC'); return [{}] }
      if (sql.includes('FROM purchase_orders')) {
        if (/FOR UPDATE|FOR SHARE/.test(sql)) { events.push(sql.includes('FOR UPDATE') ? 'PO:X' : 'PO:S'); poLockIds.push(Number(args[0])); if (waitBudget) returned = 8 }
        return [[{ ...po, id: typeof args[0] === 'number' ? args[0] : 10 }]]
      }
      if (sql.includes('FROM purchase_order_items')) {
        if (sql.includes('FOR UPDATE')) { events.push('POI'); if (waitBudget) returned = 8 }
        return [[101, 102].map(id => ({ id, product_id: 3, order_id: 10, unit_price: id === 101 ? 4 : 8, quantity: 10, received_qty: 10, returned_qty: isolation === 'RC' && pr.status !== 4 ? returned : 0 }))]
      }
      if (sql.includes('FROM purchase_returns')) {
        if (sql.includes('SUM(')) return [[{ totalAmount: 8, returnedAmount: 0 }]]
        if (sql.includes('FOR UPDATE')) events.push('PR')
        return [[{ ...pr, purchase_order_id: driftPR && sql.includes('FOR UPDATE') ? 20 : pr.purchase_order_id }]]
      }
      if (sql.includes('FROM purchase_return_items')) {
        if (sql.includes('SUM(')) return [[{ totalAmount: 8 }]]
        return [pri.map(item => ({ ...item, source_item_id: 101, source_order_id: 10, source_product_id: 3 }))]
      }
      if (sql.includes('FROM warehouse_tasks')) {
        if (sql.includes('FOR UPDATE')) events.push('WT')
        if (sql.includes('WHERE id')) return [[{ ...wt.find(t => t.id === Number(args[0])), return_id: driftWT ? 12 : 11 }]]
        return [sql.includes('LIMIT 1') ? [wt.at(-1)] : wt.map(t => ({ ...t }))]
      }
      if (sql.includes('FROM warehouse_task_items')) return [[{ id: 41, task_id: 31, purchase_return_item_id: 21, product_id: 3, product_name: 'fixture', picked_qty: 2, required_qty: 2, unit_price: 4, return_item_id: 21, return_id: 11, return_product_id: 3, return_quantity: 2 }]]
      if (sql.includes('FROM inbound_task_items')) {
        if (sql.includes('receivedTotal')) return [[{ receivedTotal: 2 }]]
        if (sql.includes('AS pending')) return [[{ pending: 0 }]]
        if (sql.includes('AS received')) return [[{ received: 2 }]]
        return [[20, 10].map(id => ({ id, purchase_order_id: id, purchase_item_id: id * 10, product_id: 3, source_item_id: id * 10, source_order_id: id, source_product_id: 3 }))]
      }
      if (sql.includes('FROM inbound_tasks')) return [[{ id: 7, task_no: 'IT7', status: 2, warehouse_id: 8 }]]
      if (sql.includes('FROM sale_purchase_bindings')) return [[{ count: 0 }]]
      if (sql.includes('FROM payment_records')) return [[{ total_amount: 100, paid_amount: 0 }]]
      if (sql.includes('UPDATE purchase_returns')) { pr.status = args[0]; events.push('PR:status'); return [{ affectedRows: 1 }] }
      if (sql.includes('UPDATE inbound_tasks')) { events.push('IT:status'); return [{ affectedRows: 1 }] }
      if (sql.includes('INSERT INTO purchase_returns')) { inserts.push(args); return [{ insertId: 11 }] }
      if (sql.includes('INSERT INTO purchase_return_items')) { inserts.push(args); return [{ insertId: 21 }] }
      if (/INSERT|UPDATE|DELETE/.test(sql)) return [{ affectedRows: 1 }]
      unknown.push(`SQL ${sql}`); throw Error(`Unexpected SQL ${sql}`)
    },
  }
  const commitFulfillment = async actual => { assert.equal(actual, conn); await conn.commit() }
  const request = { beginCreationOperationRequest: async actual => { assert.equal(actual, conn); return { replay: false } }, beginResourceOperationRequest: async actual => { assert.equal(actual, conn); return { replay: false } }, completeOperationRequest: async actual => assert.equal(actual, conn) }
  const locksPath = 'modules/returns/returns.purchase-lock.js'
  const locks = fs.existsSync(path.join(base, locksPath)) ? load(locksPath, { '../../utils/AppError': AppError, '../../utils/warehouseScope': scope, '../../utils/statusTransition': transition }) : {}
  const taskSvc = { createForPurchaseReturn: async data => { assert.equal(data.conn, conn); events.push('createWT'); return { taskId: 31, taskNo: 'WT31' } }, cancel: async (id, opts) => { cancelOptions.push(opts); assert.equal(opts.conn, conn); const task = wt.find(t => t.id === id); if (pendingCancel) task.cancel_requested_at = 'pending'; else task.status = 8 } }
  const returns = load('modules/returns/returns-purchase.service.js', {
    '../refunds/supplier-refunds.pr-gate': { assertNoPendingRefund: async () => ({ received: false }) },
    '../../config/db': { pool: { getConnection: async () => conn } }, '../../utils/AppError': AppError,
    '../../utils/statusTransition': transition, '../../constants/documentStatusRules': status,
    './return-events.service': { RETURN_EVENT: {}, record: async actual => assert.equal(actual, conn) },
    '../../constants/warehouseTaskStatus': warehouseStatus, '../../utils/requestContext': { getRequestId: () => null }, '../../utils/operationRequest': request,
    './returns.helpers': { genNo: async () => 'PR11', assertReturnPaymentHeadroom: async (actual, data) => { assert.equal(actual, conn); headroomInputs.push(data) }, adjustPaymentRecordForReturn: async () => events.push('AP') },
    '../../utils/warehouseScope': scope, '../../utils/unitConversion': { foldEntryItems: async (_conn, items) => items.map(i => ({ ...i, entryQty: i.quantity, conversionRate: 1 })) }, '../../utils/pagination': {},
    './returns.purchase-lock': locks, '../warehouse-tasks/warehouse-tasks.service': taskSvc,
  })
  const ship = load('modules/warehouse-tasks/warehouse-tasks.ship.js', {
    '../disposal/disposal.handling.target-guards': {}, // purchase_return has no SO/link; H3 exercised separately

    '../fulfillment/fulfillment.refresh': { commitFulfillment }, '../../config/db': { pool: { getConnection: async () => conn } }, '../../utils/AppError': AppError,
    '../../engine/inventoryEngine': { MOVE_TYPE: {}, moveStock: async (actual, item) => { assert.equal(actual, conn); events.push('inventory'); moves.push(item) } },
    '../../engine/containerEngine': { unlockContainersByTask: async () => {} }, '../../utils/statusTransition': transition, '../../utils/creditExposure': {}, '../../constants/warehouseTaskStatus': warehouseStatus,
    './warehouse-task-events.service': { WT_EVENT: {}, record: async () => {} }, '../../utils/operationRequest': request, '../sale/sale.contracts': {},
    './warehouse-tasks.helpers': { assertTaskScope: row => scope.assertInScope([8], row.warehouse_id), assertTaskPickScanClosure: async () => {}, logSideEffectFailure: () => {} }, './warehouse-tasks.query': {},
    '../returns/returns.purchase-lock': locks, '../returns/returns-purchase.service': returns,
  })
  const sources = load('modules/inbound-tasks/inbound-purchase-source.js', { '../../utils/AppError': AppError, '../../utils/warehouseScope': scope })
  const inbound = load('modules/inbound-tasks/inbound-tasks.command.js', {
    '../fulfillment/fulfillment.refresh': { commitFulfillment }, '../../config/db': { pool: { getConnection: async () => conn } }, '../../utils/qtyPrecision': {}, '../../utils/AppError': AppError,
    '../../engine/containerEngine': {}, '../print-jobs/print-jobs.service': {}, './inbound-tasks.helpers': { ...sources, appendInboundEvent: async () => {} }, '../../config/env': {},
    '../../utils/warehouseScope': scope, './inbound-tasks.status': {}, './inbound-tasks.putaway': { tryFinishTask: async () => events.push('finish') }, './inbound-tasks.query': {},
    '../../utils/statusTransition': transition, '../../constants/documentStatusRules': status, '../../utils/operationRequest': request,
  })
  const purchase = load('modules/purchase/purchase.service.js', {
    '../fulfillment/fulfillment.refresh': { commitFulfillment }, '../../config/db': { pool: { getConnection: async () => conn } }, '../../utils/AppError': AppError,
    '../../utils/codeGenerator': {}, '../inbound-tasks/inbound-tasks.helpers': {}, '../inbound-tasks/inbound-tasks.query': {}, '../../utils/inboundThresholds': {},
    '../../utils/statusTransition': transition, '../../constants/documentStatusRules': status, '../../utils/operationRequest': request,
    '../inbound-tasks/inbound-tasks.settle': { recomputePurchasePayable: async (actual, _id, opts) => { assert.equal(actual, conn); events.push(`settle:${opts?.sourceReadMode}`) } },
    '../../utils/unitConversion': {}, '../../utils/warehouseScope': scope, '../../utils/selfApprove': {}, '../../utils/pagination': {}, '../../utils/priceReference': {},
  })
  return { returns, ship, inbound, purchase, conn, events, sqls, moves, inserts, cancelOptions, pr, pri, po, poLockIds, headroomInputs }
}
test('create waits accurate PO then reads committed return budget using next-transaction RC, never SESSION', async () => {
  const f = fixture({ waitBudget: true })
  await assert.rejects(f.returns.createPR(input), e => e.statusCode === 409)
  assert.ok(f.events.indexOf('nextRC') < f.events.indexOf('begin:RC'))
  assert.ok(f.events.indexOf('PO:X') < f.events.indexOf('POI'))
  assert.equal(f.inserts.length, 0); assert.ok(!f.sqls.some(s => /SESSION|GLOBAL/.test(s)))
})
test('historical exact PO ID with missing optional order number keeps valid original confirmation', async () => {
  for (const orderNo of [null, '']) {
    const f = fixture()
    f.pr.status = 1
    f.pr.purchase_order_no = orderNo
    await f.returns.confirmPR(11, operator, [8])
    assert.ok(f.events.indexOf('PO:S') < f.events.indexOf('PR'))
    assert.ok(f.events.includes('createWT')); assert.ok(f.events.includes('commit'))
  }
  const mismatch = fixture()
  mismatch.pr.status = 1
  mismatch.pr.purchase_order_no = 'OTHER'
  await assert.rejects(mismatch.returns.confirmPR(11, operator, [8]), e => e.code === 'PURCHASE_RETURN_SOURCE_INVALID')
  assert.ok(!mismatch.events.includes('createWT'))
})
test('same SKU different source lines retain exact original prices and folded base quantities', async () => {
  const f = fixture()
  await f.returns.createPR({ ...input, items: [101, 102].map(sourceItemId => ({ ...input.items[0], sourceItemId, quantity: 1 })) })
  assert.equal(f.inserts[0][7], 12)
  assert.deepEqual(f.inserts.slice(1).map(args => args[13]), [4, 8])
  assert.ok(f.events.includes('PO:X'))
  await f.conn.beginTransaction(); assert.equal(f.events.at(-1), 'begin:RR')
})
test('confirm rejects PR source drift after PO wait before task or status writes', async () => {
  const f = fixture({ driftPR: true }); f.pr.status = 1
  await assert.rejects(f.returns.confirmPR(11, operator, [8]), e => e.code === 'PURCHASE_RETURN_SOURCE_CHANGED')
  assert.ok(!f.events.includes('createWT')); assert.ok(!f.events.includes('PR:status'))
})
test('legacy text-only original reference remains, but linked item without accurate PO fails closed', async () => {
  const old = fixture({ legacy: true }); old.pr.status = 1
  await old.returns.confirmPR(11, operator, [8]); assert.ok(old.events.includes('createWT')); assert.ok(!old.events.includes('PO:S'))
  const dirty = fixture({ legacy: true, orphan: true }); dirty.pr.status = 1
  await assert.rejects(dirty.returns.confirmPR(11, operator, [8]), e => e.code === 'PURCHASE_RETURN_SOURCE_INVALID')
})
test('source PO scope and supplier/POI identity remain enforced after locks', async () => {
  const f = fixture({ wrongPOWarehouse: true }); f.pr.status = 1
  await assert.rejects(f.returns.confirmPR(11, operator, [8]), e => e.statusCode === 403 || e.code === 'PURCHASE_RETURN_SOURCE_INVALID')
  const dirty = fixture(); dirty.pr.status = 1; dirty.pri[0].product_id = 4
  await assert.rejects(dirty.returns.confirmPR(11, operator, [8]), e => e.code === 'PURCHASE_RETURN_SOURCE_INVALID')
})
test('cancel checks ALL current WT including older shipped anomaly before PR cancellation', async () => {
  const f = fixture({ tasks: [{ id: 30, return_id: 11, task_type: 'purchase_return', status: 7, warehouse_id: 8 }, { id: 31, return_id: 11, task_type: 'purchase_return', status: 2, warehouse_id: 8 }] })
  await assert.rejects(f.returns.cancelPR(11, operator, [8]), e => e.code === 'PURCHASE_RETURN_TASK_INVALID')
  assert.ok(!f.events.includes('PR:status')); assert.equal(f.cancelOptions.length, 0)
})
test('pending physical return keeps confirmed PR budget; same connection/scope/operator reach original WT cancel', async () => {
  const f = fixture({ pendingCancel: true })
  const result = await f.returns.cancelPR(11, operator, [8])
  assert.equal(result?.pendingCancel, true); assert.ok(!f.events.includes('PR:status'))
  assert.equal(f.cancelOptions[0].operator, operator); assert.deepEqual(f.cancelOptions[0].scopeWarehouseIds, [8])
  assert.equal(f.cancelOptions[0].purchaseReturnId, 11)
  assert.deepEqual(f.events.filter(e => ['PO:S', 'PR', 'WT'].includes(e)).slice(0, 3), ['PO:S', 'PR', 'WT'])
})
test('ship uses original PO S -> PR -> WT and authoritative current WTI/PRI instead of controller amount', async () => {
  const f = fixture()
  await f.ship.ship(31, operator, { saleOrderId: null, warehouseId: 9, totalAmount: 999, items: [{ productId: 3, quantity: 9, unitPrice: 999 }] }, { scopeWarehouseIds: [8] })
  assert.deepEqual(f.events.filter(e => ['PO:S', 'PR', 'WT', 'inventory'].includes(e)).slice(0, 4), ['PO:S', 'PR', 'WT', 'inventory'])
  assert.equal(f.moves[0].warehouseId, 8); assert.equal(f.moves[0].quantity ?? f.moves[0].qty, 2); assert.equal(f.moves[0].unitPrice, 4)
  const begin = f.sqls.findIndex(sql => sql.includes('FOR UPDATE') && sql.includes('warehouse_tasks'))
  assert.ok(f.sqls.slice(0, begin).filter(sql => !sql.includes('warehouse_tasks')).every(sql => /FOR SHARE|FOR UPDATE/.test(sql) || sql.includes('purchase_returns') && !sql.includes('FOR UPDATE')))
})
test('ship WT/PR drift is rejected before stock movement', async () => {
  const f = fixture({ driftWT: true })
  await assert.rejects(f.ship.ship(31, operator, { saleOrderId: null, warehouseId: 8, totalAmount: 8, items: [{ productId: 3, quantity: 2, unitPrice: 4 }] }, { scopeWarehouseIds: [8] }), e => e.code === 'PURCHASE_RETURN_SOURCE_CHANGED')
  assert.equal(f.moves.length, 0)
})
test('closeReceiving locks accurate source POs sorted after IT and before status/settlement', async () => {
  const f = fixture()
  await f.inbound.closeReceiving(7, operator, [8])
  const locks = f.events.filter(e => e === 'PO:X')
  assert.equal(locks.length, 2)
  assert.deepEqual(f.poLockIds, [10, 20])
  assert.ok(f.events.lastIndexOf('PO:X') < f.events.indexOf('IT:status'))
})
test('closeRemaining only selects RC for next transaction and passes narrow current source mode', async () => {
  const f = fixture()
  await f.purchase.closeRemaining(10, operator, [8])
  assert.equal(f.events[0], 'nextRC'); assert.ok(f.events.includes('settle:current'))
  await f.conn.beginTransaction(); assert.equal(f.events.at(-1), 'begin:RR')
})
test('audit savepoint adapter preserves closeRemaining domain refusal, retry and outer fixture rollback under RC', async () => {
  const { createAuditInventoryTransaction } = require('./helpers/auditInventoryTransaction')
  const queries = [], state = { value: 1, binding: true }, savepoints = new Map()
  let outer = false, pendingIsolation = 'REPEATABLE READ', isolation
  const raw = {
    async beginTransaction() { outer = true; isolation = pendingIsolation; pendingIsolation = 'REPEATABLE READ'; queries.push('BEGIN') },
    async rollback() { outer = false; state.value = 0; queries.push('ROLLBACK') },
    async query(sql) {
      queries.push(sql)
      if (sql.startsWith('SET TRANSACTION')) {
        if (outer) throw Object.assign(Error('Transaction characteristics cannot be changed while a transaction is in progress'), { code: 'ER_CANT_CHANGE_TX_CHARACTERISTICS' })
        pendingIsolation = sql.endsWith('READ COMMITTED') ? 'READ COMMITTED' : 'REPEATABLE READ'; return [{}]
      }
      if (sql === 'SAVEPOINT service_transaction') { assert.ok(outer); savepoints.set('service_transaction', state.value); return [{}] }
      if (sql === 'RELEASE SAVEPOINT service_transaction' || sql === 'ROLLBACK TO SAVEPOINT service_transaction') {
        if (!savepoints.has('service_transaction')) throw Object.assign(Error('SAVEPOINT service_transaction does not exist'), { code: 'ER_SP_DOES_NOT_EXIST' })
        if (sql.startsWith('ROLLBACK')) state.value = savepoints.get('service_transaction')
        else savepoints.delete('service_transaction')
        return [{}]
      }
      if (sql.includes('FROM purchase_orders')) return [[{ id: 10, order_no: 'PO10', status: 2, warehouse_id: 8 }]]
      if (sql.includes('sale_order_expected_bindings')) return [state.binding ? [{ sale_order_id: 11, order_no: 'SO11', bound_qty: 2 }] : []]
      if (sql.includes('AS pending')) return [[{ pending: 0 }]]
      if (sql.includes('AS received')) return [[{ received: 5 }]]
      if (sql.includes('UPDATE purchase_orders')) { state.value = 3; return [{ affectedRows: 1 }] }
      unknown.push(`audit SQL ${sql}`); throw Error(`Unexpected audit SQL ${sql}`)
    },
  }
  const adapter = createAuditInventoryTransaction(raw), conn = adapter.serviceConn
  const purchase = load('modules/purchase/purchase.service.js', {
    '../fulfillment/fulfillment.refresh': { commitFulfillment: actual => actual.commit() }, '../../config/db': { pool: { getConnection: async () => conn } }, '../../utils/AppError': AppError,
    '../../utils/codeGenerator': {}, '../inbound-tasks/inbound-tasks.helpers': {}, '../inbound-tasks/inbound-tasks.query': {}, '../../utils/inboundThresholds': {},
    '../../utils/statusTransition': transition, '../../constants/documentStatusRules': status, '../../utils/operationRequest': {},
    '../inbound-tasks/inbound-tasks.settle': { recomputePurchasePayable: async (actual, _id, opts) => { assert.equal(actual, conn); assert.equal(opts.sourceReadMode, 'current'); assert.equal(isolation, 'READ COMMITTED') } },
    '../../utils/unitConversion': {}, '../../utils/warehouseScope': scope, '../../utils/selfApprove': {}, '../../utils/pagination': {}, '../../utils/priceReference': {},
  })
  await adapter.beginFixture('READ COMMITTED')
  await assert.rejects(purchase.closeRemaining(10, operator, [8]), error => error.code === 'BINDING_SALE_DEPENDENCY')
  assert.equal(state.value, 1); assert.ok(outer, 'service refusal must retain outer fixture transaction')
  state.binding = false
  await purchase.closeRemaining(10, operator, [8])
  assert.equal(state.value, 3); assert.ok(outer, 'service commit must not commit the fixture')
  assert.deepEqual(queries.slice(0, 2), ['SET TRANSACTION ISOLATION LEVEL READ COMMITTED', 'BEGIN'])
  assert.equal(queries.filter(sql => sql.startsWith('SET TRANSACTION')).length, 1, 'only select isolation before outer BEGIN')
  assert.ok(queries.includes('ROLLBACK TO SAVEPOINT service_transaction'))
  assert.equal(savepoints.size, 0)
  await raw.rollback(); assert.equal(state.value, 0)
  await adapter.beginFixture(); assert.equal(isolation, 'REPEATABLE READ', 'other inventory/concurrency fixtures retain RR')
  const before = queries.length
  await assert.rejects(purchase.closeRemaining(10, operator, [8]), /RC service requires an explicitly RC outer fixture/)
  assert.equal(queries.length, before, 'pre-BEGIN errors must neither access a missing savepoint nor roll back the fixture')
})
test('completed cancellation releases budget; physical pending cancellation does not', async () => {
  const completed = fixture({ waitBudget: true })
  assert.equal((await completed.returns.cancelPR(11, operator, [8])).pendingCancel, false)
  await completed.returns.createPR(input); assert.ok(completed.inserts.length > 0)
  const pending = fixture({ waitBudget: true, pendingCancel: true })
  await pending.returns.cancelPR(11, operator, [8])
  await assert.rejects(pending.returns.createPR(input), e => e.statusCode === 409)
  assert.equal(pending.inserts.length, 0)
})
test('new create resolves order number on same connection and persists actual order number; no source guessing', async () => {
  const f = fixture()
  await f.returns.createPR({ ...input, purchaseOrderId: null, items: [{ ...input.items[0], quantity: 1 }] })
  assert.ok(f.events.includes('PO:X')); assert.equal(f.inserts[0][5], 10); assert.equal(f.inserts[0][6], 'PO10')
  await assert.rejects(f.returns.createPR({ ...input, purchaseOrderNo: 'wrong' }), e => e.code === 'PURCHASE_RETURN_SOURCE_INVALID')
})
test('closeReceiving rejects canceled or outside-scope original PO before IT status/settle', async () => {
  for (const f of [fixture(), fixture({ wrongPOWarehouse: true })]) {
    if (f.po.warehouse_id === 8) f.po.status = 4
    await assert.rejects(f.inbound.closeReceiving(7, operator, [8]), e => e.statusCode === 409 || e.statusCode === 403)
    assert.ok(!f.events.includes('IT:status')); assert.ok(!f.events.includes('finish'))
  }
})
test('real settle opt-in keeps source assertions/upsert but avoids reverse IT/PR locks; default still locks sources', async () => {
  for (const sourceReadMode of ['current', 'locked']) {
    const sqls = [], args = [], order = []
    const conn = { query: async (sql, params) => {
      sqls.push(sql)
      if (sql.includes('FROM purchase_orders')) return [[{ id: 10, order_no: 'PO10', supplier_name: 'fixture', settlement_type: 2, payment_terms_days: 30, created_at: '2026-10-04' }]]
      if (sql.includes('AS amount')) { order.push('gross'); return [[{ amount: 100 }]] }
      if (sql.includes('AS returnedAmount')) { order.push('returned'); return [[{ returnedAmount: 8 }]] }
      if (sql.includes('INSERT INTO payment_records')) { args.push(params); return [{ affectedRows: 1 }] }
      unknown.push(`SQL ${sql}`); throw Error(`Unexpected SQL ${sql}`)
    } }
    const settle = load('modules/inbound-tasks/inbound-tasks.settle.js', {
      '../../constants/documentStatusRules': status, '../../constants/settlementType': { normalizeSettlementType: value => value, buildDueDateSql: () => ({ expr: 'NOW()', params: [] }) },
      '../../utils/statusTransition': transition, './inbound-purchase-source': { assertPurchaseSettlementSources: async (actual, id) => { assert.equal(actual, conn); assert.equal(id, 10); order.push('source') } },
    })
    await settle.recomputePurchasePayable(conn, 10, sourceReadMode === 'current' ? { sourceReadMode } : undefined)
    assert.deepEqual(order, ['source', 'gross', 'returned']); assert.equal(args[0][3], 92)
    assert.equal(sqls.filter(sql => sql.includes('FOR UPDATE')).length, sourceReadMode === 'current' ? 0 : 2)
    assert.ok(sqls.at(-1).includes('confirm_status')); assert.ok(sqls.at(-1).includes('settlement_type'))
  }
})
test('pending cancel controller returns 202 and truthful data, while completed cancel keeps original null/200', async () => {
  let data = { pendingCancel: true, tasks: [{ id: 31 }] }
  const controller = load('modules/returns/returns.controller.js', {
    './returns-purchase.service': { cancelPR: async () => data }, './returns-sale.service': {},
    '../../utils/response': { successResponse: (_res, data, message, status = 200) => ({ data, message, status }) }, '../../utils/requestKey': {}, '../../utils/operator': { getOperatorFromRequest: () => operator },
  })
  const response = await controller.cancelPR({ params: { id: 11 }, user: { warehouseIds: [8] } }, {}, e => { throw e })
  assert.equal(response.status, 202); assert.equal(response.data.pendingCancel, true); assert.ok(!response.message.includes('已取消'))
  data = { pendingCancel: false, tasks: [] }
  const completed = await controller.cancelPR({ params: { id: 11 }, user: { warehouseIds: [8] } }, {}, e => { throw e })
  assert.equal(completed.status, 200); assert.equal(completed.data, null); assert.equal(completed.message, '已取消')
})
test('default source assertion remains a pure module and keeps original canceled PO rejection', async () => {
  const sources = load('modules/inbound-tasks/inbound-purchase-source.js', { '../../utils/AppError': AppError })
  assert.deepEqual(Array.from(sources.validateSourceItems([{ purchase_order_id: 10, purchase_item_id: 101, product_id: 3, source_item_id: 101, source_order_id: 10, source_product_id: 3 }])), [10])
  await assert.rejects(sources.assertPurchaseOrderOpen({ query: async () => [[{ id: 10, order_no: 'PO10', status: 4 }]] }, 10), /已取消/)
})

test('actual confirmPR passes exact locked PR identity to headroom only with linked PO, legacy text does not opt in', async () => {
 const f = fixture(); f.pr.status = 1
 await f.returns.confirmPR(11, operator, [8])
 assert.equal(f.headroomInputs.length,1)
 assert.equal(f.headroomInputs[0].purchaseReturnId,11); assert.equal(f.headroomInputs[0].orderId,10)
 const old = fixture({legacy:true}); old.pr.status=1
 await old.returns.confirmPR(11,operator,[8]); assert.equal(old.headroomInputs.length,0)
})
