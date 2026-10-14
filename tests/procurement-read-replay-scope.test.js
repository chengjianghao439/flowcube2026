// Actual functions/controllers with strict SQL boundaries; not HTTP/MySQL evidence.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const base = path.join(__dirname, '../backend/src')
const AppError = require('../backend/src/utils/AppError')
function load(file, deps, transform = source => source) {
  const filename = path.join(base, file), module = { exports: {} }
  vm.runInNewContext(transform(fs.readFileSync(filename, 'utf8')), { module, require: name => {
    if (name === 'node:crypto') return require(name)
    if (Object.hasOwn(deps, name)) return deps[name]
    throw Error(`Unstubbed dependency ${file}: ${name}`)
  } }, { filename })
  return module.exports
}
const scope = load('utils/warehouseScope.js', { '../config/db': {}, './AppError': AppError })
const shortReceipt = load('modules/inbound-tasks/inbound-tasks.short-receipt.js', { '../../utils/AppError': AppError, '../../utils/warehouseScope': scope, './inbound-tasks.cost': require('../backend/src/modules/inbound-tasks/inbound-tasks.cost') })
const closeReceipt = load('modules/purchase/purchase.close-receipt.js', { '../../utils/AppError': AppError, '../../utils/warehouseScope': scope })
const status = load('modules/inbound-tasks/inbound-tasks.status.js', { '../../utils/AppError': AppError, '../print-jobs/print-jobs.service': {}, '../../utils/inboundThresholds': {}, '../../constants/documentStatusRules': {}, './inbound-tasks.cost': require('../backend/src/modules/inbound-tasks/inbound-tasks.cost'), '../../utils/warehouseScope': scope })
function inbound({ taskWarehouse = 8, containerWarehouse = 8, taskExists = true, ownContainer = true } = {}) {
  const calls = [], pool = { async query(sql) {
    calls.push(sql)
    if (sql.includes('FROM inbound_tasks')) return [taskExists ? [{ id: 21, warehouse_id: taskWarehouse }] : []]
    if (sql.includes('FROM inventory_containers WHERE id')) return [[{ id: 11, inbound_task_id: ownContainer ? 21 : 22, product_id: 3, warehouse_id: containerWarehouse, status: 4 }]]
    if (sql.includes('SELECT c.*')) return [[{ id: 11, barcode: 'SYNTHETIC-I11', warehouse_id: containerWarehouse, status: sql.includes('location_id IS NOT NULL') ? 1 : 4 }]]
    if (sql.includes('GROUP BY l.id')) return [[{ locationId: 91, locationCode: 'SYNTHETIC-L91', containerCount: 1 }]]
    throw Error(`Unstubbed SQL ${sql}`)
  } }
  const query = load('modules/inbound-tasks/inbound-tasks.query.js', {
    '../../config/db': { pool }, '../../utils/AppError': AppError, '../../utils/logger': {}, '../../engine/containerEngine': { CONTAINER_STATUS: { ACTIVE: 1, PENDING_PUTAWAY: 4 } },
    '../../utils/inboundThresholds': {}, '../../utils/warehouseScope': scope, '../../utils/pagination': {},
    './inbound-tasks.short-receipt': shortReceipt, './inbound-tasks.helpers': { fmtContainer: row => ({ id: row.id, barcode: row.barcode, warehouseId: row.warehouse_id }) }, './inbound-tasks.status': status, '../print-jobs/print-jobs.service': {},
  })
  const suggestion = load('modules/inbound-tasks/inbound-tasks.suggestion.js', { '../../config/db': { pool }, '../../utils/AppError': AppError, '../../utils/response': { successResponse: (_res, d) => d }, '../../engine/containerEngine': { CONTAINER_STATUS: { ACTIVE: 1 } }, '../../utils/warehouseScope': scope, './inbound-tasks.status': status })
  return { query, suggestion, pool, calls }
}
test('containers真实controller传当前用户scope，不把正文/query冒充范围', async () => {
  let received
  const ctrl = load('modules/inbound-tasks/inbound-tasks.controller.js', { './inbound-tasks.service': { async listContainers(...args) { received = args; return {} } }, '../../utils/response': { successResponse() {} }, '../../utils/operator': {}, '../../utils/requestKey': {} })
  await ctrl.containers({ params: { id: '21' }, user: { warehouseIds: [] }, query: { scopeWarehouseIds: null } }, {}, e => { throw e })
  assert.equal(received[0], 21); assert.deepEqual(received[1], [])
})
test('三种容器列表先核任务仓；越仓或空数组拒绝而不读容器资料', async () => {
  for (const method of ['listContainers', 'listWaitingContainers', 'listStoredContainers']) for (const ids of [[9], []]) {
    const f = inbound()
    await assert.rejects(f.query[method](21, ids), e => e.statusCode === 403 && e.code === 'WAREHOUSE_SCOPE_DENIED')
    assert.equal(f.calls.length, 1)
  }
})
test('合法任务A的当前容器已B，列表整体拒绝而不裁剪成假完整结果', async () => {
  for (const method of ['listContainers', 'listWaitingContainers', 'listStoredContainers']) {
    const f = inbound({ containerWarehouse: 9 })
    await assert.rejects(f.query[method](21, [8]), e => e.statusCode === 403)
  }
})
test('合法任务/容器同仓及null不限仓保留waiting/stored原shape', async () => {
  for (const ids of [[8], null]) {
    const f = inbound(), result = await f.query.listContainers(21, ids)
    assert.equal(result.waiting[0].barcode, 'SYNTHETIC-I11'); assert.equal(result.stored[0].id, 11); assert.equal(f.calls.length, 3)
  }
  await assert.rejects(inbound({ taskExists: false }).query.listContainers(21, [8]), e => e.statusCode === 404)
})
test('上架建议先任务仓、再准确容器归属与当前仓；拒绝不读库位', async () => {
  for (const [options, ids] of [[{}, [9]], [{ containerWarehouse: 9 }, [8]], [{ taskWarehouse: 9 }, [8]], [{}, []]]) {
    const f = inbound(options)
    await assert.rejects(f.suggestion.getPutawaySuggestion(21, 11, ids), e => e.statusCode === 403)
    assert.ok(!f.calls.some(sql => sql.includes('GROUP BY l.id') || sql.includes('FROM warehouse_locations')))
  }
})
test('上架建议合法同仓/null原shape保持，缺任务及错容器仍404/400', async () => {
  for (const ids of [[8], null]) assert.equal((await inbound().suggestion.getPutawaySuggestion(21, 11, ids)).strategy, 'same_product')
  await assert.rejects(inbound({ taskExists: false }).suggestion.getPutawaySuggestion(21, 11, [8]), e => e.statusCode === 404)
  await assert.rejects(inbound({ ownContainer: false }).suggestion.getPutawaySuggestion(21, 11, [8]), e => e.statusCode === 400)
})
test('建议真实handler采用当前scope；执行权限既有读取不新增PDA票据', async () => {
  const f = inbound(); let error
  await f.suggestion.putawaySuggestionHandler({ params: { id: '21' }, query: { containerId: '11' }, user: { warehouseIds: [9] } }, {}, e => { error = e })
  assert.equal(error?.statusCode, 403)
})
const original = { planId: 21, planStatus: 3, createdOrders: [{ purchaseOrderId: 81, orderNo: 'PO81', supplierId: 4, warehouseId: 8, itemCount: 1 }] }
function convertFixture({ sourceWarehouse = 8, poWarehouse = 8, missingSource = false, badReceipt = false } = {}) {
  const calls = [], params = [], events = [], conn = { async beginTransaction() { events.push('begin') }, async rollback() { events.push('rollback') }, release() { events.push('release') }, async query(sql, values = []) {
    calls.push(sql)
    params.push(values)
    if (sql.includes('FROM operation_requests')) return [[{ resource_type: badReceipt ? 'purchase_order' : 'procurement_plan', resource_id: 21 }]]
    if (sql.includes('FROM procurement_plans')) return [[{ id: 21 }]]
    if (sql.includes('FROM procurement_plan_items')) return [missingSource ? [] : [{ id: 11, plan_id: 21, purchase_order_id: 81, warehouse_id: sourceWarehouse, supplier_id: 4, status: 2 }]]
    if (sql.includes('FROM purchase_orders')) return [[{ id: 81, order_no: 'PO81', warehouse_id: poWarehouse, supplier_id: 4 }]]
    throw Error(`Unstubbed SQL ${sql}`)
  } }
  const helperPath = path.join(base, 'modules/procurement/procurement.convert-receipt.js')
  const helper = fs.existsSync(helperPath) ? load('modules/procurement/procurement.convert-receipt.js', { '../../utils/AppError': AppError, '../../utils/warehouseScope': scope }) : {}
  const svc = load('modules/procurement/procurement.service.js', {
    '../../config/db': { pool: { async getConnection() { return conn } } }, '../../utils/AppError': AppError, '../../utils/warehouseScope': scope, '../../utils/statusTransition': {}, '../../constants/documentStatusRules': {},
    '../../utils/operationRequest': { async beginOperationRequest() { events.push('request'); return { id: 31, replay: true, responseData: original } } }, '../../utils/codeGenerator': {}, '../inventory/inventory.procurement': {}, '../purchase/purchase.service': {},
    './procurement.planning': { async lockPlanning() { events.push('planning') } }, '../../utils/backendTime': {}, './procurement.policies': {}, '../../utils/pagination': {}, '../../utils/qtyPrecision': {}, './procurement.convert-receipt': helper,
  })
  return { svc, conn, helper, calls, params, events }
}
test('转采购同原键重放核原转换全部仓，不因计划已完成而拦合法ACK', async () => {
  const input = { itemIds: [11], operator: { userId: 7 }, requestKey: 'original', scopeWarehouseIds: [8] }
  const allow = convertFixture(); assert.equal((await allow.svc.convert(21, input)).createdOrders[0].purchaseOrderId, 81)
  for (const options of [{ sourceWarehouse: 9 }, { poWarehouse: 9 }]) {
    const f = convertFixture(options)
    await assert.rejects(f.svc.convert(21, input), e => e.statusCode === 403)
    assert.deepEqual(f.events, ['begin', 'planning', 'request', 'rollback', 'release'])
    assert.ok(f.calls.every(sql => /^SELECT/.test(sql)))
  }
})
test('转采购撤仓/空数组旧键403，坏资源或缺原转换行409；null沿原准确ACK', async () => {
  for (const ids of [[9], []]) await assert.rejects(convertFixture().svc.convert(21, { itemIds: [11], scopeWarehouseIds: ids }), e => e.statusCode === 403)
  for (const options of [{ missingSource: true }, { badReceipt: true }]) await assert.rejects(convertFixture(options).svc.convert(21, { itemIds: [11], scopeWarehouseIds: [8] }), e => e.statusCode === 409)
  assert.equal((await convertFixture().svc.convert(21, { itemIds: [11], scopeWarehouseIds: null })).planId, 21)
})
test('旧键仅核原已转行，不扩大至未转跨仓计划行；PROC07不同选择明确409', async () => {
  const f = convertFixture()
  await assert.rejects(f.svc.convert(21, { itemIds: [12], scopeWarehouseIds: [8] }), e => e.statusCode === 409 && e.code === 'PROCUREMENT_CONVERT_REQUEST_CONFLICT')
  const index = f.calls.findIndex(sql => sql.includes('FROM procurement_plan_items'))
  assert.match(f.calls[index], /WHERE plan_id=\? AND purchase_order_id IN \(\?\)/)
  assert.equal(f.params[index][0], 21); assert.deepEqual(Array.from(f.params[index][1]), [81])
  assert.ok(f.calls.every(sql => /^SELECT/.test(sql) && /FOR SHARE/.test(sql)))
})
test('公共转采购回执按实际matchedAction和资源核完整原仓，不给其它域或pending/not_found加权', async () => {
  const f = convertFixture(), data = { status: 'success', resourceType: 'procurement_plan', resourceId: 21, data: original }
  for (const requestedAction of ['procurement.plan.convert.21','procurement.plan.convert','procurement']) {
    const context = { requestedAction, matchedAction: 'procurement.plan.convert.21' }
    await f.helper.assertConvertReceipt(f.conn, data, [8], context)
    await assert.rejects(f.helper.assertConvertReceipt(f.conn, data, [9], context), e => e.statusCode === 403)
    await assert.rejects(f.helper.assertConvertReceipt(f.conn, { ...data, resourceId: 22 }, null, context), e => e.code === 'PROCUREMENT_CONVERT_RECEIPT_INVALID')
  }
  const before = f.calls.length
  for (const status of ['pending','failed','not_found']) await f.helper.assertConvertReceipt(f.conn, { status }, [], { matchedAction:'procurement.plan.convert.21' })
  for (const matchedAction of [undefined,'procurement.plan.generate.21','purchase.create']) await f.helper.assertConvertReceipt(f.conn, data, [], { matchedAction })
  assert.equal(f.calls.length,before)
})
test('完整原资源、每组source count/PO身份损坏failclosed，不从请求选择猜原ACK', async () => {
  const data = { status:'success',resourceType:'procurement_plan',resourceId:21,data:original }, context={matchedAction:'procurement.plan.convert.21'}
  for (const altered of [{ ...data, resourceType:'purchase_order' },{ ...data, data:{...original,createdOrders:[]} },{ ...data,data:{...original,createdOrders:[{...original.createdOrders[0],itemCount:2}]} },{ ...data,data:{...original,createdOrders:[{...original.createdOrders[0],orderNo:'WRONG'}]} }]) {
    const f=convertFixture();await assert.rejects(f.helper.assertConvertReceipt(f.conn,altered,null,context),e=>e.statusCode===409)
  }
})
test('反向验证：删除当前真实PO仓范围门，既定403断言自然失败', async () => {
  const f=convertFixture({poWarehouse:9}), mutant=load('modules/procurement/procurement.convert-receipt.js',{'../../utils/AppError':AppError,'../../utils/warehouseScope':scope},source=>{
    const line="    assertInScope(scopeWarehouseIds, order.warehouse_id, '原转换采购单')"
    assert.equal(source.split(line).length,2);return source.replace(line,'')
  })
  await assert.rejects(async()=>{await assert.rejects(mutant.assertConvertResult(f.conn,{resourceType:'procurement_plan',resourceId:21,data:original},[8]),e=>e.statusCode===403)},e=>e.code==='ERR_ASSERTION'&&/Missing expected rejection/.test(e.message))
})
