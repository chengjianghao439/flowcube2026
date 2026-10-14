'use strict'
// Real confirm orchestration; external DB/engine boundaries record calls.
// The isolated native MySQL barrier driver separately proves the ABBA candidate.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const root = path.resolve(__dirname, '..')
const backend = path.join(root, 'backend/src')
function loader(overrides) {
  const cache = new Map()
  function load(file) {
    file = path.resolve(file)
    if (overrides.has(file)) return overrides.get(file)
    if (cache.has(file)) return cache.get(file).exports
    const m = new Module(file, module); m.filename = file; m.paths = Module._nodeModulePaths(path.dirname(file)); cache.set(file, m)
    const native = m.require.bind(m)
    m.require = name => name.startsWith('.') ? load(require.resolve(path.resolve(path.dirname(file), name))) : native(name)
    const previous = process.env.FLOWCUBE_TRANSFER_LOCK_BASELINE_DIR && path.join(process.env.FLOWCUBE_TRANSFER_LOCK_BASELINE_DIR, path.relative(root, file))
    m._compile(fs.readFileSync(previous && fs.existsSync(previous) ? previous : file, 'utf8'), file)
    return m.exports
  }
  return load
}
function fixture(items, { available = new Map(), from = 8, to = 9, status = 1 } = {}) {
  const calls = []; const head = { id: 71, order_no: 'SYNTHETIC-TRANSFER', from_warehouse_id: from, to_warehouse_id: to, status }
  const conn = {
    async beginTransaction() { calls.push(['begin']) },
    async rollback() { calls.push(['rollback']) },
    release() { calls.push(['release']) },
    async query(sql, params) {
      if (sql.includes('FROM transfer_order_items')) return [items.map((item, index) => ({ id: index + 1, product_id: item.id, product_name: '合成商品' + item.id, quantity: item.qty }))]
      if (sql.startsWith('UPDATE transfer_orders SET submitted_at')) { calls.push(['submitted', params[2]]); return [{ affectedRows: 1 }] }
      throw new Error('Unexpected confirm SQL: ' + sql)
    },
  }
  const overrides = new Map([
    [path.join(backend, 'config/db.js'), { pool: { getConnection: async () => conn } }],
    [path.join(backend, 'engine/inventoryEngine.js'), {}],
    [path.join(backend, 'engine/containerEngine.js'), {
      async lockStockDimension(_conn, productId, warehouseId) { calls.push(['dimension', Number(productId), Number(warehouseId)]) },
      async getAvailableStockForDecision(_conn, input) { calls.push(['availability', Number(input.productId), Number(input.warehouseId), input.lock]); return { available: available.get(Number(input.productId)) ?? 10 } },
    }],
    [path.join(backend, 'utils/qtyPrecision.js'), { async assertQtyPrecision(_conn, rows) { calls.push(['policy', rows.map(r => Number(r.productId)), rows.map(r => r.qty)]) } }],
    [path.join(backend, 'utils/statusTransition.js'), {
      async lockStatusRow() { calls.push(['head', head.id]); return head },
      async compareAndSetStatus(_conn, input) { calls.push(['status', input.toStatus]); head.status = input.toStatus },
    }],
    [path.join(backend, 'modules/fulfillment/fulfillment.refresh.js'), { async commitFulfillment() { calls.push(['commit']) } }],
    [path.join(backend, 'modules/transfer/transfer-events.service.js'), { TRANSFER_EVENT: { CONFIRMED: 'TRANSFER_CONFIRMED' }, async record(_conn, event) { calls.push(['event', event.eventType]) } }],
  ])
  const service = loader(overrides)(path.join(backend, 'modules/transfer/transfer.service.js'))
  return { service, calls, head }
}
for (const items of [[{ id: 9, qty: 2 }, { id: 3, qty: 1 }], [{ id: 3, qty: 1 }, { id: 9, qty: 2 }], [{ id: '20', qty: 2 }, { id: '3', qty: 1 }]]) {
  test('调拨confirm不同原明细顺序都在可用量读取前取齐按商品/仓有序维度', async () => {
    const f = fixture(items); await f.service.confirm(71)
    const ids = items.map(i => Number(i.id)).sort((a,b) => a-b)
    assert.deepEqual(f.calls.filter(c => c[0] === 'dimension'), ids.map(id => ['dimension', id, 8]))
    const firstRead = f.calls.findIndex(c => c[0] === 'availability')
    assert.ok(f.calls.filter(c => c[0] === 'dimension').every(c => f.calls.indexOf(c) < firstRead))
    assert.deepEqual(f.calls.filter(c => c[0] === 'availability').map(c => c[1]), items.map(i => Number(i.id)), 'preserve original error/display order')
    assert.equal(f.head.status, 2); assert.equal(f.calls.at(-2)[0], 'commit'); assert.equal(f.calls.at(-1)[0], 'release')
  })
}
test('调拨confirm批量当前策略S锁在第一个库存维度之前，mutex零量不新增数量口径', async () => {
  const f = fixture([{ id: 9, qty: 0.25 }, { id: 3, qty: 0.75 }]); await f.service.confirm(71)
  const policy = f.calls.find(c => c[0] === 'policy')
  assert.deepEqual(policy, ['policy', [3,9], [0,0]])
  assert.ok(f.calls.indexOf(policy) < f.calls.findIndex(c => c[0] === 'dimension'))
})
test('重复SKU按同一源仓去重预锁，原合并需求与可用量口径保留', async () => {
  const f = fixture([{ id: 9, qty: 1 }, { id: 3, qty: 1 }, { id: 9, qty: 2 }, { id: 3, qty: 3 }], { available: new Map([[9,3],[3,4]]) })
  await f.service.confirm(71)
  assert.deepEqual(f.calls.filter(c => c[0] === 'dimension'), [['dimension',3,8],['dimension',9,8]])
  assert.deepEqual(f.calls.filter(c => c[0] === 'availability').map(c => c[1]), [9,3])
  assert.ok(f.calls.filter(c => c[0] === 'availability').every(c => c[3] === true))
})
test('原首项不足仍按原商品文案拒绝，全部预锁先取齐且状态/事件不推进', async () => {
  const f = fixture([{ id: 9, qty: 4 }, { id: 3, qty: 1 }], { available: new Map([[9,3]]) })
  await assert.rejects(f.service.confirm(71), { statusCode: 400, message: '调拨库存不足：合成商品9 可用 3，申请 4' })
  assert.deepEqual(f.calls.filter(c => c[0] === 'dimension'), [['dimension',3,8],['dimension',9,8]])
  assert.equal(f.head.status, 1); assert.ok(!f.calls.some(c => ['status','submitted','event','commit'].includes(c[0])))
  assert.deepEqual(f.calls.slice(-2), [['rollback'],['release']])
})
test('后项不足同样完整回滚，不产生确认事件或部分状态', async () => {
  const f = fixture([{ id: 9, qty: 1 }, { id: 3, qty: 5 }], { available: new Map([[3,4]]) })
  await assert.rejects(f.service.confirm(71), { statusCode: 400 })
  assert.equal(f.head.status, 1); assert.ok(!f.calls.some(c => c[0] === 'event')); assert.deepEqual(f.calls.slice(-2), [['rollback'],['release']])
})
test('空调拨明细、同仓、错误状态均保持原拒绝且不取任何维度', async () => {
  for (const [items, options] of [[[], {}], [[{ id: 3, qty: 1 }], { from: 8, to: 8 }], [[{ id: 3, qty: 1 }], { status: 2 }]]) {
    const f = fixture(items, options); await assert.rejects(f.service.confirm(71))
    assert.ok(!f.calls.some(c => ['policy','dimension','availability','event','commit'].includes(c[0])))
    assert.deepEqual(f.calls.slice(-2), [['rollback'],['release']])
  }
})
test('原仓范围任一端允许、两端都不在scope拒绝，scope检查先于新预锁', async () => {
  for (const scope of [[8],[9]]) { const f = fixture([{ id: 3, qty: 1 }]); await f.service.confirm(71, null, scope); assert.equal(f.head.status, 2) }
  const f = fixture([{ id: 3, qty: 1 }]); await assert.rejects(f.service.confirm(71, null, [10]), { statusCode: 403, code: 'WAREHOUSE_SCOPE_DENIED' })
  assert.ok(!f.calls.some(c => ['policy','dimension','availability'].includes(c[0])))
})
