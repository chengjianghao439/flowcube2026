import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test } from 'vitest'
import TemplateRenderer, { type PrintItem } from './TemplateRenderer'
import type { TemplateElement } from '@/types/print-template'

const el: TemplateElement = { id: 'table', type: 'table', fieldKey: 'itemsTable', label: '', x: 0, y: 0, width: 180, height: 10, fontSize: 9, fontWeight: 'normal', textAlign: 'left', border: true, tableColumns: ['name', 'qty', 'price', 'amount'] }
const item: PrintItem = { productCode: 'TEST', productName: '测试', unit: '件', quantity: 1, unitPrice: 1, amount: 1 }
test('超预算单据显示明确错误且不截断打印部分明细', () => {
  const html = renderToStaticMarkup(<TemplateRenderer layout={{ elements: [el] }} paperSize="A4" data={{}} items={Array(2001).fill(item)} />)
  expect(html.includes('单据打印内容超过安全限制')).toBe(true)
  expect(html).not.toContain('<tr')
})
test('历史超多元素或表列拒绝展开', () => {
  for (const elements of [Array(129).fill(el), [{ ...el, tableColumns: Array(11).fill('name') }]]) {
    const html = renderToStaticMarkup(<TemplateRenderer layout={{ elements }} paperSize="A4" data={{}} items={[item]} />)
    expect(html.includes('单据打印内容超过安全限制')).toBe(true)
    expect(html).not.toContain('<tr')
  }
})
test('最大允许模板和2000行自然渲染，节点数量与耗时有界', () => {
  const elements = [el, ...Array.from({ length: 127 }, (_, i) => ({ ...el, id: String(i), type: 'text' as const, tableColumns: undefined }))]
  const begin = performance.now()
  const html = renderToStaticMarkup(<TemplateRenderer layout={{ elements }} paperSize="A4" data={{}} items={Array(2000).fill(item)} />)
  expect(html.match(/<tr/g)?.length).toBe(2002)
  expect(html.match(/<td/g)?.length).toBe(10002)
  expect(performance.now() - begin).toBeLessThan(3000)
})
