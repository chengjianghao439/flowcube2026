const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const path = require('node:path')
const { createRequire } = require('node:module')
const filename = path.resolve(__dirname, '../backend/src/engine/containerEngine.js')
const localRequire = createRequire(filename)
const module_ = { exports: {} }
const stubs = { '../utils/logger': { warn() {}, info() {} }, '../utils/codeGenerator': {}, '../utils/expectedStock': {} }
vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module: module_, require: id => id in stubs ? stubs[id] : localRequire(id) }, { filename })
const engine = module_.exports

function inventory({ bound = 0, reserved = 8 } = {}) {
  let quantity = 10
  return { get quantity() { return quantity }, async query(sql, args) {
    if (sql.includes('sale_order_expected_bindings')) return [[{ qty: bound }]]
    if (sql.includes('SELECT COALESCE(quantity')) return [[{ qty: quantity, quantity, reserved }]]
    if (sql.includes('SELECT quantity FROM inventory_stock')) return [[{ quantity }]]
    if (sql.includes('SELECT remaining_qty')) return [[{ remaining_qty: quantity }]]
    if (sql.includes('SELECT id, barcode')) return [[{ id: 1, barcode: 'I1', remaining_qty: quantity }]]
    if (sql.includes('UPDATE inventory_containers')) { quantity = args[0]; return [{ affectedRows: 1 }] }
    if (sql.includes('SUM(remaining_qty)')) return [[{ total: quantity }]]
    if (sql.includes('INSERT INTO inventory_stock')) return [{ affectedRows: 1 }]
    throw Error(sql)
  } }
}
test('stockcheck loss cannot remove physical sales reservations', async () => {
  const conn = inventory()
  await assert.rejects(engine.adjustContainersForStockcheck(conn, { productId: 1, warehouseId: 2, diffQty: -5 }), e => e.code === 'STOCKCHECK_RESERVED_SHORTAGE')
  assert.equal(conn.quantity, 10)
})
test('expected bindings are not mistaken for physical reservations', async () => {
  const conn = inventory({ bound: 6 })
  await engine.adjustContainersForStockcheck(conn, { productId: 1, warehouseId: 2, diffQty: -5 })
  assert.equal(conn.quantity, 5)
})
test('container deduction rejects nonpositive quantities instead of changing their sign', async () => {
  for (const qty of [-1, 0]) {
    const conn = inventory()
    await assert.rejects(engine.deductFromContainers(conn, { productId: 1, warehouseId: 2, qty }), e => e.statusCode === 400)
    assert.equal(conn.quantity, 10)
  }
})

