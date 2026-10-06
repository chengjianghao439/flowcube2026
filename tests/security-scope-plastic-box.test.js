// 真实 service/controller 离线执行；RR 快照与锁后当前读明确区分，库存写、打印与幂等均可观察。
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const base = path.join(__dirname, '../backend/src')
function load(relative, deps) {
  const filename = path.join(base, relative), module = { exports: {} }
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module, require: name => Object.hasOwn(deps, name) ? deps[name] : require(path.resolve(path.dirname(filename), name)) }, { filename })
  return module.exports
}
const scope = load('utils/warehouseScope.js', { '../config/db': {} })
const clean = value => JSON.parse(JSON.stringify(value))
function fixture({ replay = false, drift = false } = {}) {
  const events = [], calls = []
  let currentWarehouse = 8
  const row = warehouse => ({ id: 11, barcode: 'B11', product_id: 3, warehouse_id: warehouse, remaining_qty: 10, status: 1, locked_by_task_id: null, container_type: 2, initial_qty: 10, is_mixed_batch: 0, unit: '件' })
  const conn = {
    async beginTransaction() { events.push('begin') }, async rollback() { events.push('rollback') }, async commit() { events.push('commit') }, release() { events.push('release') },
    async query(sql, params = []) {
      calls.push({ sql, params: clean(params) })
      if (/^UPDATE/.test(sql.trim())) { events.push('write'); return [{ affectedRows: 1 }] }
      if (sql.includes('SELECT is_mixed_batch')) return [[{ is_mixed_batch: 0 }]]
      if (sql.includes('inventory_containers')) {
        const warehouse = /FOR SHARE|FOR UPDATE/.test(sql) ? currentWarehouse : 8
        if (params[0] === 12) return [[{ ...row(8), id: 12, barcode: 'I12', container_type: 1 }]]
        return [[row(warehouse)]]
      }
      throw new Error(`未 stub SQL: ${sql}`)
    },
  }
  const engine = {
    CONTAINER_STATUS: { ACTIVE: 1, EMPTY: 3 }, SOURCE_TYPE: { CONTAINER_SPLIT: 9 },
    async lockStockDimension() { events.push('dimension') },
    async splitContainer() { events.push('write'); return { newContainerId: 11, newBarcode: 'B11' } },
    async createContainersBatch(actual, body) { assert.equal(actual, conn); events.push('write'); events.push(`created-warehouse-${body.shared.warehouseId}`); return [{ id: 13, barcode: 'I13', qty: 2 }] },
    async syncStockFromContainers() { return 10 }, async logContainerSplitBatch() { events.push('log') },
  }
  const service = load('modules/plastic-boxes/plastic-boxes.service.js', {
    '../../config/db': { pool: { async getConnection() { events.push('connection'); return conn } } },
    '../../engine/containerEngine': engine, '../../utils/warehouseScope': scope,
    '../../utils/qtyPrecision': { async assertQtyPrecision() {} },
    '../../utils/operationRequest': {
      async beginResourceOperationRequest() { events.push('receipt'); if (drift) currentWarehouse = 9; return { enabled: true, replay, responseData: { boxId: 11, original: true } } },
      async completeOperationRequest() { events.push('complete') },
    },
    '../print-jobs/print-jobs.service': { async enqueueContainerLabelJob() { events.push('print'); return null } },
  })
  async function invoke(method, context = {}, warehouses = [8]) {
    const body = method === 'fill' ? { sourceContainerId: 12, expectedSourceQty: 10, requestKey: 'owned-key' } : { items: [2], requestKey: 'owned-key' }
    return service[method](11, body, { userId: 7, ...context }, warehouses)
  }
  return { invoke, events, calls }
}
test('PDA放货/还原的NULL与非法设备仓，fresh/旧键均在幂等和库存写之前拒绝', async () => {
  for (const method of ['fill', 'repack']) for (const replay of [false, true]) for (const pdaWarehouseId of [null, undefined, 0, -1, NaN, 1.5]) {
    const f = fixture({ replay })
    await assert.rejects(f.invoke(method, { isPda: true, pdaWarehouseId }), error => error.statusCode === 403 && error.code === 'PDA_WAREHOUSE_REQUIRED')
    assert.ok(!f.events.includes('receipt')); assert.ok(!f.events.includes('write')); assert.ok(!f.events.includes('print')); assert.ok(!f.events.includes('commit'))
  }
})
test('设备正确的PDA与无设备上下文PC保留fresh和成功回放，错误设备仓仍拒绝', async () => {
  for (const method of ['fill', 'repack']) for (const replay of [false, true]) for (const context of [{ isPda: true, pdaWarehouseId: 8 }, {}]) {
    const f = fixture({ replay }), data = await f.invoke(method, context)
    assert.ok(data)
    assert.equal(f.events.includes('write'), !replay)
    assert.equal(f.events.includes('commit'), !replay)
  }
  for (const method of ['fill', 'repack']) {
    const f = fixture({ replay: true })
    await assert.rejects(f.invoke(method, { isPda: true, pdaWarehouseId: 9 }), error => error.code === 'PDA_WAREHOUSE_MISMATCH')
    assert.ok(!f.events.includes('receipt'))
  }
})
test('controller透传PDA身份：NULL设备仓不得被折叠成PC上下文', async () => {
  const calls = []
  const controller = load('modules/plastic-boxes/plastic-boxes.controller.js', {
    './plastic-boxes.service': Object.fromEntries(['fill', 'repack'].map(method => [method, async (...args) => { calls.push(args); return {} }])),
    '../../utils/response': { successResponse: () => {} }, '../../utils/requestKey': { extractRequestKey: () => 'owned-key' },
  })
  for (const method of ['fill', 'repack']) for (const pda of [{ warehouseId: null }, { warehouseId: 8 }, undefined]) {
    await controller[method]({ params: { id: '11' }, body: {}, user: { userId: 7, warehouseIds: [8] }, pda }, {}, error => { throw error })
    assert.equal(calls.at(-1)[2].isPda, Boolean(pda))
    assert.equal(calls.at(-1)[2].pdaWarehouseId, pda?.warehouseId ?? null)
  }
})
test('旧RR快照在等幂等锁时目标盒换仓，fill/repack回放必须按当前仓拒绝', async () => {
  for (const method of ['fill', 'repack']) {
    const f = fixture({ replay: true, drift: true })
    await assert.rejects(f.invoke(method, { isPda: true, pdaWarehouseId: 8 }), error => error.statusCode === 403)
    assert.ok(f.calls.some(call => /FOR SHARE|FOR UPDATE/.test(call.sql)))
    assert.ok(!f.events.includes('write')); assert.ok(!f.events.includes('print')); assert.ok(!f.events.includes('commit'))
  }
})
test('还原等锁后的盒仓变化先拒绝，不能在旧维度锁下修改另一仓库存', async () => {
  for (const context of [{ isPda: true, pdaWarehouseId: 8 }, {}]) for (const warehouses of [[8], [8, 9]]) {
    const f = fixture({ drift: true })
    await assert.rejects(f.invoke('repack', context, warehouses), error => error.statusCode === 403 || error.code === 'CONTAINER_DIMENSION_CHANGED')
    assert.ok(!f.events.includes('write')); assert.ok(!f.events.includes('print')); assert.ok(!f.events.includes('commit'))
  }
})

