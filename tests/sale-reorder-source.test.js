// 只运行真实来源服务/路由；数据库连接与查询边界显式stub，不读取业务数据库。
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const base = path.join(__dirname, '../backend/src')
function load(file, replacements = {}) {
  const filename = path.join(base, file), module = { exports: {} }
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module, require: name => Object.hasOwn(replacements, name) ? replacements[name] : require(path.resolve(path.dirname(filename), name)) }, { filename })
  return module.exports
}
const scopeGuard = load('utils/warehouseScope.js', { '../config/db': {} })
const clean = value => JSON.parse(JSON.stringify(value))
function fixture({ model = 'ordinary', itemWarehouse = 8, groupWarehouse = 8, missingKit = false, groupRows = null } = {}) {
  const queries = [], events = []
  const conn = {
    async query(sql, params) {
      queries.push({ sql, params })
      if (/SET TRANSACTION|START TRANSACTION/.test(sql)) return []
      if (sql.includes('FROM sale_orders')) return [[{ id: 80, order_no: 'S80', customer_id: 4, warehouse_id: 8, commercial_model: model === 'ordinary' ? null : 'kit-v1', total_amount: 999, receiver_address: '不应复制' }]]
      if (sql.includes('FROM sale_order_items')) return [[{ id: 11, product_id: 3, warehouse_id: itemWarehouse, unit: '个', quantity: '12.00', unit_price: 99, entry_qty: 2, conversion_rate: 6 }, { id: 12, product_id: 3, warehouse_id: 8, unit: '个', quantity: '3.00' }]]
      if (sql.includes('FROM sale_commercial_groups')) return [groupRows || [{ id: 21, component_id: 31, product_id: 5, kind: 'kit', warehouse_id: groupWarehouse, kit_version_id: 41, kit_id: missingKit ? null : 7, target_qty: '2.00', superseded: 0 }, { id: 22, component_id: 32, kind: 'ordinary', warehouse_id: 8, product_id: 3, sale_item_id: 11, unit: '个', component_unit: '个', target_qty: '12.00', superseded: 0 }]]
      throw new Error(`未stub SQL ${sql}`)
    },
    async commit() { events.push('commit') }, async rollback() { events.push('rollback') }, release() { events.push('release') },
  }
  const service = load('modules/sale/sale.reorder-source.js', { '../../config/db': { pool: { getConnection: async () => conn } }, '../../utils/warehouseScope': scopeGuard })
  return { service, queries, events }
}
test('普通来源仅白名单身份/基本量，不携旧头价格；同商品旧仓分行透明保留', async () => {
  const f = fixture()
  const answer = clean(await f.service.findReorderSource(80, [8]))
  assert.deepEqual(answer, { id: 80, orderNo: 'S80', model: 'ordinary', customerId: 4, items: [{ kind: 'ordinary', productId: 3, baseUnit: '个', baseQty: 12 }, { kind: 'ordinary', productId: 3, baseUnit: '个', baseQty: 3 }] })
  assert.deepEqual(f.events, ['commit', 'release'])
  assert.equal(f.queries.filter(q => /^SELECT/.test(q.sql)).length, 3)
  assert.ok(f.queries[0].sql.includes('REPEATABLE READ')); assert.ok(f.queries[1].sql.includes('READ ONLY'))
})
test('头/所有历史物料/成交组整单范围先验，空范围拒绝，NULL范围全仓', async () => {
  for (const options of [{ itemWarehouse: 9 }, { model: 'kit-v1', groupWarehouse: 9 }, {}]) {
    const f = fixture(options)
    await assert.rejects(f.service.findReorderSource(80, Object.keys(options).length ? [8] : []), e => e.statusCode === 403)
    assert.deepEqual(f.events, ['rollback', 'release'])
  }
  assert.equal((await fixture({ itemWarehouse: 9 }).service.findReorderSource(80, null)).id, 80)
})
test('成套来源由不可变version准确解析父定义，组件不降级为普通商品', async () => {
  const answer = clean(await fixture({ model: 'kit-v1' }).service.findReorderSource(80, [8]))
  assert.deepEqual(answer.items, [{ kind: 'kit', kitId: 7, originalKitVersionId: 41, quantity: 2 }, { kind: 'ordinary', productId: 3, baseUnit: '个', baseQty: 12 }])
  await assert.rejects(fixture({ model: 'kit-v1', missingKit: true }).service.findReorderSource(80, [8]), e => e.code === 'SALE_REORDER_SOURCE_INVALID')
})
test('来源参数严格单值正安全整数，空/重复/不明输入不变成合法来源', async () => {
  for (const id of ['', '0', '01', '1e2', ['80', '80'], '9007199254740992', null]) {
    await assert.rejects(fixture().service.findReorderSource(id, [8]), e => e.statusCode === 400)
  }
})
test('当前0目标成交组仍有商品身份；普通历史单位来自component快照，不依赖仍存物料行', async () => {
  const groupRows = [{ id: 21, component_id: 31, product_id: 5, kind: 'kit', warehouse_id: 8, kit_version_id: 41, kit_id: 7, target_qty: 0, superseded: 0 }, { id: 22, component_id: 32, kind: 'ordinary', warehouse_id: 8, product_id: 3, sale_item_id: null, unit: null, component_unit: '个', target_qty: 0, superseded: 0 }]
  assert.deepEqual(clean((await fixture({ model: 'kit-v1', groupRows }).service.findReorderSource(80, [8])).items), [{ kind: 'kit', kitId: 7, originalKitVersionId: 41, quantity: 0 }, { kind: 'ordinary', productId: 3, baseUnit: '个', baseQty: 0 }])
})
test('ordinary商业组只有准确1组件才可导入；0或多组件拒绝而不是任选第一个', async () => {
  const row = { id: 22, component_id: 32, kind: 'ordinary', warehouse_id: 8, product_id: 3, sale_item_id: 11, unit: '个', component_unit: '个', target_qty: 12, superseded: 0 }
  for (const groupRows of [[{ ...row, component_id: null, product_id: null }], [row, { ...row, component_id: 33, product_id: 4 }]]) await assert.rejects(fixture({ model: 'kit-v1', groupRows }).service.findReorderSource(80, [8]), e => e.code === 'SALE_REORDER_SOURCE_INVALID')
})
