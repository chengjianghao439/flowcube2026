// @vitest-environment jsdom
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import { SaleOrderItemsSection } from './SaleOrderItemsSection'

it('紧凑商品区保留添加动作和明细，移除常驻功能说明', () => {
  const html = renderToStaticMarkup(<SaleOrderItemsSection compact hasItems onAdd={() => {}}><p>既有明细</p></SaleOrderItemsSection>)
  expect(html).toContain('添加商品')
  expect(html).toContain('既有明细')
  expect(html).not.toContain('数量、单价按 Enter 前进')
})

it('标准商品区同样移除常驻快捷键教学提示', () => {
  const html = renderToStaticMarkup(<SaleOrderItemsSection hasItems onAdd={() => {}}><p>既有明细</p></SaleOrderItemsSection>)
  expect(html).toContain('既有明细')
  expect(html).not.toContain('数量、单价按 Enter 前进')
})


it('空明细在两种布局的添加操作附近显示调用方提供的错误', () => {
  const compact = renderToStaticMarkup(<SaleOrderItemsSection compact addError="请添加至少一条商品明细" hasItems={false} onAdd={() => {}}>{null}</SaleOrderItemsSection>)
  expect(compact).toContain('role="alert"')
  expect(compact).toContain('请添加至少一条商品明细')
  const standard = renderToStaticMarkup(<SaleOrderItemsSection addError="请添加至少一条商品明细" hasItems={false} onAdd={() => {}}>{null}</SaleOrderItemsSection>)
  expect(standard).toContain('role="alert"')
})
