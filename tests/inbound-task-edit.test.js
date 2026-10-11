 'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { createRequire } = require('node:module')
const root = path.resolve(__dirname, '../backend/src/modules/inbound-tasks')
const rulesFile = path.join(root, 'inbound-tasks.edit-rules.js')
const rules = fs.existsSync(rulesFile) ? require(rulesFile) : {}
const stableStringify = value => value === null || typeof value !== 'object' ? JSON.stringify(value ?? null) : Array.isArray(value) ? `[${value.map(stableStringify).join(',')}]` : `{${Object.keys(value).filter(k => value[k] !== undefined).sort().map(k => JSON.stringify(k) + ':' + stableStringify(value[k])).join(',')}}`
const draft = (extra = {}) => ({ id: 1, task_no: 'IT-1', status: 1, submitted_at: null, warehouse_id: 2, lock_version: 0, remark: null, freight_type: null, freight_amount: null, ...extra })
const line = (extra = {}) => ({ id: 11, task_id: 1, purchase_order_id: 3, purchase_item_id: 31, product_id: 7, product_name: '商品', ordered_qty: '3.00', received_qty: '0.00', putaway_qty: '0.00', ...extra })
const source = (extra = {}) => ({ purchaseItemId: 31, purchaseOrderId: 3, purchaseOrderNo: 'PO-3', supplierId: 5, supplierName: '可信供应商', warehouseId: 2, warehouseName: '仓库', productId: 7, productCode: 'P7', productName: '商品', unit: '个', remainingQty: 10, orderedQty: 10, unitPrice: 9, ...extra })

test('编辑领域规则存在', () => assert.equal(typeof rules.editFingerprint, 'function'))
test('只有未提交、完整零执行、无任何未删容器的非空草稿可编辑', () => {
  assert.equal(rules.isDraftEditable(draft(), [line()], 0), true)
  for (const [head, items, count] of [
    [draft({ status: 2 }), [line()], 0], [draft({ submitted_at: '2026-10-10' }), [line()], 0],
    [draft(), [], 0], [draft(), [line({ received_qty: 1 }), line({ received_qty: -1 })], 0],
    [draft(), [line({ putaway_qty: -1 })], 0], [draft(), [line()], 1],
    [draft(), [line({ received_qty: null })], 0],
  ]) assert.equal(rules.isDraftEditable(head, items, count), false)
})
test('基线含完整持久头行与lockVersion，行排序稳定', () => {
  const items = [line(), line({ id: 12, purchase_item_id: 32 })]
  const original = rules.editFingerprint(draft(), items)
  assert.match(original, /^[a-f0-9]{64}$/)
  assert.equal(rules.editFingerprint(draft(), items.slice().reverse()), original)
  for (const [head, rows] of [[draft({ lock_version: 1 }), items], [draft({ submitted_at: 'x' }), items], [draft({ freight_amount: '0.00' }), items], [draft(), [line({ ordered_qty: 4 }), items[1]]], [draft(), [line({ product_code: 'changed' }), items[1]]]]) assert.notEqual(rules.editFingerprint(head, rows), original)
})
test('重复采购行拒绝，同商品不同采购行保留', () => {
  assert.throws(() => rules.normalizeEditItems([{ purchaseItemId: 31, qty: 1 }, { purchaseItemId: 31, qty: 2 }]), { code: 'INBOUND_EDIT_DUPLICATE_SOURCE' })
  assert.equal(rules.normalizeEditItems([{ purchaseItemId: 31, qty: 1 }, { purchaseItemId: 32, qty: 2 }]).length, 2)
})
test('原始两位数量在舍入之前拒绝', () => {
  assert.throws(() => rules.normalizeEditItems([{ purchaseItemId: 31, qty: 1.001 }]), { code: 'QTY_DECIMALS_EXCEEDED' })
  for (const qty of [0, -1, null, '', NaN, '1']) assert.throws(() => rules.normalizeEditItems([{ purchaseItemId: 31, qty }]))
})
test('运费仅接受nullable枚举和非负两位金额，空与0不同，省略沿原值', () => {
  assert.deepEqual(rules.normalizeFreight({}, draft({ freight_type: 2, freight_amount: '4.50' })), { freightType: 2, freightAmount: 4.5 })
  assert.deepEqual(rules.normalizeFreight({ freightType: null, freightAmount: 0 }), { freightType: null, freightAmount: 0 })
  assert.deepEqual(rules.normalizeFreight({ freightAmount: null }), { freightType: null, freightAmount: null })
  for (const body of [{ freightType: 4 }, { freightType: '1' }, { freightAmount: -1 }, { freightAmount: 1.001 }, { freightAmount: '' }, { freightAmount: Infinity }]) assert.throws(() => rules.normalizeFreight(body), { code: 'INBOUND_FREIGHT_INVALID' })
})

