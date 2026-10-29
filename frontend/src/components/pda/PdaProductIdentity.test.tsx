// @vitest-environment jsdom
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test } from 'vitest'
import PdaProductIdentity from './PdaProductIdentity'

const code = 'SKU0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const name = '超长商品名称规格型号颜色需要完整保留'.repeat(10)
test.each(['overview', 'detail'] as const)('PDA %s 与桌面同层级显示完整商品身份', view => {
  const host = document.createElement('div')
  host.innerHTML = renderToStaticMarkup(<PdaProductIdentity code={code} name={name} product={{ spec: 'X200', color: '黑色', articleNumber: 'YN-1001' }} view={view} />)
  const root = host.firstElementChild!
  expect(root.children[0].textContent).toBe(code + name)
  expect(root.children[1].textContent).toBe('型号 X200 · 颜色 黑色 · 供应商型号 YN-1001')
  expect(root.querySelector('.truncate, details')).toBeNull()
})
test('PDA 当前事实缺少编码规格时不使用容器条码冒充商品编码', () => {
  const html = renderToStaticMarkup(<PdaProductIdentity product={{ productName: '历史商品' }} />)
  expect(html).toContain('历史商品')
  expect(html).not.toContain('型号')
  expect(html).not.toContain('font-mono')
})
