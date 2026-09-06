// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import DataTable from './DataTable'
import type { TableColumn } from '@/types'

type Row = { id: number; name: string; code: string }
const columns: TableColumn<Row>[] = [{ key: 'name', title: '名称', width: 160 }, { key: 'code', title: '编码', width: 160 }, { key: 'actions', title: '操作', width: 180 }]
let host: HTMLDivElement
let root: Root | null
let frames: Map<number, FrameRequestCallback>
let nextFrame = 0
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  localStorage.clear()
  frames = new Map(); nextFrame = 0
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { frames.set(++nextFrame, callback); return nextFrame })
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => { frames.delete(id) })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(() => {
  act(() => window.dispatchEvent(new Event('blur')))
  act(() => root?.unmount()); host.remove(); vi.restoreAllMocks()
  document.body.style.cursor = ''; document.body.style.userSelect = ''
})
function render(cols = columns, selectable = false) {
  act(() => root!.render(<DataTable columns={cols} data={[{ id: 1, name: '商品', code: 'P001' }]} selectable={selectable} columnStorageKey="resize-test" />))
}
// jsdom 不排版：只替代浏览器测量结果，拖拽仍调用真实组件事件处理。
function measure(widths: number[]) {
  host.querySelectorAll('col').forEach((col, i) => vi.spyOn(col, 'getBoundingClientRect').mockReturnValue({ width: widths[i] } as DOMRect))
}
function down() { act(() => host.querySelector('[aria-label="调整名称列宽"]')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 300, button: 0 }))) }
function flushFrames() { const pending = [...frames.values()]; frames.clear(); act(() => pending.forEach(callback => callback(0))) }
function move(x: number) { act(() => window.dispatchEvent(new MouseEvent('mousemove', { clientX: x }))); flushFrames() }
function up(x: number) { act(() => window.dispatchEvent(new MouseEvent('mouseup', { clientX: x }))) }
function widths() { return Array.from(host.querySelectorAll('col'), c => Number.parseFloat(c.style.width)) }

test('多选框不参与业务列宽快照，拖拽后保留每列对应关系', () => {
  render(columns, true); measure([56, 240, 360, 180]); down(); up(320)
  expect(widths()).toEqual([56, 260, 360, 180])
  expect(JSON.parse(localStorage.getItem('flowcube:table-columns:resize-test')!).widths).toEqual({ name: 260, code: 360, actions: 180 })
})
test('容器撑宽后拖动保持其他列实际宽度，松手不跳变', () => {
  render(); measure([280, 300, 320]); down(); move(340)
  expect(widths()).toEqual([320, 300, 320])
  up(340)
  expect(widths()).toEqual([320, 300, 320])
})
test('父页面刷新但列定义未变时不重置正在拖动的宽度', () => {
  render(); measure([280, 300, 320]); down(); move(340)
  render(columns.map(c => ({ ...c })))
  expect(widths()).toEqual([320, 300, 320])
  up(340)
})
test('单列表格也可独立调整列宽', () => {
  render(columns.slice(0, 1)); measure([400]); down(); up(360)
  expect(widths()).toEqual([460])
})
test('拖拽时关闭表格会解除全局监听并恢复原鼠标状态', () => {
  render(); measure([280, 300, 320])
  document.body.style.cursor = 'crosshair'; document.body.style.userSelect = 'text'
  down(); move(340)
  act(() => root!.unmount()); root = null
  expect(document.body.style.cursor).toBe('crosshair')
  expect(document.body.style.userSelect).toBe('text')
  up(360)
  expect(localStorage.getItem('flowcube:table-columns:resize-test')).toBeNull()
})

