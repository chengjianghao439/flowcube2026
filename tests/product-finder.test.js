const { test, afterEach } = require('node:test')
const assert = require('node:assert/strict')
// Stub the DB module before loading the service: this regression never opens a DB connection.
const dbPath = require.resolve('../backend/src/config/db')
const calls = []
const unknown = []
afterEach(() => assert.deepEqual(unknown, []))
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { pool: { query: async (sql, params) => {
  calls.push({ sql, params })
  if (sql.includes('SELECT id, name, parent_id, path')) return [[{ id: 1, name: '配件', path: '' }, { id: 2, name: '连接器', path: '/1/' }]]
  if (sql === 'SELECT product_id, unit_name, conversion_rate, is_base FROM product_units\n       WHERE product_id IN (?) ORDER BY is_base DESC, sort_order ASC, id ASC') { assert.deepEqual(params,[3]); return [[]] }
  if (!sql.includes('FROM product_items p')) { unknown.push(sql); throw new Error('unknown product query') }
  if (sql.includes('COUNT(*)')) return [[{ total: 65 }]]
  if (!/SELECT\s+p\.(id|\*)/.test(sql)) { unknown.push(sql); throw new Error('unknown product select') }
  return [[{ id: 3, code: 'P003', name: '连接器', category_id: 2, barcode: '690003', stock: '5', sale_price_a: '10', search_match: '名称' }]]
} } } }
const { findForFinder, findAll } = require('../backend/src/modules/products/products.service')

test('商品查找支持规格检索、父分类、带仓分页及条码回填', async () => {
  const result = await findForFinder({ page: 2, pageSize: 30, keyword: 'M6', categoryId: 1, warehouseId: 7 })
  const query = calls[1]
  assert.match(query.sql, /p.article_number LIKE \? ESCAPE '!' OR p.spec LIKE \? ESCAPE '!' OR p.color LIKE \? ESCAPE '!'/)
  assert.match(query.sql, /supply_suppliers sup/)
  assert.match(query.sql, /s ON p.id = s.product_id/)
  assert.match(query.sql, /ORDER BY search_rank ASC, p.name ASC, p.id ASC/)
  assert.deepEqual(query.params, [...searchSelectParams('M6'), 7, ...Array(6).fill('%M6%'), 1, 2, 30, 30])
  assert.deepEqual(calls[2].params, [7, ...Array(6).fill('%M6%'), 1, 2])
  assert.equal(result.pagination.total, 65)
  assert.equal(result.list[0].barcode, '690003')
  assert.equal(result.list[0].categoryPath, '配件 > 连接器')
  assert.equal(result.list[0].stock, 5)
  assert.equal(result.list[0].searchMatch, '名称')
})

