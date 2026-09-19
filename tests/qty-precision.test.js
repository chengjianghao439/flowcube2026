#!/usr/bin/env node
'use strict'

/**
 * 数量精度校验契约（迁移 254 的 `product_items.allow_decimal_qty`）。
 *
 * 反向验证：把 qtyPrecision.js 的 QTY_EPSILON 调大到 1e-2 会让「1.005 被拒」的用例失败；
 * 把 allowDecimal === false 分支删掉会让整数用例失败——即守卫真的在拦东西。
 *
 * 运行：node --test tests/qty-precision.test.js
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const {
  qtyPrecisionProblem,
  assertQtyPrecisionWith,
  assertQtyPrecision,
  loadQtyPolicies,
  hasFraction,
  hasTooManyDecimals,
} = require('../backend/src/utils/qtyPrecision')

const INTEGER_ONLY = { id: 1, code: 'P001', name: '矿泉水', allowDecimal: false }
const DECIMAL_OK = { id: 2, code: 'P002', name: '螺纹钢', allowDecimal: true }

test('只能整数的商品：整数放行、小数被拒', () => {
  assert.equal(qtyPrecisionProblem(INTEGER_ONLY, 3), null)
  assert.equal(qtyPrecisionProblem(INTEGER_ONLY, 0), null)
  assert.equal(qtyPrecisionProblem(INTEGER_ONLY, '7'), null)

  const problem = qtyPrecisionProblem(INTEGER_ONLY, 1.5)
  assert.equal(problem.code, 'QTY_INTEGER_REQUIRED')
  assert.match(problem.message, /矿泉水/)
  assert.match(problem.message, /1\.5/)
})

test('浮点噪声不会被误判为小数', () => {
  // 0.1 + 0.2 === 0.30000000000000004，必须按两位小数放行
  assert.equal(qtyPrecisionProblem(DECIMAL_OK, 0.1 + 0.2), null)
  assert.equal(qtyPrecisionProblem(DECIMAL_OK, 1.1 * 1), null)
  assert.equal(qtyPrecisionProblem(DECIMAL_OK, Number('2.50')), null)
  // 只能整数的商品同样不能被噪声判成小数
  assert.equal(qtyPrecisionProblem(INTEGER_ONLY, Number('5.00000000001')), null)
})

test('商品查不到时放行（「商品不存在」由业务自己报错）', () => {
  assert.equal(qtyPrecisionProblem(null, 1.5), null)
  assert.equal(qtyPrecisionProblem(undefined, 1.234), null)
})

test('非有限数被拦下', () => {
  assert.equal(qtyPrecisionProblem(INTEGER_ONLY, NaN).code, 'QTY_INVALID')
  assert.equal(qtyPrecisionProblem(DECIMAL_OK, Infinity).code, 'QTY_INVALID')
})

test('assertQtyPrecisionWith 抛出带 code 的 400', () => {
  assert.throws(() => assertQtyPrecisionWith(INTEGER_ONLY, 2.5, '第 3 行数量'), (err) => {
    assert.equal(err.statusCode, 400)
    assert.equal(err.code, 'QTY_INTEGER_REQUIRED')
    assert.match(err.message, /第 3 行数量/)
    return true
  })
  assert.doesNotThrow(() => assertQtyPrecisionWith(DECIMAL_OK, 2.5))
})

test('assertQtyPrecision 按商品批量读开关并逐条校验', async () => {
  const seen = []
  const conn = {
    async query(sql, params) {
      seen.push(params[0])
      return [[
        { id: 1, code: 'P001', name: '矿泉水', allow_decimal_qty: 0 },
        { id: 2, code: 'P002', name: '螺纹钢', allow_decimal_qty: 1 },
      ]]
    },
  }

  await assert.doesNotReject(() => assertQtyPrecision(conn, [
    { productId: 1, qty: 2, label: '第 1 行数量' },
    { productId: 2, qty: 1.25, label: '第 2 行数量' },
  ]))

  await assert.rejects(() => assertQtyPrecision(conn, [
    { productId: 1, qty: 2 },
    { productId: 2, qty: 1.25 },
    { productId: 1, qty: 0.5, label: '第 3 行数量' },
  ]), (err) => {
    assert.equal(err.code, 'QTY_INTEGER_REQUIRED')
    assert.match(err.message, /第 3 行数量/)
    return true
  })
})

test('开关改动立即生效（不跨调用缓存策略）', async () => {
  let allow = 1
  let calls = 0
  const conn = {
    async query() {
      calls++
      return [[{ id: 9, code: 'P009', name: '整箱货', allow_decimal_qty: allow }]]
    },
  }
  await assert.doesNotReject(() => assertQtyPrecision(conn, [{ productId: 9, qty: 1.5 }]))
  allow = 0 // 管理员在同一个连接上把它改成「只能整数」
  await assert.rejects(
    () => assertQtyPrecision(conn, [{ productId: 9, qty: 1.5 }]),
    (err) => err.code === 'QTY_INTEGER_REQUIRED',
  )
  assert.equal(calls, 2, '每次校验都要重新读开关，否则改了开关还能按小数下单')
})

test('allow_decimal_qty 为 NULL 时视作允许（与商品接口出参同口径）', async () => {
  const conn = { async query() { return [[{ id: 3, code: 'P003', name: '旧商品', allow_decimal_qty: null }]] } }
  const policies = await loadQtyPolicies(conn, [3])
  assert.equal(policies.get(3).allowDecimal, true)
  assert.doesNotThrow(() => assertQtyPrecisionWith(policies.get(3), 1.5))
})
