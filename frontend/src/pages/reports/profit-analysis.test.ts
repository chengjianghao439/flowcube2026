import { expect, test } from 'vitest'
import { costBasisNote } from './profit-analysis'

test('行内成本来源：四种明确来源各自有简洁中文说明', () => {
  expect(costBasisNote({ costBasis: 'snapshot' }).text).toBe('出库成本快照')
  expect(costBasisNote({ costBasis: 'estimated' }).text).toBe('按当前进价估算')

  const missing = costBasisNote({ costBasis: 'missing', missingCostLineCount: 2 })
  expect(missing.text).toContain('2 行')
  expect(missing.text).toContain('按 0 计')
  expect(missing.warn).toBe(true)

  const mixed = costBasisNote({ costBasis: 'mixed', missingCostLineCount: 1, estimatedCostAmount: 300 })
  expect(mixed.text).toContain('1 行')
  expect(mixed.text).toContain('300')
  expect(mixed.warn).toBe(true)
})

test('来源未知或字段缺失时不得默认成「出库成本快照」', () => {
  // 前后端滚动更新 / API 未返回该字段：costBasis 为 undefined。
  // 若这里默认成"快照"，就是把"没查到来源"说成"全部可信"——必须退回待核实。
  const absent = costBasisNote({})
  expect(absent.text).not.toBe('出库成本快照')
  expect(absent.text).toContain('待核实')
  expect(absent.warn).toBe(true)

  // 将来后端新增了前端不认识的取值，同样不得当成快照
  const unknown = costBasisNote({ costBasis: 'something_new' })
  expect(unknown.text).not.toBe('出库成本快照')
  expect(unknown.warn).toBe(true)
})
