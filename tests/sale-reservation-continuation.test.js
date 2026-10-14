'use strict'

// Real service/state rules, with only connection and external domain boundaries stubbed.
// The owned HTTP/MySQL runner separately verifies locks, stock, AR and task execution.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const AppError = require('../backend/src/utils/AppError')
const rules = require('../backend/src/constants/documentStatusRules')
const { SALE_STATUS } = require('../backend/src/constants/saleOrderStatus')
const scopeModule = { exports: {} }
const scopeFile = path.resolve(__dirname, '../backend/src/utils/warehouseScope.js')
vm.runInNewContext(fs.readFileSync(scopeFile, 'utf8'), { module: scopeModule, require: name => name === './AppError' ? AppError : {} }, { filename: scopeFile })
const { assertInScope } = scopeModule.exports
const { assertQtyPrecision } = require('../backend/src/utils/qtyPrecision')
const file = path.resolve(__dirname, '../backend/src/modules/sale/sale.service.js')
const source = () => fs.readFileSync(file, 'utf8')

function fixture({ status = 3, quantity = 10, reserved = 4, shipped = 4, allowDecimal = 0, pending = false, fault = false, replay = false, creditLimit = null, creditUsed = 0, code = source() } = {}) {
  const order = { id: 9, order_no: '合成续量单', status, customer_id: 5, warehouse_id: 2, total_amount: 200, discount_amount: 0 }
  const item = { id: 19, order_id: 9, product_id: 7, product_name: '合成商品', warehouse_id: 2, unit: '个', quantity, reserved_qty: reserved, dispatched_qty: reserved, shipped_qty: shipped }
  const calls = [], reserves = [], events = []
  const initial = JSON.stringify({ order, item })
  const conn = {
    async beginTransaction() { calls.push('begin') },
    async rollback() { calls.push('rollback'); const old = JSON.parse(initial); Object.assign(order, old.order); Object.assign(item, old.item) },
    release() { calls.push('release') },
    async query(sql, params = []) {
      calls.push(sql)
      if (sql.includes('FROM product_items')) return [[{ id: 7, name: item.product_name, allow_decimal_qty: allowDecimal }]]
      if (sql.includes('FROM sale_orders') && sql.startsWith('SELECT')) return [[order]]
      if (sql.includes('FROM sale_customers')) return [[{ id: 5, credit_limit: creditLimit }]]
      if (sql.includes('FROM warehouse_tasks')) return [pending ? [{ id: 30 }] : []]
      if (sql.includes('SELECT warehouse_id FROM sale_order_items')) return [[{ warehouse_id: 2 }]]
      if (sql.includes('SELECT * FROM sale_order_items')) return [[item]]
      if (sql.includes('FROM inventory_warehouses')) return [[{ id: 2, name: '合成仓', is_active: 1 }, { id: 3, name: '第二合成仓', is_active: 1 }]]
      if (sql.includes('UPDATE sale_order_items SET warehouse_id')) { item.warehouse_id = params[0]; return [{ affectedRows: 1 }] }
      if (sql.includes('UPDATE sale_order_items SET reserved_qty = reserved_qty +')) { item.reserved_qty += params[0]; return [{ affectedRows: 1 }] }
      if (sql.includes('COUNT(*) AS unfilled')) return [[{ unfilled: item.reserved_qty < item.quantity ? 1 : 0 }]]
      if (sql.includes('INSERT INTO sale_order_events')) { events.push(params); return [{ insertId: 11 }] }
      throw new Error(`未建模SQL: ${sql}`)
    },
  }
  const mocks = {
    '../disposal/disposal.handling.target-guards': { readLink: async () => null, assertSaleItems() {}, assertWarehouse() {} },
    './sale.commercial-store': { assertModel() {}, assertRequestKey() {}, assertRevision() {} },
    '../fulfillment/fulfillment.refresh': { captureDimensions: async () => [], commitFulfillment: async current => { assert.equal(current, conn); calls.push('commit') } },
    '../../config/db': { pool: { getConnection: async () => conn, query: (...args) => conn.query(...args) } },
    '../../utils/warehouseScope': { assertInScope },
    '../../utils/AppError': AppError,
    '../../utils/qtyPrecision': { assertQtyPrecision, loadQtyPolicies: async () => new Map([[7, { allowDecimal: allowDecimal === 1 }]]) },
    '../../utils/statusTransition': { lockStatusRow: async current => { assert.equal(current, conn); calls.push('SO-X'); return order }, compareAndSetStatus: async (current, args) => { assert.equal(current, conn); assert.ok(args.fromStatus.includes(order.status)); order.status = args.toStatus; calls.push(`status:${args.toStatus}`) } },
    '../../constants/documentStatusRules': rules,
    '../../constants/saleOrderStatus': { SALE_STATUS },
    '../../constants/settlementType': require('../backend/src/constants/settlementType'),
    '../../utils/creditExposure': { getCustomerCreditUsed: async (_conn, customerId, options) => { assert.equal(customerId, 5); assert.equal(options.excludeSaleOrderId, 9); return creditUsed }, hasCreditOverridePermission: async () => false },
    '../credit-overrides/credit-overrides.service': { hasApprovedOverride: async () => null },
    '../../utils/operationRequest': { beginOperationRequest: async () => { calls.push('key'); return { enabled: true, id: 1, replay, responseData: null } }, completeOperationRequest: async () => { calls.push('receipt'); if (fault) throw new Error('合成回执写失败') } },
    '../../utils/expectedStock': { lockExpectedPurchaseOrders: async () => calls.push('PO-X') },
    '../../engine/containerEngine': { getStockProjection: async () => ({ available: 10 }) },
    '../../engine/reservationEngine': { reserve: async (current, args) => { assert.equal(current, conn); reserves.push(args) } },
    './sale.contracts': { getNetOrderAmount: (total, discount) => total - discount, saleOperationAction: (action, id) => `sale.${action}:${id}` },
    '../inventory/inventory.service': { getAvailabilityByProducts: async () => { calls.push('availability'); return [] } },
  }
  const mod = { exports: {} }
  vm.runInNewContext(code, { module: mod, require: name => mocks[name] || {} }, { filename: file })
  return { svc: mod.exports, order, item, conn, calls, reserves, events }
}
const actor = { userId: 1, roleId: 5 }
const options = { requestKey: 'original-synthetic-key', scopeWarehouseIds: [2, 3] }
const reserve = (f, qty = 6, warehouseId = 2) => f.svc.reserveStock(9, actor, [{ id: 19, qty, warehouseId }], options)

