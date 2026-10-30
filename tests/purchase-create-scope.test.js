// 装载真实采购创建/控制器；数据库与业务副作用严格 stub，不等同 HTTP/MySQL 验收。
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const AppError = require('../backend/src/utils/AppError')
const base = path.join(__dirname, '../backend/src')
function load(relative, deps, transform = source => source) {
  const filename = path.join(base, relative), module = { exports: {} }
  vm.runInNewContext(transform(fs.readFileSync(filename, 'utf8')), { module, require: name => {
    if (Object.hasOwn(deps, name)) return deps[name]
    if(name==='../../utils/cashMoney')return require('../backend/src/utils/cashMoney')
    if(name==='./purchase.cash-money')return require('../backend/src/modules/purchase/purchase.cash-money')
    throw Error(`未 stub 依赖 ${name}`)
  } }, { filename })
  return module.exports
}
const scope = load('utils/warehouseScope.js', { '../config/db': {}, './AppError': AppError })
const shortReceipt = load('modules/inbound-tasks/inbound-tasks.short-receipt.js', { '../../utils/AppError': AppError, '../../utils/warehouseScope': scope, './inbound-tasks.cost': require('../backend/src/modules/inbound-tasks/inbound-tasks.cost') })
const closeReceipt = load('modules/purchase/purchase.close-receipt.js', { '../../utils/AppError': AppError, '../../utils/warehouseScope': scope })
const body = { supplierId: 3, supplierName: '合成供商', warehouseId: 8, warehouseName: '合成仓', items: [{ productId: 5, productCode: 'P5', productName: '合成商品', unit: '个', quantity: 2, unitPrice: 1.2345 }], operator: { userId: 7, realName: '合成制单人' }, requestKey: 'same-key' }
function fixture({ replay = false, savedWarehouse = 8, missingReceipt = false, wrongResource = false, missingOrder = false, nullWarehouse = false, missingWarehouse = false, activeWarehouse = true } = {}) {
  const events = [], queries = []
  const conn = {
    async beginTransaction() { events.push('begin') }, async rollback() { events.push('rollback') }, release() { events.push('release') },
    async query(sql, params = []) {
      queries.push({ sql, params })
      if (sql.includes('FROM operation_requests')) return [missingReceipt ? [] : [{ resource_type: wrongResource ? 'sale_order' : 'purchase_order', resource_id: 81 }]]
      if (sql.includes('FROM purchase_orders')) return [missingOrder ? [] : [{ id: 81, warehouse_id: nullWarehouse ? null : savedWarehouse }]]
      if (sql.includes('FROM inventory_warehouses')) return [missingWarehouse ? [] : [{ id: 8, name: '合成仓', is_active: activeWarehouse ? 1 : 0 }]]
      if (sql.includes('FROM supply_suppliers')) return [[{ is_active: 1 }]]
      if (sql.includes('INSERT INTO purchase_orders')) { events.push('head'); return [{ insertId: 81 }] }
      if (sql.includes('INSERT INTO purchase_order_items')) { events.push('item'); return [{}] }
      if (sql.includes('FROM purchase_order_items'))return [[{id:91,product_id:5,unit:'个',quantity:2,unit_price:1.2345,amount:2.47}]]
      if (sql.startsWith('UPDATE purchase_orders SET cash_basis='))return [{affectedRows:1}]
      throw Error(`未 stub SQL ${sql}`)
    },
  }
  const service = load('modules/purchase/purchase.service.js', {
    '../inbound-tasks/inbound-tasks.short-receipt': shortReceipt, './purchase.close-receipt': closeReceipt,
    '../fulfillment/fulfillment.refresh': { captureDimensions() {}, async commitFulfillment(actual) { assert.equal(actual, conn); events.push('commit') } },
    '../../config/db': { pool: { async getConnection() { return conn } } }, '../../utils/AppError': AppError,
    '../../utils/codeGenerator': { async generateDailyCode() { events.push('number'); return 'PO81' } },
    '../inbound-tasks/inbound-tasks.helpers': {}, '../inbound-tasks/inbound-tasks.query': {}, '../../utils/inboundThresholds': {}, '../../utils/statusTransition': {}, '../../constants/documentStatusRules': {},
    '../../utils/operationRequest': { async beginCreationOperationRequest() { events.push('request'); return { id: 21, enabled: true, replay, responseData: { id: 81, orderNo: 'PO81' } } }, async completeOperationRequest() { events.push('receipt') } },
    '../inbound-tasks/inbound-tasks.settle': {}, '../../utils/unitConversion': { round2: n => Math.round(n * 100) / 100, async foldEntryItems(actual, items) { assert.equal(actual, conn); events.push('fold'); return items.map(item => ({ ...item, entryQty: item.quantity, entryUnit: item.unit, conversionRate: 1, amount: 2.47 })) } },
    '../../utils/warehouseScope': scope, '../../utils/selfApprove': {}, '../../utils/pagination': {}, '../../utils/priceReference': { async getPriceReferenceWarnings() { return [] } }, '../../constants/purchaseOrderStatus': {},
    './purchase.create-receipt': load('modules/purchase/purchase.create-receipt.js', { '../../utils/AppError': AppError, '../../utils/warehouseScope': scope }),
  })
  return { service, conn, events, queries }
}
function noWrite(f) {
  for (const event of ['request', 'head', 'item', 'number', 'fold', 'receipt', 'commit']) assert.ok(!f.events.includes(event), `拒绝不能触发 ${event}`)
}
test('controller 传实际用户范围覆盖正文伪造范围，保留原键和操作人', async () => {
  let actual
  const controller = load('modules/purchase/purchase.controller.js', { './purchase.service': { async create(input) { actual = input; return { id: 81 } } }, '../../utils/response': { successResponse() {} }, '../../utils/operator': { getOperatorFromRequest: () => body.operator }, '../../utils/requestKey': { extractRequestKey: () => 'actual-key' } })
  for (const warehouseIds of [[8], [], null]) {
    await controller.create({ body: { ...body, scopeWarehouseIds: null }, user: { warehouseIds } }, {}, e => { throw e })
    assert.deepEqual(actual.scopeWarehouseIds, warehouseIds)
    assert.equal(actual.requestKey, 'actual-key'); assert.equal(actual.operator.userId, 7)
  }
})
test('限仓/空范围创建外仓先拒绝，不取号、不建回执或业务行', async () => {
  for (const scopeWarehouseIds of [[9], []]) {
    const f = fixture()
    await assert.rejects(f.service.create({ ...body, scopeWarehouseIds }), e => e.statusCode === 403 && e.code === 'WAREHOUSE_SCOPE_DENIED')
    noWrite(f); assert.deepEqual(f.events, ['begin', 'rollback', 'release'])
  }
})
test('本仓与null不限仓沿原数量/价格创建，草稿和明细同事务提交', async () => {
  for (const scopeWarehouseIds of [[8], null]) {
    const f = fixture(), result = await f.service.create({ ...body, scopeWarehouseIds })
    assert.equal(result.id, 81)
    assert.deepEqual(f.events, ['begin', 'request', 'number', 'fold', 'head', 'item', 'receipt', 'commit', 'release'])
    assert.equal(f.queries.find(q => q.sql.includes('INSERT INTO purchase_orders')).params[6], 2.47)
    assert.equal(f.queries.find(q => q.sql.includes('INSERT INTO purchase_order_items')).params[12], 1.2345)
  }
})
test('事务内复用核心亦复核scope，非法计划组不能在已传conn中建采购', async () => {
  const f = fixture()
  await assert.rejects(f.service.createWithinTransaction(f.conn, { ...body, scopeWarehouseIds: [9] }), e => e.statusCode === 403)
  assert.equal(f.queries.length, 0); noWrite(f)
})
test('成功同键回放核当前真实PO仓，允许不重复写、撤范围拒绝', async () => {
  const allow = fixture({ replay: true })
  assert.equal((await allow.service.create({ ...body, scopeWarehouseIds: [8] })).id, 81)
  assert.deepEqual(allow.events, ['begin', 'request', 'rollback', 'release'])
  assert.ok(allow.queries.every(q => /FOR SHARE/.test(q.sql)))
  const moved = fixture({ replay: true, savedWarehouse: 9 })
  await assert.rejects(moved.service.create({ ...body, scopeWarehouseIds: [8] }), e => e.statusCode === 403)
  assert.deepEqual(moved.events, ['begin', 'request', 'rollback', 'release'])
  for (const f of [allow, moved]) assert.ok(!f.queries.some(q => /INSERT|UPDATE/.test(q.sql)))
})
test('旧回执缺准确资源/原单/原仓时failclosed，不从正文猜原结果', async () => {
  for (const options of [{ missingReceipt: true }, { wrongResource: true }, { missingOrder: true }, { nullWarehouse: true }]) {
    const f = fixture({ replay: true, ...options })
    await assert.rejects(f.service.create({ ...body, scopeWarehouseIds: [8] }), e => e.statusCode === 409 && e.code === 'PURCHASE_CREATE_RECEIPT_INVALID')
    assert.deepEqual(f.events, ['begin', 'request', 'rollback', 'release'])
    assert.ok(!f.queries.some(q => /INSERT|UPDATE/.test(q.sql)))
  }
})
test('新建仅选择未删启用仓；历史成功回执不因仓后来停用而重建或拒绝', async () => {
  for (const [options, status] of [[{ missingWarehouse: true }, 404], [{ activeWarehouse: false }, 400]]) {
    const f = fixture(options)
    await assert.rejects(f.service.create({ ...body, scopeWarehouseIds: [8] }), e => e.statusCode === status)
    for (const event of ['head', 'item', 'fold', 'number', 'receipt', 'commit']) assert.ok(!f.events.includes(event))
  }
  const history = fixture({ replay: true, activeWarehouse: false })
  assert.equal((await history.service.create({ ...body, scopeWarehouseIds: [8] })).id, 81)
  assert.ok(!history.queries.some(q => q.sql.includes('FROM inventory_warehouses')))
})
const successReceipt = { status: 'success', resourceType: 'purchase_order', resourceId: 81, data: { id: 81, orderNo: 'PO81' } }
function receiptFixture(saved = { id: 81, warehouse_id: 8 }) {
  const queries = [], db = { async query(sql, params) { queries.push({ sql, params }); return [saved ? [saved] : []] } }
  const guard = load('modules/purchase/purchase.create-receipt.js', { '../../utils/AppError': AppError, '../../utils/warehouseScope': scope })
  return { queries, db, guard }
}
test('本人GET按实际命中create域核scope，不强加VIEW，base/精确/宽prefix均保护', async () => {
  for (const requestedAction of ['purchase.create', 'purchase.create.1234567890abcdef', 'purchase']) {
    const f = receiptFixture(), context = { requestedAction, matchedAction: 'purchase.create.1234567890abcdef' }
    await f.guard.assertPurchaseCreateReceipt(f.db, successReceipt, [8], context)
    await f.guard.assertPurchaseCreateReceipt(f.db, successReceipt, null, context)
    await assert.rejects(f.guard.assertPurchaseCreateReceipt(f.db, successReceipt, [9], context), e => e.statusCode === 403 && e.code === 'WAREHOUSE_SCOPE_DENIED')
    await assert.rejects(f.guard.assertPurchaseCreateReceipt(f.db, successReceipt, [], context), e => e.statusCode === 403)
    assert.ok(f.queries.every(q => /^SELECT/.test(q.sql) && !/FOR SHARE|FOR UPDATE/.test(q.sql)))
  }
})
test('本人GET缺失/不一致身份即409，NULL权限也不能把坏回执当成功', async () => {
  for (const receipt of [{ ...successReceipt, resourceType: 'sale_order' }, { ...successReceipt, resourceId: 0 }, { ...successReceipt, resourceId: true }, { ...successReceipt, data: { id: 82 } }]) {
    const f = receiptFixture()
    await assert.rejects(f.guard.assertPurchaseCreateReceipt(f.db, receipt, null, { matchedAction: 'purchase.create' }), e => e.code === 'PURCHASE_CREATE_RECEIPT_INVALID')
    assert.equal(f.queries.length, 0)
  }
  for (const saved of [null, { id: 82, warehouse_id: 8 }, { id: 81, warehouse_id: null }, { id: 81, warehouse_id: true }]) {
    const f = receiptFixture(saved)
    await assert.rejects(f.guard.assertPurchaseCreateReceipt(f.db, successReceipt, null, { matchedAction: 'purchase.create' }), e => e.statusCode === 409)
  }
})
test('本人GET无原命中/未成功/其它领域不查采购，不编造success', async () => {
  const f = receiptFixture()
  for (const status of ['pending', 'failed', 'not_found']) await f.guard.assertPurchaseCreateReceipt(f.db, { status }, [], { matchedAction: 'purchase.create' })
  for (const matchedAction of [undefined, 'sale.create', 'purchase.requisition.create.1234567890abcdef', 'purchase.create.bad']) await f.guard.assertPurchaseCreateReceipt(f.db, successReceipt, [], { matchedAction })
  assert.equal(f.queries.length, 0)
})
test('计划转采购显式把同一已授权scope和事务传入复用创建核心', async () => {
  const items = [{ id: 11, product_id: 5, warehouse_id: 8, supplier_id: 3, adjusted_qty: 2, status: 1 }, { id: 12, product_id: 6, warehouse_id: 9, supplier_id: 3, adjusted_qty: 2, status: 1 }]
  for (const scopeWarehouseIds of [[8, 9], null, []]) {
    const calls = [], events = [], conn = { async beginTransaction() {}, async rollback() { events.push('rollback') }, async commit() { events.push('commit') }, release() {}, async query(sql) {
      if (sql.includes('SELECT * FROM procurement_plan_items')) return [items]
      if (sql.includes('SELECT COUNT(*)')) return [[{ pending: 0 }]]
      if (sql.startsWith('UPDATE procurement_plan_items')) return [{}]
      throw Error(`未 stub SQL ${sql}`)
    } }
    const planning = load('modules/procurement/procurement.service.js', {
      '../../config/db': { pool: { async getConnection() { return conn } } }, '../../utils/AppError': AppError, '../../utils/warehouseScope': scope,
      '../../utils/statusTransition': { async lockStatusRow() { return { id: 21, status: 1 } }, async compareAndSetStatus() {} }, '../../constants/documentStatusRules': { assertStatusAction() {} },
      '../../utils/operationRequest': { async beginOperationRequest() { return { replay: false } }, async completeOperationRequest() {} }, '../../utils/codeGenerator': {},
      '../inventory/inventory.procurement': { async getProcurementPlan() { return { list: items.map(i => ({ id: `${i.product_id}-${i.warehouse_id}`, netRequirement: 2 })) } } },
      '../purchase/purchase.service': { async createWithinTransaction(actual, input) { assert.equal(actual, conn); calls.push(input); return { id: 81, orderNo: 'PO81' } } },
      './procurement.planning': { async lockPlanning() {}, roundPurchase: n => n }, '../../utils/backendTime': {}, './procurement.policies': { async getPolicy() { return { packMultiple: 1, conversionRate: 1, minimumOrderQty: 0 } } }, '../../utils/pagination': {}, '../../utils/qtyPrecision': {},
    })
    const action = () => planning.convert(21, { itemIds: [11, 12], operator: body.operator, requestKey: 'original-plan', scopeWarehouseIds })
    if (Array.isArray(scopeWarehouseIds) && !scopeWarehouseIds.length) {
      await assert.rejects(action(), e => e.statusCode === 403); assert.equal(calls.length, 0); assert.deepEqual(events, ['rollback'])
    } else {
      await action(); assert.equal(calls.length, 2); for (const input of calls) assert.equal(input.scopeWarehouseIds, scopeWarehouseIds); assert.deepEqual(events, ['commit'])
    }
  }
})
test('真实system控制器使用实际匹配action/本人userId/当前scope核采购回执，撤仓不返回ACK', async () => {
  for (const warehouseIds of [[8], [9]]) {
    const f = receiptFixture(), sent = [], controller = load('modules/system/system.controller.js', {
      '../../utils/AppError': AppError,
      '../../utils/response': { successResponse(_res, data) { sent.push(data) } }, '../../utils/operationRequest': { async getScopedOperationRequestStatus(input) { assert.equal(input.userId, 7); input.receiptContext.matchedAction = 'purchase.create.1234567890abcdef'; return successReceipt } },
      '../packages/packages.receipt-guard': { assertPrintLabelReceiptConsistent() {} }, '../../utils/logger': {},
      '../inbound-tasks/inbound-tasks.create-receipt': { async ensureInboundCreateReceiptView() {}, async assertInboundCreateReceipt() {} },
      '../inbound-tasks/inbound-tasks.edit-receipt': { async ensureInboundEditReceiptView() {}, async assertInboundEditReceipt() {} },
      '../print-jobs/print-jobs.reprint-intent': { async ensureReprintReceiptPermission() {}, async assertReprintReceiptScope() {} }, './system.split-device': { async ensureSplitReceiptDevice() {} },
      '../inventory/inventory.split-receipt': { async assertSplitReceipt() {} }, '../sale/sale.commercial-receipts': { async assertReceiptScope() {} },
      '../purchase/purchase.create-receipt': f.guard, '../../config/db': { pool: f.db },
    })
    let error
    await controller.requestStatus({ params: { key: 'same-key' }, query: { action: 'purchase' }, user: { userId: 7, warehouseIds } }, {}, e => { error = e })
    if (warehouseIds[0] === 8) { assert.equal(error, undefined); assert.equal(sent[0], successReceipt) }
    else { assert.equal(error?.statusCode, 403); assert.equal(sent.length, 0) }
    assert.equal(f.queries.length, 1)
  }
})
test('反向验证：移除实际采购回执范围门，既定403断言会自然失败', async () => {
  const f = receiptFixture()
  const mutant = load('modules/purchase/purchase.create-receipt.js', { '../../utils/AppError': AppError, '../../utils/warehouseScope': scope }, source => {
    const line = "  assertInScope(scopeWarehouseIds, order.warehouse_id, '采购单')"
    assert.equal(source.split(line).length, 2, 'Exactly one actual scope gate is removed only inside this VM')
    return source.replace(line, '')
  })
  await assert.rejects(async () => {
    await assert.rejects(mutant.assertPurchaseCreateReceipt(f.db, successReceipt, [9], { matchedAction: 'purchase.create' }), e => e.statusCode === 403)
  }, e => e.code === 'ERR_ASSERTION' && /Missing expected rejection/.test(e.message))
})
