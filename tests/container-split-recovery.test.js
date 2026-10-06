// 离线真实 service/controller/engine 行为：所有数据库、设备和打印边界均显式 stub。
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const root = path.join(__dirname, '../backend/src')
function load(relative, replacements = {}) {
  const filename = path.join(root, relative)
  const module = { exports: {} }
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module, require: name => Object.hasOwn(replacements, name) ? replacements[name] : require(path.resolve(path.dirname(filename), name)),
  }, { filename })
  return module.exports
}
const clean = value => JSON.parse(JSON.stringify(value))
const warehouseScope = load('utils/warehouseScope.js', { '../config/db': {} })
const result = { sourceContainerId: 11, sourceBarcode: 'I11', sourceRemainingAfter: 7, newContainerId: 12, newBarcode: 'B12', newContainerKind: 'plastic_box', productId: 3, warehouseId: 8, printJobId: null, printJobIds: [], noPrinterCount: 0, renderFailedCount: 0 }
function fixture({ replay = false, warehouse = 8, print = 'ok', sourceStatus = 1, remaining = 10, sourceBarcode = result.sourceBarcode, engineError = null, receiptError = null } = {}) {
  const events = [], calls = []
  const response = { ...result, sourceBarcode }
  const conn = {
    async beginTransaction() { events.push('begin') }, async commit() { events.push('commit') }, async rollback() { events.push('rollback') }, release() { events.push('release') },
    async query(sql, params) {
      calls.push({ sql, params: clean(params || []) })
      if (sql.includes('inventory_logs')) return [[{ warehouse_id: 8, container_id: 11 }, { warehouse_id: 8, container_id: 12 }]]
      if (sql.includes('JOIN product_items')) return [[{ barcode: 'B12', remaining_qty: 3, product_name: '离线商品' }]]
      if (sql.includes('inventory_containers')) return [[{ id: 11, barcode: sourceBarcode, product_id: 3, warehouse_id: warehouse, status: sourceStatus, remaining_qty: remaining, locked_by_task_id: sourceStatus === 2 ? 99 : null }]]
      throw new Error(`未 stub SQL ${sql}`)
    },
  }
  const engine = {
    async lockStockDimension(actual) { assert.equal(actual, conn); events.push('dimension') },
    async splitContainer(actual, body) { assert.equal(actual, conn); events.push('engine'); if (engineError) throw engineError; return { ...response, sourceRemainingAfter: remaining - body.qty, printJobIds: [] } },
  }
  const operations = {
    async beginResourceOperationRequest(actual, body) { assert.equal(actual, conn); assert.equal(body.resourceId, 11); assert.equal(body.resourceType, 'inventory_container'); assert.equal(body.action, 'inventory.container.split'); events.push('receipt'); if (receiptError) throw receiptError; return { enabled: !!body.requestKey, id: 31, replay, responseData: { ...response, printJobIds: [] } } },
    async completeOperationRequest(actual, state, data) { assert.equal(actual, conn); events.push('complete'); assert.equal(data.resourceId, 11); assert.equal(data.data.newBarcode, 'B12') },
  }
  const deps = {
    '../../config/db': { pool: { getConnection: async () => conn } }, '../../engine/containerEngine': engine,
    '../../utils/operationRequest': operations,
    '../../utils/warehouseScope': warehouseScope,
    './inventory.split-receipt': load('modules/inventory/inventory.split-receipt.js', { '../../utils/warehouseScope': warehouseScope }),
    '../print-jobs/print-jobs.service': { enqueueContainerLabelJob: async args => { assert.equal(args.conn, conn); events.push('print'); return { id: 21, unprintable: print !== 'ok', errorMessage: print === 'render' ? 'label render failed: OFFLINE' : 'no printer' } } },
  }
  const serviceDeps = { ...deps, './manual-stock-request': {}, '../../engine/inventoryEngine': {}, './inventoryProjection': {}, '../../utils/expectedStock': {}, '../../utils/qtyPrecision': {} }
  Object.defineProperty(serviceDeps, './inventory.split', { get: () => load('modules/inventory/inventory.split.js', deps) })
  const service = load('modules/inventory/inventory.service.js', serviceDeps)
  return { service, calls, events, conn }
}
test('普通拆分库存、原打印结果、完整回执同conn一次提交；渲染失败不回滚', async () => {
  for (const print of ['ok', 'none', 'render']) {
    const f = fixture({ print })
    const data = await f.service.splitContainerOp(11, { qty: 3, printLabel: true, requestKey: 'original', userId: 9, isPda: true, pdaWarehouseId: 8 }, [8])
    assert.equal(data.sourceBarcode, 'I11'); assert.equal(data.newBarcode, 'B12')
    assert.equal(data.noPrinterCount, print === 'none' ? 1 : 0); assert.equal(data.renderFailedCount, print === 'render' ? 1 : 0)
    assert.deepEqual(clean(data.printJobIds), print === 'ok' ? [21] : [])
    assert.deepEqual(f.events, ['begin', 'dimension', 'receipt', 'engine', 'print', 'complete', 'commit', 'release'])
  }
})
test('重放先于ACTIVE/余量/锁状态闸，当前范围与设备仓仍先于重放', async () => {
  const f = fixture({ replay: true, sourceStatus: 2, remaining: 0 })
  const data = await f.service.splitContainerOp(11, { qty: 3, requestKey: 'original', userId: 9, isPda: true, pdaWarehouseId: 8 }, [8])
  assert.deepEqual(clean(data), result); assert.ok(!f.events.includes('engine')); assert.ok(!f.events.includes('print'))
  for (const options of [{ scope: [], pdaWarehouseId: 8 }, { scope: [8], pdaWarehouseId: 9 }]) {
    const denied = fixture({ replay: true })
    await assert.rejects(denied.service.splitContainerOp(11, { qty: 3, requestKey: 'original', isPda: true, pdaWarehouseId: options.pdaWarehouseId }, options.scope), e => e.statusCode === 403)
    assert.ok(!denied.events.includes('receipt')); assert.ok(denied.events.includes('rollback'))
  }
})
test('普通PC既有非数字库存条码与任意稳定键，首次成功后回放/本人查询仍成功且精确核流水身份', async () => {
  const sourceBarcode = 'F6SRC-6b6e51ec-114cba62', requestKey = '6b6e51ec-split-A'
  const fresh = fixture({ sourceBarcode })
  const first = await fresh.service.splitContainerOp(11, { qty: 3, requestKey, userId: 9 }, [8])
  const replay = fixture({ sourceBarcode, replay: true, remaining: 7 })
  assert.deepEqual(clean(await replay.service.splitContainerOp(11, { qty: 3, requestKey, userId: 9 }, [8])), clean(first))
  assert.ok(!replay.events.includes('engine')); assert.ok(!replay.events.includes('print'))
  const log = replay.calls.find(call => call.sql.includes('inventory_logs'))
  assert.match(log.sql, /FOR SHARE/); assert.equal(log.params[5], sourceBarcode)
  assert.equal(log.params[4], 11); assert.equal(log.params[6], 12); assert.equal(log.params[7], 'B12')
  const receipt = await receiptFixture({ data: first }).run()
  assert.equal(receipt.error, undefined); assert.deepEqual(clean(receipt.output.data.data), clean(first))
  const missing = await receiptFixture({ data: first, logs: false }).run()
  assert.equal(missing.error?.code, 'CONTAINER_SPLIT_RECEIPT_INVALID')
  const denied = await receiptFixture({ data: first, scope: [] }).run()
  assert.equal(denied.error?.statusCode, 403)
})
test('既有来源码兼容仍拒绝空/超界码、伪造ID/条码/原仓、目标或缺失流水', async () => {
  const sourceBarcode = 'F6SRC-6b6e51ec-114cba62', data = { ...result, sourceBarcode }
  const guard = load('modules/inventory/inventory.split-receipt.js', { '../../utils/warehouseScope': warehouseScope })
  const conn = { async query(sql, params) {
    assert.match(sql, /c\.id=\? AND c\.barcode=\?/)
    return [params[0] === 11 && params[2] === 3 && params[3] === 8 && params[4] === 11 && params[5] === sourceBarcode && params[6] === 12 && params[7] === 'B12' ? [{ container_id: 11, warehouse_id: 8 }, { container_id: 12, warehouse_id: 8 }] : []]
  } }
  const receipt = { status: 'success', resourceType: 'inventory_container', resourceId: 11, data }
  const context = { matchedAction: 'inventory.container.split.11', currentRead: true }
  await guard.assertSplitReceipt(conn, receipt, [8], context)
  for (const changed of [{ sourceBarcode: '' }, { sourceBarcode: '   ' }, { sourceBarcode: null }, { sourceBarcode: 'A'.repeat(65) }, { sourceBarcode: 'F6FAKE' }, { sourceContainerId: 13 }, { newContainerId: 11 }, { newBarcode: 'B99' }, { newContainerKind: 'whole' }, { warehouseId: 9 }]) {
    await assert.rejects(guard.assertSplitReceipt(conn, { ...receipt, data: { ...data, ...changed } }, [8,9], context), error => error.code === 'CONTAINER_SPLIT_RECEIPT_INVALID')
  }
  await assert.rejects(guard.assertSplitReceipt(conn, receipt, [8], { matchedAction: 'inventory.container.split.99' }), error => error.code === 'CONTAINER_SPLIT_RECEIPT_INVALID')
})
test('PDA空或非法设备仓在新写与旧键回放前拒绝，不能退化为PC不限仓', async () => {
  for (const replay of [false, true]) for (const pdaWarehouseId of [null, undefined, 0, -1, NaN, 1.5]) {
    const f = fixture({ replay })
    await assert.rejects(f.service.splitContainerOp(11, { qty: 3, requestKey: 'original', userId: 9, isPda: true, pdaWarehouseId }, [8]), e => e.statusCode === 403 && e.code === 'PDA_WAREHOUSE_REQUIRED')
    assert.ok(!f.events.includes('receipt')); assert.ok(!f.events.includes('engine')); assert.ok(!f.events.includes('print')); assert.ok(!f.events.includes('commit'))
  }
})
test('重复请求旧RR快照在等锁后仍可核首请求新回执；本人独立查询保持非锁读', async () => {
  const calls = [], events = []
  let snapshotBeforeCommit = false, firstCommitted = false, releaseDimension, reachedDimension
  const dimensionWait = new Promise(resolve => { releaseDimension = resolve })
  const dimensionReached = new Promise(resolve => { reachedDimension = resolve })
  const guard = load('modules/inventory/inventory.split-receipt.js', { '../../utils/warehouseScope': warehouseScope })
  const logs = [{ container_id: 11, warehouse_id: 8 }, { container_id: 12, warehouse_id: 8 }]
  const conn = {
    async beginTransaction() { events.push('begin') }, async commit() { events.push('commit') },
    async rollback() { events.push('rollback') }, release() { events.push('release') },
    async query(sql, params) {
      calls.push({ sql, params: clean(params || []) })
      if (sql.includes('inventory_logs')) return [firstCommitted && (!snapshotBeforeCommit || /FOR SHARE|FOR UPDATE/.test(sql)) ? logs : []]
      if (sql.includes('FOR UPDATE')) { assert.equal(firstCommitted, true); return [[{ id: 11, barcode: 'I11', product_id: 3, warehouse_id: 8, remaining_qty: 7 }]] }
      snapshotBeforeCommit = !firstCommitted
      return [[{ product_id: 3, warehouse_id: 8 }]]
    },
  }
  const service = load('modules/inventory/inventory.split.js', {
    '../../config/db': { pool: { getConnection: async () => conn } }, '../../utils/warehouseScope': warehouseScope,
    './inventory.split-receipt': guard,
    '../../engine/containerEngine': {
      async lockStockDimension(actual) { assert.equal(actual, conn); events.push('dimension-wait'); reachedDimension(); await dimensionWait; events.push('dimension-held') },
      async splitContainer() { throw new Error('成功重放不得再次拆分') },
    },
    '../../utils/operationRequest': {
      async beginResourceOperationRequest(actual) { assert.equal(actual, conn); assert.equal(firstCommitted, true); events.push('receipt-current-read'); return { enabled: true, id: 31, replay: true, action: 'inventory.container.split.11', responseData: result } },
      async completeOperationRequest() { throw new Error('成功重放不得重写回执') },
    },
    '../print-jobs/print-jobs.service': { async enqueueContainerLabelJob() { throw new Error('成功重放不得重印') } },
  })
  const pending = service.splitContainerOp(11, { qty: 3, requestKey: 'original', userId: 9, isPda: true, pdaWarehouseId: 8 }, [8])
  await dimensionReached
  assert.equal(snapshotBeforeCommit, true)
  firstCommitted = true
  releaseDimension()
  assert.deepEqual(clean(await pending), result)
  assert.deepEqual(events, ['begin', 'dimension-wait', 'dimension-held', 'receipt-current-read', 'commit', 'release'])
  assert.ok(!/FOR SHARE|FOR UPDATE/.test(calls[0].sql), '探维度不得提前锁容器')
  assert.match(calls.find(call => call.sql.includes('inventory_logs')).sql, /FOR SHARE|FOR UPDATE/)
  let freshSql
  await guard.assertSplitReceipt({ async query(sql) { freshSql = sql; return [logs] } }, { status: 'success', resourceType: 'inventory_container', resourceId: 11, data: result }, [8], { matchedAction: 'inventory.container.split.11' })
  assert.ok(!/FOR SHARE|FOR UPDATE/.test(freshSql), '本人fresh查询不继承写事务锁读')
})
test('PDA缺请求键和全量均拒绝；旧PC无键合法全量保留', async () => {
  const noKey = fixture()
  await assert.rejects(noKey.service.splitContainerOp(11, { qty: 3, isPda: true, pdaWarehouseId: 8 }, [8]), e => e.statusCode === 400)
  const full = fixture()
  await assert.rejects(full.service.splitContainerOp(11, { qty: 10, requestKey: 'original', isPda: true, pdaWarehouseId: 8 }, [8]), /小于/)
  const pc = fixture()
  assert.equal((await pc.service.splitContainerOp(11, { qty: 10, userId: 9 }, [8])).sourceRemainingAfter, 0)
})
test('只为新请求业务拒绝且成功rollback提供未执行证据；幂等待确认冲突不伪造失败', async () => {
  const AppError = require('../backend/src/utils/AppError')
  const f = fixture({ engineError: new AppError('个体条码不可拆分', 400, 'INDIVIDUAL_CONTAINER_NO_SPLIT') })
  await assert.rejects(f.service.splitContainerOp(11, { qty: 3, requestKey: 'original', userId: 9, isPda: true, pdaWarehouseId: 8 }, [8]), e => e.code === 'INDIVIDUAL_CONTAINER_NO_SPLIT' && e.data?.containerSplitNotExecuted === true)
  assert.ok(f.events.includes('rollback')); assert.ok(!f.events.includes('complete')); assert.ok(!f.events.includes('commit'))
  const pending = fixture({ receiptError: new AppError('上次提交结果仍待确认', 409, 'OPERATION_REQUEST_PENDING') })
  await assert.rejects(pending.service.splitContainerOp(11, { qty: 3, requestKey: 'original', userId: 9 }, [8]), e => e.code === 'OPERATION_REQUEST_PENDING' && !e.data?.containerSplitNotExecuted)
})
test('真实引擎拒绝目标为来源自身，拒绝前没有任何库存写；不同盒合法全量守恒', async () => {
  const writes = []
  const source = { id: 11, barcode: 'B11', product_id: 3, warehouse_id: 8, remaining_qty: 30, status: 1, container_type: 2, initial_qty: 30 }
  const target = { ...source, id: 12, barcode: 'B12', remaining_qty: 0 }
  const conn = { async query(sql, params) {
    if (sql.includes('SUM(remaining_qty)')) return [[{ total: 30 }]]
    if (sql.includes('SELECT quantity FROM inventory_stock')) return [[{ quantity: 30 }]]
    if (/^SELECT/.test(sql.trim())) return [[params[0] === 12 ? target : source]]
    writes.push({ sql, params }); return [{ affectedRows: 1, insertId: 22 }]
  } }
  const engine = load('engine/containerEngine.js', { '../utils/logger': {}, '../utils/codeGenerator': {}, '../utils/expectedStock': {}, '../utils/qtyPrecision': { assertQtyScale: () => {}, assertQtyPrecision: async () => {} }, './inventoryEngine': { MOVE_TYPE: { CONTAINER_SPLIT: 9 } } })
  await assert.rejects(engine.splitContainer(conn, { containerId: 11, targetContainerId: 11, qty: 20 }), e => e.code === 'CONTAINER_SELF_MERGE_FORBIDDEN')
  assert.equal(writes.length, 0)
  const data = await engine.splitContainer(conn, { containerId: 11, targetContainerId: 12, qty: 30 })
  assert.equal(data.sourceRemainingAfter, 0); assert.equal(data.targetQtyAfter, 30); assert.equal(data.newContainerId, 12)
})
function receiptFixture({ warehouse = 8, scope = [8], requested = 'inventory.container.split.11', data = result, device = null, logs = true } = {}) {
  let error, output, validations = 0
  const pool = { async query(sql) { if (sql.includes('inventory_logs')) return [logs ? [{ warehouse_id: warehouse, container_id: 11 }, { warehouse_id: warehouse, container_id: 12 }] : []]; throw new Error('回执不得依赖之后调拨的当前容器量/仓/状态') } }
  const controller = load('modules/system/system.controller.js', {
    '../../utils/operationRequest': { getScopedOperationRequestStatus: async options => { options.receiptContext.matchedAction = 'inventory.container.split.11'; return { status: 'success', resourceType: 'inventory_container', resourceId: 11, data } } },
    '../../config/db': { pool }, '../sale/sale.commercial-receipts': { assertReceiptScope: async () => {} }, '../packages/packages.receipt-guard': { assertPrintLabelReceiptConsistent: () => {} }, '../../utils/logger': {},
    '../inventory/inventory.split-receipt': { assertSplitReceipt: (...args) => load('modules/inventory/inventory.split-receipt.js', { '../../utils/warehouseScope': warehouseScope }).assertSplitReceipt(...args) },
    './system.split-device': { ensureSplitReceiptDevice: async req => { validations++; req.pda = device } },
  })
  const req = { params: { key: 'original' }, query: { action: requested }, user: { userId: 9, warehouseIds: scope } }
  const res = { status() { return this }, json(value) { output = value } }
  return { async run() { await controller.requestStatus(req, res, e => { error = e }); return { error, output, validations } } }
}
test('新split原回执核原流水仓/真实身份；后续调拨或EMPTY不会改原快照', async () => {
  const valid = await receiptFixture().run(); assert.equal(valid.error, undefined); assert.equal(valid.output.data.data.sourceRemainingAfter, 7)
  const denied = await receiptFixture({ scope: [] }).run(); assert.equal(denied.error?.statusCode, 403)
  const missing = await receiptFixture({ logs: false }).run(); assert.equal(missing.error?.statusCode, 409)
  const wrong = await receiptFixture({ data: { ...result, sourceContainerId: 99 } }).run(); assert.equal(wrong.error?.statusCode, 409)
})
test('宽action命中split也不能绕领域/device闸，不需要新增执行权限', async () => {
  const denied = await receiptFixture({ requested: 'inventory', device: { warehouseId: 9 } }).run()
  assert.equal(denied.error?.statusCode, 403); assert.equal(denied.validations, 1)
})
test('split本人查询保留PC及正设备仓，NULL设备仓含宽action查询均不能拿成功回执', async () => {
  for (const requested of ['inventory.container.split.11', 'inventory']) {
    const empty = await receiptFixture({ requested, device: { warehouseId: null } }).run()
    assert.equal(empty.error?.statusCode, 403); assert.equal(empty.error?.code, 'PDA_WAREHOUSE_REQUIRED'); assert.equal(empty.output, undefined)
    const good = await receiptFixture({ requested, device: { warehouseId: 8 } }).run()
    assert.equal(good.error, undefined); assert.equal(good.output.data.data.sourceRemainingAfter, 7)
  }
  const pc = await receiptFixture().run()
  assert.equal(pc.error, undefined)
})
function deviceFixture() {
  const calls = []
  const middleware = load('middleware/pdaSession.js', {
    '../config/db': { pool: { async query(sql) {
      calls.push(sql)
      if (sql.startsWith('UPDATE')) return [{ affectedRows: 1 }]
      return [[{ session_id: 31, device_id: 32, user_id: 9, device_code: 'OFFLINE-PDA', session_warehouse_id: 8, device_warehouse_id: 8, device_status: 'active', expires_at: new Date(Date.now() + 60000), revoked_at: null }]]
    } } },
    '../utils/logger': { warn() {}, info() {}, error() {} },
    '../modules/pda/pda.sessions.service': { hashToken: token => token, normalizeScopes: () => [] },
  })
  const gate = load('modules/system/system.split-device.js', { '../../middleware/pdaSession': middleware, '../inventory/inventory.split-receipt': load('modules/inventory/inventory.split-receipt.js', { '../../utils/warehouseScope': warehouseScope }) })
  return { calls, gate, middleware }
}
const runMiddleware = (fn, req) => new Promise((resolve, reject) => fn(req, {}, error => error ? reject(error) : resolve()))
test('真实PDA可选设备闸仅已知库存scope领域启用；宽匹配也核票据，其它领域与PC契约保留', async () => {
  const f = deviceFixture()
  const req = { headers: { 'x-client': 'pda' }, user: { userId: 9 }, query: { action: 'inventory.container.split.11' } }
  await assert.rejects(runMiddleware(f.gate.splitReceiptDevice, req), e => e.code === 'PDA_SESSION_REQUIRED')
  req.headers['x-pda-session'] = 'offline-ticket'
  await runMiddleware(f.gate.splitReceiptDevice, req)
  assert.equal(req.pda.warehouseId, 8); assert.equal(f.calls.filter(sql => sql.startsWith('UPDATE')).length, 2)
  await f.gate.ensureSplitReceiptDevice(req, {}, 'inventory.container.split.11')
  assert.equal(f.calls.length, 3, '同次请求不重复设备读取或last_seen元数据写')
  const broad = { headers: { 'x-client': 'pda' }, user: { userId: 9 }, query: { action: 'inventory' } }
  await runMiddleware(f.gate.splitReceiptDevice, broad)
  await assert.rejects(f.gate.ensureSplitReceiptDevice(broad, {}, 'inventory.container.split.11'), e => e.statusCode === 403)
  for (const action of ['plastic_box.fill', 'plastic_box.fill.11', 'plastic_box.repack', 'plastic_box.repack.11']) {
    await assert.rejects(runMiddleware(f.gate.splitReceiptDevice, { ...broad, query: { action } }), e => e.code === 'PDA_SESSION_REQUIRED')
  }
  for (const action of ['supplier_refund.receive.11', 'disposal.dispose.11']) {
    await runMiddleware(f.gate.splitReceiptDevice, { ...broad, query: { action } })
  }
  const pc = { headers: {}, user: { userId: 9 }, query: { action: 'inventory.container.split.11' } }
  await runMiddleware(f.gate.splitReceiptDevice, pc); assert.equal(pc.pda, null)
})
test('真实split路由保留写权限并委派原键、完整body、设备仓和当前范围；查询路由不加执行权', async () => {
  const f = deviceFixture(), delegated = []
  const controller = load('modules/inventory/inventory.controller.js', {
    './inventory.service': { splitContainerOp: async (...args) => { delegated.push(clean(args)); return result } },
    './inventory.aging': {}, './inventory.procurement': {}, './inventory.reservations': {}, '../../utils/operator': {},
  })
  const permissions = require('../backend/src/constants/permissions').PERMISSIONS
  const auth = { authMiddleware: () => {}, requirePermission: code => (req, res, next) => req.permissions.includes(code) ? next() : next(new Error('写权限已撤回')) }
  const router = load('modules/inventory/inventory.routes.js', {
    express: require('../backend/node_modules/express'), zod: require('../backend/node_modules/zod'),
    './inventory.controller': controller, '../../middleware/auth': auth, '../../middleware/pdaSession': f.middleware,
  })
  const handlers = router.stack.find(layer => layer.route?.path === '/containers/:id/split').route.stack.map(layer => layer.handle)
  async function invoke(req) {
    let output
    const res = { status() { return this }, json(data) { output = data } }
    for (const handle of handlers) {
      if (handle === controller.splitContainer) await handle(req, res, error => { if (error) throw error })
      else await new Promise((resolve, reject) => handle(req, res, error => error ? reject(error) : resolve()))
    }
    return output
  }
  const req = { params: { id: '11' }, body: { qty: 3, remark: '原备注', printLabel: true, targetContainerId: 12 }, headers: { 'x-client': 'pda', 'x-pda-session': 'offline-ticket', 'x-request-key': ' original ' }, user: { userId: 9, realName: '离线员工', warehouseIds: [8] }, permissions: [permissions.INVENTORY_CONTAINER_SPLIT] }
  assert.equal((await invoke(req)).data.sourceBarcode, 'I11')
  assert.deepEqual(delegated[0], [11, { qty: 3, remark: '原备注', printLabel: true, targetContainerId: 12, userId: 9, userName: '离线员工', requestKey: 'original', isPda: true, pdaWarehouseId: 8 }, [8]])
  await assert.rejects(invoke({ ...req, permissions: [] }), /写权限已撤回/); assert.equal(delegated.length, 1)
  await assert.rejects(invoke({ ...req, headers: { 'x-client': 'pda' } }), e => e.statusCode === 403); assert.equal(delegated.length, 1)
  const statusRouter = load('modules/system/system.routes.js', {
    express: require('../backend/node_modules/express'), zod: require('../backend/node_modules/zod'),
    './system.controller': { requestStatus() {}, reportError() {} }, '../../middleware/auth': { authMiddleware() {}, requirePermission() { throw new Error('本人查询不得要求执行权') } }, './system.split-device': f.gate,
  })
  assert.ok(statusRouter.stack.some(layer => layer.route?.path === '/request-status/:key'))
})
