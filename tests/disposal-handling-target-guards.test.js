// H3: real original wrappers + statusTransition/domain. No DB/env/app imports.
// SQL fixtures project only declared columns; unknown requires/SQL are setup errors.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const base = path.resolve(__dirname, '../backend/src')
const AppError = require('../backend/src/utils/AppError')
const saleEditBaseline = require('../backend/src/modules/sale/sale.edit-baseline')
const sqlIdentifier = require('../backend/src/utils/sqlIdentifier')
const { z } = require('../backend/node_modules/zod')
function load(file, deps) {
  const module = { exports: {} }, filename = path.join(base, file)
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module, require: name => {
    if (!Object.hasOwn(deps, name)) throw Error(`Unstubbed require ${file}: ${name}`)
    return deps[name]?.lazy ? deps[name]() : deps[name]
  } }, { filename })
  return module.exports
}
const lazy = fn => Object.assign(fn, { lazy: true })
const qty = load('utils/qtyPrecision.js', { './AppError': AppError })
const scope = load('utils/warehouseScope.js', { '../config/db': {}, './AppError': AppError })
const units = load('utils/unitConversion.js', { './AppError': AppError, './qtyPrecision': qty })
const transition = load('utils/statusTransition.js', { './AppError': AppError, './sqlIdentifier': sqlIdentifier })
const docRules = load('constants/documentStatusRules.js', { '../utils/AppError': AppError })
const wtRules = load('constants/warehouseTaskStatus.js', { '../utils/AppError': AppError })
const rules = load('modules/disposal/disposal.handling.rules.js', { 'node:crypto': require('node:crypto'), '../../utils/AppError': AppError, '../../utils/qtyPrecision': qty })
const guards = lazy(() => load('modules/disposal/disposal.handling.target-guards.js', { '../../utils/AppError': AppError, '../../utils/warehouseScope': scope, '../../utils/qtyPrecision': qty, './disposal.handling.rules': rules }))
const handlingContracts = lazy(() => load('modules/disposal/disposal.handling.contracts.js', { zod: { z }, '../../utils/AppError': AppError, './disposal.handling.rules': rules }))
const saleContracts = load('modules/sale/sale.contracts.js', { zod: { z }, '../../utils/AppError': AppError, '../../utils/qtyPrecision': qty, '../disposal/disposal.handling.contracts': handlingContracts })
const actor = { userId: 9, realName: 'offline' }
function project(sql, row) {
  const columns = sql.match(/^SELECT (.*?) FROM /)?.[1]
  assert.ok(columns, `Projection: ${sql}`)
  if (columns === '*') return structuredClone(row)
  return Object.fromEntries(columns.split(',').map(col => {
    const name = col.trim().replace(/^[a-z]+\./, '')
    assert.match(name, /^[a-z_]+$/i, `Not a plain projection: ${name}`)
    return [name, row[name]]
  }))
}
function fixture(options = {}) {
  const sqls = [], calls = [], moves = [], events = [], tasksCreated = []
  let state = {
    head: { id: 81, order_no: 'S81', customer_id: 4, customer_name: '客4', warehouse_id: 8, warehouse_name: '仓8', status: options.status || 1, commercial_model: null, commercial_revision: null, total_amount: 20, discount_amount: 0, disposal_handling_link_id: options.unlinked ? null : 31, task_id: options.taskId || null, task_no: 'WT21', deleted_at: null },
    item: { id: 501, order_id: 81, product_id: 3, product_code: 'P3', product_name: '商品3', warehouse_id: 8, warehouse_name: '仓8', unit: '个', quantity: 10, reserved_qty: options.reserved || 0, dispatched_qty: options.dispatched || 0, shipped_qty: options.shipped || 0, unit_price: 2, amount: 20 },
    link: { id: 31, source_id: 7, target_type: options.scrap ? 'inventory_disposal' : 'sale_order', target_id: 81, target_line_id: 501, product_id: 3, warehouse_id: 8, unit: '个', allocated_quantity: 10, released_quantity: 0, final_executed_quantity: null, state: 'ACTIVE' },
    task: { id: 21, task_no: 'WT21', task_type: 'sale_out', sale_order_id: 81, return_id: null, warehouse_id: 8, status: 6, cancel_requested_at: null, adjustment_requested_at: null, deleted_at: null },
    taskItem: { id: 601, task_id: 21, product_id: 3, product_name: '商品3', unit: '个', required_qty: 2, picked_qty: 2 },
    extraItems: options.hiddenExtra ? [{ id: 502, order_id: 81, product_id: 4, product_name: '额外商品', warehouse_id: 8, unit: '个', quantity: 1, reserved_qty: options.hiddenExtra === 'unreserved' ? 0 : 1, dispatched_qty: options.hiddenExtra === 'unreserved' ? 0 : 1 }] : [],
    durableEvents: [], genericDone: false,
  }
  let backup
  const conn = {
    beginTransaction: async () => { calls.push('begin'); backup = structuredClone(state); if (options.onBegin) options.onBegin(state) },
    commit: async () => { calls.push('commit'); backup = null },
    rollback: async () => { calls.push('rollback'); if (backup) state = backup; backup = null },
    release: () => calls.push('release'),
    query: async (raw, args = []) => {
      const sql = raw.replace(/\s+/g, ' ').trim(); sqls.push(sql)
      if (sql.includes('disposal_handling_sources')) throw Error('H3 must not query/lock source')
      if (sql === 'SELECT * FROM disposal_handling_links WHERE id=? FOR SHARE') { assert.deepEqual(Array.from(args), [31]); calls.push('link'); return [state.link ? [project(sql, state.link)] : []] }
      if (/^SELECT .* FROM sale_orders WHERE id\s*=\s*\?.*(FOR UPDATE)?$/.test(sql) || /^SELECT .* FROM inventory_disposal_orders WHERE id\s*=\s*\?/.test(sql)) {
        assert.ok([80, 81].includes(Number(args[0]))); if (sql.endsWith('FOR UPDATE')) calls.push('head-X'); return [[project(sql, Number(args[0]) === 81 ? state.head : { ...state.head, id: 80, disposal_handling_link_id: null })]]
      }
      if (sql.includes('FROM sale_orders so')) { assert.equal(Number(args[0]), 81); if (sql.includes('AS orderTotal')) return [[{ orderTotal: state.head.total_amount, discount: 0 }]]; if (sql.includes('LEFT JOIN sale_customers')) return [[{ order_no: 'S81', customer_name: '客4', created_at: '2026-10-05', settlement_type: 2, terms: 30 }]] }
      if (/^SELECT .* FROM warehouse_tasks WHERE id\s*=\s*\?/.test(sql)) { assert.equal(Number(args[0]), 21); if (sql.endsWith('FOR UPDATE')) calls.push('task-X'); return [[project(sql, state.task)]] }
      if (sql.startsWith('SELECT wt.id FROM warehouse_tasks wt WHERE wt.sale_order_id=? AND (')) {
        assert.equal(Number(args[0]), 81); assert.ok(sql.includes('c.locked_by_task_id=wt.id')); assert.ok(sql.includes('p.warehouse_task_id=wt.id AND p.status=2'));
        assert.ok(!/FOR SHARE|FOR UPDATE|deleted_at/.test(sql));
        return [options.pendingReturn || options.unclosed || options.lockedContainer || options.returnedBox ? [{ id: 21 }] : []]
      }
      if (/^SELECT .* FROM warehouse_tasks WHERE sale_order_id\s*=\s*\?/.test(sql)) {
        assert.equal(Number(args[0]), 81)
        if (sql.includes('cancel_requested_at')) return [options.pendingReturn ? [{ id: 21 }] : []]
        if (sql.includes('ORDER BY id FOR UPDATE')) return [[{ id: 21 }]]
        return [[{ id: 21, status: options.shippedTask ? 7 : 8, warehouse_id: 8 }]]
      }
      if (/^SELECT .* FROM warehouse_task_items WHERE task_id\s*=\s*\?/.test(sql)) { assert.equal(Number(args[0]), 21); return [state.taskItem ? (options.duplicateTaskItem ? [state.taskItem, { ...state.taskItem, id: 602 }] : [state.taskItem]).map(row => project(sql, row)) : []] }
      if (sql.startsWith('SELECT ') && sql.includes('FROM sale_order_items')) {
        assert.equal(Number(args[0]), 81)
        if (sql.includes('AS whCount')) return [[{ whCount: 1, shippedAny: 0 }]]
        if (sql.includes('AS incomplete')) return [[{ incomplete: 0 }]]
        if (sql.includes('AS unfilled')) return [[{ unfilled: state.item && state.item.reserved_qty < state.item.quantity ? 1 : 0 }]]
        if (sql.includes('AS remaining')) return [[{ remaining: sql.includes('COUNT') ? 0 : state.item?.reserved_qty || 0 }]]
        if (sql.includes('AS total')) return [[{ total: state.item?.amount || 0 }]]
        if (sql.includes('AS amount')) return [[{ amount: (state.item?.shipped_qty || 0) * (state.item?.unit_price || 0) }]]
        let rows = [...(state.item ? (options.duplicateItem ? [state.item, { ...state.item, id: 502 }] : [state.item]) : []), ...state.extraItems]
        if (sql.includes('dispatched_qty < reserved_qty')) rows = rows.filter(row => Number(row.dispatched_qty) < Number(row.reserved_qty))
        return [rows.map(row => project(sql, row))]
      }
      if (sql.includes('FROM inventory_disposal_items')) { assert.equal(Number(args[0]), 81); return [[{ id: 501, dispose_type: 3, product_id: 3, unit: '个', quantity: 10 }]] }
      if (sql.includes('FROM sale_customers')) { assert.equal(Number(args[0]), 4); if (sql.endsWith('FOR UPDATE')) calls.push('customer-X'); return [[{ id: 4, name: '客4', is_active: 1, credit_limit: null }]] }
      if (sql.includes('FROM inventory_warehouses')) return [Array.from(args[0]).map(id => ({ id, name: `仓${id}`, is_active: 1 }))]
      if (sql.includes('FROM product_items')) return [[{ id: 3, name: '商品3', code: 'P3', unit: '个', unit_value: 2, cost_price: 0, is_active: 1, allow_decimal_qty: 1 }]]
      if (sql.includes('FROM product_units')) return [[]]
      if (sql.includes('FROM sale_returns sr')) return [[{ returnedAmount: 0 }]]
      if (sql.startsWith('INSERT INTO payment_records')) { calls.push('AR'); return [{}] }
      if (sql.startsWith('INSERT INTO sale_order_events')) { state.durableEvents.push({ kind: args[1] }); return [{}] }
      if (sql === 'DELETE FROM sale_order_items WHERE order_id=?') { assert.equal(Number(args[0]), 81); calls.push('rebuild'); state.item = null; return [{}] }
      if (sql.startsWith('INSERT INTO sale_order_items')) { calls.push('rebuild'); state.item = { id: 502, order_id: 81, product_id: 3, warehouse_id: 8, unit: '个', quantity: 10, unit_price: 2, amount: 20, reserved_qty: 0 }; return [{}] }
      if (sql.startsWith('DELETE FROM inventory_disposal_items')) { calls.push('rebuild'); return [{}] }
      if (sql.startsWith('INSERT INTO inventory_disposal_items')) { calls.push('rebuild'); return [{}] }
      if (sql.startsWith('UPDATE inventory_disposal_orders SET remark')) return [{ affectedRows: 1 }]
      if (/^UPDATE (sale_orders|warehouse_tasks) SET status = \?/.test(sql)) { const head = sql.startsWith('UPDATE sale_orders') ? state.head : state.task; const fromCount = (sql.match(/IN \((.*?)\)/)?.[1].match(/\?/g) || []).length; const idPos = args.length - fromCount - 1; assert.equal(Number(args[idPos]), head.id); if (!Array.from(args.slice(idPos + 1)).map(Number).includes(Number(head.status))) return [{ affectedRows: 0 }]; head.status = Number(args[0]); return [{ affectedRows: 1 }] }
      if (sql === 'UPDATE sale_orders SET deleted_at=NOW() WHERE id=? AND deleted_at IS NULL') { assert.equal(Number(args[0]), 81); state.head.deleted_at = 'offline'; return [{ affectedRows: 1 }] }
      if (sql.startsWith('UPDATE sale_order_items SET warehouse_id')) { assert.equal(Number(args[3]), 81); assert.equal(Number(args[2]), 501); state.item.warehouse_id = args[0]; return [{ affectedRows: 1 }] }
      if (sql.startsWith('UPDATE sale_order_items SET reserved_qty = reserved_qty +')) { state.item.reserved_qty += Number(args[0]); return [{ affectedRows: 1 }] }
      if (sql.startsWith('UPDATE sale_order_items SET reserved_qty = reserved_qty -')) { state.item.reserved_qty -= Number(args[0]); return [{ affectedRows: 1 }] }
      if (sql.startsWith('UPDATE sale_order_items SET quantity =')) { assert.equal(Number(args[4]), 501); state.item.quantity = Number(args[0]); state.item.amount = Number(args[1]); return [{ affectedRows: 1 }] }
      if (sql.startsWith('UPDATE sale_orders SET total_amount =')) { state.head.total_amount = Number(args[0]); return [{ affectedRows: 1 }] }
      if (sql.startsWith('UPDATE sale_order_items SET reserved_qty = 0')) { state.item.reserved_qty = 0; return [{ affectedRows: 1 }] }
      if (sql.startsWith('UPDATE sale_order_items soi JOIN product_items')) return [{ affectedRows: 1 }]
      if (sql.startsWith('UPDATE sale_order_items SET dispatched_qty = dispatched_qty +')) { state.item.dispatched_qty += Number(args[0]); return [{ affectedRows: 1 }] }
      if (sql.startsWith('UPDATE sale_order_items soi SET reserved_qty =')) return [{ affectedRows: 1 }]
      if (sql.startsWith('UPDATE sale_orders SET customer_id=') || sql.startsWith('UPDATE sale_orders SET total_amount=?')) return [{ affectedRows: 1 }]
      throw Error(`Unstubbed SQL: ${sql}`)
    },
  }
  const operation = { beginOperationRequest: async c => { assert.equal(c, conn); calls.push('request'); return options.replay ? { replay: true, responseData: { taskId: 21, status: 7, original: true } } : { enabled: true, id: 1 } }, completeOperationRequest: async c => { assert.equal(c, conn); if (options.receiptFail) throw new AppError('receipt failed', 409, 'FIXTURE_RECEIPT_FAIL'); state.genericDone = true } }
  operation.beginCreationOperationRequest = operation.beginOperationRequest; operation.beginResourceOperationRequest = operation.beginOperationRequest
  const common = { '../../config/db': { pool: { getConnection: async () => conn, query: (...args) => conn.query(...args) } }, '../../utils/AppError': AppError, '../../utils/warehouseScope': scope, '../../utils/qtyPrecision': qty, '../../utils/statusTransition': transition, '../../constants/documentStatusRules': docRules, '../../constants/warehouseTaskStatus': wtRules, '../../utils/unitConversion': units, '../../utils/operationRequest': operation, '../../utils/pagination': {}, '../../utils/codeGenerator': {}, '../disposal/disposal.handling.target-guards': guards, './disposal.handling.target-guards': guards }
  const fulfillment = { captureDimensions: async () => { calls.push('dimensions'); return [] }, commitFulfillment: async c => { assert.equal(c, conn); calls.push('fulfillment'); await c.commit() } }
  const taskSvc = { createForSaleOrder: async data => { assert.equal(data.conn, conn); tasksCreated.push(data); return { taskId: 21, taskNo: 'WT21' } }, cancel: async (_id, data) => { assert.equal(data.conn, conn) } }
  const saleDeps = { ...common, './sale.commercial-dispatch': {}, './sale.edit-baseline': saleEditBaseline, './sale.commercial-store': { assertModel() {}, assertRequestKey() {}, assertRevision() {} }, './sale.commercial-resolver': {}, './sale.commercial-money': {}, '../fulfillment/fulfillment.refresh': fulfillment, '../logistics/shipping-products': {}, '../fulfillment/fulfillment.sale-items': { snapshotItemCommitments: async () => [], restoreItemCommitments: async () => {} }, './sale.presentation': {}, './sale.items': load('modules/sale/sale.items.js', {}), '../../engine/reservationEngine': { reserve: async (c, data) => { assert.equal(c, conn); calls.push('reserve'); assert.equal(data.warehouseId, state.item.warehouse_id) }, releaseByRef: async c => { assert.equal(c, conn); calls.push('release-stock') }, partialReleaseByProduct: async c => { assert.equal(c, conn); calls.push('release-stock') } }, '../../engine/containerEngine': { getStockProjection: async () => ({ available: 99 }) }, '../../utils/expectedStock': { lockExpectedPurchaseOrders: async () => {} }, '../inventory/inventory.service': {}, '../../utils/creditExposure': {}, '../credit-overrides/credit-overrides.service': {}, '../../constants/saleOrderStatus': { SALE_STATUS: { DRAFT: 1, RESERVED: 2, PICKING: 3, PARTIAL_RESERVED: 6 } }, '../../constants/settlementType': { SETTLEMENT_TYPE: {}, normalizeSettlementType: value => value, buildDueDateSql: () => ({ expr: 'NULL', params: [] }) }, '../../utils/backendTime': {}, '../warehouse-tasks/warehouse-tasks.adjust': {}, '../warehouse-tasks/warehouse-task-events.service': {}, './sale.contracts': saleContracts, '../warehouse-tasks/warehouse-tasks.service': taskSvc }
  const sale = load('modules/sale/sale.service.js', saleDeps)
  const disposal = load('modules/disposal/disposal.service.js', { ...common, '../../engine/inventoryEngine': {}, '../../engine/containerEngine': {}, '../../utils/selfApprove': {}, './disposal.receipt': {} })
  const taskHelpers = { assertTaskScope: (task, data) => { scope.assertInScope(data.scopeWarehouseIds, task.warehouse_id); if (data.pdaWarehouseId != null && Number(data.pdaWarehouseId) !== Number(task.warehouse_id)) throw new AppError('device scope', 403) }, logSideEffectFailure: () => {}, ...Object.fromEntries(['assertTaskPickScanClosure','assertSaleReturnReverseClosure','assertTaskCheckScanClosure','assertTaskPackagingClosure','assertTaskPackagePrintClosure'].map(name => [name, async c => { assert.equal(c, conn); calls.push(name) }])) }
  const wt = load('modules/warehouse-tasks/warehouse-tasks.ship.js', { ...common, '../fulfillment/fulfillment.refresh': fulfillment, '../../engine/inventoryEngine': { MOVE_TYPE: { TASK_OUT: 8 }, moveStock: async (c, data) => { assert.equal(c, conn); moves.push(structuredClone(data)); return { unitCost: 1 } } }, '../../engine/containerEngine': { unlockContainersByTask: async c => assert.equal(c, conn) }, '../../utils/creditExposure': {}, './warehouse-task-events.service': { WT_EVENT: { SHIPPED: 'shipped' }, record: async (c, event) => { assert.equal(c, conn); events.push(event); state.durableEvents.push(event) } }, '../sale/sale.contracts': saleContracts, './warehouse-tasks.helpers': taskHelpers, './warehouse-tasks.query': {}, '../returns/returns.purchase-lock': {}, '../sale/sale.service': { syncShippedByWarehouseTaskWithinTransaction: async c => { assert.equal(c, conn); calls.push('sync-AR') } } })
  const data = { customerId: 4, warehouseId: 8, scopeWarehouseIds: [8, 9], operator: actor, requestKey: 'original', items: [{ productId: 3, unit: '个', quantity: 10, unitPrice: 2 }] }
  const context = { saleOrderId: 81, warehouseId: 8, totalAmount: 20, items: [{ productId: 3, productName: '商品3', quantity: 9, unitPrice: 99 }] }
  return { sale, disposal, wt, data, context, conn, sqls, calls, moves, events, tasksCreated, get state() { return state } }
}
const guarded = error => error instanceof AppError && error.statusCode === 409 && /^DISPOSAL_HANDLING_/.test(error.code)
for (const action of ['update', 'reserved-adjust', 'execution-adjust', 'scrap-update']) {
  test(`linked ${action} refuses line replacement even with unchanged quantity`, async () => {
    const f = fixture({ status: action === 'update' || action === 'scrap-update' ? 1 : 2, scrap: action === 'scrap-update', taskId: action === 'execution-adjust' ? 21 : null })
    const run = action === 'update' ? () => f.sale.update(81, f.data) : action === 'scrap-update' ? () => f.disposal.update(81, { ...f.data, items: [{ ...f.data.items[0], disposeType: 3 }] }, [8]) : () => f.sale.requestAdjustment(81, f.data)
    await assert.rejects(run(), error => error.code === 'DISPOSAL_HANDLING_TARGET_EDIT_FORBIDDEN' && error.statusCode === 409); assert.equal(f.calls.includes('rebuild'), false); assert.equal(f.calls.includes('commit'), false)
  })
}
test('original successful edit ACK precedes linked new-edit rejection', async () => {
  for (const action of ['update', 'requestAdjustment']) { const f = fixture({ status: 2, replay: true }); const ack = await f.sale[action](81, f.data); assert.equal(ack.original, true); assert.equal(f.calls.includes('rebuild'), false) }
})
test('original unlinked draft edit succeeds and performs zero domain queries', async () => {
  const f = fixture({ unlinked: true }); await f.sale.update(81, f.data)
  assert.ok(f.calls.includes('rebuild')); assert.equal(f.calls.filter(c => c === 'commit').length, 1); assert.ok(f.sqls.every(sql => !/FROM disposal_handling_/.test(sql)))
})
test('linked reserve rejects changed warehouse with zero prior reserve', async () => {
  const f = fixture(); await assert.rejects(f.sale.reserveStock(81, actor, [{ id: 501, qty: 2, warehouseId: 9 }], { scopeWarehouseIds: [8, 9], requestKey: 'key' }), guarded)
  assert.equal(f.calls.includes('reserve'), false); assert.equal(f.calls.includes('commit'), false)
})
test('same warehouse reserve/release/partial dispatch still commit once without source reads', async () => {
  const f = fixture(); await f.sale.reserveStock(81, actor, [{ id: 501, qty: 2, warehouseId: 8 }], { scopeWarehouseIds: [8], requestKey: 'key' })
  assert.ok(f.calls.includes('link')); assert.ok(f.calls.indexOf('link') < f.calls.indexOf('customer-X')); assert.ok(f.sqls.filter(sql => sql.includes('disposal_handling_')).every(sql => sql.endsWith('FOR SHARE')))
  const r = fixture({ status: 6, reserved: 2 }); await r.sale.releaseStock(81, actor, [{ id: 501, qty: 1 }], [8], 'key')
  assert.ok(r.calls.includes('release-stock'))
  const d = fixture({ status: 2, reserved: 10 }); await d.sale.ship(81, actor, { items: [{ id: 501, qty: 2 }], scopeWarehouseIds: [8], requestKey: 'key' })
  assert.equal(d.tasksCreated[0].items[0].quantity, 2)
  for (const x of [f, r, d]) assert.equal(x.calls.filter(c => c === 'commit').length, 1)
})
test('linked partially shipped cancel keeps historical A/line while trimming current quantity', async () => {
  const f = fixture({ status: 3, shipped: 2, shippedTask: true }); await f.sale.cancel(81, actor, [8], 'key')
  assert.equal(f.state.head.status, 4); assert.equal(f.state.item.quantity, 2); assert.equal(f.state.link.allocated_quantity, 10); assert.equal(f.state.link.target_line_id, 501)
})
test('linked delete refuses pending physical return with no WT shared/exclusive lock', async () => {
  const f = fixture({ status: 5, pendingReturn: true }); await assert.rejects(f.sale.deleteOrder(81, actor, [8], 'key'), guarded)
  assert.equal(f.state.head.deleted_at, null); assert.ok(f.sqls.filter(sql => sql.includes('FROM warehouse_tasks')).every(sql => !/FOR SHARE|FOR UPDATE/.test(sql)))
})
test('linked delete conservatively blocks unclosed tasks, locked containers and returned boxes', async () => {
  for (const flag of ['unclosed', 'lockedContainer', 'returnedBox']) { const f = fixture({ status: 5, [flag]: true }); await assert.rejects(f.sale.deleteOrder(81, actor, [8], 'key'), guarded); assert.equal(f.calls.includes('commit'), false) }
})
test('linked closed delete retains original replay and ordinary soft-delete contract', async () => {
  const f = fixture({ status: 5 }); f.state.item = null; await f.sale.deleteOrder(81, actor, [8], 'key'); assert.equal(f.state.head.deleted_at, 'offline')
  const r = fixture({ status: 5, replay: true, pendingReturn: true }); r.state.item = null; const ack = await r.sale.deleteOrder(81, actor, [8], 'key'); assert.equal(ack.original, true)
})
test('marker, link type/head/product/warehouse/unit and scope fail closed before generic ACK', async () => {
  const cases = [f => { f.state.head.disposal_handling_link_id = 0 }, f => { f.state.link = null }, f => { f.state.link.target_type = 'purchase_return' }, f => { f.state.link.target_id = 82 }, f => { f.state.link.product_id = null }, f => { f.state.link.warehouse_id = 9 }, f => { f.state.link.unit = '' }, f => { f.state.link.state = 'TERMINATED' }, f => { f.state.link.allocated_quantity = 1.001 }]
  for (const change of cases) { const f = fixture({ replay: true }); change(f); await assert.rejects(f.sale.releaseStock(81, actor, null, [8], 'key'), guarded); assert.equal(f.calls.includes('request'), false) }
})
test('scope and device gates precede successful ship ACK', async () => {
  for (const options of [{ scopeWarehouseIds: [] }, { scopeWarehouseIds: [8], pdaWarehouseId: 9 }]) { const f = fixture({ status: 3, replay: true }); await assert.rejects(f.wt.ship(21, actor, f.context, options), error => error.statusCode === 403); assert.equal(f.calls.includes('request'), false) }
})
test('new actual ship replaces stale pool context with current sole SOI/WTI but full SO event total', async () => {
  const f = fixture({ status: 3 }); await f.wt.ship(21, actor, f.context, { requestKey: 'key', scopeWarehouseIds: [8], pdaWarehouseId: 8 })
  assert.equal(f.moves.length, 1); assert.equal(f.moves[0].qty, 2); assert.equal(f.moves[0].productId, 3); assert.equal(f.moves[0].warehouseId, 8); assert.equal(f.moves[0].unitPrice, 2)
  assert.equal(f.events[0].detail.totalAmount, 20); assert.equal(f.events[0].detail.itemCount, 1); assert.equal(f.calls.filter(c => c === 'commit').length, 1)
  assert.ok(f.calls.indexOf('head-X') < f.calls.indexOf('task-X')); assert.ok(f.calls.indexOf('request') < f.calls.indexOf('assertTaskPickScanClosure'))
})
test('ship preBEGIN supplied SO mismatch refuses without locking or following another SO', async () => {
  const f = fixture({ status: 3 }); f.context.saleOrderId = 80
  await assert.rejects(f.wt.ship(21, actor, f.context, { scopeWarehouseIds: [8] }), e => e.statusCode === 409)
  assert.equal(f.calls.includes('begin'), false); assert.equal(f.moves.length, 0)
})
test('ship WT identity drift after BEGIN rolls back without chasing its new SO', async () => {
  const f = fixture({ status: 3, onBegin: state => { state.task.sale_order_id = 82 } })
  await assert.rejects(f.wt.ship(21, actor, f.context, { scopeWarehouseIds: [8] }), e => e.statusCode === 409); assert.equal(f.moves.length, 0)
})
test('new linked ship rejects wrong historical line/product/unit/warehouse, fanout or amount beyond A', async () => {
  const cases = [f => { f.state.item.id = 502 }, f => { f.state.item.product_id = 4 }, f => { f.state.item.unit = '箱' }, f => { f.state.item.warehouse_id = 9 }, f => { f.state.item.quantity = 11 }, f => { f.state.item.quantity = 9 }, f => { f.state.taskItem.product_id = 4 }, f => { f.state.taskItem.unit = '箱' }, f => { f.state.taskItem.picked_qty = 11 }]
  for (const change of cases) { const f = fixture({ status: 3 }); change(f); await assert.rejects(f.wt.ship(21, actor, f.context, { scopeWarehouseIds: [8, 9] }), guarded); assert.equal(f.moves.length, 0) }
})
test('new linked ship rejects real duplicate SOI or WTI rows', async () => {
  for (const flag of ['duplicateItem', 'duplicateTaskItem']) { const f = fixture({ status: 3, [flag]: true }); await assert.rejects(f.wt.ship(21, actor, f.context, { scopeWarehouseIds: [8] }), guarded); assert.equal(f.moves.length, 0) }
})
test('successful ship ACK survives later partial close and missing current rows', async () => {
  const f = fixture({ status: 4, replay: true }); f.state.item = null; f.state.taskItem = null; f.state.task.status = 7
  const result = await f.wt.ship(21, actor, f.context, { requestKey: 'key', scopeWarehouseIds: [8] })
  assert.equal(result.original, true); assert.equal(f.moves.length, 0); assert.ok(f.sqls.every(sql => !sql.includes('FROM sale_order_items') && !sql.includes('FROM warehouse_task_items')))
})
test('unlinked ship keeps old context and zero new-table reads; linked receipt failure rolls state back', async () => {
  const f = fixture({ unlinked: true, status: 3 }); await f.wt.ship(21, actor, f.context, { scopeWarehouseIds: [8] }); assert.equal(f.moves[0].qty, 9); assert.ok(f.sqls.every(sql => !/FROM disposal_handling_/.test(sql)))
  const r = fixture({ status: 3, receiptFail: true }); await assert.rejects(r.wt.ship(21, actor, r.context, { scopeWarehouseIds: [8] }), e => e.code === 'FIXTURE_RECEIPT_FAIL'); assert.equal(r.state.task.status, 6); assert.equal(r.state.durableEvents.length, 0); assert.equal(r.calls.includes('commit'), false)
})

