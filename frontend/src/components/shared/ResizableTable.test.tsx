// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { ResizableTable } from './ResizableTable'

let host: HTMLDivElement, root: Root
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  localStorage.clear()
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); localStorage.clear() })
const columns = [{ key: 'code', title: '编码', width: 160 }, { key: 'quantity', title: '数量', width: 100 }, { key: 'actions', title: '操作', width: 120 }]
function render() {
  act(() => root.render(<ResizableTable columns={columns} columnStorageKey="plain-review"><tbody><tr><td>SKU-01</td><td><input aria-label="数量" defaultValue="80" /></td><td><button type="button">删除</button></td></tr></tbody></ResizableTable>))
}
test('每列提供相同的列宽把手，调整不重建数量输入或产生占位列', () => {
  render()
  const input = host.querySelector('input')!
  const handles = host.querySelectorAll<HTMLButtonElement>('thead button')
  expect([...handles].map(button => button.getAttribute('aria-label'))).toEqual(['调整编码列宽', '调整数量列宽', '调整操作列宽'])
  act(() => handles[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })))
  expect([...host.querySelectorAll('col')].map(col => col.style.width)).toEqual(['170px', '100px', '120px'])
  expect(host.querySelector('input')).toBe(input)
  expect(input.value).toBe('80')
  expect(host.querySelectorAll('thead th')).toHaveLength(3)
  expect(host.querySelectorAll('tbody td')).toHaveLength(3)
})
test('普通明细固定业务字段顺序，旧列宽记忆不能令表头与行错位', () => {
  localStorage.setItem('flowcube:table-columns:plain-review', JSON.stringify({ order: ['actions', 'quantity', 'code'], widths: { code: 210, quantity: 100, actions: 120 }, widthUnit: 'px' }))
  render()
  expect([...host.querySelectorAll('thead th')].map(cell => cell.textContent)).toEqual(['编码', '数量', '操作'])
  expect([...host.querySelectorAll('col')].map(col => col.style.width)).toEqual(['210px', '100px', '120px'])
  expect(host.querySelector('tbody td')?.textContent).toBe('SKU-01')
})
