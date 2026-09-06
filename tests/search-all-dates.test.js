const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const path = require('node:path')

// 只替换数据库边界，不连接任何数据库；校验实际服务构造的 SQL 契约。
test('全局搜索忽略旧客户端日期参数，保留限仓条件及查询上限', async () => {
  const queries = []
  const sandbox = { module: { exports: {} }, require: name => {
    if (name === '../../utils/AppError') return require('../backend/src/utils/AppError')
    assert.equal(name, '../../config/db')
    return { pool: { query: async (sql, params) => { queries.push({ sql, params }); return [[]] } } }
  } }
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../backend/src/modules/search/search.service.js'), 'utf8'), sandbox)
  await sandbox.module.exports.searchGlobal('旧单号', [7], { startDate: '2026-09-06', endDate: '2026-09-06' })
  assert.equal(queries.length, sandbox.module.exports.ENTITIES.length)
  for (const { sql, params } of queries) {
    assert.doesNotMatch(sql, /created_at\s*[<>]=/)
    assert.match(sql, /deleted_at IS NULL/)
    assert.match(sql, /LIMIT 21/)
    assert.equal(params.includes('2026-09-06 00:00:00'), false)
  }
  assert.match(queries.find(q => q.sql.includes('FROM purchase_orders')).sql, /warehouse_id IN/)
  assert.match(queries.find(q => q.sql.includes('FROM transfer_orders')).sql, /from_warehouse_id IN.*OR to_warehouse_id IN/)
})

function loadService(query) {
  const sandbox = { module: { exports: {} }, require: name => name === '../../utils/AppError' ? require('../backend/src/utils/AppError') : ({ pool: { query } }) }
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../backend/src/modules/search/search.service.js'), 'utf8'), sandbox)
  return sandbox.module.exports
}

test('客户显示名称与联系资料，并能通过游标读完超过五条的结果', async () => {
  const queries = []
  const service = loadService(async (sql, params) => {
    queries.push({ sql, params })
    const before = params.find(p => typeof p === 'number') ?? 100
    return [Array.from({ length: 27 }, (_, i) => ({ id: 27-i, no_val: `C${27-i}`, subtitle: `C${27-i}`, name: `客户${27-i}`, contact: '张先生', phone: '123456', address: '上海' })).filter(r => r.id < before).slice(0,21)]
  })
  const first = await service.searchGlobal('客户', [7], { type: 'customer' })
  assert.equal(first.data.length, 20)
  assert.equal(first.data[0].title, '客户27')
  assert.equal(first.data[0].subtitle, 'C27')
  assert.ok(first.data[0].details.some(d => d.label === '联系人' && d.value === '张先生'))
  assert.equal(first.nextCursors.customer, 8)
  const second = await service.searchGlobal('客户', [7], { type: 'customer', beforeId: first.nextCursors.customer })
  assert.equal(second.data.length, 7)
  assert.equal(second.nextCursors.customer, null)
  assert.equal(new Set([...first.data, ...second.data].map(r => r.id)).size, 27)
  assert.match(queries[1].sql, /id < \?/)
})

test('续页继续执行限仓、空范围与软删除过滤，拒绝未知分类或无效游标', async () => {
  const queries = []
  const service = loadService(async (sql, params) => { queries.push({ sql, params }); return [[]] })
  await service.searchGlobal('单', [], {type:'transfer', beforeId:20})
  assert.equal(queries.length, 1)
  assert.match(queries[0].sql, /1=0/)
  assert.match(queries[0].sql, /deleted_at IS NULL/)
  assert.match(queries[0].sql, /id < \?/)
  await assert.rejects(() => service.searchGlobal('单', null, {type:'invalid'}))
  await assert.rejects(() => service.searchGlobal('单', null, {type:'sale', beforeId:'x'}))
})
