import { test, expect } from 'vitest'
import { qtyStep } from './qtyStep'

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
