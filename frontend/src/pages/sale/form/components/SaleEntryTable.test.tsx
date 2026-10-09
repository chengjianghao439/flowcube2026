// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { SaleEntryTable } from './SaleEntryTable'

let host: HTMLDivElement, root: Root
const storageKey = 'flowcube:table-columns:sale-entry-items'
const widths = [540, 112, 96, 144, 128, 176, 80]
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  localStorage.removeItem(storageKey)
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  vi.spyOn(HTMLTableColElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLTableColElement) {
    const index = [...this.parentElement!.children].indexOf(this)
    return { width: widths[index] } as DOMRect
  })
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); localStorage.removeItem(storageKey) })
function render() {
  act(() => root.render(<SaleEntryTable rowCount={2}><tbody><tr>
    <td>完整商品身份</td><td><input defaultValue="2" /></td><td>箱</td><td><input defaultValue="120" /></td><td>240.00</td><td><input defaultValue="原行备注" /></td><td>操作</td>
  </tr></tbody></SaleEntryTable>))
}
function resize(end: 'mouseup' | 'Escape') {
  const handle = host.querySelector<HTMLButtonElement>('[aria-label="调整数量列宽"]')!
  act(() => handle.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: 100 })))
  act(() => window.dispatchEvent(new MouseEvent('mousemove', { clientX: 180 })))
  act(() => window.dispatchEvent(end === 'mouseup' ? new MouseEvent('mouseup', { clientX: 180 }) : new KeyboardEvent('keydown', { key: 'Escape' })))
}
test('复用共享拖动，只保存列宽；取消不覆盖原布局，重挂载恢复宽度且行输入保持', () => {
  render()
  expect(host.querySelectorAll('[aria-label^="调整"][aria-label$="列宽"]')).toHaveLength(7)
  resize('Escape')
  expect(localStorage.getItem(storageKey)).toBeNull()
  expect(document.body.style.cursor).toBe('')
  resize('mouseup')
  const saved = JSON.parse(localStorage.getItem(storageKey)!)
  expect(saved.widths.quantity).toBe(192)
  expect(saved.widthUnit).toBe('px')
  expect([...host.querySelectorAll('input')].map(input => input.value)).toEqual(['2', '120', '原行备注'])
  expect((host.querySelectorAll('col')[1] as HTMLElement).style.width).toBe('192px')
  act(() => root.render(<></>)); render()
  expect((host.querySelectorAll('col')[1] as HTMLElement).style.width).toBe('192px')
  expect([...host.querySelectorAll('th')].map(th => th.textContent)).toEqual(['商品', '数量', '单位', '单价 (¥)', '金额', '备注', '操作'])
})
