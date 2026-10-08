// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import DataTable from './DataTable'
import type { TableColumn } from '@/types'

type Row = { id: number; identity: string }
const storageKey = 'flowcube:table-columns:fluid-test'
let host: HTMLDivElement
let root: Root

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  localStorage.clear()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => window.dispatchEvent(new Event('blur')))
  act(() => root.unmount())
  host.remove()
  vi.restoreAllMocks()
})

function render(columns: TableColumn<Row>[], selectable = false) {
  act(() => root.render(<DataTable columns={columns} data={[{ id: 1, identity: 'GL76c9c150P0完整商品身份' }]} fluid selectable={selectable} columnStorageKey="fluid-test" />))
}
function weightedColumns(weights: number[]): TableColumn<Row>[] {
  return weights.map((width, index) => ({ key: index === 0 ? 'identity' : `field${index}`, title: index === weights.length - 1 ? '操作' : `字段${index}`, width }))
}
function table() { return host.querySelector('table')! }
function colWidths() { return Array.from(host.querySelectorAll('col'), col => col.style.width) }

test.each([8, 10, 15])('%i 列等权列表给操作保留 128px，其余列随权重扩展，窄屏滚动容器仍在表格内部', count => {
  render(weightedColumns(Array(count).fill(1)))
  expect(table().style.width).toBe('100%')
  expect(table().style.minWidth).toBe(`${128 * count}px`)
  const widths = colWidths().map(Number.parseFloat)
  expect(widths.reduce((sum, value) => sum + value, 0)).toBeCloseTo(100)
  expect(widths.every(value => value === 100 / count)).toBe(true)
  expect(host.querySelector('[data-table-scroll]')?.classList.contains('overflow-x-auto')).toBe(true)
  expect(host.textContent).toContain('GL76c9c150P0完整商品身份')
  expect(host.querySelector('tbody td:last-child')?.classList.contains('sticky')).toBe(true)
  expect(localStorage.getItem(storageKey)).toBeNull()
})

test('销售默认权重合计 104，按有效比例归一后 7 权重经办人仍有 96px，保留所有列的比例', () => {
  const weights = [14, 14, 8, 10, 15, 8, 8, 7, 10, 10]
  render(weightedColumns(weights))
  expect(table().style.minWidth).toBe('1427px')
  const widths = colWidths().map(Number.parseFloat)
  expect(widths.reduce((sum, value) => sum + value, 0)).toBeCloseTo(100)
  weights.forEach((weight, index) => expect(widths[index]).toBeCloseTo(weight / 104 * 100))
  expect(Number.parseFloat(table().style.minWidth) * widths[7] / 100).toBeGreaterThanOrEqual(96)
  expect(Number.parseFloat(table().style.minWidth) * widths[9] / 100).toBeGreaterThanOrEqual(128)
})

test('选择列固定 56px，业务列仅分配余下宽度，不把选择列挤入归一权重', () => {
  render(weightedColumns([25, 35, 40]), true)
  expect(table().style.minWidth).toBe('440px')
  expect(colWidths()).toEqual(['56px', '25%', '35%', '40%'])
})

test.each([
  [{ key: 'identity', title: '商品身份', width: 7 }, 96],
  [{ key: 'id', title: '操作', width: 7 }, 128],
] as const)('单列 %j 分配完整业务宽度，不被原始权重放大', (column, minimum) => {
  render([column])
  expect(table().style.minWidth).toBe(`${minimum}px`)
  expect(colWidths()).toEqual(['100%'])
})

test.each([false, true])('无业务列时不产生 NaN/Infinity；选择列启用=%s', selectable => {
  render([], selectable)
  expect(Number.parseFloat(table().style.minWidth)).toBe(selectable ? 56 : 0)
  expect(colWidths()).toEqual(selectable ? ['56px'] : [])
})

test('旧百分比记忆决定有效权重与下限，不被当前默认值或归一结果改写', () => {
  const saved = JSON.stringify({ order: ['identity', 'field1', 'field2'], widths: { identity: 25, field1: 35, field2: 40 } })
  localStorage.setItem(storageKey, saved)
  render(weightedColumns([1, 1, 1]))
  expect(colWidths()).toEqual(['25%', '35%', '40%'])
  expect(table().style.minWidth).toBe('384px')
  expect(localStorage.getItem(storageKey)).toBe(saved)
})

test('已经保存的像素列宽 80/90/128 不受比例表默认下限影响，选择列和存储保持原值', () => {
  const saved = JSON.stringify({ order: ['identity', 'field1', 'field2'], widths: { identity: 80, field1: 90, field2: 128 }, widthUnit: 'px' })
  localStorage.setItem(storageKey, saved)
  render(weightedColumns([25, 35, 40]), true)
  expect(colWidths()).toEqual(['56px', '80px', '90px', '128px'])
  expect(table().style.width).toBe('354px')
  expect(table().style.minWidth).toBe('0')
  expect(localStorage.getItem(storageKey)).toBe(saved)
})

test('列可覆盖比例模式的像素下限，而不把该下限写成用户列宽', () => {
  const columns = weightedColumns([20, 80])
  columns[0].minWidth = 144
  render(columns)
  expect(table().style.minWidth).toBe('720px')
  expect(colWidths()).toEqual(['20%', '80%'])
  expect(localStorage.getItem(storageKey)).toBeNull()
})

test('比例模式拖动取消恢复可读下限，提交后以测量像素保存且不改其他列', () => {
  render(weightedColumns([25, 35, 40]), true)
  let frame: FrameRequestCallback | undefined
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { frame = callback; return 1 })
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
  const measured = [56, 100, 140, 160]
  host.querySelectorAll('col').forEach((col, index) => vi.spyOn(col, 'getBoundingClientRect').mockReturnValue({ width: measured[index] } as DOMRect))
  const handle = host.querySelector('[aria-label="调整字段0列宽"]')!
  act(() => handle.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 300, button: 0 })))
  act(() => window.dispatchEvent(new MouseEvent('mousemove', { clientX: 280 })))
  expect(frame).toBeDefined()
  act(() => frame!(0))
  expect(table().style.minWidth).toBe('0px')
  expect(colWidths()).toEqual(['56px', '80px', '140px', '160px'])
  act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
  expect(table().style.minWidth).toBe('440px')
  expect(colWidths()).toEqual(['56px', '25%', '35%', '40%'])
  expect(localStorage.getItem(storageKey)).toBeNull()
  act(() => handle.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 300, button: 0 })))
  act(() => window.dispatchEvent(new MouseEvent('mouseup', { clientX: 280 })))
  expect(colWidths()).toEqual(['56px', '80px', '140px', '160px'])
  expect(table().style.minWidth).toBe('0')
  expect(JSON.parse(localStorage.getItem(storageKey)!)).toEqual({ order: ['identity', 'field1', 'field2'], widths: { identity: 80, field1: 140, field2: 160 }, widthUnit: 'px' })
})
