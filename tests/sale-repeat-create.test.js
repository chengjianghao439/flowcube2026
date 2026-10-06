// 真实销售创建/路由/控制器，只有数据库及依赖业务边界stub；不启动HTTP或数据库。
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const base = path.join(__dirname, '../backend/src')
const AppError = require('../backend/src/utils/AppError')
function load(file, replacements) {
  const filename = path.join(base, file), module = { exports: {} }
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module, require: name => Object.hasOwn(replacements, name) ? replacements[name] : {} }, { filename })
  return module.exports
}
function creation({ late = false, replay = false, rollbackFails = false, pending = false, storedReplay = false, storedHead = 8, storedLines = [9], missingResource = false } = {}) {
  const events = [], queries = []
  const conn = {
    async beginTransaction() { events.push('begin') }, async rollback() { events.push('rollback'); if (rollbackFails) throw Error('rollback lost') }, release() { events.push('release') },
    async query(sql) {
      queries.push(sql)
      if (sql.includes('FROM sale_customers')) return [[{ id: 4, name: '当前客户', is_active: late ? 1 : 0 }]]
      if (sql.includes('FROM inventory_warehouses')) return [[{ id: 8, name: '当前仓', is_active: 1 }]]
      if (sql.includes('FROM product_items')) return [[]]
      if (sql.includes('INSERT INTO sale_orders')) return [{ insertId: 81 }]
      if (sql.includes('INSERT INTO sale_order_events')) return [{}]
      if (sql.includes('FROM operation_requests')) return [missingResource ? [] : [{ resource_type: storedReplay ? 'sale_order' : 'wrong', resource_id: 81 }]]
      if (sql.includes('FROM sale_orders')) return [storedHead == null ? [] : [{ id: 81, warehouse_id: storedHead, commercial_model: null }]]
      if (sql.includes('FROM sale_order_items')) return [storedLines.map(warehouse_id => ({ warehouse_id }))]
      throw Error(`未stub SQL ${sql}`)
    },
  }
  const svc = load('modules/sale/sale.service.js', {
    '../../config/db': { pool: { getConnection: async () => conn } }, '../../utils/AppError': AppError,
    '../../utils/warehouseScope': storedReplay ? realScope : { assertInScope: () => {} }, '../../constants/settlementType': { SETTLEMENT_TYPE: { CASH: 1 } },
    './sale.commercial-store': { assertRequestKey: () => {} }, './sale.items': { insertSaleItems: async () => {} },
    '../../utils/unitConversion': { round2: n => n, foldEntryItems: async () => [] }, '../../utils/codeGenerator': { generateDailyCode: async () => 'S81' },
    './sale.contracts': { assertDiscountWithinTotal: () => {} },
    '../../utils/operationRequest': { beginCreationOperationRequest: async () => { if (pending) throw new AppError('处理中', 409, 'OPERATION_REQUEST_PENDING'); return { enabled: true, id: 1, replay, responseData: { id: 81, orderNo: 'S81' } } }, completeOperationRequest: async () => events.push('receipt') },
    '../fulfillment/fulfillment.refresh': { commitFulfillment: async () => { events.push('commit-started'); throw new AppError('提交阶段未知', 409, 'COMMIT_UNKNOWN') } },
  })
  return { svc, events, queries }
}
const input = { customerId: 4, warehouseId: 8, items: [], operator: { userId: 9 }, requestKey: 'original' }
test('重复创建首发事务明确回滚，返回修正出口；旧普通创建契约不变', async () => {
  const f = creation()
  await assert.rejects(f.svc.create({ ...input, repeatCreate: true }), e => e.statusCode === 400 && e.data?.saleCreateNotExecuted === true)
  assert.deepEqual(f.events, ['begin', 'rollback', 'release'])
  await assert.rejects(creation().svc.create(input), e => e.statusCode === 400 && !e.data?.saleCreateNotExecuted)
})
test('待处理/回放领域拒绝/提交开始后/回滚失败均不能声称未执行', async () => {
  for (const options of [{ pending: true }, { replay: true }, { late: true }, { rollbackFails: true }]) {
    await assert.rejects(creation(options).svc.create({ ...input, repeatCreate: true, ...(options.replay ? { commercialModel: 'kit-v1' } : {}) }), e => !e.data?.saleCreateNotExecuted)
  }
})
test('来源GET保留SALE_VIEW原路由门；控制器只委派原scope与严格rawId', async () => {
  const registrations = [], permission = code => Object.assign(() => {}, { code }), ctrl = { reorderSource: () => {} }
  const router = { use() {}, get: (p, ...handlers) => registrations.push({ p, handlers }), post() {}, put() {}, delete() {} }
  load('modules/sale/sale.routes.js', { express: { Router: () => router }, './sale.controller': ctrl, '../../middleware/auth': { authMiddleware() {}, requirePermission: permission }, '../../constants/permissions': { PERMISSIONS: { SALE_ORDER_VIEW: 'sale.order.view' } }, '../../utils/route': { validateBody: () => () => {} } })
  const route = registrations.find(r => r.p === '/:id/reorder-source')
  assert.equal(route.handlers[0].code, 'sale.order.view'); assert.equal(route.handlers[1], ctrl.reorderSource)
  let args, sent
  const controller = load('modules/sale/sale.controller.js', { './sale.service': {}, './sale.reorder-source': { findReorderSource: async (...a) => { args = a; return { id: 80 } } }, '../../utils/response': { successResponse: (_res, d) => { sent = d } } })
  await controller.reorderSource({ params: { id: '080' }, user: { warehouseIds: [] } }, {}, e => { throw e })
  assert.equal(args[0], '080'); assert.deepEqual(args[1], []); assert.equal(sent.id, 80)
})
test('创建opt-in只读header，不信body冒充，原key/operator/scope保留', async () => {
  let input
  const controller = load('modules/sale/sale.controller.js', { './sale.service': { create: async p => { input = p; return { id: 81 } } }, '../../utils/response': { successResponse: () => {} }, '../../utils/operator': { getOperatorFromRequest: () => ({ userId: 9 }) }, '../../utils/requestKey': { extractRequestKey: () => 'original' } })
  for (const header of [undefined, '1']) {
    await controller.create({ body: { repeatCreate: true }, get: () => header, user: { warehouseIds: [] } }, {}, e => { throw e })
    assert.equal(input.repeatCreate, header === '1'); assert.equal(input.requestKey, 'original'); assert.equal(input.operator.userId, 9); assert.deepEqual(input.scopeWarehouseIds, [])
  }
})
const realScope = load('utils/warehouseScope.js', { '../config/db': {}, './AppError': AppError })
test('普通create同原载荷重放核已存头仓及全部行当前scope，不新建订单', async () => {
  const original = { ...input, repeatCreate: true, items: [{ productId: 11, quantity: 1, warehouseId: 9 }] }
  const allowed = creation({ replay: true, storedReplay: true })
  assert.equal((await allowed.svc.create({ ...original, scopeWarehouseIds: [8, 9] })).id, 81)
  const denied = creation({ replay: true, storedReplay: true })
  await assert.rejects(denied.svc.create({ ...original, scopeWarehouseIds: [8] }), e => e.statusCode === 403 && !e.data?.saleCreateNotExecuted)
  const movedHead = creation({ replay: true, storedReplay: true, storedHead: 9, storedLines: [8] })
  await assert.rejects(movedHead.svc.create({ ...original, scopeWarehouseIds: [8] }), e => e.statusCode === 403)
  for (const f of [allowed, denied, movedHead]) {
    assert.ok(!f.queries.some(sql => sql.includes('INSERT')))
    assert.ok(!f.queries.some(sql => sql.includes('FROM sale_customers')), 'replay does not rehydrate or price the old order')
    assert.deepEqual(f.events, ['begin', 'rollback', 'release'])
  }
})
test('普通create重放缺原resource或存储单头failclosed而不编造成功', async () => {
  for (const options of [{ missingResource: true }, { storedHead: null }]) {
    const f = creation({ replay: true, storedReplay: true, ...options })
    await assert.rejects(f.svc.create({ ...input, scopeWarehouseIds: [8, 9] }), e => e.statusCode === 409)
    assert.ok(!f.queries.some(sql => sql.includes('INSERT')))
  }
})
const createReceipt = { status: 'success', resourceType: 'sale_order', resourceId: 81, data: { id: 81, orderNo: 'S81' } }
const createContext = { requestedAction: 'sale.create', matchedAction: 'sale.create.1234567890abcdef' }
function receiptFixture(rows = [{ id: 81, commercial_model: null, head_warehouse_id: 8, warehouse_id: 8 }]) {
  const queries = [], pool = { query: async (sql, params) => { queries.push({ sql, params }); return [rows] } }
  const guard = load('modules/sale/sale.commercial-receipts.js', { '../../utils/warehouseScope': realScope, '../../utils/AppError': AppError })
  return { pool, guard, queries }
}
test('普通sale.create本人成功回执核完整头仓及每行当前范围，空范围拒绝且NULL全仓', async () => {
  const f = receiptFixture()
  await f.guard.assertReceiptScope(f.pool, createReceipt, [8], createContext)
  await assert.rejects(f.guard.assertReceiptScope(f.pool, createReceipt, [], createContext), e => e.statusCode === 403)
  for (const rows of [[{ id: 81, commercial_model: null, head_warehouse_id: 9, warehouse_id: 8 }], [{ id: 81, commercial_model: null, head_warehouse_id: 8, warehouse_id: 9 }]]) {
    const bad = receiptFixture(rows); await assert.rejects(bad.guard.assertReceiptScope(bad.pool, createReceipt, [8], createContext), e => e.statusCode === 403)
  }
  await f.guard.assertReceiptScope(f.pool, createReceipt, null, createContext)
  assert.equal(f.queries[0].params[0], 81)
})
test('create回执缺原资源/错类型ID/宽请求或不匹配action必须failclosed；pending/not_found不编造成功', async () => {
  for (const value of [{ ...createReceipt, resourceType: 'purchase_order' }, { ...createReceipt, resourceId: 0 }, { ...createReceipt, data: { id: 82 } }]) {
    const f = receiptFixture(); await assert.rejects(f.guard.assertReceiptScope(f.pool, value, [8], createContext), e => e.code === 'SALE_CREATE_RECEIPT_INVALID')
  }
  for (const context of [{ ...createContext, requestedAction: 'sale' }, { ...createContext, matchedAction: 'sale.adjust.81' }, { ...createContext, requestedAction: 'sale.create.aaaaaaaaaaaaaaaa' }]) {
    const f = receiptFixture(); await assert.rejects(f.guard.assertReceiptScope(f.pool, createReceipt, [8], context), e => e.code === 'SALE_CREATE_RECEIPT_INVALID')
  }
  const missing = receiptFixture([]); await assert.rejects(missing.guard.assertReceiptScope(missing.pool, createReceipt, [8], createContext), e => e.code === 'SALE_CREATE_RECEIPT_INVALID')
  const f = receiptFixture()
  for (const status of ['pending', 'not_found']) await f.guard.assertReceiptScope(f.pool, { status, data: null }, [], createContext)
  assert.equal(f.queries.length, 0)
})
test('真实本人status控制器传原action匹配和当前scope，普通create越仓不返回成功；其它旧动作不加权', async () => {
  const f = receiptFixture([{ id: 81, commercial_model: null, head_warehouse_id: 8, warehouse_id: 9 }])
  const controller = load('modules/system/system.controller.js', {
    '../../utils/operationRequest': { getScopedOperationRequestStatus: async input => { assert.equal(input.userId, 9); input.receiptContext.matchedAction = createContext.matchedAction; return createReceipt } },
    '../../config/db': { pool: f.pool }, '../sale/sale.commercial-receipts': f.guard,
    './system.split-device': { ensureSplitReceiptDevice: async () => {} }, '../inventory/inventory.split-receipt': { assertSplitReceipt: async () => {} },
    '../packages/packages.receipt-guard': { assertPrintLabelReceiptConsistent: () => {} }, '../../utils/response': { successResponse: () => { throw Error('越仓不得成功') } },
  })
  let error
  await controller.requestStatus({ params: { key: 'original' }, query: { action: 'sale.create' }, user: { userId: 9, warehouseIds: [8] } }, {}, e => { error = e })
  assert.equal(error?.statusCode, 403)
  const old = receiptFixture([{ commercial_model: null, head_warehouse_id: 9, warehouse_id: 9 }])
  await old.guard.assertReceiptScope(old.pool, createReceipt, [8], { requestedAction: 'sale.ship', matchedAction: 'sale.ship.81' })
})
