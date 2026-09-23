const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const path = require('node:path')
const { createRequire } = require('node:module')

function load(filename, stubs) {
  const full = path.resolve(__dirname, filename), localRequire = createRequire(full), module_ = { exports: {} }
  vm.runInNewContext(fs.readFileSync(full, 'utf8'), { module: module_, require: name => stubs[name] || localRequire(name), Buffer, setInterval, clearInterval }, { filename: full })
  return module_.exports
}
function fixture({ sourceRows, stocks = new Map() } = {}) {
  let computations = 0
  const procurement = load('../backend/src/modules/inventory/inventory.procurement.js', {
    '../../config/db': { pool: { query: async sql => {
      if (sql.includes('FROM (\n      SELECT product_id')) {
        computations++
        return [(sourceRows || [1, 2, 3].map(id => ({ product_id: id, warehouse_id: 2, product_code: `P${id}`, product_name: `Product ${id}`, unit: '个', warehouse_name: '仓库', total_sold: 0, recent_sold: 0, confirmed_demand: 10 + id, draft_demand: 0, safety_stock: 0, reorder_point: 0, target_stock: 0, lead_time: 0, pack_multiple: 0, minimum_order_qty: 0, conversion_rate: 1 })))]
      }
      if (sql.includes('coverage GROUP')) return [[]]
      throw Error(sql)
    } } },
    '../../utils/warehouseScope': { scopeFilter: () => ({ sql: '', params: [] }) },
    '../../engine/containerEngine': { getStockProjections: async (_conn, pairs) => new Map(pairs.map(p => [`${p.productId}:${p.warehouseId}`, stocks.get(`${p.productId}:${p.warehouseId}`) || { quantity: 0, reserved: 0, available: 0 }])) },
    '../../utils/expectedStock': { getExpectedStock: async () => ({ supplyItems: [], byPair: new Map(), boundByPair: new Map() }) },
  })
  const controller = load('../backend/src/modules/inventory/inventory.controller.js', {
    './inventory.service': {}, './inventory.aging': {}, './inventory.procurement': procurement,
    '../../utils/response': { successResponse: (_res, data) => data }, '../../utils/operator': {}, '../../utils/requestKey': {},
  })
  const request = (query = {}, user = { userId: 7, warehouseIds: [2, 3] }) => controller.procurementPlan({ query: { pageSize: 2, ...query }, user }, {}, error => { throw error })
  return { request, procurement, get computations() { return computations } }
}

test('真实采购预测入口两页只计算一次，后续复用首次排序与总数', async () => {
  const f = fixture(), first = await f.request()
  assert.equal(first.list.length, 2)
  const second = await f.request({ page: 2, snapshotId: first.snapshotId })
  assert.equal(f.computations, 1)
  assert.equal(typeof first.snapshotId, 'string')
  assert.equal(second.snapshotId, first.snapshotId)
  assert.equal(second.pagination.total, 3)
  assert.equal(second.list[0].productId, 1)
})
test('用户、当前仓库范围、筛选条件与批次大小都绑定，拒绝串读', async () => {
  const f = fixture(), first = await f.request()
  for (const [query, user] of [
    [{}, { userId: 8, warehouseIds: [2, 3] }],
    [{}, { userId: 7, warehouseIds: [2] }],
    [{ keyword: 'changed' }, undefined],
    [{ pageSize: 1 }, undefined],
  ]) {
    await assert.rejects(f.request({ page: 2, snapshotId: first.snapshotId, ...query }, user), error => error.statusCode === 409 && error.code === 'PROCUREMENT_SNAPSHOT_RESTART')
  }
  const next = await f.request({ page: 2, snapshotId: first.snapshotId }, { userId: 7, warehouseIds: [3, 2] })
  assert.equal(next.list.length, 1)
  assert.equal(f.computations, 1)
})
test('续页没有有效 ID 或实例丢失时明确要求刷新，不隐式重算', async () => {
  const f = fixture()
  for (const snapshotId of [undefined, 'unknown-snapshot']) {
    await assert.rejects(f.request({ page: 2, snapshotId }), error => error.code === 'PROCUREMENT_SNAPSHOT_RESTART')
  }
  assert.equal(f.computations, 0)
})