function escaped(keyword) { return keyword.replace(/!/g, '!!').replace(/%/g, '!%').replace(/_/g, '!_') }
function searchSelectParams(keyword) { return [...Array(6).fill(`%${escaped(keyword)}%`), ...Array(6).fill(keyword), ...Array(6).fill(`${escaped(keyword)}%`)] }
function assertProductSearch(query, prefix, keyword) {
  for (const field of ['code', 'name', 'barcode', 'article_number', 'spec', 'color']) {
    assert.ok(query.sql.includes(`${prefix}${field} LIKE ? ESCAPE '!'`), field)
    assert.ok(query.sql.includes(`IF(NULLIF(${prefix}${field}, '') LIKE ? ESCAPE '!'`), field)
  }
  assert.match(query.sql, /CONCAT_WS\('、',/)
  assert.match(query.sql, /AS search_match/)
  const rank = query.sql.slice(query.sql.indexOf('CASE WHEN'), query.sql.indexOf('END AS search_rank'))
  assert.ok(rank.includes(`CASE WHEN ${prefix}code = ? OR ${prefix}barcode = ? THEN 0`))
  assert.ok(rank.includes(`WHEN ${['name','article_number','spec','color'].map(field=>`${prefix}${field} = ?`).join(' OR ')} THEN 1`))
  assert.ok(rank.includes(`WHEN ${['code','name','barcode','article_number','spec','color'].map(field=>`${prefix}${field} LIKE ? ESCAPE '!'`).join(' OR ')} THEN 2 ELSE 3`))
  assert.equal((query.sql.match(/\?/g) || []).length, query.params.length)
  assert.deepEqual(query.params.slice(0, 18), searchSelectParams(keyword))
}

test('Finder trim六字段搜索、精确编码/条码优先，同时保留启用及仓库范围', async () => {
  calls.length = 0
  await findForFinder({ keyword: '  SUP-01  ', warehouseId: 7, scopeWarehouseIds: [7] })
  assertProductSearch(calls[1], 'p.', 'SUP-01')
  assert.match(calls[1].sql, /p.deleted_at IS NULL AND p.is_active = 1/)
  assert.match(calls[1].sql, /ORDER BY search_rank ASC, p.name ASC, p.id ASC/)
  assert.equal((calls[2].sql.match(/\?/g) || []).length, calls[2].params.length)
  await assert.rejects(() => findForFinder({ warehouseId: 8, scopeWarehouseIds: [7] }), /仓库/)
  assert.equal(calls.length, 3)
})

test('管理搜索新增供应商型号/型号/颜色，同时保留分类、停用、供应商及价格筛选', async () => {
  calls.length = 0
  const result = await findAll({ keyword: '  SUP-01 ', categoryId: 2, status: '0', supplierId: 4, minPrice: '5', maxPrice: '20', page: 2, pageSize: 30 })
  assertProductSearch(calls[0], 'p.', 'SUP-01')
  assert.equal(result.list[0].searchMatch, '名称')
  assert.match(calls[0].sql, /ORDER BY search_rank ASC, p.created_at DESC, p.id DESC/)
  assert.match(calls[0].sql, /p.category_id = \? AND p.is_active = \? AND p.supplier_id = \?/)
  assert.match(calls[0].sql, /COALESCE\(p.sale_price_a, p.sale_price\) >= \? AND COALESCE\(p.sale_price_a, p.sale_price\) <= \?/)
  assert.deepEqual(calls[0].params.slice(18), [...Array(6).fill('%SUP-01%'), 2, '0', 4, 5, 20, 30, 30])
  assert.deepEqual(calls[1].params, calls[0].params.slice(18, -2))
})

test('空白关键词保持旧排序及入口停用差异，没有命中说明参数', async () => {
  calls.length = 0
  const finder = await findForFinder({ keyword: '  ' })
  assert.match(calls[1].sql, /ORDER BY p.name ASC, p.id ASC/)
  assert.doesNotMatch(calls[1].sql, /search_match|LIKE/)
  assert.deepEqual(calls[1].params, [20, 0])
  assert.equal(Object.hasOwn(finder.list[0], 'searchMatch'), false)
  calls.length = 0
  const management = await findAll({ keyword: ' ' })
  assert.match(calls[0].sql, /ORDER BY p.created_at DESC, p.id DESC/)
  assert.doesNotMatch(calls[0].sql, /search_match|LIKE|p.is_active =/)
  assert.deepEqual(calls[0].params, [20, 0])
  assert.equal(Object.hasOwn(management.list[0], 'searchMatch'), false)
})

for (const keyword of ['!', '%', '_', "x' OR 1=1", 'M6\\_', '\\']) {
  test(`特殊关键词${keyword}按字面六字段匹配，显式ESCAPE不依赖反斜杠SQL_MODE`, async () => {
    const { productSearch } = require('../backend/src/modules/products/productSearch')
    const search = productSearch(`  ${keyword}  `, 'p')
    const fields = ['code','name','barcode','article_number','spec','color']
    assert.equal(search.where, `(${fields.map(field=>`p.${field} LIKE ? ESCAPE '!'`).join(' OR ')})`)
    assert.deepEqual(search.whereParams, Array(6).fill(`%${escaped(keyword)}%`))
    assert.deepEqual(search.selectParams, searchSelectParams(keyword))
    assertProductSearch({sql:search.select+search.where,params:[...search.selectParams,...search.whereParams]},'p.',keyword)
    assert.doesNotMatch(search.select, /COALESCE|x' OR 1=1/)
  })
}
test('四档字段CASE顺序、空关键词及alias白名单固定，不把值写进SQL',()=>{
 const {productSearch}=require('../backend/src/modules/products/productSearch')
 assertProductSearch({sql:productSearch(' M6 ').select,params:searchSelectParams('M6')},'', 'M6')
 assert.deepEqual(productSearch(' '),{keyword:'',where:'',select:'',whereParams:[],selectParams:[]})
 assert.throws(()=>productSearch('M6','p;DROP'))
})
