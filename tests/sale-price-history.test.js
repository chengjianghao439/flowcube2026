'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')

const dbPath = require.resolve('../backend/src/config/db')
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { pool: {} } }

const { findCustomerPriceHistory } = require('../backend/src/modules/sale/sale.price-history')
const { SALE_STATUS } = require('../backend/src/constants/saleOrderStatus')

test('非法 customerId / productId 返回 400 INVALID_PARAM 且不查库', async () => {
  let queried = false
  const db = { query: async () => { queried = true; return [[]] } }
  for (const args of [
    { customerId: '', productId: 1 },
    { customerId: 'abc', productId: 1 },
    { customerId: 0, productId: 1 },
    { customerId: 1, productId: -2 },
    { customerId: 1, productId: '1.5' },
  ]) {
    await assert.rejects(() => findCustomerPriceHistory(args, db), e => e.statusCode === 400 && e.code === 'INVALID_PARAM')
  }
  assert.equal(queried, false)
})

test('空仓库范围直接返回空数组且不查库', async () => {
  let queried = false
  const db = { query: async () => { queried = true; return [[]] } }
  const rows = await findCustomerPriceHistory({ customerId: 10, productId: 20, scopeWarehouseIds: [] }, db)
  assert.deepEqual(rows, [])
  assert.equal(queried, false)
})

test('带仓库范围查询排除草稿与已取消单据，并按最近成交顺序与限制条数返回', async () => {
  let capturedSql = ''
  let capturedParams = []
  const db = {
    query: async (sql, params) => {
      capturedSql = sql
      capturedParams = params
      return [[
        { order_id: 12, order_no: 'SL20261127002', created_at: '2026-11-27T08:00:00Z', unit_price: '118.50', amount: '237.00', quantity: '2.00', unit: '件', entry_qty: '2.00', entry_unit: '件' },
        { order_id: 9, order_no: 'SL20261120001', created_at: '2026-11-20T04:00:00Z', unit_price: '120.00', amount: '600.00', quantity: '5.00', unit: '件', entry_qty: null, entry_unit: null },
      ]]
    },
  }
  const rows = await findCustomerPriceHistory({ customerId: 10, productId: 20, limit: 99, scopeWarehouseIds: [1, 3] }, db)
  assert.match(capturedSql, /so\.status NOT IN \(\?, \?\)/)
  assert.match(capturedSql, /COALESCE\(soi\.warehouse_id, so\.warehouse_id\) IN \(\?,\?\)/)
  assert.deepEqual(capturedParams, [10, 20, SALE_STATUS.DRAFT, SALE_STATUS.CANCELLED, 1, 3, 10])
  assert.deepEqual(rows, [
    { orderId: 12, orderNo: 'SL20261127002', orderDate: '2026-11-27', unitPrice: 118.5, quantity: 2, unit: '件' },
    { orderId: 9, orderNo: 'SL20261120001', orderDate: '2026-11-20', unitPrice: 120, quantity: 5, unit: '件' },
  ])
})
