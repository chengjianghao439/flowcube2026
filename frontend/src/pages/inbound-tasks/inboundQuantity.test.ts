import { expect, test } from 'vitest'
import { groupInboundQuantities } from './inboundQuantity'
const line = { productId: 1, productName: '商品', unit: '个', orderedQty: 2, receivedQty: 1, putawayQty: 0 }
test('2个和3米不相加；相同商品基本单位可合并，不同规格/未知单位保持独立', () => {
  expect(groupInboundQuantities([line, { ...line, productId: 2, unit: '米', orderedQty: 3 }]).map(group => [group.orderedQty, group.unit])).toEqual([[2, '个'], [3, '米']])
  expect(groupInboundQuantities([line, line])[0].orderedQty).toBe(4)
  expect(groupInboundQuantities([line, { ...line, spec: '另一包装规格' }])).toHaveLength(2)
  expect(groupInboundQuantities([{ ...line, unit: null }, { ...line, unit: null }])).toHaveLength(2)
})

test.each([null, undefined, NaN, Infinity, '0'])('未知原量%s传播有效性，后续同组零也不能洗成已知零', invalid => {
  const raw = { ...line, receivedQty: invalid } as unknown as Parameters<typeof groupInboundQuantities>[0][number]
  const group = groupInboundQuantities([raw, { ...line, receivedQty: 0 }])[0]
  expect(group.receivedQty).toBeNaN()
  expect(group.quantityState?.receivedQty).toEqual({ known: false, allZero: false })
  expect(group.orderedQty).toBe(4)
  expect(group.quantityState?.putawayQty).toEqual({ known: true, allZero: true })
})
test('同组非零相抵仍保留非全零事实；正常基本量合计不变', () => {
  const group = groupInboundQuantities([{ ...line, receivedQty: 1 }, { ...line, receivedQty: -1 }])[0]
  expect(group.receivedQty).toBe(0)
  expect(group.quantityState?.receivedQty).toEqual({ known: true, allZero: false })
  expect(group.quantityState?.putawayQty).toEqual({ known: true, allZero: true })
})
