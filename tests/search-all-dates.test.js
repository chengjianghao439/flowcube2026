const { test, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const path = require('node:path')

const unknownImports = []
afterEach(() => assert.deepEqual(unknownImports, []))
const TABLES = new Set(['product_items','supply_suppliers','sale_customers','purchase_orders','sale_orders','purchase_requisitions','transfer_orders','purchase_returns','sale_returns','inbound_tasks','expense_claims','inventory_disposal_orders','refund_orders','sale_credit_overrides','inventory_checks','fin_invoices'])
const unknownQueries = []
afterEach(() => assert.deepEqual(unknownQueries, []))
function checkedQuery(query) { return async (sql, params) => {
 const table = sql.match(/FROM ([a-z_]+) WHERE/)
 if(!table || !TABLES.has(table[1]) || !/ORDER BY id DESC LIMIT 21$/.test(sql.trim()) || (sql.match(/\?/g)||[]).length!==params.length) { unknownQueries.push(sql);throw Error('unknown global search SQL') }
 return query(sql,params)
} }
// 只替换数据库边界，不连接任何数据库；校验实际服务构造的 SQL 契约。
test('全局搜索忽略旧客户端日期参数，保留限仓条件及查询上限', async () => {
  const queries = []
  const sandbox = { module: { exports: {} }, require: name => {
    if (name === '../../constants/permissions') return require('../backend/src/constants/permissions')
    if (name === '../../utils/AppError') return require('../backend/src/utils/AppError')
    if (name === '../../utils/sqlIdentifier') return require('../backend/src/utils/sqlIdentifier')
    if (name === '../products/productSearch') return require('../backend/src/modules/products/productSearch')
    if(name!=='../../config/db') unknownImports.push(name)
    assert.equal(name, '../../config/db')
    return { pool: { query: checkedQuery(async (sql, params) => { queries.push({ sql, params }); return [[]] }) } }
  } }
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../backend/src/modules/search/search.service.js'), 'utf8'), sandbox)
  await sandbox.module.exports.searchGlobal('旧单号', [7], { user: { userId: 1, roleId: 1 }, startDate: '2026-09-06', endDate: '2026-09-06' })
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
  const sandbox = { module: { exports: {} }, require: name => {
    if (name === '../../constants/permissions') return require('../backend/src/constants/permissions')
    if (name === '../../utils/AppError') return require('../backend/src/utils/AppError')
    if (name === '../../utils/sqlIdentifier') return require('../backend/src/utils/sqlIdentifier')
    if (name === '../products/productSearch') return require('../backend/src/modules/products/productSearch')
    if(name!=='../../config/db') unknownImports.push(name)
    assert.equal(name, '../../config/db')
    return { pool: { query: checkedQuery(query) } }
  } }
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
  const first = await service.searchGlobal('客户', [7], { type: 'customer', user: { userId: 1, roleId: 1 } })
  assert.equal(first.data.length, 20)
  assert.equal(first.data[0].title, '客户27')
  assert.equal(first.data[0].subtitle, 'C27')
  assert.ok(first.data[0].details.some(d => d.label === '联系人' && d.value === '张先生'))
  assert.equal(first.nextCursors.customer, 8)
  const second = await service.searchGlobal('客户', [7], { type: 'customer', beforeId: first.nextCursors.customer, user: { userId: 1, roleId: 1 } })
  assert.equal(second.data.length, 7)
  assert.equal(second.nextCursors.customer, null)
  assert.equal(new Set([...first.data, ...second.data].map(r => r.id)).size, 27)
  assert.match(queries[1].sql, /id < \?/)
})

test('全局商品六字段匹配和数据库命中说明，保持id游标有界与停用可见政策', async () => {
  const queries = []
  const service = loadService(async (sql, params) => {
    queries.push({ sql, params })
    const before = params.at(-1) === 8 ? 8 : 100
    return [Array.from({ length: 27 }, (_, i) => ({
      id: 27-i, no_val: `P${27-i}`, name: `商品${27-i}`, article_number: '供应商型号',
      barcode: '690001', search_match: 27-i === 1 ? '编码、条码' : '供应商型号', search_rank: 27-i === 1 ? 0 : 1,
    })).filter(row => row.id < before).slice(0, 21)]
  })
  const user = { roleId: 2, userId: 8, permissions: ['product.view'] }
  const first = await service.searchGlobal('  690001  ', [], {type:'product', user})
  const second = await service.searchGlobal('690001', [], {type:'product', user, beforeId:first.nextCursors.product})
  assert.equal(first.nextCursors.product, 8)
  assert.equal(second.nextCursors.product, null)
  assert.equal(new Set([...first.data, ...second.data].map(row => row.id)).size, 27)
  assert.equal(second.data.at(-1).searchRank, 0)
  assert.equal(second.data.at(-1).searchMatch, '编码、条码')
  assert.ok(second.data.at(-1).details.some(detail => detail.label === '条码' && detail.value === '690001'))
  for (const query of queries) {
    for (const field of ['code','name','barcode','article_number','spec','color']) assert.ok(query.sql.includes(`${field} LIKE ? ESCAPE '!'`), field)
    assert.match(query.sql, /ORDER BY id DESC LIMIT 21/)
    assert.ok(query.sql.includes("IF(NULLIF(color, '') LIKE ?"))
    assert.doesNotMatch(query.sql, /ORDER BY search_rank|is_active =|1=0/)
    assert.equal((query.sql.match(/\?/g) || []).length, query.params.length)
    assert.deepEqual(Array.from(query.params.slice(0, 24)), [...Array(6).fill('%690001%'), ...Array(6).fill('690001'), ...Array(6).fill('690001%'), ...Array(6).fill('%690001%')])
  }
  assert.match(queries[1].sql, /id < \?/)
  assert.equal(queries[1].params.at(-1), 8)
})

test('续页继续执行限仓、空范围与软删除过滤，拒绝未知分类或无效游标', async () => {
  const queries = []
  const service = loadService(async (sql, params) => { queries.push({ sql, params }); return [[]] })
  await service.searchGlobal('单', [], {type:'transfer', beforeId:20, user: { userId: 1, roleId: 1 }})
  assert.equal(queries.length, 1)
  assert.match(queries[0].sql, /1=0/)
  assert.match(queries[0].sql, /deleted_at IS NULL/)
  assert.match(queries[0].sql, /id < \?/)
  await assert.rejects(() => service.searchGlobal('单', null, {type:'invalid'}))
  await assert.rejects(() => service.searchGlobal('单', null, {type:'sale', beforeId:'x'}))
})

test('NULL与空规格不由JS猜命中字段，其它类型继续保留原搜索字段', async () => {
  const queries = []
  const service = loadService(async (sql, params) => {
    queries.push({sql, params})
    return [[{id:1,no_val:'P1',name:'连接器',barcode:null,article_number:null,spec:'',color:null,search_match:'编码、名称',search_rank:1}]]
  })
  const user = { roleId: 1, userId: 1 }
  const result = await service.searchGlobal('%', null, {type:'product', user})
  assert.equal(result.data[0].searchMatch, '编码、名称')
  assert.equal(result.data[0].details.length, 0)
  assert.deepEqual(Array.from(queries[0].params), [...Array(6).fill('%!%%'), ...Array(6).fill('%'), ...Array(6).fill('!%%'), ...Array(6).fill('%!%%')])
  await service.searchGlobal('  供应商  ', null, {type:'supplier', user})
  assert.match(queries[1].sql, /\(name LIKE \?\)/)
  assert.doesNotMatch(queries[1].sql, /search_match|search_rank/)
  assert.deepEqual(Array.from(queries[1].params), ['%供应商%'])
})

test('实际controller保留旧数组响应，新分页响应保留数字游标', async () => {
  const result = {data:[{id:1,type:'product',searchMatch:'编码',searchRank:0}],nextCursors:{product:1},message:'搜索成功'}
  const sandbox = {module:{exports:{}},require:name=>{
    if (name === '../../utils/response') return require('../backend/src/utils/response')
    if(name!=='./search.service') unknownImports.push(name)
    assert.equal(name, './search.service')
    return {searchGlobal:async()=>result}
  }}
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../backend/src/modules/search/search.controller.js'),'utf8'),sandbox)
  const sent=[]
  const res={status(){return this},json(body){sent.push(body);return this}}
  await sandbox.module.exports.searchGlobal({query:{q:'P1'},user:{warehouseIds:[7]}},res,error=>{throw error})
  await sandbox.module.exports.searchGlobal({query:{q:'P1',paginated:'1'},user:{warehouseIds:[7]}},res,error=>{throw error})
  assert.equal(sent[0].data, result.data)
  assert.equal(sent[1].data.items, result.data)
  assert.equal(sent[1].data.nextCursors.product, 1)
})
