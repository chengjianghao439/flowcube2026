// @vitest-environment jsdom
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import DataTable from './DataTable'
import { SectionVisibilityContext } from '@/components/layout/SectionVisibilityContext'
const rows = Array.from({ length: 1000 }, (_, i) => ({ id: i + 1, name: `商品 ${i + 1}` }))
const columns = [{ key: 'name', title: '名称', width: 200 }]
let host: HTMLDivElement, root: Root
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  host = document.createElement('div'); host.dataset.workspaceScroll = ''; document.body.append(host)
  Object.defineProperty(host, 'clientHeight', { value: 480 }); Object.defineProperty(host, 'offsetHeight', { value: 480 }); Object.defineProperty(host, 'offsetWidth', { value: 800 })
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const height = this === host ? 480 : this.tagName === 'TR' ? 48 : 0
    return { height, width: 800, top: this === host ? 0 : -host.scrollTop, left: 0, bottom: height, right: 800, x: 0, y: 0, toJSON() {} }
  })
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  host.scrollTo = vi.fn((options: ScrollToOptions) => { host.scrollTop = options.top || 0 }) as typeof host.scrollTo
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
function render(active = true, data = rows) { act(() => root.render(<SectionVisibilityContext.Provider value={active}><DataTable columns={columns} data={data} virtualized /></SectionVisibilityContext.Provider>)) }
test('大列表只挂载可视行，保留全量高度和总行数语义', () => {
  render(); expect(host.querySelectorAll('tbody tr:not([aria-hidden])').length).toBeLessThan(50)
  expect(host.textContent).toContain('商品 1'); expect(host.textContent).not.toContain('商品 1000')
  expect(host.querySelector('table')?.getAttribute('aria-rowcount')).toBe('1001')
})
test('滚动到远处能访问末行，隐藏再显示保留位置', () => {
  render(); act(() => { host.scrollTop = 48000 - 480; host.dispatchEvent(new Event('scroll')) })
  expect(host.textContent).toContain('商品 1000'); render(false); render(true)
  expect(host.scrollTop).toBeGreaterThan(45000); expect(host.textContent).toContain('商品 1000')
})
test('大列表全选包含屏幕外记录，禁用行不选中', () => {
  const onSelectionChange = vi.fn(), selectableCheck = (r: {id:number}) => r.id % 2 === 0
  function SelectedTable() {
    const [ids, setIds] = useState(new Set<number>())
    return <DataTable columns={columns} data={rows} virtualized selectable selectedIds={ids} selectableCheck={selectableCheck} onSelectionChange={next => { setIds(next); onSelectionChange(next) }} />
  }
  act(() => root.render(<SelectedTable />)); act(() => (host.querySelector('thead input') as HTMLInputElement).click())
  const selected = onSelectionChange.mock.calls[0][0] as Set<number>
  expect(selected.size).toBe(500); expect(selected.has(1000)).toBe(true); expect(selected.has(999)).toBe(false)
  expect(host.querySelectorAll('tbody input:checked').length).toBeLessThan(50)
})
test('少量行保持普通表格，收窄结果不留下空白占位', () => {
  render(); render(true, rows.slice(0, 3)); expect(host.querySelectorAll('tbody tr')).toHaveLength(3); expect(host.textContent).toContain('商品 3')
})

test('多行文本按真实行高增加占位，避免固定行高造成重叠', () => {
  vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockImplementation(function (this: HTMLElement) {
    const height = this === host ? 480 : this.tagName === 'TR' ? (this.dataset.index === '0' ? 96 : 48) : 0
    return { height, width: 800, top: this === host ? 0 : -host.scrollTop, left: 0, bottom: height, right: 800, x: 0, y: 0, toJSON() {} }
  })
  render()
  const total = [...host.querySelectorAll<HTMLTableRowElement>('tbody tr')].reduce((sum, row) => sum + (row.hasAttribute('aria-hidden') ? Number.parseFloat(row.cells[0].style.height) : row.getBoundingClientRect().height), 0)
  expect(total).toBe(48048)
})

test('适应列宽仍考虑屏幕外的长文本', () => {
  vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockImplementation(function (this: HTMLElement) {
    return { height: this === host ? 480 : this.tagName === 'TR' ? 48 : 0, width: 100, top: 0, left: 0, bottom: 0, right: 100, x: 0, y: 0, toJSON() {} }
  })
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ measureText: (text: string) => ({ width: text.length * 8 }) } as CanvasRenderingContext2D)
  render(true, rows.map((row, index) => index === 999 ? { ...row, name: 'W'.repeat(100) } : row))
  act(() => host.querySelector('[aria-label="调整名称列宽"]')!.dispatchEvent(new MouseEvent('dblclick', {bubbles:true})))
  expect(host.querySelector('col')!.style.width).toBe('800px')
})

test('切回页面保留已滚出视口的行高测量，长列表位置不漂移', () => {
  vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockImplementation(function (this: HTMLElement) {
    const height = this === host ? 480 : this.tagName === 'TR' ? (this.dataset.index === '0' ? 144 : 48) : 0
    return { height, width: 800, top: this === host ? 0 : -host.scrollTop, left: 0, bottom: height, right: 800, x: 0, y: 0, toJSON() {} }
  })
  const totalHeight = () => [...host.querySelectorAll<HTMLTableRowElement>('tbody tr')].reduce((sum, row) => sum + (row.hasAttribute('aria-hidden') ? Number.parseFloat(row.cells[0].style.height) : row.getBoundingClientRect().height), 0)
  render(); act(() => { host.scrollTop=24000; host.dispatchEvent(new Event('scroll')) })
  const height=totalHeight(); expect(height).toBe(48096)
  render(false); render(true); expect(totalHeight()).toBe(height)
})
