// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { PurchaseProductIdentity } from './PurchaseProductIdentity'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let host: HTMLDivElement, root: ReturnType<typeof createRoot>
beforeEach(() => {
  // jsdom不排版；仅补实际文字测量边界，真实展开组件和原生details保留。
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(280)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(16)
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function (this: HTMLElement) { return (this.textContent?.length ?? 0) > 50 ? 64 : 16 })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks() })
const item = { productCode: 'P11', productName: '标准商品', spec: '短型号', color: '黑色', articleNumber: '' }

test('长规格默认紧凑且提供原生展开，完整编码名称与规格仍可核对', async () => {
  const spec = '技术参数'.repeat(30)
  await act(async () => root.render(<PurchaseProductIdentity item={{ ...item, spec }} />))
  const details = host.querySelector('details')!
  expect(details).not.toBeNull()
  expect(details.open).toBe(false)
  expect(host.querySelector<HTMLElement>('.table-text-value')!.style.webkitLineClamp).toBe('1')
  expect(details.querySelector('summary')!.textContent).toContain('展开或收起商品规格')
  expect(host.textContent).toContain('P11标准商品')
  expect(host.textContent).toContain(spec)
  await act(async () => details.querySelector('summary')!.click())
  expect(details.open).toBe(true)
})

test('短规格不增加展开按钮，编辑商品入口和供应商型号保持', async () => {
  await act(async () => root.render(<PurchaseProductIdentity item={{ ...item, articleNumber: 'A12' }} name={<button>标准商品</button>} />))
  expect(host.querySelector('details')).toBeNull()
  expect(host.querySelector('button')!.textContent).toBe('标准商品')
  expect(host.textContent).toContain('型号 短型号 · 颜色 黑色 · 供应商型号 A12')
})