test('旧比例设置按原口径加载，手动调整转为像素且重新挂载保持一致', () => {
  localStorage.setItem('flowcube:table-columns:resize-test', JSON.stringify({ order: ['name', 'code', 'actions'], widths: { name: 25, code: 35, actions: 40 } }))
  const fluidColumns = columns.map((c, index) => ({ ...c, width: [25, 35, 40][index] }))
  act(() => root!.render(<DataTable columns={fluidColumns} data={[]} fluid columnStorageKey="resize-test" />))
  expect(host.querySelector('col')!.style.width).toBe('25%')
  measure([250, 350, 400]); down(); move(350)
  expect(widths()).toEqual([300, 350, 400]); up(350)
  act(() => root!.unmount()); root = createRoot(host)
  act(() => root!.render(<DataTable columns={fluidColumns} data={[]} fluid columnStorageKey="resize-test" />))
  expect(widths()).toEqual([300, 350, 400])
})

test('放大不受相邻列限制，缩小只限制本列最小宽度', () => {
  render(); measure([280, 300, 320]); down(); move(900); up(900)
  expect(widths()).toEqual([880, 300, 320])
  expect(host.querySelector('table')!.style.width).toBe('1500px')
  measure([880, 300, 320]); down(); up(-900)
  expect(widths()).toEqual([80, 300, 320])
})


test('拖动期间不重复渲染明细，松手才提交一次布局', () => {
  const cell = vi.fn(() => '商品')
  render(columns.map(c => c.key === 'name' ? { ...c, render: cell } : c))
  measure([280, 300, 320]); cell.mockClear(); down(); move(320); move(340)
  expect(cell).not.toHaveBeenCalled()
  up(340)
  expect(cell).toHaveBeenCalledTimes(1)
})

test('Escape 取消预览，保留原布局与存储', () => {
  render(); measure([280, 300, 320]); const original = widths(); down(); move(340)
  act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
  expect(widths()).toEqual(original)
  up(340)
  expect(localStorage.getItem('flowcube:table-columns:resize-test')).toBeNull()
})

test('双击分隔线按内容宽度适配，仅改变本列', () => {
  render(); measure([280, 300, 320])
  const content = host.querySelector('tbody td > div')!
  Object.defineProperty(content, 'scrollWidth', { configurable: true, value: 460 })
  vi.spyOn(content, 'getBoundingClientRect').mockReturnValue({ width: 460.4 } as DOMRect)
  act(() => host.querySelector('[aria-label="调整名称列宽"]')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })))
  expect(widths()[0]).toBe(497)
  expect(widths().slice(1)).toEqual([300, 320])
})

test('恢复默认只清除宽度，保留用户列顺序', () => {
  localStorage.setItem('flowcube:table-columns:resize-test', JSON.stringify({ order: ['code', 'name', 'actions'], widths: { name: 400, code: 300, actions: 180 }, widthUnit: 'px' }))
  render()
  act(() => host.querySelector('[aria-label="恢复默认列宽"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true })))
  expect(widths()).toEqual([160, 160, 180])
  const saved = JSON.parse(localStorage.getItem('flowcube:table-columns:resize-test')!)
  expect(saved.order).toEqual(['code', 'name', 'actions'])
  expect(saved.widths).toEqual({})
})


test('一帧内合并鼠标事件，取消后不执行遗留预览', () => {
  render(); measure([280, 300, 320]); down()
  act(() => {
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 320 }))
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 340 }))
  })
  expect(frames.size).toBe(1)
  flushFrames(); expect(widths()).toEqual([320, 300, 320])
  act(() => window.dispatchEvent(new MouseEvent('mousemove', { clientX: 360 })))
  act(() => window.dispatchEvent(new Event('blur')))
  expect(frames.size).toBe(0)
  expect(widths()).toEqual([160, 160, 180])
})

test('方向键可精确调整，存储不可用也不阻断交互', () => {
  render(); measure([280, 300, 320])
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Storage disabled') })
  act(() => host.querySelector('[aria-label="调整名称列宽"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true, bubbles: true })))
  expect(widths()).toEqual([320, 300, 320])
})
