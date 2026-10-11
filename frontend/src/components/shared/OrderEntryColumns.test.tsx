// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { SaleEntryTable } from '@/pages/sale/form/components/SaleEntryTable'
import { PurchaseEntryTable } from '@/pages/purchase/form/PurchaseEntryTable'
import { InboundEntryTable } from '@/pages/inbound-tasks/InboundEntryTable'

let host: HTMLDivElement, root: Root
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  localStorage.clear(); host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(() => { act(() => window.dispatchEvent(new Event('blur'))); act(() => root.unmount()); host.remove(); vi.restoreAllMocks() })
const row = <tr><td>完整商品</td><td><input defaultValue="3" /></td><td>个</td><td>3.4567</td><td>10.37</td><td><button>删除</button></td></tr>
const variants = {
  sale: () => <SaleEntryTable><tbody>{row}</tbody></SaleEntryTable>,
  purchase: () => <PurchaseEntryTable stickyHeader rowCount={2}><tbody>{row}</tbody></PurchaseEntryTable>,
  inbound: () => <InboundEntryTable data={[{ id: 1 }]} getRowKey={r => r.id} renderRow={() => row} />,
}
test.each(Object.keys(variants) as (keyof typeof variants)[])('%s 默认比例每列达到共享拖动80px下限，第一次缩窄不反向扩大', variant => {
  act(() => root.render(variants[variant]()))
  const minimum = parseFloat(host.querySelector('table')!.style.minWidth)
  const widths = [...host.querySelectorAll('col')].map(col => parseFloat(col.style.width) * minimum / 100)
  expect(Math.min(...widths)).toBeGreaterThanOrEqual(80)
})
test.each(['purchase', 'inbound'] as const)('%s 表头沿销售可换行与单一分隔把手，不叠加原静态分隔线', variant => {
  act(() => root.render(variants[variant]()))
  expect(host.querySelector('thead')!.hasAttribute('data-resizable')).toBe(true)
  expect(host.querySelector('thead .whitespace-nowrap')).toBeNull()
  expect(host.querySelector('th:last-child')!.classList.contains('!px-2')).toBe(false)
})
test.each(['purchase', 'inbound'] as const)('%s 最后操作列沿销售独立调宽与取消规则，输入不重建', variant => {
  act(() => root.render(variants[variant]()))
  const cols = [...host.querySelectorAll('col')], original = cols.map(col => col.style.width)
  cols.forEach((col, index) => vi.spyOn(col, 'getBoundingClientRect').mockReturnValue({ width: index === cols.length - 1 ? 80 : 200 } as DOMRect))
  const input = host.querySelector('input'), handle = host.querySelector('[aria-label="调整操作列宽"]')!
  act(() => handle.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: 600 })))
  act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
  act(() => window.dispatchEvent(new MouseEvent('mouseup', { clientX: 680 })))
  expect(cols.map(col => col.style.width)).toEqual(original)
  act(() => handle.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: 600 })))
  act(() => window.dispatchEvent(new MouseEvent('mouseup', { clientX: 680 })))
  expect(cols.map(col => col.style.width)).toEqual(cols.map((_, index) => index === cols.length - 1 ? '160px' : '200px'))
  expect(host.querySelector('input')).toBe(input); expect(input!.value).toBe('3')
  const key = `flowcube:table-columns:${variant === 'purchase' ? 'purchase' : 'inbound'}-entry-items`
  expect(JSON.parse(localStorage.getItem(key)!).widths.actions).toBe(160)
  expect(localStorage.getItem('flowcube:table-columns:sale-entry-items')).toBeNull()
  act(() => root.render(<></>)); act(() => root.render(variants[variant]()))
  expect(host.querySelector('col:last-child')!.getAttribute('style')).toContain('160px')
})
