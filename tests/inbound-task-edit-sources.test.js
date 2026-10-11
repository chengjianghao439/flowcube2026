 'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { createRequire } = require('node:module')
const filename = path.resolve(__dirname, '../backend/src/modules/inbound-tasks/inbound-tasks.query.js')
function fixture({ changedOrder = false, missingSource = false, executed = false, legacy = false } = {}) {
  const local = createRequire(filename), module_ = { exports: {} }, calls = []
  const conn = { query: async (sql, params) => {
    calls.push({ sql, params })
    if (/SELECT id, order_id FROM purchase_order_items/.test(sql)) return [missingSource ? [] : [{ id: 31, order_id: 3 }, { id: 32, order_id: 2 }]]
    if (/SELECT \* FROM purchase_orders/.test(sql)) return [[{ id: 2 }, { id: 3 }]]
    if (/SELECT \* FROM purchase_order_items/.test(sql)) return [[{ id: 31, order_id: changedOrder ? 4 : 3 }, { id: 32, order_id: 2 }]]
    if (/FROM inbound_task_items/.test(sql)) return [[{ task_id: 1, line_count: 2, ordered_qty: 5, received_qty: 0, putaway_qty: 0, execution_line_count: executed ? 2 : 0 }]]
    if (/edit_container_count/.test(sql)) return [[{ task_id: 1, edit_container_count: legacy ? 1 : 0 }]]
    if (/FROM inventory_containers/.test(sql)) return [[]]
    if (/FROM purchase_order_items/.test(sql)) return [[{ purchase_item_id: 31, remaining_qty: 7, total_count: 201 }]]
    throw new Error(sql)
  } }
  const status = { DEFAULT_INBOUND_THRESHOLDS: { printTimeoutMinutes: 5, putawayTimeoutHours: 24 } }
  for (const fn of ['buildPrintStatus','buildPutawayStatus','buildAuditStatus','buildExceptionFlags','buildReceiptStatus','buildInboundPrintBatches']) status[fn] = () => ({})
  const stubs = {
    '../../config/db': { pool: conn }, '../../utils/logger': {}, '../../engine/containerEngine': { CONTAINER_STATUS: { PENDING_PUTAWAY: 0, ACTIVE: 1 } },
    '../../utils/inboundThresholds': {}, '../../utils/warehouseScope': { scopeFilter: (scope, column) => ({ sql: Array.isArray(scope) ? ` AND ${column} IN (?)` : '', params: Array.isArray(scope) ? [scope] : [] }) },
    './inbound-tasks.status': status, '../print-jobs/print-jobs.service': { EXPIRE_MESSAGE: 'timeout' },
    './inbound-tasks.helpers': { fmtPurchasableItem: row => ({ purchaseItemId: row.purchase_item_id, remainingQty: row.remaining_qty }) },
  }
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module: module_, require: id => Object.hasOwn(stubs, id) ? stubs[id] : local(id) }, { filename })
  return { query: module_.exports, conn, calls }
}
test('写候选先peek身份再锁实际PO→POI；聚合不加锁其它IT且取齐', async () => {
  const f = fixture()
  const list = await f.query.loadPurchasableCandidates(f.conn, { supplierId: 5, purchaseItemIds: [32, 31], forUpdate: true })
  assert.equal(list.length, 1)
  assert.match(f.calls[1].sql, /purchase_orders.*ORDER BY id FOR UPDATE/)
  assert.deepEqual(Array.from(f.calls[1].params[0]), [2, 3])
  assert.match(f.calls[2].sql, /purchase_order_items.*ORDER BY id FOR UPDATE/)
  assert.deepEqual(Array.from(f.calls[2].params[0]), [31, 32])
  assert.doesNotMatch(f.calls[3].sql, /FOR UPDATE|FOR SHARE|LIMIT/)
})
test('等来源锁之后POI归属被改或来源缺失必须fail-loud', async () => {
  for (const options of [{ changedOrder: true }, { missingSource: true }]) {
    const f = fixture(options)
    await assert.rejects(f.query.lockPurchasableSources(f.conn, [31, 32]), { code: 'INBOUND_PURCHASE_SOURCE_INVALID' })
  }
})
test('自身排除三个分配聚合，原supplier/warehouse/scope后绑定且default候选limit200', async () => {
  const f = fixture()
  await f.query.loadPurchasableCandidates(f.conn, { supplierId: 5, warehouseId: 2, purchaseItemIds: [31, 32], excludeTaskId: 42, scopeWarehouseIds: [2] })
  const call = f.calls[0]
  assert.equal((call.sql.match(/OR it.id = \?/g) || []).length, 3)
  assert.deepEqual(JSON.parse(JSON.stringify(call.params)), [42, 42, 42, 5, 31, 32, [2], 2])
  assert.match(call.sql, /po.status = 2/); assert.match(call.sql, /po.warehouse_id = \?/)
})
test('closure批量统计逐条执行和legacy容器，不因正负执行抵消而可编辑', async () => {
  for (const [options, allowed] of [[{}, true], [{ executed: true }, false], [{ legacy: true }, false]]) {
    const f = fixture(options), map = await f.query.loadInboundTaskClosureSummary(Array.from({ length: 100 }, (_, i) => i + 1))
    const task = f.query.buildTaskWithClosure({ id: 1, status: 1, submittedAt: null }, [], map.get(1))
    assert.equal(task.draftEditable, allowed)
    assert.equal(f.calls.length, 4)
    assert.match(f.calls[0].sql, /received_qty <> 0 OR putaway_qty <> 0/)
    const edit = f.calls.find(c => /edit_container_count/.test(c.sql))
    assert.doesNotMatch(edit.sql, /is_legacy/)
    assert.match(edit.sql, /deleted_at IS NULL/)
  }
})
