'use strict'
// 真实模块离线契约 + 源码反向守卫。运行时串行/并发/清理矩阵见专属实例smoke。
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module')
const root = path.resolve(__dirname, '..')
const source = p => fs.readFileSync(path.join(root, p), 'utf8').replace(/^\s*\/\/.*$/gm, '')
function checkTransfer(s) {
  assert.match(s, /SELECT id, has_transfer_history FROM inventory_containers WHERE inbound_task_id = \? AND deleted_at IS NULL FOR SHARE/)
  assert.match(s, /taskContainerRows\.some\(r => Number\(r\.has_transfer_history\) === 1\)/)
}
test('永久调拨事实覆盖全部未删容器，反向删除会红', () => {
  const s = source('backend/src/modules/inbound-tasks/inbound-tasks.void.js'); checkTransfer(s)
  assert.throws(() => checkTransfer(s.replace('has_transfer_history', 'lost_marker')))
  const transfer = source('backend/src/modules/transfer/transfer.service.js')
  assert.equal((transfer.match(/has_transfer_history = 1/g) || []).length, 3)
  const migration = source('backend/src/database/285_container_transfer_history.sql')
  assert.match(migration, /information_schema.COLUMNS/); assert.match(migration, /transfer_order_events/); assert.match(migration, /TRANSFER_SCAN_OUT/)
})
test('两补打入口事务内事件/入队/回执，不依赖时间桶；反向旧桶会红', () => {
  const inbound = source('backend/src/modules/inbound-tasks/inbound-tasks.command.js').split('async function reprint(')[1].split('async function cancel(')[0]
  const check = s => { assert.doesNotMatch(s, /Date\.now\(\)|reprintBucket/); assert.match(s, /appendInboundEvent\(conn/); assert.match(s, /enqueueContainerLabelJob\(\{ conn/); assert.match(s, /completeReprintIntent\(conn/); assert.doesNotMatch(s, /SELECT id, barcode, remaining_qty, warehouse_id, product_name/) }
  check(inbound); assert.throws(() => check(inbound + '\nDate.now()'))
  const center = source('backend/src/modules/print-jobs/print-jobs.label-command.js').split('async function reprintInboundBarcode(')[1]
  assert.doesNotMatch(center, /Date\.now\(\)/); assert.match(center, /getDispatchHintForJob\(job.printerCode, job.id, conn\)/)
})
function loadIntent() {
  const file = path.join(root, 'backend/src/modules/print-jobs/print-jobs.reprint-intent.js'), m = new Module(file, module)
  m.filename = file; m.paths = Module._nodeModulePaths(path.dirname(file))
  const native = m.require.bind(m)
  m.require = name => name === '../../utils/operationRequest' ? {
    stableStringify: value => JSON.stringify(value),
    beginResourceOperationRequest: async (conn, args) => ({ id: 1, action: `${args.action}.${args.resourceId}`, replay: !!conn.stored, responseData: conn.stored }),
    completeOperationRequest: async (conn, _request, args) => { conn.stored = args.data },
  } : name === '../../utils/warehouseScope' ? {
    assertBoundWarehouseInScope: (scope, id) => { if (scope && !scope.includes(Number(id))) throw Object.assign(new Error('scope denied'), { code: 'WAREHOUSE_SCOPE_DENIED' }) },
  } : native(name)
  m._compile(fs.readFileSync(file, 'utf8'), file); return m.exports
}
test('真实意图模块保存原回执、拒绝异正文和撤销原仓范围', async () => {
  const helper = loadIntent(), conn = {}, args = { requestKey: `reprint-v2-${Date.now()}-original`, userId: 4, action: 'inbound.reprint', resourceId: 9, payload: { mode: 'task' }, scopeWarehouseIds: [3] }
  await assert.rejects(helper.beginReprintIntent(conn, { ...args, requestKey: '' }), { code: 'REQUEST_KEY_REQUIRED' })
  const request = await helper.beginReprintIntent(conn, args), result = { taskId: 9, jobIds: [11] }
  await helper.completeReprintIntent(conn, request, { resourceId: 9, warehouseIds: [3], result })
  assert.deepEqual((await helper.beginReprintIntent(conn, args)).result, result)
  await assert.rejects(helper.beginReprintIntent(conn, { ...args, payload: { mode: 'barcode' } }), { code: 'PRINT_REPRINT_REQUEST_CONFLICT' })
  await assert.rejects(helper.beginReprintIntent(conn, { ...args, scopeWarehouseIds: [7] }), { code: 'WAREHOUSE_SCOPE_DENIED' })
})

test('回执当前收货头已不存在时不能仅凭残留容器放行', async () => {
  const helper = loadIntent(), conn = { query: async sql => sql.includes('FROM inbound_tasks') ? [[]] : [[{ warehouse_id: 3 }]] }
  const data = { version: 1, action: 'inbound.reprint.9', resourceId: 9, fingerprint: 'a'.repeat(64), warehouseIds: [3], result: { taskId: 9, requestId: 1, containerIds: [11] } }
  await assert.rejects(helper.assertReprintReceiptScope(conn, { status: 'success', resourceType: 'print_reprint', resourceId: 9, data }, [3], { requestedAction: data.action, matchedAction: data.action }), { code: 'PRINT_REPRINT_RECEIPT_INVALID' })
})

// 只隔离范围I/O与库存枚举读取，断言使用真实来源分支；不启动库/认证配置。
function loadSource(mutation = value => value) {
  const file = path.join(root, 'backend/src/modules/print-jobs/print-jobs.reprint-source.js'), m = new Module(file, module)
  m.filename = file; m.paths = Module._nodeModulePaths(path.dirname(file))
  const native = m.require.bind(m)
  m.require = name => name === '../../utils/warehouseScope' ? { assertBoundWarehouseInScope() {} }
    : name === '../../engine/containerEngine' ? { CONTAINER_STATUS: { VOID: 3 } } : native(name)
  m._compile(mutation(fs.readFileSync(file, 'utf8')), file); return m.exports
}
test('删头来源谓词必须有效：真实函数反向移除删头条件必红', () => {
  const row = { id: 11, warehouse_id: 3, status: 1, inbound_task_id: 9, source_task_id: 9, source_deleted_at: 'synthetic deleted', source_item_count: 1, source_ref_type: 'inbound_task', source_ref_id: 9 }
  const guard = module => assert.throws(() => module.assertContainerReprintSource(row, null), { code: 'PRINT_REPRINT_SOURCE_INVALID' })
  guard(loadSource())
  assert.throws(() => guard(loadSource(s => s.replace('|| row.source_deleted_at', '|| false'))))
  const validOther = { id: 12, warehouse_id: 3, status: 1, inbound_task_id: null, source_ref_type: 'manual' }
  assert.equal(loadSource().assertContainerReprintSource(validOther, null), validOther)
  assert.throws(() => loadSource().assertContainerReprintSource(validOther, null, { recovery: true }), { code: 'PRINT_REPRINT_SOURCE_INVALID' })
})
test('清理后的过期键和无时间旧键不能创建：删除时间门必红', async () => {
  const helper = loadIntent(), args = { requestKey: `reprint-v2-${Date.now()-8*86400000}-expired`, userId: 4, action: 'inbound.reprint', resourceId: 9, payload: { mode: 'task' }, scopeWarehouseIds: null }
  await assert.rejects(helper.beginReprintIntent({}, args), { code: 'PRINT_REPRINT_INTENT_EXPIRED' })
  await assert.rejects(helper.beginReprintIntent({}, { ...args, requestKey: 'legacy-no-time' }), { code: 'PRINT_REPRINT_INTENT_UNKNOWN' })
  const check = s => { assert.match(s, /age >= 7 \* 86400000 - 120000/); assert.match(s, /PRINT_REPRINT_INTENT_EXPIRED/); assert.match(s, /PRINT_REPRINT_INTENT_UNKNOWN/) }
  const src = source('backend/src/modules/print-jobs/print-jobs.reprint-intent.js'); check(src)
  assert.throws(() => check(src.replace('age >= 7 * 86400000 - 120000', 'false')))
})
