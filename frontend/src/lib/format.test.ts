import { expect, test } from 'vitest'
import { amount, money, qty } from './format'

/**
 * 2026-09-19 收敛前，全仓有 20 处各自定义的 money()/fmtMoney()：11 处不带千分位、
 * 两处连 ¥ 都没有、一处 4 位小数、空值有的显示 ¥0.00 有的显示 —。
 * 这组用例把统一后的规则钉住，避免又冒出第 21 种写法。
 */

test('money：千分位 + 固定 2 位小数 + ¥ 前缀', () => {
  expect(money(1234567.891)).toBe('¥1,234,567.89')
  expect(money(90)).toBe('¥90.00')
  expect(money(0)).toBe('¥0.00')
  expect(money(-20)).toBe('¥-20.00')
})

test('amount：同一套数字规则，但不带货币符号（会计凭证借贷方按标准格式列示）', () => {
  expect(amount(1234567.891)).toBe('1,234,567.89')
  expect(amount(-20)).toBe('-20.00')
  expect(amount(0)).toBe('0.00')
})

test('空值与非有限数显示「—」，不伪装成 0', () => {
  for (const value of [null, undefined, NaN, Infinity, -Infinity]) {
    expect(money(value)).toBe('—')
    expect(amount(value)).toBe('—')
  }
})

test('qty：整数不补零、小数保留有效位、最多 4 位', () => {
  expect(qty(3)).toBe('3')
  expect(qty(1.2)).toBe('1.2')
  expect(qty(1.25)).toBe('1.25')
  expect(qty(0.0001)).toBe('0.0001')
  expect(qty(12345)).toBe('12,345')
  // 超过 4 位（DECIMAL(14,4) 的精度）才截断——这是显示口径，不是校验
  expect(qty(1.234567)).toBe('1.2346')
})

test('qty 的空值口径与金额一致', () => {
  for (const value of [null, undefined, NaN, Infinity, -Infinity]) {
    expect(qty(value)).toBe('—')
  }
})