function fixture(options = {}) {
  const filename = path.join(root, 'inbound-tasks.edit.js')
  if (!fs.existsSync(filename)) return { svc: {}, writes: [], calls: [] }
  const localRequire = createRequire(filename)
  let head = draft(), items = options.items || [line(), line({ id: 12, purchase_item_id: 32 })]
  if (options.head) head = draft(options.head)
  const calls = [], writes = []
  const sourceOrders = () => [{ id: 3, supplier_id: options.sourceSupplierId ?? 5, warehouse_id: 2, status: options.sourceStatus ?? 2, deleted_at: null }]
  const sourceItem = id => ({ id, order_id: 3, product_id: 7, quantity: options.sourceQuantity ?? 10, unit_price: options.sourcePrice ?? 9, unit: options.sourceUnit ?? '个' })
  const sourceFacts = () => ({ orders: sourceOrders(), items: items.map(i => sourceItem(i.purchase_item_id)) })
  let released = false, commits = 0, rollbacks = 0
  const conn = {
    beginTransaction: async () => calls.push('begin'),
    commit: async () => { calls.push('commit'); commits++; if (options.commitError) throw Object.assign(new Error('commit unknown'), { statusCode: 409 }) },
    rollback: async () => { calls.push('rollback'); rollbacks++; if (options.rollbackError) throw new Error('rollback unknown') },
    release: () => { released = true },
    query: async (sql, params = []) => {
      calls.push(sql)
      if (/^(SET|START TRANSACTION)/.test(sql)) return [[]]
      if (/^(UPDATE|INSERT|DELETE)/.test(sql.trim())) { writes.push({ sql, params }); return [{ affectedRows: 1, insertId: 40 }] }
      if (/FROM inbound_tasks WHERE id/.test(sql)) return [[head]]
      if (/FROM inbound_task_items/.test(sql)) return [items]
      if (/FROM purchase_order_items/.test(sql)) return [items.map(i => sourceItem(i.purchase_item_id))]
      if (/FROM purchase_orders/.test(sql)) return [sourceOrders()]
      if (/FROM inventory_containers/.test(sql)) return [options.container ? [{ id: 99, is_legacy: 1 }] : []]
      throw new Error('Unhandled SQL: ' + sql)
    },
  }
  const request = { enabled: true, id: 20, userId: 8, action: 'inbound.update.1', replay: !!options.replay, responseData: options.replay }
  const query = {
    findById: async () => ({ id: 1, taskNo: 'IT-1', items: items.map(i => ({ id: i.id, purchaseItemId: i.purchase_item_id, orderedQty: Number(i.ordered_qty) })) }),
    lockPurchasableSources: async (_conn, ids) => ({ orders: sourceOrders(), items: ids.map(sourceItem) }),
    loadPurchasableCandidates: async (_conn, args) => { calls.push('sources:' + JSON.stringify(args)); return (args.purchaseItemIds || items.map(i => i.purchase_item_id)).filter(id => !options.unavailableId || id !== options.unavailableId).map(id => source({ purchaseItemId: id, supplierId: options.sourceSupplierId ?? 5, remainingQty: options.remainingQty ?? 10, ...(options.foreign ? { warehouseId: 9 } : {}) })) },
  }
  const stubs = {
    '../../config/db': { pool: { getConnection: async () => conn } },
    '../../utils/warehouseScope': { assertInScope: (scope, id) => { if (Array.isArray(scope) && !scope.includes(Number(id))) throw Object.assign(new Error('scope'), { statusCode: 403, code: 'WAREHOUSE_SCOPE_DENIED' }) } },
    '../../utils/operationRequest': { stableStringify, beginResourceOperationRequest: async () => { calls.push('request'); if (options.requestError) throw Object.assign(new Error('pending'), { statusCode: 409 }); return request }, completeOperationRequest: async (_conn, _req, data) => { calls.push('complete'); writes.push({ receipt: data }) } },
    '../../utils/qtyPrecision': { ...localRequire('../../utils/qtyPrecision'), assertQtyPrecision: async (_conn, rows) => { for (const row of rows) localRequire('../../utils/qtyPrecision').assertQtyPrecisionWith({ allowDecimal: !options.integer }, row.qty) } },
    './inbound-tasks.query': query,
    './inbound-tasks.helpers': { appendInboundEvent: async () => { calls.push('event'); writes.push({ event: true }) } },
    './inbound-tasks.edit-receipt': { replayInboundEdit: async () => options.replay },
  }
  const module_ = { exports: {} }
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module: module_, require: id => Object.hasOwn(stubs, id) ? stubs[id] : localRequire(id), Date, Buffer }, { filename })
  const body = { remark: '保存备注', items: [{ purchaseItemId: 31, qty: 2 }, { purchaseItemId: 33, qty: 1 }], expectedEditFingerprint: rules.editFingerprint(head, items, sourceFacts()) }
  return { svc: module_.exports, body, calls, writes, conn, request, get head() { return head }, get items() { return items }, get sourceFacts() { return sourceFacts() }, result: () => ({ released, commits, rollbacks }) }
}