// 同一只读聚合提供完整单位统计；不从跨页/截断明细伪造全局数量。
function overviewFixture({ scope = [8], groups, count = 2, failGroups = false, drift = false } = {}) {
  const serviceFile = path.resolve(__dirname, '../backend/src/modules/inventory/inventory.service.js')
  const serviceRequire = createRequire(serviceFile), serviceModule = { exports: {} }, queries = []
  const scopeFile = path.resolve(__dirname, '../backend/src/utils/warehouseScope.js'), scopeModule = { exports: {} }, scopeRequire = createRequire(scopeFile)
  vm.runInNewContext(fs.readFileSync(scopeFile, 'utf8'), { module: scopeModule, require: id => id === '../config/db' ? { pool: {} } : scopeRequire(id) }, { filename: scopeFile })
  const empty = Array.isArray(scope) && !scope.length
  const unitRows = groups ?? [
    { quantity_unit: Buffer.from('个'), matched_rows: 1, total_on_hand: '100.00', total_reserved: '30.00' },
    { quantity_unit: Buffer.from('米'), matched_rows: 1, total_on_hand: '5.00', total_reserved: '1.00' },
  ]
  const pool = { async query(sql, params = []) {
    queries.push({ sql, params }); assert.match(sql.trim(), /^SELECT\b/)
    if(drift && sql.includes('AS containerQty')) return [[{productId:1,warehouseId:8,containerQty:10,cacheQty:12},{productId:2,warehouseId:8,containerQty:20,cacheQty:25},{productId:3,warehouseId:8,containerQty:30,cacheQty:30}]]
    if(drift && sql.includes('FROM inventory_stock s')) return [[]]
    if(drift && sql.includes('AS unit_cost')) return [[{id:1,code:'P1',name:'合成均价',unit:'个',unit_cost:'3.4567',unit_cost_source:'avg_cost'},{id:2,code:'P2',name:'合成进价',unit:'个',unit_cost:'4.1234',unit_cost_source:'cost_price'},{id:3,code:'P3',name:'合成缺成本',unit:'个',unit_cost:'0.0000',unit_cost_source:'zero_fallback'}]]

    if (sql.includes('FROM product_categories')) return [[{ id: 3, name: '合成类', path: '/3/', parent_id: null }, { id: 4, name: '子类', path: '/3/4/', parent_id: 3 }]]
    if (sql.includes('AS quantity_unit')) { if (failGroups) throw new Error('合成聚合读取失败'); return [empty ? [] : unitRows] }
    if (sql.includes('AS total_skus')) return [[{ total_skus: empty ? 0 : 2, total_on_hand: empty ? 0 : 105, total_reserved: empty ? 0 : 31 }]]
    if (sql.includes('COUNT(*) AS total')) return [[{ total: empty ? 0 : count }]]
    if (sql.includes('p.id AS product_id')) return [empty ? [] : [{ id: -1000008, product_id: 1, product_code: 'G-1', product_name: '合成商品', unit: '个', warehouse_id: 8, warehouse_name: '合成仓', quantity: 100, reserved: 30 }]]
    throw new Error(sql)
  } }
  const serviceStubs = {
    '../../config/db': { pool }, '../../utils/warehouseScope': scopeModule.exports,
    './inventoryProjection': serviceRequire('./inventoryProjection'), '../../utils/pagination': serviceRequire('../../utils/pagination'),
    '../../utils/AppError': serviceRequire('../../utils/AppError'), './manual-stock-request': {},
    '../../engine/inventoryEngine': {}, '../../engine/containerEngine': {}, '../../utils/expectedStock': {},
    '../../utils/operationRequest': {}, '../../utils/qtyPrecision': {},
  }
  vm.runInNewContext(fs.readFileSync(serviceFile, 'utf8'), { module: serviceModule, Buffer, require: id => { if (!(id in serviceStubs)) throw new Error('Unexpected dependency '+id); return serviceStubs[id] } }, { filename: serviceFile })
  return { api: serviceModule.exports, queries, input: { keyword: '筛选', warehouseId: 8, categoryId: 3, scopeWarehouseIds: scope, pageSize: 1 } }
}
test('overview unit statistics cover complete filtered range in one grouped read, retaining original fields and row batching', async () => {
  const f = overviewFixture(); const data = await f.api.getOverview(f.input)
  assert.equal(data.stats.totalOnHand, 105); assert.equal(data.stats.totalReserved, 31); assert.equal(data.stats.totalAvailable, 74)
  assert.deepEqual(JSON.parse(JSON.stringify(data.stats.quantitiesByUnit)), { complete: true, matchedRows: 2, groups: [{ unit: '个', onHand: 100, reserved: 30 }, { unit: '米', onHand: 5, reserved: 1 }] })
  assert.equal(data.list.length, 1); assert.equal(data.pagination.total, 2)
  const group = f.queries.filter(q => q.sql.includes('AS quantity_unit')); assert.equal(group.length, 1)
  assert.match(group[0].sql, /GROUP BY CAST\(p\.unit AS BINARY\)/)
  assert.deepEqual(group[0].params, f.queries.find(q => q.sql.includes('AS total_skus')).params)
  assert.equal(group[0].sql.split('WHERE ')[1].split('GROUP BY')[0].trim(), f.queries.find(q => q.sql.includes('AS total_skus')).sql.split('WHERE ')[1].trim())
  assert.match(group[0].sql, /ip\.warehouse_id IN \(\?\)/)
  assert.equal(f.queries.length, 5)
})
test('overview unit statistics preserve empty warehouse scope and return known empty groups', async () => {
  const f = overviewFixture({ scope: [] }); const data = await f.api.getOverview(f.input)
  assert.deepEqual(JSON.parse(JSON.stringify(data.stats.quantitiesByUnit)), { complete: true, matchedRows: 0, groups: [] })
  assert.match(f.queries.find(q => q.sql.includes('AS quantity_unit')).sql, /AND 1=0/)
})
test('overview preserves null units and exact case labels without guessing conversion', async () => {
  const f = overviewFixture({ count: 3, groups: [
    { quantity_unit: null, matched_rows: 1, total_on_hand: 10, total_reserved: 0 },
    { quantity_unit: Buffer.from('m'), matched_rows: 1, total_on_hand: 5, total_reserved: 0 },
    { quantity_unit: Buffer.from('M'), matched_rows: 1, total_on_hand: 6, total_reserved: 0 },
  ] }); const data = await f.api.getOverview(f.input)
  assert.deepEqual(Array.from(data.stats.quantitiesByUnit.groups, g => g.unit), [null, 'm', 'M'])
  assert.equal(data.stats.quantitiesByUnit.matchedRows, 3)
})
test('unit aggregate read failure refuses partial success response', async () => {
  const f = overviewFixture({ failGroups: true })
  await assert.rejects(f.api.getOverview(f.input), /合成聚合读取失败/)
})
test('overview subsequent row batches preserve legacy response without repeating global unit aggregation', async () => {
  const f = overviewFixture(); const data = await f.api.getOverview({ ...f.input, page: 2 })
  assert.equal(data.stats.totalOnHand, 105); assert.equal(data.stats.quantitiesByUnit, undefined)
  assert.equal(f.queries.filter(q => q.sql.includes('AS quantity_unit')).length, 0)
  assert.equal(f.queries.length, 4)
})

