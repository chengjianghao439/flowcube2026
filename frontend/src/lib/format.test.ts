import { expect, test } from 'vitest'
import { amount, money } from './format'

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
