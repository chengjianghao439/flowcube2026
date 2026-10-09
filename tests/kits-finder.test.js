'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const contracts = require('../backend/src/modules/kits/kits.contracts')

function fixture() {
  const calls = [], lifecycle = []
  const conn = {
    async query(sql, params = []) {
      calls.push({ sql, params })
      if (sql === 'START TRANSACTION READ ONLY') { lifecycle.push('read-only'); return [] }
      if (sql.includes('FROM inventory_warehouses')) return [[{ id: 7, is_active: 1 }]]
      if (sql.includes('FROM product_categories')) return [[{ id: 1, path: '' }, { id: 2, path: '/1/' }, { id: 3, path: '/1/2/' }, { id: 11, path: '' }, { id: 12, path: '/11/' }]]
      if (sql.includes('COUNT(*)')) return [[{ total: 25 }]]
      if (sql.includes('FROM kit_definitions')) return [[{ id: 4, code: 'K4', name: '五金套', is_active: 1, current_version_id: 5 }]]
      if (sql.includes('FROM kit_definition_versions')) return [[{ id: 5, kit_id: 4, version_no: 1, reference_unit_price: 10 }]]
      if (sql.includes('FROM kit_definition_components')) return [[{ id: 6, version_id: 5, product_id: 9, base_qty: 1, code: 'P9', name: '组件', is_active: 1 }]]
      throw Error(`未配置的DB边界 ${sql}`)
    },
    async commit() { lifecycle.push('commit') },
    async rollback() { lifecycle.push('rollback') },
    release() { lifecycle.push('release') },
  }
  const filename = path.resolve(__dirname, '../backend/src/modules/kits/kits.service.js')
  const loaded = new Module(filename, module)
  loaded.filename = filename; loaded.paths = Module._nodeModulePaths(path.dirname(filename))
  const actualRequire = Module.createRequire(filename)
  loaded.require = id => id === '../../config/db' ? { pool: { getConnection: async () => conn } }
    : id === '../../engine/containerEngine' ? { getStockProjections: async () => new Map([['9:7', { quantity: 5, reserved: 1 }]]) }
      : actualRequire(id)
  const dbId = actualRequire.resolve('../../config/db'), savedDb = require.cache[dbId]
  require.cache[dbId] = { id: dbId, filename: dbId, loaded: true, exports: { pool: { getConnection: async () => conn, query: () => { throw Error('Finder不得使用事务外数据库') } } } }
  try { loaded._compile(fs.readFileSync(filename, 'utf8'), filename) }
  finally { if (savedDb) require.cache[dbId] = savedDb; else delete require.cache[dbId] }
  return { service: loaded.exports, calls, lifecycle }
}

test('kit finder accepts only positive safe category IDs', () => {
  assert.equal(contracts.finderQuery.parse({ warehouseId: '7', categoryId: '1' }).categoryId, 1)
  for (const value of ['0', '-1', '1.5', '', '9007199254740992', ['1', '2']]) {
    assert.equal(contracts.finderQuery.safeParse({ warehouseId: '7', categoryId: value }).success, false)
  }
  assert.equal(contracts.finderQuery.parse({ warehouseId: '7' }).categoryId, undefined)
})

test('kit category descendants and keyword constrain both rows and total before paging', async () => {
  const f = fixture()
  const result = await f.service.findForFinder({ warehouseId: 7, scopeWarehouseIds: [7], categoryId: 1, keyword: 'M4', page: 2, pageSize: 20 })
  const rows = f.calls.find(c => c.sql.includes('FROM kit_definitions') && !c.sql.includes('COUNT(*)'))
  const count = f.calls.find(c => c.sql.includes('COUNT(*)'))
  assert.match(rows.sql, /k.category_id IN \(\?\)/)
  assert.match(count.sql, /k.category_id IN \(\?\)/)
  assert.deepEqual(rows.params, [...Array(5).fill('%M4%'), [1, 2, 3], 20, 20])
  assert.deepEqual(count.params, rows.params.slice(0, -2))
  assert.equal(result.pagination.total, 25)
  assert.equal(result.list[0].selectable, true)
  assert.equal(result.list[0].standaloneCompleteSetsByCurrentStock, 4)
  assert.deepEqual(f.lifecycle, ['read-only', 'commit', 'release'])
})

test('all categories keep legacy list behavior without an extra category query', async () => {
  const f = fixture()
  await f.service.findAll({ keyword: 'M4' })
  assert.equal(f.calls.some(c => c.sql.includes('FROM product_categories')), false)
  const count = f.calls.find(c => c.sql.includes('COUNT(*)'))
  assert.doesNotMatch(count.sql, /category_id IN/)
  assert.deepEqual(count.params, Array(5).fill('%M4%'))
})

test('warehouse scope rejects before category and kit queries', async () => {
  const f = fixture()
  await assert.rejects(f.service.findForFinder({ warehouseId: 7, scopeWarehouseIds: [], categoryId: 1 }), e => e.code === 'WAREHOUSE_SCOPE_DENIED')
  assert.equal(f.calls.some(c => /FROM (product_categories|kit_definitions)/.test(c.sql)), false)
  assert.deepEqual(f.lifecycle, ['read-only', 'rollback', 'release'])
})