test('编辑服务存在', () => assert.equal(typeof fixture().svc.updateDraft, 'function'))
test('保存保留原采购行ID，仅移除消失行且新增行批量写；事件与回执先于commit', async () => {
  const f = fixture()
  const result = await f.svc.updateDraft(1, f.body, { userId: 8, requestKey: 'key', scopeWarehouseIds: [2] })
  assert.equal(result.taskId, 1)
  assert.match(result.expectedEditFingerprint, /^[a-f0-9]{64}$/)
  assert.equal(f.writes.filter(w => /INSERT INTO inbound_task_items/.test(w.sql || '')).length, 1)
  assert.match(f.writes.find(w => /INSERT INTO inbound_task_items/.test(w.sql || '')).sql, /VALUES \?/)
  assert.ok(f.writes.some(w => /UPDATE inbound_task_items/.test(w.sql || '') && JSON.stringify(w.params).includes('11')))
  assert.ok(f.writes.some(w => /DELETE FROM inbound_task_items/.test(w.sql || '') && JSON.stringify(w.params).includes('12')))
  assert.ok(f.calls.indexOf('complete') < f.calls.indexOf('commit'))
  assert.ok(f.calls.indexOf('event') < f.calls.indexOf('commit'))
  assert.equal(f.result().released, true)
})
for (const [name, options, mutate, code] of [
  ['过期基线', {}, b => { b.expectedEditFingerprint = '0'.repeat(64) }, 'INBOUND_EDIT_CONFLICT'],
  ['已提交', { head: { submitted_at: 'x' } }, () => {}, 'INBOUND_TASK_NOT_EDITABLE'],
  ['legacy容器', { container: true }, () => {}, 'INBOUND_TASK_NOT_EDITABLE'],
  ['超出剩余量', { remainingQty: 1 }, () => {}, 'INBOUND_EDIT_QTY_EXCEEDED'],
  ['整数商品小数', { integer: true }, b => { b.items[0].qty = 1.5 }, 'QTY_INTEGER_REQUIRED'],
  ['新来源跨仓', { foreign: true }, () => {}, 'INBOUND_PURCHASE_SOURCE_INVALID'],
]) test(name + '首次新请求回滚且提供明确未执行证明', async () => {
  const f = fixture(options); mutate(f.body)
  await assert.rejects(f.svc.updateDraft(1, f.body, { userId: 8, requestKey: 'key', scopeWarehouseIds: [2] }), error => error.code === code && error.data?.inboundEditNotExecuted === true)
  assert.equal(f.writes.filter(w => /^(UPDATE|INSERT|DELETE)/.test(w.sql || '')).length, 0)
  assert.equal(f.result().rollbacks, 1)
})
test('当前范围在幂等回放之前复核', async () => {
  const f = fixture({ replay: { taskId: 1 } })
  await assert.rejects(f.svc.updateDraft(1, f.body, { userId: 8, requestKey: 'key', scopeWarehouseIds: [9] }), { code: 'WAREHOUSE_SCOPE_DENIED' })
  assert.equal(f.calls.includes('request'), false)
})
test('缺requestKey不能开始写事务', async () => {
  const f = fixture()
  await assert.rejects(f.svc.updateDraft(1, f.body, { userId: 8 }), { code: 'REQUEST_KEY_REQUIRED' })
  assert.equal(f.calls.includes('begin'), false)
})
test('成功原键在后续非草稿可回放，无新写', async () => {
  const f = fixture({ head: { status: 2 }, replay: { taskId: 1, taskNo: 'IT-1', expectedEditFingerprint: 'a'.repeat(64) } })
  f.request.responseData.requestFingerprint = rules.requestFingerprint(f.body)
  const result = await f.svc.updateDraft(1, f.body, { userId: 8, requestKey: 'key', scopeWarehouseIds: [2] })
  assert.equal(result.taskId, 1)
  assert.equal(f.writes.length, 0)
})
test('同键不同载荷409，不能标记未执行', async () => {
  const f = fixture({ replay: { taskId: 1, taskNo: 'IT-1', expectedEditFingerprint: 'a'.repeat(64), requestFingerprint: 'b'.repeat(64) } })
  await assert.rejects(f.svc.updateDraft(1, f.body, { userId: 8, requestKey: 'key' }), e => e.code === 'INBOUND_EDIT_REQUEST_CONFLICT' && !e.data?.inboundEditNotExecuted)
})
for (const [name, options] of [['pending', { requestError: true }], ['commit不确定', { commitError: true }], ['rollback失败', { rollbackError: true, remainingQty: 1 }]]) test(name + '不声称未执行', async () => {
  const f = fixture(options)
  await assert.rejects(f.svc.updateDraft(1, f.body, { userId: 8, requestKey: 'key' }), e => !e.data?.inboundEditNotExecuted)
})

