// 撤回与调拨真实函数 SQL 桩：读取形状、当前读与库存/应付副作用均独立观察。
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
const statuses = { ACTIVE: 1, EMPTY: 3, PENDING_PUTAWAY: 4, VOID: 5 }
function inboundFixture({ warehouse = 8, transferred = false, outsideCandidates = false, inTransit = false } = {}) {
  const events = [], calls = []
  const container = { id: 11, product_id: 3, warehouse_id: warehouse, status: statuses.ACTIVE, initial_qty: 10, remaining_qty: 10, locked_by_task_id: null, transfer_order_id: inTransit ? 51 : null }
  const conn = {
    async beginTransaction() { events.push('begin') }, async rollback() { events.push('rollback') }, release() { events.push('release') },
    async query(sql, params = []) {
      calls.push({ sql, params })
      if (/^UPDATE/.test(sql.trim())) { events.push('write'); return [{ affectedRows: 1 }] }
      if (sql.includes('paid_amount')) return [[]]
      if (sql.includes('SELECT DISTINCT product_id')) return [outsideCandidates ? [] : [{ product_id: 3, warehouse_id: warehouse }]]
      if (sql.includes('inventory_containers') && sql.includes('status IN')) return [outsideCandidates ? [] : [container]]
      if (sql.includes('SELECT id FROM inventory_containers')) return [[{ id: 11 }]]
      if (sql.includes('inventory_logs')) {
        // transferred=true 表示探维度快照建立后才提交的历史；普通 RR 读会漏掉它。
        assert.deepEqual(Array.from(params[0]), [11])
        return [transferred && /FOR SHARE|FOR UPDATE/.test(sql) ? [{ container_id: 11, ref_no: 'TR-OWNED' }] : []]
      }
      if (sql.includes('sale_order_expected_bindings')) return [[{ qty: 0 }]]
      if (sql.includes('SELECT quantity FROM inventory_stock')) return [[{ quantity: 10 }]]
      if (sql.includes('SELECT DISTINCT purchase_order_id')) return [[{ purchase_order_id: 31 }]]
      if (sql.includes('SELECT status FROM purchase_orders')) return [[{ status: 2 }]]
      throw new Error(`未 stub SQL: ${sql}`)
    },
  }
  const service = load('modules/inbound-tasks/inbound-tasks.void.js', {
    '../../config/db': { pool: { async getConnection() { return conn } } }, '../../utils/warehouseScope': scope,
    '../fulfillment/fulfillment.refresh': { async commitFulfillment() { events.push('commit') } },
    '../../engine/containerEngine': { CONTAINER_STATUS: statuses, async lockStockDimension() { events.push('dimension') }, async getStockProjection() { return { quantity: 10, reserved: 0 } }, async syncStockFromContainers() { events.push('sync'); return 0 } },
    '../../engine/inventoryEngine': { MOVE_TYPE: { RECEIPT_VOID: 9 }, async writeInventoryLog() { events.push('log') } },
    './inbound-tasks.helpers': { async assertPurchaseOrdersOpen() {}, async appendInboundEvent() { events.push('event') } },
    '../../utils/statusTransition': { async lockStatusRow() { return { id: 21, task_no: 'IT-OWNED', warehouse_id: 8, status: 3 } }, async compareAndSetStatus() { events.push('status') } },
    '../../constants/documentStatusRules': { assertStatusAction: () => ({ from: [3], to: 1 }) },
    './inbound-tasks.settle': { async recomputePurchasePayable() { events.push('payable') } },
    './inbound-tasks.query': { async findById() { return { id: 21 } } },
    '../print-jobs/print-jobs.service': { async voidPendingPrintJobsForContainers() { events.push('print') } },
  })
  return { service, conn, events, calls }
}
function assertNoInboundWrite(f) {
  for (const event of ['write', 'sync', 'log', 'status', 'payable', 'print', 'commit']) assert.ok(!f.events.includes(event), `拒绝前不得 ${event}`)
  assert.ok(f.events.includes('rollback'))
}
test('完成调入别仓的收货容器必须拒绝撤回，不能消除另一仓库存/原采购应付', async () => {
  const f = inboundFixture({ warehouse: 9 })
  await assert.rejects(f.service.voidReceipt(21, { userId: 7 }, [8]), error => error.statusCode === 409 && error.code === 'INBOUND_TASK_CONTAINER_MOVED_AWAY')
  assertNoInboundWrite(f)
})
test('A→B→A及已force-close VOID容器仍按全部任务容器的当前调拨历史拒绝', async () => {
  for (const outsideCandidates of [false, true]) {
    const f = inboundFixture({ transferred: true, outsideCandidates })
    await assert.rejects(f.service.voidReceipt(21, { userId: 7 }, [8]), error => error.statusCode === 409 && error.code === 'INBOUND_TASK_CONTAINER_TRANSFERRED')
    assertNoInboundWrite(f)
    assert.match(f.calls.find(call => call.sql.includes('inventory_logs')).sql, /FOR SHARE/)
    assert.doesNotMatch(f.calls.find(call => call.sql.includes('SELECT id FROM inventory_containers')).sql, /status IN/)
  }
})
test('未调拨正常收货允许撤回，在途仍拒绝，任务越范围先于库存读拒绝', async () => {
  const normal = inboundFixture()
  assert.equal((await normal.service.voidReceipt(21, { userId: 7 }, [8])).id, 21)
  assert.ok(normal.events.includes('payable')); assert.ok(normal.events.includes('commit'))
  const transit = inboundFixture({ inTransit: true })
  await assert.rejects(transit.service.voidReceipt(21, { userId: 7 }, [8]), error => error.statusCode === 409)
  assertNoInboundWrite(transit)
  const denied = inboundFixture()
  await assert.rejects(denied.service.voidReceipt(21, { userId: 7 }, []), error => error.statusCode === 403)
  assert.equal(denied.calls.length, 0); assertNoInboundWrite(denied)
})
function transferFixture(direction = 'out') {
  const events = [], calls = [], recorded = []
  const container = { id: 11, barcode: 'I11', product_id: 3, remaining_qty: 10, warehouse_id: direction === 'out' ? 8 : 9, status: direction === 'out' ? 1 : 4, locked_by_task_id: null, transfer_order_id: direction === 'out' ? null : 51 }
  const conn = {
    async beginTransaction() {}, async rollback() { events.push('rollback') }, release() {},
    async query(sql, params = []) {
      calls.push({ sql, params })
      if (/^UPDATE/.test(sql.trim())) { events.push('write'); return [{ affectedRows: 1 }] }
      if (sql.includes('inventory_containers')) {
        if (/SELECT\s+[^\n]*\bproduct_name\b/.test(sql)) throw new Error('ER_BAD_FIELD_ERROR: inventory_containers.product_name 不存在')
        if (sql.includes('COUNT(*)')) return [[{ pending: 0 }]]
        return [[container]]
      }
      if (sql.includes('product_items')) { assert.doesNotMatch(sql, /FOR UPDATE|FOR SHARE/); return [[{ name: '实际主档名' }]] }
      if (sql.includes('warehouse_locations')) return [[{ id: 91, warehouse_id: 9 }]]
      if (sql.includes('transfer_order_items')) return [[{ id: 71, quantity: 10, deducted_qty: direction === 'out' ? 0 : 10, received_qty: sql.includes('WHERE order_id=? AND product_id=?') ? 0 : 10, product_name: '请求伪造名' }]]
      throw new Error(`未 stub SQL: ${sql}`)
    },
  }
  const service = load('modules/transfer/transfer.service.js', {
    '../../config/db': { pool: { async getConnection() { return conn } } }, '../../utils/warehouseScope': scope,
    '../fulfillment/fulfillment.refresh': { async commitFulfillment() { events.push('commit') }, captureDimensions: () => {} },
    '../../engine/inventoryEngine': { MOVE_TYPE: {}, async writeInventoryLog() { events.push('log') } },
    '../../engine/containerEngine': { SOURCE_TYPE: {}, CONTAINER_STATUS: statuses, async getAvailableStockForDecision() { return { available: 10 } }, async syncStockFromContainers() { return 0 }, async lockStockDimension() { events.push('dimension') } },
    '../../utils/codeGenerator': {}, '../../utils/statusTransition': { async lockStatusRow() { return { id: 51, order_no: 'TR-OWNED', from_warehouse_id: 8, to_warehouse_id: 9, status: direction === 'out' ? 2 : 3 } }, async compareAndSetStatus() { events.push('status') } },
    '../../constants/documentStatusRules': { assertStatusAction: () => ({}) },
    './transfer-events.service': { TRANSFER_EVENT: {}, async record(actual, event) { assert.equal(actual, conn); recorded.push(event) } },
    '../../utils/requestContext': { getRequestId: () => null }, '../../utils/operationRequest': { async completeOperationRequest() {} },
    './transfer-requests': { async beginTransferRequest() { return { replay: false } } }, '../../utils/qtyPrecision': {},
  })
  return { service, events, calls, recorded }
}
test('调出/调入显示商品真实主档名，不读容器无列或信任建单显示名，并保持维度先锁', async () => {
  for (const direction of ['out', 'in']) {
    const f = transferFixture(direction)
    const data = direction === 'out' ? await f.service.scanOut(51, { containerBarcode: 'I11' }, {}, 'owned', [8], 8) : await f.service.scanIn(51, { containerBarcode: 'I11', locationId: 91 }, {}, 'owned', [9], 9)
    assert.equal(data.productName, '实际主档名')
    assert.match(f.recorded[0].description, /实际主档名/)
    assert.doesNotMatch(f.recorded[0].description, /请求伪造名/)
    assert.ok(f.events.indexOf('dimension') < f.events.indexOf('write')); assert.ok(f.events.includes('commit'))
  }
})
test('force-close只查询真实容器列，在途核销成功且不加回任一仓库存', async () => {
  const f = transferFixture('in')
  await f.service.forceCloseInTransit(51, { userId: 7 }, { reason: '测试运输损失' }, [8])
  assert.ok(f.events.includes('commit')); assert.ok(!f.events.includes('dimension')); assert.ok(!f.events.includes('log'))
  assert.equal(f.recorded[0].payload.voidedContainers[0].qty, 10)
  assert.ok(f.calls.every(call => !/inventory_stock/.test(call.sql)))
})