const fillReceipt = { sourceContainerId: 12, sourceBarcode: 'LEGACY-I12', sourceRemainingAfter: 0, targetContainerId: 11, targetBarcode: 'B11', targetQtyAfter: 10, newContainerId: 11, newBarcode: 'B11', newContainerKind: 'plastic_box', productId: 3, warehouseId: 8 }
const repackReceipt = { boxId: 11, boxRemainingAfter: 5, created: [{ containerId: 13, barcode: 'I13', qty: 2 }, { containerId: 14, barcode: 'I14', qty: 3 }], printJobIds: [] }
function queryFixture({ kind = 'fill', warehouses = [8], device = undefined, missingTicket = false, requested, changedData, missingLogs = false, wrongTarget = false } = {}) {
  const action = `plastic_box.${kind}.11`, data = changedData || clean(kind === 'fill' ? fillReceipt : repackReceipt)
  const calls = [], AppError = require('../backend/src/utils/AppError')
  const history = (containerId, barcode, quantity, sourceId, sourceBarcode) => ({ container_id: containerId, barcode, quantity, product_id: 3, warehouse_id: 8, current_product_id: 3, container_type: containerId === 11 ? 2 : 1, initial_qty: quantity, source_type: 'container_split', source_ref_type: 'plastic_box_repack', source_ref_id: 11, source_barcode: sourceBarcode, source_product_id: 3, source_container_type: sourceId === 11 ? 2 : 1 })
  const logs = kind === 'fill' ? [history(12, 'LEGACY-I12', 10, 12, 'LEGACY-I12'), history(11, 'B11', 10, 12, 'LEGACY-I12')]
    : [history(11, 'B11', 2, 11, 'B11'), history(11, 'B11', 3, 11, 'B11'), history(13, 'I13', 2, 11, 'B11'), history(14, wrongTarget ? 'I99' : 'I14', 3, 11, 'B11')]
  const pool = { async query(sql, params) { calls.push({ sql, params: clean(params) }); assert.match(sql, /inventory_logs/); return [missingLogs ? [] : logs] } }
  const validator = () => load('modules/plastic-boxes/plastic-boxes.receipt.js', { '../../utils/warehouseScope': scope })
  const gate = load('modules/system/system.split-device.js', {
    '../../middleware/pdaSession': { pdaSessionOptional: () => (req, _res, next) => {
      if (missingTicket) return next(new AppError('缺设备票据', 403, 'PDA_SESSION_REQUIRED'))
      req.pda = device === undefined ? null : { warehouseId: device }; next()
    } },
    '../inventory/inventory.split-receipt': { isSplitAction: () => false },
    '../plastic-boxes/plastic-boxes.receipt': validator(),
  })
  const controller = load('modules/system/system.controller.js', {
    '../../utils/operationRequest': { getScopedOperationRequestStatus: async options => { options.receiptContext.matchedAction = action; return { status: 'success', resourceType: 'inventory_container', resourceId: 11, data } } },
    '../../config/db': { pool }, './system.split-device': gate,
    '../inventory/inventory.split-receipt': { assertSplitReceipt() {} }, '../sale/sale.commercial-receipts': { assertReceiptScope() {} },
    '../plastic-boxes/plastic-boxes.receipt': { assertPlasticBoxReceipt: (...args) => validator().assertPlasticBoxReceipt(...args) },
    '../packages/packages.receipt-guard': { assertPrintLabelReceiptConsistent() {} }, '../../utils/logger': {},
  })
  const req = { headers: device !== undefined || missingTicket ? { 'x-client': 'pda' } : {}, query: { action: requested || action }, params: { key: 'owned-key' }, user: { userId: 7, warehouseIds: warehouses, permissions: [] } }
  let output, error
  const res = { status() { return this }, json(value) { output = value } }
  return { calls, async run() {
    await new Promise(resolve => gate.splitReceiptDevice(req, res, e => { if (e) error = e; resolve() }))
    if (!error) await controller.requestStatus(req, res, e => { error = e })
    return { output, error }
  } }
}
test('本人塑料盒GET原结果仍核原流水仓，撤原仓授权不能取得完整条码结果', async () => {
  for (const kind of ['fill', 'repack']) {
    const f = queryFixture({ kind, warehouses: [9] }), got = await f.run()
    assert.equal(got.error?.statusCode, 403); assert.equal(got.output, undefined)
  }
})
test('塑料盒精确和宽前缀GET均要求PDA有效非空原仓；无票据、NULL及别仓均拒绝', async () => {
  for (const kind of ['fill', 'repack']) for (const requested of [undefined, 'plastic_box']) for (const context of [{ missingTicket: true }, { device: null }, { device: 9 }]) {
    const got = await queryFixture({ kind, requested, ...context }).run()
    assert.equal(got.error?.statusCode, 403); assert.equal(got.output, undefined)
  }
})
test('PC及正确PDA本人GET不要求执行权，后来盒/整件移动不否定原操作仓', async () => {
  for (const kind of ['fill', 'repack']) for (const device of [undefined, 8]) {
    const f = queryFixture({ kind, device }), got = await f.run()
    assert.equal(got.error, undefined); assert.equal(got.output.data.status, 'success')
    assert.ok(f.calls.some(call => call.sql.includes('inventory_logs')))
    assert.ok(f.calls.every(call => !/FOR UPDATE|FOR SHARE/.test(call.sql)), '独立查询不加库存锁')
  }
})
test('塑料盒GET不独认响应warehouse；完整来源/目标/原流水缺失或伪造必须拒绝', async () => {
  for (const options of [{ missingLogs: true }, { changedData: { ...fillReceipt, warehouseId: 9 } }, { changedData: { ...fillReceipt, sourceBarcode: 'FORGED' } }, { kind: 'repack', wrongTarget: true }, { kind: 'repack', changedData: { ...repackReceipt, created: [{ containerId: 13, barcode: 'I13', qty: 9 }] } }]) {
    const got = await queryFixture(options).run()
    assert.equal(got.error?.statusCode, 409); assert.equal(got.output, undefined)
  }
})
