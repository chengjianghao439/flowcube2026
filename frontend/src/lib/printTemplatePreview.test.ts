import { expect, test } from 'vitest'
import { adaptTemplatePreview, defaultPreviewElements } from './printTemplatePreview'

test('数字零保留，缺少标签字段留空', () => {
  expect(adaptTemplatePreview({ type: 6, kind: 'label', sourceLabel: 'I1', data: { qty: 0, product_name: null, container_code: 'I1' } }).data).toEqual({ qty: '0', product_name: '', container_code: 'I1' })
})
test('退货真实编号使用returnNo，沿用采购/销售退货标题', () => {
  const result = adaptTemplatePreview({ type: 3, kind: 'return', sourceLabel: 'PR1', record: { returnNo: 'PR1', type: 'purchase', supplierName: '真实供应商', items: [] } })
  expect(result.data.orderNo).toBe('PR1'); expect(result.data.title).toBe('采购退货单'); expect(result.items).toEqual([])
})
test.each([[1, 105, 148], [2, 148, 210], [8, 30, 40], [10, 120, 100]] as const)('类型%s的初始排版适配%s×%s纸张', (type, w, h) => {
  const elements = defaultPreviewElements(type, w, h)
  expect(elements.length).toBeGreaterThan(0)
  for (const el of elements) { expect(el.x).toBeGreaterThanOrEqual(0); expect(el.y).toBeGreaterThanOrEqual(0); expect(el.x + el.width).toBeLessThanOrEqual(w); expect(el.y + el.height).toBeLessThanOrEqual(h) }
})
