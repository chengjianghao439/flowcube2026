// @vitest-environment jsdom
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test } from 'vitest'
import { ProductIdentityCells, ProductIdentityHeaders } from './ProductIdentityCells'
import { productIdentityColumns } from './productIdentityColumns'
import { ProductIdentitySummary } from './ProductIdentitySummary'
const product = { productCode: 'SKU0001', productName: '测试商品1', spec: 'X200', color: '黑色', articleNumber: 'YN-1001' }
const html = (value: React.ReactNode) => { const host = document.createElement('div'); host.innerHTML = renderToStaticMarkup(value); return host }
test('商品原生表头与内容始终对应一列，名称链接保持可用', () => {
  const host = html(<table><thead><tr><ProductIdentityHeaders /></tr></thead><tbody><tr><ProductIdentityCells product={product} nameContent={<a href="#product">测试商品1</a>} /></tr></tbody></table>)
  expect([...host.querySelectorAll('th')].map(cell => cell.textContent)).toEqual(['商品'])
  expect(host.querySelectorAll('td')).toHaveLength(1)
  expect(host.querySelector('a')?.getAttribute('href')).toBe('#product')
  expect(host.textContent).toContain('SKU0001测试商品1型号 X200 · 颜色 黑色 · 供应商型号 YN-1001')
})
test('显式商品旧字段别名映射到同一摘要，不丢编码名称', () => {
  const columns = productIdentityColumns({ code: 'legacySku', name: 'legacyName' })
  expect(columns).toHaveLength(1)
  expect(columns[0].title).toBe('商品')
  const row = { legacySku: 'OLD-42', legacyName: '旧字段商品', spec: 'S2' }
  const host = html(columns[0].render?.(undefined, row))
  expect(host.textContent).toBe('OLD-42旧字段商品型号 S2')
})
test('缺失身份不编造元数据，长字段完整显示且无需展开', () => {
  const name = '长商品'.repeat(100), spec = '长型号'.repeat(80)
  const host = html(<ProductIdentitySummary product={{ productName: name, spec }} />)
  expect(host.textContent).toBe(`${name}型号 ${spec}`)
  expect(host.textContent).not.toContain('颜色')
  expect(host.querySelector('details, .truncate, [style*="line-clamp"]')).toBeNull()
})
