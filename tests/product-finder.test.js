const test = require('node:test')
const assert = require('node:assert/strict')
// Stub the DB module before loading the service: this regression never opens a DB connection.
const dbPath = require.resolve('../backend/src/config/db')
const calls = []
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { pool: { query: async (sql, params) => {
  calls.push({ sql, params })
  if (sql.includes('SELECT id, name, parent_id, path')) return [[{ id: 1, name: '配件', path: '' }, { id: 2, name: '连接器', path: '/1/' }]]
  if (sql.includes('COUNT(*)')) return [[{ total: 65 }]]
  return [[{ id: 3, code: 'P003', name: '连接器', category_id: 2, barcode: '690003', stock: '5', sale_price_a: '10' }]]
} } } }
const { findForFinder } = require('../backend/src/modules/products/products.service')

test('商品查找支持规格检索、父分类、带仓分页及条码回填', async () => {
  const result = await findForFinder({ page: 2, pageSize: 30, keyword: 'M6', categoryId: 1, warehouseId: 7 })
  const query = calls[1]
  assert.match(query.sql, /p.article_number LIKE \? OR p.spec LIKE \? OR p.color LIKE \?/)
  assert.match(query.sql, /supply_suppliers sup/)
  assert.match(query.sql, /s ON p.id = s.product_id/)
  assert.match(query.sql, /ORDER BY p.name ASC, p.id ASC/)
  assert.deepEqual(query.params, [7, ...Array(6).fill('%M6%'), 1, 2, 30, 30])
  assert.deepEqual(calls[2].params, query.params.slice(0, -2))
  assert.equal(result.pagination.total, 65)
  assert.equal(result.list[0].barcode, '690003')
  assert.equal(result.list[0].categoryPath, '配件 > 连接器')
  assert.equal(result.list[0].stock, 5)
})