test('库存对账只读DTO标注当前估值来源，原单位成本及两位价值不改',async()=>{
  const f=overviewFixture({drift:true}),data=await f.api.findStockDrift({scopeWarehouseIds:[8]})
  const rows=new Map(data.list.map(r=>[r.productId,r]))
  assert.equal(rows.get(1).unitCostSource,'avg_cost');assert.equal(rows.get(2).unitCostSource,'cost_price');assert.equal(rows.get(3).unitCostSource,'zero_fallback')
  assert.equal(rows.get(1).unitCost,3.4567);assert.equal(rows.get(1).cacheValue,41.48);assert.equal(rows.get(1).containerValue,34.57);assert.equal(rows.get(1).diffValue,6.91)
  assert.equal(rows.get(2).unitCost,4.1234);assert.equal(rows.get(2).diffValue,20.62);assert.equal(rows.get(3).unitCost,0)
  const sql=f.queries.find(q=>q.sql.includes('AS unit_cost')).sql
  assert.match(sql,/COALESCE\(NULLIF\(avg_cost,0\), NULLIF\(cost_price,0\), 0\) AS unit_cost/)
  assert.match(sql,/CASE WHEN NULLIF\(avg_cost,0\) IS NOT NULL/)
  assert.match(sql,/WHEN NULLIF\(cost_price,0\) IS NOT NULL/)
  assert.match(sql,/AS unit_cost_source/)
})

test('成本对账201行只标注截断范围，200行价值口径及仓筛选保持',async()=>{
  const filename=path.resolve(__dirname,'../backend/src/modules/reports/reports.metrics.js')
  const source=fs.readFileSync(filename,'utf8'),start=source.indexOf('async function avgCostReconciliation('),end=source.indexOf(String.fromCharCode(10)+'}',start)+2
  assert(start>=0 && end>start)
  for(const n of [200,201]){
    let selectedScope
    const m={exports:{}},rows=Array.from({length:n},(_,i)=>({rowKey:(i+1)+'-8',drifted:true,diffValue:20,unitCostSource:'avg_cost'}))
    vm.runInNewContext(source.slice(start,end)+';module.exports=avgCostReconciliation',{module:m,require:id=>{
      assert.equal(id,'../inventory/inventory.service')
      return{findStockDrift:async({scopeWarehouseIds})=>{selectedScope=scopeWarehouseIds;return{list:rows}}}
    }},{filename})
    const data=await m.exports({scopeWarehouseIds:[8]})
    assert.deepEqual(selectedScope,[8]);assert.equal(data.list.length,200);assert.equal(data.totalRows,200);assert.equal(data.totalDiffValue,4000);assert.equal(data.driftedCount,200)
    assert.equal(data.matchedRows,n);assert.equal(data.truncated,n===201);assert.equal(data.list[0].unitCostSource,'avg_cost')
  }
})
