// H2: actual original wrappers and actual domain rules; only SQL/remote business boundaries stubbed.
// No config/db/app/env imports. Unknown require or SQL is a fixture error, never a business red.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const base = path.resolve(__dirname, '../backend/src')
const AppError = require('../backend/src/utils/AppError')
const sqlIdentifier = require('../backend/src/utils/sqlIdentifier')
const { z } = require('../backend/node_modules/zod')
function load(file, deps) {
  const filename = path.join(base, file), module = { exports: {} }
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module, require: name => {
    if (Object.hasOwn(deps, name)) return typeof deps[name] === 'function' && deps[name].lazy ? deps[name]() : deps[name]
    throw Error(`Unstubbed require ${file}: ${name}`)
  } }, { filename })
  return module.exports
}
const lazy = fn => Object.assign(fn, { lazy: true })
const qty = load('utils/qtyPrecision.js', { './AppError': AppError })
const scope = load('utils/warehouseScope.js', { '../config/db': {}, './AppError': AppError })
const units = load('utils/unitConversion.js', { './AppError': AppError, './qtyPrecision': qty })
const rules = load('modules/disposal/disposal.handling.rules.js', { 'node:crypto': require('node:crypto'), '../../utils/AppError': AppError, '../../utils/qtyPrecision': qty })
const operations = load('modules/disposal/disposal.handling.operations.js', { '../../utils/AppError': AppError, './disposal.handling.rules': rules })
const contracts = lazy(() => load('modules/disposal/disposal.handling.contracts.js', { zod: { z }, '../../utils/AppError': AppError, './disposal.handling.rules': rules }))
const targets = lazy(() => load('modules/disposal/disposal.handling.targets.js', { '../../utils/AppError': AppError, '../../utils/warehouseScope': scope, '../../utils/qtyPrecision': qty, '../../utils/sqlIdentifier': sqlIdentifier, './disposal.handling.rules': rules, './disposal.handling.operations': operations, './disposal.handling.contracts': contracts }))
const targetGuards = load('modules/disposal/disposal.handling.target-guards.js', { '../../utils/AppError': AppError, '../../utils/warehouseScope': scope, '../../utils/qtyPrecision': qty, './disposal.handling.rules': rules })
const actor = { userId: 9, realName: 'fixture' }, uuid = '11111111-1111-4111-8111-111111111111'
const reference = { sourceId: 7, expectedRevision: 1, operationUuid: uuid }
const input = type => ({ warehouseId: 8, warehouseName: '仓8', customerId: 4, supplierId: 4, supplierName: '供4', purchaseOrderId: 10, purchaseOrderNo: 'PO10', operator: actor, scopeWarehouseIds: [8], requestKey: 'original', disposalSourceAuthorized: true, disposalSource: { ...reference }, items: [{ sourceItemId: 101, productId: 3, productCode: 'P3', productName: '商品3', unit: '个', quantity: 2, unitPrice: 99, disposeType: 3 }], ...(type === 'sale_order' ? {} : {}) })
function fixture(type, options = {}) {
  const calls = [], events = [], genericPayloads = [], sqls = []
  let state = { source: { id: 7, intent_uuid: '22222222-2222-4222-8222-222222222222', product_id: 3, warehouse_id: 8, unit: '个', quantity: 10, handling_type: { sale_order: 1, purchase_return: 2, inventory_disposal: 3 }[type], revision: 1 }, ops: {}, links: [], heads: [], lines: [], durableEvents: [], generic: null }
  let backup, connections = 0
  const product = { id: 3, code: 'P3', name: '商品3', unit: options.unit || '个', allow_decimal_qty: 1, is_active: options.inactive ? 0 : 1, unit_value: 4, cost_price: 0, deleted_at: null }
  const conn = {
    beginTransaction: async () => { events.push('begin'); backup = structuredClone(state) },
    commit: async () => { events.push('commit'); backup = null },
    rollback: async () => { events.push('rollback'); if (backup) state = backup; backup = null }, release: () => events.push('release'),
    query: async (raw, args = []) => {
      const sql = raw.replace(/\s+/g, ' ').trim(); sqls.push(sql)
      if (['SET TRANSACTION ISOLATION LEVEL READ COMMITTED', 'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ', 'START TRANSACTION READ ONLY'].includes(sql)) return [{}]
      if (/^SELECT \* FROM disposal_handling_sources WHERE id=\?(?: FOR UPDATE| FOR SHARE)?$/.test(sql)) { assert.equal(args.length, 1); calls.push('source'); return [Number(args[0]) === Number(state.source.id) ? [{ ...state.source }] : []] }
      if (sql.startsWith('INSERT INTO disposal_handling_operations')) {
        calls.push('permanent'); const [id, action, user, key, intent, hash, json] = args
        if (state.ops[id]) throw Object.assign(Error('duplicate'), { code: 'ER_DUP_ENTRY' })
        state.ops[id] = { operation_uuid: id, action, actor_id: user, request_key: key, intent_uuid: intent, payload_hash: hash, payload_json: json, status: 0 }; return [{ insertId: 1 }]
      }
      if (/^SELECT \* FROM disposal_handling_operations WHERE operation_uuid=\?(?: AND actor_id=\?)?(?: FOR SHARE)?$/.test(sql)) return [[state.ops[args[0]]].filter(row => row && (args[1] === undefined || Number(row.actor_id) === Number(args[1])))]
      if (sql.startsWith('UPDATE disposal_handling_operations')) {
        if (options.receiptFail) throw new AppError('receipt failed', 409, 'FIXTURE_RECEIPT_FAIL')
        const [sourceId, targetType, targetId, lineId, resourceType, resourceId, json, id] = args
        if (!state.ops[id] || state.ops[id].status !== 0) return [{ affectedRows: 0 }]
        Object.assign(state.ops[id], { source_id: sourceId, target_type: targetType, target_id: targetId, target_line_id: lineId, resource_type: resourceType, resource_id: resourceId, response_json: json, status: 1 }); return [{ affectedRows: 1 }]
      }
      if (/^SELECT \* FROM disposal_handling_links WHERE (source_id|created_operation_uuid)=\?(?: ORDER BY id)?(?: FOR SHARE)?$/.test(sql)) { if (sql.includes('source_id=?')) calls.push('budget'); return [state.links.filter(row => sql.includes('created_operation_uuid=?') ? row.created_operation_uuid === args[0] : Number(row.source_id) === Number(args[0])).map(row => ({ ...row }))] }
      if (sql.startsWith('INSERT INTO disposal_handling_links')) {
        if (options.linkFail) throw new AppError('link failed', 409, 'FIXTURE_LINK_FAIL')
        const [sourceId, targetType, targetId, lineId, productId, warehouseId, unit, allocated, operationUuid, json] = args
        assert.equal(Number(sourceId), Number(state.source.id)); assert.ok(state.heads.some(head => head.type === targetType && Number(head.id) === Number(targetId))); assert.ok(state.lines.some(line => Number(line.parent_id) === Number(targetId) && Number(line.id) === Number(lineId)));
        const linkId = 31 + state.links.length; state.links.push({ id: linkId, source_id: sourceId, target_type: targetType, target_id: targetId, target_line_id: lineId, product_id: productId, warehouse_id: warehouseId, unit, allocated_quantity: allocated, released_quantity: 0, final_executed_quantity: null, state: 'ACTIVE', created_operation_uuid: operationUuid, response_json: json }); calls.push('link'); return [{ insertId: linkId }]
      }
      if (sql === 'UPDATE disposal_handling_sources SET revision=revision+1 WHERE id=? AND revision=?') { assert.equal(args.length, 2); if (Number(args[0]) !== Number(state.source.id) || Number(args[1]) !== Number(state.source.revision)) return [{ affectedRows: 0 }]; state.source.revision++; return [{ affectedRows: 1 }] }
      if (sql.startsWith('UPDATE') && sql.includes('disposal_handling_link_id')) {
        if (options.markerFail) return [{ affectedRows: 0 }]
        assert.equal(args.length, 2); const head = state.heads.find(row => Number(row.id) === Number(args[1])); if (!head || head.disposal_handling_link_id !== null) return [{ affectedRows: 0 }]; assert.ok(state.links.some(row => Number(row.id) === Number(args[0]) && Number(row.target_id) === Number(head.id))); head.disposal_handling_link_id = args[0]; calls.push('marker'); return [{ affectedRows: 1 }]
      }
      if (sql.includes('FROM sale_customers')) return [[{ id: 4, name: '客4', is_active: 1 }]]
      if (sql.includes('FROM inventory_warehouses')) { calls.push('master'); return [(Array.isArray(args[0]) ? args[0] : args).map(Number).includes(8) ? [{ id: 8, name: '仓8', is_active: 1 }] : []] }
      if (sql.includes('FROM product_items')) return [(Array.isArray(args[0]) ? args[0] : args).map(Number).includes(3) ? [{ ...product }] : []]
      if (sql.includes('FROM product_units')) return [[{ unit_name: '箱', conversion_rate: 3 }]]
      if (sql.includes('FROM purchase_order_items')) return [[{ id: 101, order_id: 10, product_id: 3, unit: '个', quantity: 10, received_qty: 10, returned_qty: options.returned || 0, unit_price: 4 }]]
      if (sql.includes('FROM purchase_orders')) return [[{ id: 10, order_no: 'PO10', supplier_id: 4, warehouse_id: 8 }]]
      if (/^INSERT INTO (sale_orders|purchase_returns|inventory_disposal_orders) /.test(sql)) {
        calls.push('target'); const no = args[0]
        const id = 81 + state.heads.length; state.heads.push({ id, type, warehouse_id: 8, no, order_no: no, return_no: no, disposal_no: no, commercial_model: null, disposal_handling_link_id: null }); return [{ insertId: id }]
      }
      if (sql.startsWith('INSERT INTO sale_order_items')) {
        state.lines.push(...args[0].map((row, index) => ({ id: 501 + state.lines.length + index, parent_id: row[0], product_id: row[3], warehouse_id: row[1], unit: row[6], quantity: row[11], unit_price: row[14] }))); return [{ insertId: 999 }]
      }
      if (sql.startsWith('INSERT INTO purchase_return_items')) { state.lines.push({ id: 502 + state.lines.length, parent_id: args[0], product_id: args[2], unit: args[8], quantity: args[10], unit_price: args[13], purchase_item_id: args[1] }); return [{ insertId: 999 }] }
      if (sql.startsWith('INSERT INTO inventory_disposal_items')) { state.lines.push({ id: 503 + state.lines.length, parent_id: args[0], product_id: args[1], unit: args[4], quantity: args[5] }); return [{ insertId: 999 }] }
      if (/FROM (sale_order_items|purchase_return_items|inventory_disposal_items)/.test(sql)) return [state.lines.filter(row => Number(row.parent_id) === Number(args[0])).map(row => ({ ...row, warehouse_id: row.warehouse_id || 8 }))]
      if (/FROM (sale_orders|purchase_returns|inventory_disposal_orders)/.test(sql)) return [state.heads.filter(row => Number(row.id) === Number(args[0])).map(row => ({ ...row }))]
      if (sql.startsWith('INSERT INTO sale_order_events')) { calls.push('event'); state.durableEvents.push({ id: args[0], kind: args[1] }); return [{}] }
      if (sql.startsWith('UPDATE inventory_disposal_orders SET total_value')) return [{ affectedRows: 1 }]
      throw Error(`Unstubbed SQL: ${sql}`)
    },
  }
  const generic = { beginCreationOperationRequest: async (c, data) => { assert.equal(c, conn); calls.push('generic'); genericPayloads.push(structuredClone(data.payload)); if (options.genericReplay) return { replay: true, responseData: { id: 80 } }; state.generic = { status: 0 }; return { enabled: true, id: 1, replay: false } }, completeOperationRequest: async c => { assert.equal(c, conn); calls.push('generic-complete'); state.generic.status = 1 } }
  const common = { '../disposal/disposal.handling.target-guards': targetGuards, './disposal.handling.target-guards': targetGuards, '../refunds/supplier-refunds.pr-gate': { assertNoPendingRefund: async () => ({ received: false }) },
    '../../config/db': { pool: { getConnection: async () => { connections++; return conn } } }, '../../utils/AppError': AppError, '../../utils/warehouseScope': scope, '../../utils/unitConversion': units, '../../utils/qtyPrecision': qty, '../../utils/codeGenerator': { generateDailyCode: async () => ({ sale_order: 'S', purchase_return: 'PR', inventory_disposal: 'DP' })[type] + (81 + state.heads.length) }, '../../utils/operationRequest': generic, '../../utils/statusTransition': {}, '../../constants/documentStatusRules': {}, '../../utils/pagination': {}, '../disposal/disposal.handling.targets': targets, './disposal.handling.targets': targets }
  const saleContracts = load('modules/sale/sale.contracts.js', { zod: { z }, '../../utils/AppError': AppError, '../../utils/qtyPrecision': qty, '../disposal/disposal.handling.contracts': contracts })
  let svc
  if (type === 'sale_order') svc = load('modules/sale/sale.service.js', { ...common, './sale.commercial-dispatch': {}, './sale.commercial-store': { assertRequestKey() {} }, './sale.commercial-resolver': {}, './sale.commercial-money': {}, '../fulfillment/fulfillment.refresh': { commitFulfillment: async c => { assert.equal(c, conn); calls.push('fulfillment'); await c.commit() } }, '../logistics/shipping-products': {}, '../fulfillment/fulfillment.sale-items': {}, './sale.presentation': {}, './sale.items': load('modules/sale/sale.items.js', {}), '../../engine/reservationEngine': {}, '../../engine/containerEngine': {}, '../inventory/inventory.service': {}, '../../utils/expectedStock': {}, '../../utils/creditExposure': {}, '../credit-overrides/credit-overrides.service': {}, '../../constants/saleOrderStatus': {}, '../../constants/settlementType': { SETTLEMENT_TYPE: {} }, '../../constants/warehouseTaskStatus': {}, '../../utils/backendTime': {}, '../warehouse-tasks/warehouse-tasks.adjust': {}, '../warehouse-tasks/warehouse-task-events.service': {}, './sale.contracts': saleContracts })
  if (type === 'purchase_return') svc = load('modules/returns/returns-purchase.service.js', { ...common, './return-events.service': { RETURN_EVENT: { CREATED: 'created' }, record: async (c, event) => { assert.equal(c, conn); calls.push('event'); state.durableEvents.push(structuredClone(event)) } }, '../../constants/warehouseTaskStatus': {}, '../../utils/requestContext': { getRequestId: () => 'req' }, './returns.helpers': { genNo: async () => 'PR' + (81 + state.heads.length) }, './returns.purchase-lock': {} })
  if (type === 'inventory_disposal') svc = load('modules/disposal/disposal.service.js', { ...common, '../../engine/inventoryEngine': {}, '../../engine/containerEngine': {}, '../../utils/selfApprove': {}, './disposal.receipt': {} })
  const proof = load('modules/disposal/disposal.handling.proof.js', { '../../utils/AppError': AppError, '../../utils/warehouseScope': scope, '../../utils/sqlIdentifier': sqlIdentifier, './disposal.handling.rules': rules })
  const facts = load('modules/disposal/disposal.handling.facts.js', { '../../utils/sqlIdentifier': sqlIdentifier, './disposal.handling.rules': rules, './disposal.handling.proof': proof })
  const release = load('modules/disposal/disposal.handling.release.js', { ...common, './disposal.handling.rules': rules, './disposal.handling.operations': operations, './disposal.handling.proof': proof, './disposal.handling.facts': facts })
  const own = load('modules/disposal/disposal.handling.js', { '../../config/db': common['../../config/db'], '../../utils/AppError': AppError, '../../utils/warehouseScope': scope, '../../utils/qtyPrecision': qty, '../../utils/sqlIdentifier': sqlIdentifier, './disposal.handling.rules': rules, './disposal.handling.operations': operations, './disposal.handling.targets': targets, './disposal.handling.proof': proof, './disposal.handling.facts': facts, './disposal.handling.release': release })
  return { run: data => type === 'purchase_return' ? svc.createPR(data) : svc.create(data), own, events, calls, sqls, genericPayloads, conn, get state() { return state }, get connections() { return connections }, saleContracts }
}
for (const type of ['sale_order', 'purchase_return', 'inventory_disposal']) {
  test(`${type}: original wrapper commits target + exact line/link/marker + permanent response once`, async () => {
    const f = fixture(type), result = await f.run(input(type))
    assert.equal(result.id, 81); assert.equal(f.state.links.length, 1)
    const link = f.state.links[0]; assert.equal(link.target_line_id, { sale_order: 501, purchase_return: 502, inventory_disposal: 503 }[type]); assert.equal(link.allocated_quantity, 2)
    assert.equal(f.state.heads[0].disposal_handling_link_id, 31); assert.equal(f.state.source.revision, 2)
    assert.equal(f.state.ops[uuid].response_json, rules.stableJson(result)); assert.equal(f.state.ops[uuid].resource_type, type)
    assert.equal(f.connections, 1); assert.equal(f.events.filter(e => e === 'commit').length, 1)
    assert.ok(f.calls.indexOf('source') < f.calls.indexOf('permanent')); assert.ok(f.calls.indexOf('permanent') < f.calls.indexOf('budget')); assert.ok(f.calls.indexOf('budget') < f.calls.indexOf('master')); assert.ok(f.calls.indexOf('budget') < f.calls.indexOf(type === 'inventory_disposal' ? 'target' : 'generic')); assert.ok(f.calls.indexOf('link') < f.calls.indexOf('generic-complete') || type === 'inventory_disposal')
  })
  test(`${type}: permanent ACK survives changed revision, generic TTL and current line removal`, async () => {
    const f = fixture(type), data = input(type), original = await f.run(data)
    f.state.lines = []; f.state.generic = null; f.state.source.revision = 8
    const replay = await f.run(data)
    assert.equal(rules.stableJson(replay), rules.stableJson(original)); assert.equal(f.calls.filter(c => c === 'target').length, 1)
    assert.equal(f.calls.filter(c => c === 'generic').length, type === 'inventory_disposal' ? 0 : 1)
  })
  test(`${type}: link/marker/receipt failure rolls back all target and events`, async () => {
    for (const flag of ['linkFail', 'markerFail', 'receiptFail']) {
      const f = fixture(type, { [flag]: true })
      await assert.rejects(f.run(input(type)), e => e instanceof AppError)
      assert.equal(f.state.heads.length, 0); assert.equal(f.state.lines.length, 0); assert.equal(f.state.links.length, 0); assert.equal(f.state.durableEvents.length, 0); assert.deepEqual(f.state.ops, {}); assert.equal(f.state.generic, null)
      assert.equal(f.events.filter(e => e === 'commit').length, 0); assert.ok(f.events.includes('rollback'))
    }
  })
  test(`${type}: no source preserves old path/payload and never reads new tables`, async () => {
    const f = fixture(type), data = input(type); delete data.disposalSource; delete data.disposalSourceAuthorized
    await f.run(data); assert.ok(f.sqls.every(sql => !sql.includes('disposal_handling_')))
    if (type !== 'inventory_disposal') {
      const fields = type === 'sale_order' ? ['customerId','warehouseId','remark','carrierId','carrier','freightType','shippingProduct','receiverName','receiverPhone','receiverAddress','items','discountAmount','commercialModel','commercialGroups'] : ['supplierId','supplierName','warehouseId','warehouseName','purchaseOrderId','purchaseOrderNo','remark','items']
      assert.equal(rules.stableJson(f.genericPayloads[0]), rules.stableJson(Object.fromEntries(fields.map(key => [key, data[key]]))))
      assert.deepEqual(Object.keys(f.genericPayloads[0]), fields)
    }
    else assert.equal(f.calls.includes('generic'), false)
  })
}
test('source scope/auth, UUID identity and budget fail before duplicate target creation', async () => {
  const f = fixture('sale_order'), data = input('sale_order'); await f.run(data)
  for (const changed of [{ requestKey: 'changed' }, { remark: 'changed' }, { operator: { ...actor, userId: 10 } }, { disposalSourceAuthorized: false }, { scopeWarehouseIds: [] }]) {
    await assert.rejects(f.run({ ...data, ...changed }), e => e instanceof AppError)
  }
  assert.equal(f.calls.filter(c => c === 'target').length, 1)
  f.state.source.quantity = 2
  await assert.rejects(f.run({ ...data, disposalSource: { ...reference, expectedRevision: 2, operationUuid: '33333333-3333-4333-8333-333333333333' } }), e => e.code === 'DISPOSAL_HANDLING_BUDGET_EXCEEDED')
})
test('single folded basic quantity, type/warehouse and current unit/active are authoritative', async () => {
  const f = fixture('sale_order'), data = input('sale_order'); data.items[0].entryUnit = '箱'; await f.run(data)
  assert.equal(f.state.links[0]?.allocated_quantity, 6)
  for (const [type, options, changed] of [
    ['sale_order', {}, { items: [...input('sale_order').items, ...input('sale_order').items] }],
    ['sale_order', {}, { items: [{ ...input('sale_order').items[0], warehouseId: 9 }] }],
    ['purchase_return', { inactive: true }, {}], ['inventory_disposal', { unit: '件' }, {}],
  ]) await assert.rejects(fixture(type, options).run({ ...input(type), ...changed }), e => e instanceof AppError)
  const bad = fixture('sale_order'); bad.state.source.handling_type = 2
  await assert.rejects(bad.run(input('sale_order')), e => e instanceof AppError)
})
test('linked PR retains accurate PO/POI budget and original unit price; unbound PO is refused', async () => {
  const f = fixture('purchase_return'); await f.run(input('purchase_return'))
  assert.equal(f.state.lines[0].unit_price, 4)
  await assert.rejects(fixture('purchase_return', { returned: 9 }).run(input('purchase_return')), e => e.statusCode === 409)
  await assert.rejects(fixture('purchase_return').run({ ...input('purchase_return'), purchaseOrderId: null, purchaseOrderNo: undefined, items: [{ ...input('purchase_return').items[0], sourceItemId: undefined }] }), e => e instanceof AppError)
})
test('null/extra source, commercial and repeat/source combinations refuse before target creation', async () => {
  for (const changed of [{ disposalSource: null }, { disposalSource: { ...reference, extra: 1 } }, { commercialModel: 'kit-v1' }, { repeatCreate: true }]) {
    const f = fixture('sale_order'); await assert.rejects(f.run({ ...input('sale_order'), ...changed }), e => e instanceof AppError); assert.equal(f.calls.includes('target'), false)
  }
})
test('new source operation cannot adopt a generic success lacking permanent link', async () => {
  for (const type of ['sale_order', 'purchase_return']) {
    const f = fixture(type, { genericReplay: true })
    await assert.rejects(f.run(input(type)), e => e.code === 'DISPOSAL_HANDLING_RECEIPT_INVALID')
    assert.equal(f.state.links.length, 0)
  }
})
test('actual POST schema retains strict source; edit routes refuse source before body stripping', async () => {
  const f = fixture('sale_order'), schema = f.saleContracts.createSaleSchema
  const body = { customerId: 4, customerName: '客4', warehouseId: 8, warehouseName: '仓8', items: input('sale_order').items, disposalSource: reference }
  const parsed = schema.parse(body)
  assert.equal(rules.stableJson(parsed.disposalSource), rules.stableJson(reference))
  assert.equal(schema.safeParse({ ...body, disposalSource: null }).success, false)
  const routes = [], router = { use() {}, get() {}, post() {}, delete() {}, put: (url, ...handlers) => routes.push({ url, handlers }) }
  load('modules/sale/sale.routes.js', { express: { Router: () => router }, './sale.controller': {}, '../../middleware/auth': { authMiddleware() {}, requirePermission: () => (_r, _s, next) => next() }, '../../constants/permissions': { PERMISSIONS: {} }, '../../utils/route': load('utils/route.js', {}), './sale.contracts': f.saleContracts, '../disposal/disposal.handling.contracts': contracts })
  for (const route of routes) for (const value of [reference, null]) {
    const req = { body: { ...body, disposalSource: value } }; let error
    for (const handler of route.handlers.filter(Boolean)) { handler(req, {}, e => { error = e }); if (error) break }
    assert.ok(error, `${route.url} must reject raw disposalSource`)
  }
})
test('permanent UUID refuses changed action/body/key/actor/resource and malformed frozen metadata', async () => {
  const baseInput = input('sale_order')
  for (const mutate of [
    op => { op.action = rules.SOURCE_CREATE }, op => { op.resource_type = 'purchase_return' }, op => { op.resource_id = 82 }, op => { op.target_line_id = 999 }, op => { op.source_id = 99 },
    (_op, state) => { state.links[0].response_json = '{}' }, (_op, state) => { state.heads[0].disposal_handling_link_id = null },
  ]) {
    const f = fixture('sale_order'); await f.run(baseInput); mutate(f.state.ops[uuid], f.state)
    await assert.rejects(f.run(baseInput), e => e instanceof AppError)
    assert.equal(f.calls.filter(c => c === 'target').length, 1)
  }
  const f = fixture('sale_order'); await f.run(baseInput)
  await assert.rejects(f.run({ ...baseInput, disposalSource: { ...reference, expectedRevision: 2 } }), e => e.code === 'DISPOSAL_HANDLING_OPERATION_CONFLICT')
  await assert.rejects(f.run({ ...baseInput, disposalSource: { ...reference, expectedRevision: 1, operationUuid: '33333333-3333-4333-8333-333333333333' } }), e => e.code === 'DISPOSAL_HANDLING_REVISION_CHANGED')
})
test('source scope before permanent ACK, target full current warehouse scope and soft-deleted head replay', async () => {
  const f = fixture('sale_order'), data = input('sale_order'); const result = await f.run(data), count = f.calls.filter(c => c === 'permanent').length
  f.state.source.warehouse_id = 9
  await assert.rejects(f.run(data), e => e.statusCode === 403)
  assert.equal(f.calls.filter(c => c === 'permanent').length, count)
  f.state.source.warehouse_id = 8; f.state.lines[0].warehouse_id = 9
  await assert.rejects(f.run(data), e => e.statusCode === 403)
  f.state.lines = []; f.state.heads[0].deleted_at = 'historical soft delete'
  assert.equal(rules.stableJson(await f.run(data)), rules.stableJson(result))
})
test('auth-only exact own target operation has no VIEW/CREATE gate and no additional price fields', async () => {
  for (const type of ['sale_order', 'purchase_return', 'inventory_disposal']) {
    const f = fixture(type), original = await f.run(input(type)), action = f.state.ops[uuid].action
    const query = { operationUuid: uuid, intentUuid: f.state.source.intent_uuid, action, requestKey: 'original', userId: 9, scopeWarehouseIds: [8] }
    const response = await f.own.getOwnOperation(query)
    assert.equal(response.status, 'success'); assert.equal(response.resourceType, type); assert.equal(rules.stableJson(response.data), rules.stableJson(original))
    assert.deepEqual(Object.keys(response.data).sort(), Object.keys(original).sort())
    assert.equal((await f.own.getOwnOperation({ ...query, userId: 10 })).status, 'not_found')
    await assert.rejects(f.own.getOwnOperation({ ...query, requestKey: 'changed' }), e => e.code === 'DISPOSAL_HANDLING_RECEIPT_INVALID')
    await assert.rejects(f.own.getOwnOperation({ ...query, scopeWarehouseIds: [] }), e => e.statusCode === 403)
    f.state.ops[uuid].status = 0
    const before = f.sqls.length
    assert.equal((await f.own.getOwnOperation(query)).status, 'pending')
    assert.ok(f.sqls.slice(before).every(sql => !/FROM (sale_orders|purchase_returns|inventory_disposal_orders|disposal_handling_links)/.test(sql)))
    f.state.ops[uuid].status = 1
    f.state.ops[uuid].resource_type = 'wrong'
    await assert.rejects(f.own.getOwnOperation(query), e => e.code === 'DISPOSAL_HANDLING_RECEIPT_INVALID')
  }
})
test('actual controllers use server-loaded source VIEW only when source exists, ignoring body authorization', async () => {
  for (const type of ['sale', 'returns', 'disposal']) {
    let saved, checks = 0
    const create = async data => { saved = data; return { id: 81 } }
    const deps = { '../../utils/AppError': AppError, '../../utils/response': { successResponse() {} }, '../../utils/operator': { getOperatorFromRequest: () => actor }, '../../utils/requestKey': { extractRequestKey: () => 'original' }, '../../middleware/auth': { hasPermission: (_req, code) => { assert.equal(code, 'disposal.view'); checks++; return false } }, '../../constants/permissions': { PERMISSIONS: { INVENTORY_DISPOSAL_VIEW: 'disposal.view' } } }
    if (type === 'sale') deps['./sale.service'] = { create }
    if (type === 'returns') { deps['./returns-purchase.service'] = { createPR: create }; deps['./returns-sale.service'] = {} }
    if (type === 'disposal') { deps['./disposal.service'] = { create }; deps['./disposal.handling'] = {} }
    const ctrl = load(`modules/${type}/${type === 'returns' ? 'returns' : type}.controller.js`, deps)
    const run = type === 'returns' ? ctrl.createPR : ctrl.create
    const req = { body: { ...input('sale_order'), disposalSourceAuthorized: true }, user: { warehouseIds: [8] }, get: () => undefined }
    await run(req, {}, error => { throw error }); assert.equal(saved.disposalSourceAuthorized, false); assert.equal(checks, 1)
    delete req.body.disposalSource; await run(req, {}, error => { throw error }); assert.equal(checks, 1)
  }
})
test('PR/disposal actual POST accepts strict source, edits and kit-v1 do not silently strip it', () => {
  for (const type of ['returns', 'disposal']) {
    const registrations = [], router = { use() {}, get() {}, put() {}, post: (url, ...handlers) => registrations.push({ url, handlers }) }
    const deps = { express: { Router: () => router }, zod: { z }, [`./${type}.controller`]: {}, '../../middleware/auth': { authMiddleware() {}, requirePermission: () => () => {}, requireAnyPermission: () => () => {} }, '../../constants/permissions': { PERMISSIONS: {} }, '../../utils/route': { validateBody: schema => ({ schema }) }, [type === 'returns' ? '../disposal/disposal.handling.contracts' : './disposal.handling.contracts']: contracts }
    if (type === 'returns') deps['./returns.contracts'] = { saleReturnSchema: z.any() }
    load(`modules/${type}/${type}.routes.js`, deps)
    const schema = registrations.find(route => route.url === (type === 'returns' ? '/purchase' : '/')).handlers.find(handler => handler.schema).schema
    assert.equal(rules.stableJson(schema.parse(input('sale_order')).disposalSource), rules.stableJson(reference))
    for (const disposalSource of [null, { ...reference, extra: 1 }, { ...reference, sourceId: 0 }, { ...reference, expectedRevision: 1.5 }]) assert.equal(schema.safeParse({ ...input('sale_order'), disposalSource }).success, false)
  }
  const schema = fixture('sale_order').saleContracts.createSaleSchema
  const commercial = { customerId: 4, customerName: '客', warehouseId: 8, warehouseName: '仓', commercialModel: 'kit-v1', commercialGroups: [{ kind: 'kit', lineKey: 'fresh', kitVersionId: 1, quantity: 1, priceSource: 'kit_default' }] }
  assert.equal(schema.safeParse(commercial).success, true)
  for (const disposalSource of [reference, null]) assert.equal(schema.safeParse({ ...commercial, disposalSource }).success, false)
})
