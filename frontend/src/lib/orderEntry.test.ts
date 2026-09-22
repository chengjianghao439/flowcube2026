import { expect, test } from 'vitest'
import { collectOrderIssues } from './orderEntry'
const row = { _key: 7, productId: 1, productName: '测试商品', quantity: 2, unitPrice: 3 }
const valid = { kind: 'sale' as const, partyId: '1', partyName: '客户', warehouseId: '1', warehouseName: '仓', items: [row] }
test('集中收集头字段和多个明细错误，保留原始行号和稳定行键', () => {
 const issues = collectOrderIssues({ ...valid, partyId: '', warehouseId: '', items: [{ ...row, productId: 0 }, { ...row, _key: 9, quantity: 0, unitPrice: 0 }] })
 expect(issues.map(x => x.target)).toEqual(['party', 'warehouse', 'item-9-quantity', 'item-9-price'])
 expect(issues[2].message).toContain('第 2 行')
})
test('销售忽略空占位行，采购提示未选商品；采购零单价有效但小数数量无效', () => {
 expect(collectOrderIssues({ ...valid, items: [row, { ...row, productId: 0 }] })).toEqual([])
 expect(collectOrderIssues({ ...valid, kind: 'purchase', items: [{ ...row, productId: 0 }] })[0].target).toBe('item-7-product')
 expect(collectOrderIssues({ ...valid, kind: 'purchase', items: [{ ...row, unitPrice: 0 }] })).toEqual([])
 expect(collectOrderIssues({ ...valid, kind: 'purchase', items: [{ ...row, quantity: 1.2 }] })[0].target).toBe('item-7-quantity')
})
test('非有限数量和价格、电话与无效折扣均不能遗漏', () => {
 expect(collectOrderIssues({ ...valid, items: [{ ...row, quantity: NaN, unitPrice: Infinity }], receiverPhone: '错误', discountAmount: -1 }).map(x=>x.target)).toEqual(['item-7-quantity', 'item-7-price', 'phone', 'discount'])
 expect(collectOrderIssues({ ...valid, discountAmount: 7 })[0].target).toBe('discount')
 expect(collectOrderIssues({ ...valid, discountAmount: 6 })).toEqual([])
 expect(collectOrderIssues({ ...valid, items: [], discountAmount: 0 })[0].target).toBe('add')
})
test('查价未结束或失败时必须确认，空占位行的旧查价状态不阻止提交', () => {
 expect(collectOrderIssues({ ...valid, priceLoading: { 7: true } })[0].message).toContain('正在查询价格')
 expect(collectOrderIssues({ ...valid, priceErrors: { 7: '请手动确认单价' } })[0].message).toContain('请手动确认单价')
 expect(collectOrderIssues({ ...valid, priceErrors: { 8: '失败' } })).toEqual([])
})

test('销售提交拒绝三位以上数量，四位单价仍然合法', () => {
 expect(collectOrderIssues({ ...valid, items: [{ ...row, quantity: 1.234, unitPrice: 1.2345 }] }).map(x => x.target)).toEqual(['item-7-quantity'])
 expect(collectOrderIssues({ ...valid, items: [{ ...row, quantity: 1.23, unitPrice: 1.2345 }] })).toEqual([])
})