test('执行中首批已发4后可补6，累计已占10且仍为执行中3', async () => {
  const f = fixture()
  await reserve(f)
  assert.equal(f.order.status, 3)
  assert.equal(f.item.quantity, 10)
  assert.equal(f.item.reserved_qty, 10)
  assert.equal(f.item.dispatched_qty, 4)
  assert.equal(f.item.shipped_qty, 4)
  assert.equal(f.reserves.length, 1)
  assert.equal(f.reserves[0].qty, 6)
  assert.deepEqual(f.calls.slice(-3), ['receipt', 'commit', 'release'])
})
test('首批尚未实发也可补未占需求，部分补占仍保持3', async () => {
  const f = fixture({ shipped: 0 })
  await reserve(f, 2)
  assert.equal(f.order.status, 3)
  assert.equal(f.item.reserved_qty, 6)
  assert.equal(f.item.dispatched_qty, 4)
})
test('补量只认原需求减累计已占，不能重新占已履行的4', async () => {
  const f = fixture()
  await assert.rejects(reserve(f, 7), /超过未占余量 6/)
  assert.equal(f.reserves.length, 0)
  assert.ok(f.calls.includes('rollback'))
})
test('同一行重复输入不能绕过未占6的上限', async () => {
  const f = fixture()
  await assert.rejects(f.svc.reserveStock(9, actor, [{ id: 19, qty: 4 }, { id: 19, qty: 4 }], options), /超过未占余量 2/)
  assert.equal(f.reserves.length, 0)
})
test('原仓不变：已发后累计预占非零仍禁止补占换仓', async () => {
  const f = fixture()
  await assert.rejects(reserve(f, 6, 3), { code: 'RESERVE_WAREHOUSE_CHANGE_NOT_ALLOWED' })
  assert.equal(f.item.warehouse_id, 2)
})
test('取消或改单待仓库确认时补占拒绝，原请求未进入库存引擎', async () => {
  const f = fixture({ pending: true })
  await assert.rejects(reserve(f), { code: 'SALE_RESERVATION_EXECUTION_PENDING' })
  assert.equal(f.reserves.length, 0)
})
test('原键重放先于新阶段和挂起门，结束本次事务、不再次占库', async () => {
  const f = fixture({ status: 4, pending: true, replay: true })
  await reserve(f)
  assert.equal(f.reserves.length, 0)
  assert.ok(f.calls.includes('rollback'))
  assert.ok(!f.calls.includes('commit'))
})
test('当前仓范围仍先于原键，撤仓403无回放', async () => {
  const f = fixture({ replay: true })
  await assert.rejects(f.svc.reserveStock(9, actor, [], { ...options, scopeWarehouseIds: [3] }), { code: 'WAREHOUSE_SCOPE_DENIED' })
  assert.ok(!f.calls.includes('key'))
})
test('执行中占库预览仍展示原未占6，当前全部明细仓范围必须先于库存/授信读取', async () => {
  const f = fixture()
  const preview = await f.svc.getReservePreview(9, [2])
  assert.equal(preview.items[0].remainToReserve, 6)
  assert.equal(preview.items[0].quantity, 10)
  const denied = fixture()
  denied.item.warehouse_id = 3
  await assert.rejects(denied.svc.getReservePreview(9, [2]), { code: 'WAREHOUSE_SCOPE_DENIED' })
  assert.ok(!denied.calls.includes('availability'))
})
test('执行中挂起原任务的预览与写入口均明确拒绝，正常WT不被状态查询误挡', async () => {
  await assert.rejects(fixture({ pending: true }).svc.getReservePreview(9, [2]), { code: 'SALE_RESERVATION_EXECUTION_PENDING' })
  await assert.doesNotReject(fixture().svc.getReservePreview(9, [2]))
})
for (const status of [2, 4, 5]) test(`状态${status}新补占仍拒绝`, async () => {
  const f = fixture({ status })
  await assert.rejects(reserve(f), /可以占用库存/)
  assert.equal(f.reserves.length, 0)
})
for (const status of [1, 6]) test(`原状态${status}全补仍推进已占库2`, async () => {
  const f = fixture({ status, shipped: 0 })
  await reserve(f)
  assert.equal(f.order.status, 2)
})
test('两位小数补量0.2保留当前允许规则，不重写固定单位与已发0.1', async () => {
  const f = fixture({ quantity: 0.3, reserved: 0.1, shipped: 0.1, allowDecimal: 1 })
  await reserve(f, 0.2)
  assert.equal(Math.round(f.item.reserved_qty * 100), 30)
  assert.equal(f.item.unit, '个')
  assert.equal(f.item.shipped_qty, 0.1)
  assert.equal(f.order.status, 3)
})
test('当前整数规则及两位原量规则没有被续量豁免', async () => {
  await assert.rejects(reserve(fixture(), 0.5), { code: 'QTY_INTEGER_REQUIRED' })
  await assert.rejects(reserve(fixture({ allowDecimal: 1 }), 0.005), { code: 'QTY_DECIMALS_EXCEEDED' })
})
test('授信仍先排除本单再计整单净额，邻单额度不足时补量拒绝', async () => {
  const f = fixture({ creditLimit: 220, creditUsed: 40 })
  await assert.rejects(reserve(f), { code: 'CREDIT_LIMIT_EXCEEDED' })
  assert.equal(f.reserves.length, 0)
})
test('完成回执写失败时原需求、累计量和状态全部回滚', async () => {
  const f = fixture({ fault: true })
  await assert.rejects(reserve(f), /合成回执写失败/)
  assert.equal(f.item.reserved_qty, 4)
  assert.equal(f.order.status, 3)
  assert.ok(!f.calls.includes('commit'))
})
test('恢复旧2/6回写会被真实service行为反证发现', async () => {
  const original = source()
  const changed = original.replace('const toStatus = wasExecuting ? SALE_STATUS.PICKING :', 'const toStatus = false ? SALE_STATUS.PICKING :')
  assert.ok(changed !== original, 'preservation branch must be present and changed by the mutation')
  const f = fixture({ code: changed })
  await reserve(f)
  assert.notEqual(f.order.status, 3)
})