test('800条合法草稿完整保存且所有原采购行ID保留，不新增/删除原行', async () => {
  const items = Array.from({ length: 800 }, (_, index) => line({ id: 1000 + index, purchase_item_id: 2000 + index }))
  const f = fixture({ items })
  f.body.items = items.map(i => ({ purchaseItemId: i.purchase_item_id, qty: 2 }))
  await f.svc.updateDraft(1, f.body, { userId: 8, requestKey: '800-lines' })
  const update = f.writes.find(w => /UPDATE inbound_task_items/.test(w.sql || ''))
  assert.equal(update.params.at(-1).length, 800)
  assert.equal(update.params.at(-1).at(-1), 1799)
  assert.equal(f.writes.some(w => /INSERT INTO inbound_task_items|DELETE FROM inbound_task_items/.test(w.sql || '')), false)
})
test('上下文保留采购状态失效和余量不足的全部原行，基线来自同份持久数据', async () => {
  const f = fixture({ sourceStatus: 4, unavailableId: 32, remainingQty: 1 })
  const ctx = await f.svc.getEditContext(1, [2])
  assert.equal(ctx.task.items.length, 2)
  assert.equal(ctx.candidates.length, 2)
  assert.equal(ctx.candidates[0].remainingQty, 1)
  assert.equal(ctx.candidates[1].purchaseItemId, 32)
  assert.equal(ctx.candidates[1].sourceAvailable, false)
  assert.equal(ctx.expectedEditFingerprint, rules.editFingerprint(f.head, f.items, f.sourceFacts))
})
test('800行上下文完整取齐不使用公共精确ID200上限', async () => {
  const items = Array.from({ length: 800 }, (_, index) => line({ id: index + 1000, purchase_item_id: index + 2000 }))
  const f = fixture({ items })
  const ctx = await f.svc.getEditContext(1, [2])
  assert.equal(ctx.task.items.length, 800)
  assert.equal(ctx.candidates.length, 800)
  assert.equal(ctx.candidates.at(-1).purchaseItemId, 2799)
})
test('原采购状态失效即使移除该行也拒绝保存，保留全部原单', async () => {
  const f = fixture({ sourceStatus: 4 })
  await assert.rejects(f.svc.updateDraft(1, f.body, { userId: 8, requestKey: 'invalid-source' }), e => e.code === 'INBOUND_PURCHASE_SOURCE_INVALID' && e.data?.inboundEditNotExecuted)
  assert.equal(f.writes.length, 0)
})
test('有界edit候选默认200并固定服务器供应商仓库；公开exact IDs每批最多200', async () => {
  const f = fixture()
  await f.svc.findEditPurchasableItems(1, { supplierId: 99, warehouseId: 99, pageSize: 99999 }, [2])
  const sourceCall = f.calls.find(c => typeof c === 'string' && c.startsWith('sources:'))
  const args = JSON.parse(sourceCall.slice(8))
  assert.equal(args.supplierId, 5); assert.equal(args.warehouseId, 2)
  assert.equal(args.excludeTaskId, 1); assert.equal(args.readPage.pageSize, 200)
  await assert.rejects(f.svc.findEditPurchasableItems(1, { purchaseItemIds: Array(201).fill('31').join(',') }, [2]), { statusCode: 400 })
})
test('候选页码产生不安全offset时拒绝，禁止溢出或无界数据库偏移', async () => {
  const f = fixture()
  await assert.rejects(f.svc.findEditPurchasableItems(1, { page: Number.MAX_SAFE_INTEGER, pageSize: 200 }, [2]), { statusCode: 400 })
})

test('原采购来源供应商/数量/单价/单位在context后变化，旧基线拒绝而不跟随覆盖', async () => {
  for (const [field, value] of [['sourceSupplierId', 6], ['sourceQuantity', 11], ['sourcePrice', 12], ['sourceUnit', '箱']]) {
    const options = {}, f = fixture(options)
    options[field] = value
    await assert.rejects(f.svc.updateDraft(1, f.body, { userId: 8, requestKey: 'old-source-' + field }), error => error.code === 'INBOUND_EDIT_CONFLICT' && error.data?.inboundEditNotExecuted === true)
    assert.equal(f.writes.length, 0)
  }
})
test('运费高位金额仍严格两位，合法14,2上界可记录且无金额舍入', () => {
  for (const freightAmount of [999999999999.9803, 999999999999.9802, 100000000000.01003, 1e-3, 1e-7]) assert.throws(() => rules.normalizeFreight({ freightAmount }), { code: 'INBOUND_FREIGHT_INVALID' })
  for (const freightAmount of [999999999999.99, 100000000000.01, 1.1, 0.01, 0, null]) assert.equal(rules.normalizeFreight({ freightAmount }).freightAmount, freightAmount)
})
