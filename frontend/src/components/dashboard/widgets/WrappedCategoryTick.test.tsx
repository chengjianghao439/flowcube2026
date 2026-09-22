import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { WrappedCategoryTick } from './WrappedCategoryTick'
import { splitChartLabel, categoryChartHeight } from './chartLabelLayout'

describe('完整图表分类标签', () => {
  it('完整保留中英文长名称及 Unicode 字符', () => {
    for (const text of ['超长商品名称规格颜色及客户自定义编码'.repeat(8), 'SKU-' + 'ABC0123456789'.repeat(12), '📦仓库'.repeat(12)]) {
      const lines = splitChartLabel(text)
      expect(lines.join('')).toBe(text)
      expect(lines.every(line => Array.from(line).length <= 8)).toBe(true)
      const html = renderToStaticMarkup(<svg><WrappedCategoryTick x={110} y={200} payload={{ value: text }} /></svg>)
      expect(html).toContain(`<title>${text}</title>`)
      expect(html).not.toContain('…')
    }
  })
  it('根据最长标签增加每行空间，避免多行标签互相重叠', () => {
    const names = ['短名', '仓库'.repeat(80)]
    const maxLines = Math.max(...names.map(n => splitChartLabel(n).length))
    expect((categoryChartHeight(names) - 40) / names.length).toBeGreaterThanOrEqual(maxLines * 16 + 20)
    expect(categoryChartHeight([])).toBeGreaterThanOrEqual(240)
  })
})