test('new linked reserve/release/dispatch/ship require quantity exactly frozen A', async () => {
  const actions = [f => f.sale.reserveStock(81, actor, [{ id: 501, qty: 2, warehouseId: 8 }], { scopeWarehouseIds: [8] }), f => f.sale.releaseStock(81, actor, [{ id: 501, qty: 1 }], [8]), f => f.sale.ship(81, actor, { items: [{ id: 501, qty: 2 }], scopeWarehouseIds: [8] }), f => f.wt.ship(21, actor, f.context, { scopeWarehouseIds: [8] })]
  for (const [i, run] of actions.entries()) { const f = fixture({ status: i === 0 ? 1 : i === 3 ? 3 : 2, reserved: i === 0 ? 0 : 10 }); f.state.item.quantity = 9; await assert.rejects(run(f), guarded); assert.equal(f.calls.includes('commit'), false) }
})

for (const hiddenExtra of ['unreserved', 'dispatched']) {
  test(`linked dispatch rejects extra same-warehouse ${hiddenExtra} row hidden by eligibility filter`, async () => {
    const f = fixture({ status: 2, reserved: 10, hiddenExtra })
    await assert.rejects(f.sale.ship(81, actor, { items: [{ id: 501, qty: 2 }], scopeWarehouseIds: [8], requestKey: 'key' }), error => error.code === 'DISPOSAL_HANDLING_TARGET_INVALID' && error.statusCode === 409)
    assert.equal(f.tasksCreated.length, 0); assert.equal(f.state.item.dispatched_qty, 0); assert.ok(f.sqls.every(sql => !sql.startsWith('UPDATE sale_order_items SET dispatched_qty'))); assert.equal(f.calls.includes('commit'), false)
  })
}
test('linked sole fully dispatched line retains original no-eligible 400 and replay skips current lines', async () => {
  const f = fixture({ status: 3, reserved: 10, dispatched: 10 })
  await assert.rejects(f.sale.ship(81, actor, { scopeWarehouseIds: [8], requestKey: 'key' }), error => error.statusCode === 400 && error.message === '该销售单已无可发货明细，请先占库')
  assert.equal(f.tasksCreated.length, 0); assert.equal(f.calls.includes('commit'), false)
  const r = fixture({ status: 4, replay: true }); r.state.item = null
  const ack = await r.sale.ship(81, actor, { scopeWarehouseIds: [8], requestKey: 'key' }); assert.equal(ack.original, true)
  assert.ok(r.sqls.filter(sql => sql.includes('FROM sale_order_items')).every(sql => sql.startsWith('SELECT warehouse_id FROM'))); assert.equal(r.tasksCreated.length, 0)
})
