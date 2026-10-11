 'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { createRequire } = require('node:module')
const filename = path.resolve(__dirname, '../backend/src/modules/inbound-tasks/inbound-tasks.command.js')
function fixture({ count = 2, integer = false } = {}) {
  const local = createRequire(filename), module_ = { exports: {} }, calls = [], writes = []
  const candidates = Array.from({ length: count }, (_, index) => ({ purchaseItemId: index + 31, purchaseOrderId: 3, purchaseOrderNo: '可信PO', supplierId: 5, supplierName: '可信供应商', warehouseId: 2, warehouseName: '可信仓', productId: 7, productName: '商品', productCode: 'P7', unit: '个', remainingQty: 10 }))
  const conn = { query: async (sql, params = []) => {
    calls.push({ sql, params })
    if (/INSERT INTO/.test(sql)) { writes.push({ sql, params }); return [{ insertId: 9 }] }
    if (/SELECT \* FROM purchase_orders/.test(sql)) return [[{ id: 3, order_no: '可信PO', supplier_id: 5, supplier_name: '可信供应商', warehouse_id: 2, warehouse_name: '可信仓', status: 2 }]]
    if (/SELECT \* FROM purchase_order_items/.test(sql)) return [candidates.map(i => ({ id: i.purchaseItemId, order_id: 3 }))]
    if (/SELECT it.id/.test(sql)) return [[]]
    if (/^SET TRANSACTION/.test(sql)) return [[]]
    throw new Error(sql)
  }, beginTransaction: async () => calls.push({ sql: 'begin' }), commit: async () => calls.push({ sql: 'commit' }), rollback: async () => calls.push({ sql: 'rollback' }), release: () => calls.push({ sql: 'release' }) }
  const stubs = {
    // 无键创建走真实兼容分支；补打不在此夹具中，禁止加载其数据库依赖。
    './inbound-tasks.create-receipt': local('./inbound-tasks.create-receipt'),
    '../print-jobs/print-jobs.reprint-intent': { beginReprintIntent: () => assert.fail('创建专项不得补打'), completeReprintIntent: () => assert.fail('创建专项不得补打') },
    '../fulfillment/fulfillment.refresh': { commitFulfillment: async c => c.commit() }, '../../config/db': { pool: { getConnection: async () => conn } },
    '../../utils/qtyPrecision': { ...local('../../utils/qtyPrecision'), assertQtyPrecision: async (_c, rows) => { for (const row of rows) local('../../utils/qtyPrecision').assertQtyPrecisionWith({ allowDecimal: !integer }, row.qty) } },
    '../../engine/containerEngine': {}, '../print-jobs/print-jobs.service': {},
    './inbound-tasks.helpers': { genTaskNo: async () => 'IT-9', appendInboundEvent: async () => {} }, '../../config/env': { env: {} },
    '../../utils/warehouseScope': { assertInScope: (scope, id) => { if (Array.isArray(scope) && !scope.includes(Number(id))) throw Object.assign(new Error('scope'), { statusCode: 403, code: 'WAREHOUSE_SCOPE_DENIED' }) } },
    './inbound-tasks.status': {}, './inbound-tasks.putaway': {},
    './inbound-tasks.query': { loadPurchasableCandidates: async (_c, args) => { calls.push({ sql: 'sources', params: args }); return candidates } }, '../../utils/operationRequest': {},
  }
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module: module_, require: id => Object.hasOwn(stubs, id) ? stubs[id] : local(id), Date }, { filename })
  return { svc: module_.exports, calls, writes, candidates }
}
test('manual建单供应商/仓库快照取可信采购来源，运输空与0均持久且明细批量写', async () => {
  const f = fixture()
  await f.svc.createManualTask({ supplierId: 5, supplierName: '伪客户端名', freightType: 2, freightAmount: 0, items: [{ purchaseItemId: 31, qty: 1 }, { purchaseItemId: 32, qty: 1 }] }, [2])
  const head = f.writes.find(w => /INSERT INTO inbound_tasks/.test(w.sql))
  assert.equal(head.params[3], '可信供应商'); assert.equal(head.params[4], 2)
  assert.deepEqual(Array.from(head.params).slice(-2), [2, 0])
  assert.match(f.writes[1].sql, /VALUES \?/); assert.equal(f.writes[1].params[0].length, 2)
  const locks = f.calls.find(c => c.sql === 'sources').params
  assert.equal(locks.forUpdate, true); assert.deepEqual(Array.from(locks.scopeWarehouseIds), [2])
  assert.match(f.calls[0].sql, /SET TRANSACTION ISOLATION LEVEL READ COMMITTED/)
})
test('poId旧客户端省略transport保持NULL且头字段全部来自同事务真实采购锁', async () => {
  const f = fixture()
  await f.svc.createFromPoId(3, [2])
  assert.match(f.calls[2].sql, /purchase_orders.*FOR UPDATE/)
  assert.match(f.calls[3].sql, /purchase_order_items.*ORDER BY id FOR UPDATE/)
  const head = f.writes.find(w => /INSERT INTO inbound_tasks/.test(w.sql))
  assert.deepEqual(Array.from(head.params).slice(1), [3, '可信PO', '可信供应商', 2, '可信仓', null, null])
})
test('poId可选transport字段持久，并继续商品整数规则', async () => {
  const f = fixture()
  await f.svc.createFromPoId(3, [2], { freightType: 3, freightAmount: 4.5 })
  assert.deepEqual(Array.from(f.writes[0].params).slice(-2), [3, 4.5])
  const fail = fixture({ integer: true }); fail.candidates[0].remainingQty = 1.5
  await assert.rejects(fail.svc.createFromPoId(3, [2]), { code: 'QTY_INTEGER_REQUIRED' })
  assert.equal(fail.writes.length, 0)
})
test('manual重复来源和原始超精度在写前拒绝，800行合法建单不受查询批200上限影响', async () => {
  const fail = fixture()
  await assert.rejects(fail.svc.createManualTask({ supplierId: 5, supplierName: 'x', items: [{ purchaseItemId: 31, qty: 1 }, { purchaseItemId: 31, qty: 2 }] }), { code: 'INBOUND_EDIT_DUPLICATE_SOURCE' })
  await assert.rejects(fail.svc.createManualTask({ supplierId: 5, supplierName: 'x', items: [{ purchaseItemId: 31, qty: 1.001 }] }), { code: 'QTY_DECIMALS_EXCEEDED' })
  assert.equal(fail.writes.length, 0)
  const f = fixture({ count: 800 })
  await f.svc.createManualTask({ supplierId: 5, supplierName: 'x', items: f.candidates.map(c => ({ purchaseItemId: c.purchaseItemId, qty: 1 })) }, [2])
  assert.equal(f.writes[1].params[0].length, 800)
})
