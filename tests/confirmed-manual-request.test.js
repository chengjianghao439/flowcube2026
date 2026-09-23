const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const path = require('node:path')
const { createRequire } = require('node:module')
function load(file, stubs = {}) {
  const filename = path.resolve(__dirname, '../backend/src', file)
  const module = { exports: {} }, fallback = createRequire(filename)
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module, require: id => id in stubs ? stubs[id] : fallback(id) })
  return module.exports
}
const operations = load('utils/operationRequest.js', { '../config/db': { pool: {} } })
const { beginManualStockRequest } = load('modules/inventory/manual-stock-request.js', { '../../utils/operationRequest': operations })
function database() {
  const rows = []
  return { rows, async query(sql, args) {
    if (sql.includes('SELECT')) return [rows.filter(r => r.request_key === args[0] && (Array.isArray(args[1]) ? args[1].includes(r.action) : r.action === args[1]) && r.user_id === args[2])]
    if (sql.includes('INSERT')) {
      if (rows.some(r => r.request_key === args[0] && r.action === args[1] && r.user_id === args[2])) throw Object.assign(Error(), { code: 'ER_DUP_ENTRY' })
      const id = rows.length + 1
      rows.push({ id, request_key: args[0], action: args[1], user_id: args[2], status: 1, response_json: '{"afterQty":8}' })
      return [{ insertId: id }]
    }
    throw Error(sql)
  } }
}
test('manual outbound binds warehouse and quantity; an identical retry replays', async () => {
  const conn = database(), common = { requestKey: 'key', userId: 4, productId: 8, warehouseId: 1, quantity: 2 }
  assert.equal((await beginManualStockRequest(conn, common)).replay, false)
  assert.equal((await beginManualStockRequest(conn, common)).replay, true)
  assert.equal((await beginManualStockRequest(conn, { ...common, warehouseId: 2 })).replay, false)
  assert.equal((await beginManualStockRequest(conn, { ...common, quantity: 3 })).replay, false)
  assert.equal(conn.rows.length, 3)
})
test('unbound legacy receipts require manual verification and never repeat stock mutation', async () => {
  for (const action of ['inventory.manual-out', 'inventory.manual-out.8']) {
    const conn = database()
    conn.rows.push({ request_key: 'key', action, user_id: 4, status: 1 })
    await assert.rejects(beginManualStockRequest(conn, { requestKey: 'key', userId: 4, productId: 8, warehouseId: 2, quantity: 2 }), e => e.code === 'LEGACY_STOCK_REQUEST_REVIEW_REQUIRED')
    assert.equal(conn.rows.length, 1)
  }
})
