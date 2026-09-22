// @vitest-environment jsdom
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test } from 'vitest'
import PdaProductIdentity from './PdaProductIdentity'

const code = 'SKU0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const name = '超长商品名称规格型号颜色需要完整保留'.repeat(10)
function render(view: 'overview' | 'detail') {
  const host = document.createElement('div')
  host.innerHTML = renderToStaticMarkup(<PdaProductIdentity code={code} name={name} view={view} />)
  return host.firstElementChild!
}
test('PDA 总览优先编码，辅助名称单行但保留原值', () => {
  const root = render('overview')
  expect(root.children[0].textContent).toBe(code)
  expect(root.children[0].classList.contains('truncate')).toBe(false)
  expect(root.children[1].textContent).toBe(name)
  expect(root.children[1].classList.contains('truncate')).toBe(true)
  expect(root.children[1].getAttribute('title')).toBe(name)
})
test('PDA 详情仍以编码为主，名称完整换行', () => {
  const root = render('detail')
  expect(root.children[0].textContent).toBe(code)
  expect(root.children[1].textContent).toBe(name)
  expect(root.querySelector('.truncate')).toBeNull()
  expect(root.children[1].classList.contains('whitespace-normal')).toBe(true)
})
