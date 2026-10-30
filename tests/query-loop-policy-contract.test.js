const test = require('node:test')
const assert = require('node:assert/strict')
const { CHECKS, assertCanDisableDecimals } = require('../backend/src/modules/products/products.quantity-policy')
const { ALLOWLIST, findReadOnlyLoopQueries } = require('./query-loop-contract.test')

const prefix = 'backend/src/modules/products/products.quantity-policy.js::'

test('quantity policy dependency checks have a fixed single-product query budget', async () => {
  assert.equal(CHECKS.length, 21)
  const seen = []
  await assertCanDisableDecimals({ async query(sql, params) {
    seen.push({ sql, params })
    return [[]]
  } }, 419)
  assert.equal(seen.length, 22) // 21 dependencies and one stock-policy read.
  for (const { sql, params } of seen) {
    assert.deepEqual(params, [419])
    assert.match(sql, /\bproduct_id\s*=\s*\?/)
    assert.match(sql, /^SELECT\b/)
  }
  for (const [, sql] of CHECKS) assert.match(sql, /\bLIMIT 1\s*$/)
})

test('fixed-check exception remains exact and does not admit per-row queries', () => {
  const fixed = 'for (const [label, sql] of CHECKS) {\n  const [rows] = await conn.query(sql, [productId])\n}'
  const rowDriven = fixed.replace('of CHECKS', 'of rows')
  const fixedHit = findReadOnlyLoopQueries(fixed)
  const rowHit = findReadOnlyLoopQueries(rowDriven)
  assert.equal(fixedHit.length, 1)
  assert.equal(rowHit.length, 1)
  assert.equal(ALLOWLIST.has(prefix + fixedHit[0].loopText), true)
  assert.equal(ALLOWLIST.has(prefix + rowHit[0].loopText), false)
  assert.equal(ALLOWLIST.has('backend/src/modules/other/read.js::' + fixedHit[0].loopText), false)
})

test('the query scanner continues to detect repeated read queries', () => {
  const source = 'for (const item of items) {\n  await conn.query("SELECT quantity FROM inventory_stock WHERE product_id=?", [item.id])\n}'
  const hits = findReadOnlyLoopQueries(source)
  assert.equal(hits.length, 1)
  assert.equal(ALLOWLIST.has(prefix + hits[0].loopText), false)
})
