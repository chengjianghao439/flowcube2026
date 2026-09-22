import { test, expect } from 'vitest'
import { qtyStep, quantityInputError, hasQuantityPrecision, roundQuantity } from './qtyStep'

/**
 * 数量输入框 step 的取值口径（迁移 254 的商品「数量小数」开关）。
 *
 * 反向验证：把 qtyStep 的 `allowDecimal === false` 判断改成 `!allowDecimal`，
 * 「未加载时按允许「0.01」」这条会失败——那正是「查询还没回来就把整数框锁死」的回归。
 */
test('只能整数的商品 step=1', () => {
  expect(qtyStep(false)).toBe('1')
})

test('允许小数（含未加载）step=0.01', () => {
  expect(qtyStep(true)).toBe('0.01')
  expect(qtyStep(undefined)).toBe('0.01')
  expect(qtyStep(null)).toBe('0.01')
})

test('有效小数按原文判断，不能通过尾零、科学计数法和浮点截断绕过', () => {
  for (const value of ['1.2340', '0.0001', '1e-3', '1.2300000000000001']) expect(quantityInputError(value)).toBeTruthy()
  for (const value of ['1.23000', '123e-2', '0.000', '0e-100']) expect(quantityInputError(value)).toBeNull()
})

test('数字计算允许IEEE噪声，但真实小于0.01的数量仍拒绝', () => {
  expect(hasQuantityPrecision(0.1 + 0.2)).toBe(true)
  expect(hasQuantityPrecision(1.0001)).toBe(false)
  expect(hasQuantityPrecision(1e-18)).toBe(false)
  expect(roundQuantity(1.2345)).toBe(1.23)
})
