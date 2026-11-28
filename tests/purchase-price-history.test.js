'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { findSupplierPriceHistory } = require('../backend/src/modules/purchase/purchase.price-history')

test('非法 supplierId / productId 返回 400 INVALID_PARAM 且不查库', async () => {
  let called = 0
  const db = { query: async () => { called++; return [[]] } }
  await assert.rejects(
    () => findSupplierPriceHistory({ supplierId: 'abc', productId: 10 }, db),
    (err) => err && err.statusCode === 400 && err.code === 'INVALID_PARAM',
  )
  await assert.rejects(
    () => findSupplierPriceHistory({ supplierId: 5, productId: 0 }, db),
    (err) => err && err.statusCode === 400 && err.code === 'INVALID_PARAM',
  )
  assert.equal(called, 0)
})

test('空仓库范围直接返回空数组且不查库', async () => {
  let called = 0
  const db = { query: async () => { called++; return [[]] } }
  const rows = await findSupplierPriceHistory({ supplierId: 5, productId: 10, scopeWarehouseIds: [] }, db)
  assert.deepEqual(rows, [])
  assert.equal(called, 0)
})

test('带仓库范围查询排除草稿与已取消采购单，并按最近采购顺序返回', async () => {
  const captured = {}
  const db = {
    query: async (sql, params) => {
      captured.sql = sql
      captured.params = params
      return [[
        {
          order_id: 201,
          order_no: 'PO20261128001',
          created_at: new Date('2026-11-28T02:00:00Z'),
          unit_price: 18.5,
          amount: 1850,
          quantity: 100,
          unit: '个',
          entry_qty: 100,
          entry_unit: '个',
        },
      ]]
    },
  }
  const rows = await findSupplierPriceHistory({
    supplierId: '12',
    productId: '88',
    limit: 1,
    scopeWarehouseIds: [1, 2],
  }, db)

  assert.match(captured.sql, /po\.status NOT IN \(\?, \?\)/)
  assert.match(captured.sql, /po\.warehouse_id IN \(\?,\?\)/)
  assert.deepEqual(captured.params, [12, 88, 1, 4, 1, 2, 1])
  assert.deepEqual(rows, [{
    orderId: 201,
    orderNo: 'PO20261128001',
    orderDate: '2026-11-28',
    unitPrice: 18.5,
    quantity: 100,
    unit: '个',
  }])
})