test('过期即拒绝、读取不延长有效期，定期清理可释放条数与字节预算', () => {
  const { createProcurementSnapshots } = require('../backend/src/modules/inventory/procurement.snapshots')
  let now = 0
  const store = createProcurementSnapshots({ now: () => now, ttlMs: 100, maxSnapshots: 2, maxRows: 2, maxBytes: 1024 })
  const first = store.save('owner', { list: [{ id: 1 }] })
  now = 90; assert.equal(store.read(first.snapshotId, 'owner').result.list[0].id, 1)
  now = 100; store.prune()
  assert.throws(() => store.read(first.snapshotId, 'owner'), error => error.code === 'PROCUREMENT_SNAPSHOT_RESTART')
  const second = store.save('owner', { list: [{ id: 2 }, { id: 3 }] })
  assert.equal(store.read(second.snapshotId, 'owner').result.list.length, 2)
})
test('缓存数量、累计条数、累计字节均有界，淘汰后不得重算，超大结果明确拒绝', () => {
  const { createProcurementSnapshots } = require('../backend/src/modules/inventory/procurement.snapshots')
  for (const limits of [{ maxSnapshots: 1 }, { maxRows: 1 }, { maxBytes: 85 }]) {
    const store = createProcurementSnapshots(limits)
    const first = store.save('owner', { list: [{ id: 1 }] })
    const second = store.save('owner', { list: [{ id: 2 }] })
    assert.throws(() => store.read(first.snapshotId, 'owner'), error => error.code === 'PROCUREMENT_SNAPSHOT_RESTART')
    assert.equal(store.read(second.snapshotId, 'owner').result.list[0].id, 2)
  }
  for (const limits of [{ maxRows: 1 }, { maxBytes: 5 }]) {
    assert.throws(() => createProcurementSnapshots(limits).save('owner', { list: [{ id: 1 }, { id: 2 }] }), error => error.code === 'PROCUREMENT_PREVIEW_TOO_LARGE')
  }
})
test('保留数据隔离于调用方对象变更及返回对象变更，其他进程不存在相同结果', () => {
  const { createProcurementSnapshots } = require('../backend/src/modules/inventory/procurement.snapshots')
  const store = createProcurementSnapshots(), result = { list: [{ id: 1 }], params: { window: 30 } }
  const first = store.save('owner', result)
  result.list[0].id = 2
  const read = store.read(first.snapshotId, 'owner'); read.result.list[0].id = 3
  assert.equal(store.read(first.snapshotId, 'owner').result.list[0].id, 1)
  assert.throws(() => createProcurementSnapshots().read(first.snapshotId, 'owner'), error => error.code === 'PROCUREMENT_SNAPSHOT_RESTART')
})


test('指定目标仓仍读取跨仓净额并保留正确调拨候选；预览限制不影响事务实时函数', async () => {
  const common = { product_id: 1, product_code: 'P1', product_name: 'Product', unit: '个', total_sold: 0, recent_sold: 0, draft_demand: 0, safety_stock: 0, reorder_point: 0, target_stock: 0, lead_time: 0, pack_multiple: 0, minimum_order_qty: 0, conversion_rate: 1 }
  const f = fixture({ sourceRows: [{ ...common, warehouse_id: 2, warehouse_name: '目标仓', confirmed_demand: 10 }, { ...common, warehouse_id: 3, warehouse_name: '来源仓', confirmed_demand: 3, safety_stock: 5 }], stocks: new Map([['1:3', { quantity: 30, reserved: 0, available: 30 }]]) })
  const result = await f.request({ warehouseId: 2 })
  assert.equal(result.list.length, 1)
  assert.equal(result.list[0].transferCandidates[0].warehouseId, 3)
  assert.equal(result.list[0].transferCandidates[0].quantity, 10)
  assert.equal(result.list[0].suggestedQty, 10)
  await f.procurement.getProcurementPlan({ warehouseId: 2 })
  assert.equal(f.computations, 2, '事务内调用不能复用旧预览')
  await assert.rejects(f.procurement.getProcurementPlan({ maxSourceRows: 1 }), error => error.code === 'PROCUREMENT_PREVIEW_TOO_LARGE')
})
