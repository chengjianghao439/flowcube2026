// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { ReportTable } from './ReportTable'
let host: HTMLDivElement, root: Root
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); localStorage.clear(); host = document.createElement('div'); document.body.append(host); root = createRoot(host) })
afterEach(() => { act(() => root.unmount()); host.remove(); localStorage.clear() })
test('财务原生表可调整列宽，保留排序、输入及合计，不添加空列', () => {
  const sort = vi.fn()
  act(() => root.render(<ReportTable><thead className="data-table-header"><tr><th><button onClick={sort}>账户</button></th><th className="text-right">余额</th></tr></thead><tbody><tr><td><input defaultValue="演示账户" /></td><td>80.50</td></tr></tbody><tfoot><tr><td>合计</td><td>80.50</td></tr></tfoot></ReportTable>))
  expect(host.querySelector('thead')?.hasAttribute('data-resizable')).toBe(true)
  const input = host.querySelector('input')!
  const handles = host.querySelectorAll<HTMLButtonElement>('button[aria-label^="调整"]')
  expect(handles).toHaveLength(2)
  const before = parseFloat(host.querySelectorAll('col')[1].style.width)
  act(() => handles[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })))
  expect(parseFloat(host.querySelectorAll('col')[1].style.width)).toBe(before + 10)
  expect(host.querySelector('input')).toBe(input)
  expect(input.value).toBe('演示账户')
  expect(host.querySelectorAll('thead th')).toHaveLength(2)
  expect(host.querySelector('tfoot')?.textContent).toBe('合计80.50')
  expect(sort).not.toHaveBeenCalled()
  act(() => host.querySelector<HTMLButtonElement>('th button:not([aria-label])')!.click())
  expect(sort).toHaveBeenCalledOnce()
})
test('试算平衡分组表头保留跨行跨列语义', () => {
  act(() => root.render(<ReportTable><thead><tr><th rowSpan={2}>科目</th><th colSpan={2}>期末余额</th></tr><tr><th>借方</th><th>贷方</th></tr></thead><tbody><tr><td>库存</td><td>80</td><td>0</td></tr></tbody></ReportTable>))
  expect(host.querySelector('th[rowspan="2"]')?.textContent).toBe('科目')
  expect(host.querySelector('th[colspan="2"]')?.textContent).toBe('期末余额')
  expect(host.querySelectorAll('thead tr')).toHaveLength(2)
  expect(host.querySelectorAll('tbody td')).toHaveLength(3)
  const handles = host.querySelectorAll<HTMLButtonElement>('button[aria-label^="调整"]')
  expect([...handles].map(h => h.getAttribute('aria-label'))).toEqual(['调整科目列宽', '调整期末余额 · 借方列宽', '调整期末余额 · 贷方列宽'])
  const cols = host.querySelectorAll('col'), before = parseFloat(cols[1].style.width)
  act(() => handles[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })))
  expect(parseFloat(cols[1].style.width)).toBe(before + 10)
  expect(host.querySelector('th[colspan="2"]')?.textContent).toBe('期末余额')
  expect(host.querySelector('tbody')?.textContent).toBe('库存800')
  const debit = host.querySelector('thead tr:last-child th:first-child > div')!
  const credit = host.querySelector('thead tr:last-child th:last-child > div')!
  vi.spyOn(debit, 'getBoundingClientRect').mockReturnValue({ width: 85 } as DOMRect)
  vi.spyOn(credit, 'getBoundingClientRect').mockReturnValue({ width: 300 } as DOMRect)
  act(() => handles[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
  expect(parseFloat(cols[1].style.width)).toBe(121) // 借方适应自己的标题，不误量第二行的贷方。
})
test('保留表格说明在列定义之前，不重复说明或丢失原行标题', () => {
  act(() => root.render(<ReportTable><caption>生成时与当前数据</caption><thead><tr><th>项目</th><th>当前</th></tr></thead><tbody><tr><th scope="row">需求</th><td>80</td></tr></tbody></ReportTable>))
  expect(host.querySelector('table')?.firstElementChild?.tagName).toBe('CAPTION')
  expect(host.querySelectorAll('caption')).toHaveLength(1)
  expect(host.querySelector('tbody th[scope="row"]')?.textContent).toBe('需求')
})
