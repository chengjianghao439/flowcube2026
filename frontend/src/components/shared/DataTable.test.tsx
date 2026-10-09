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
  vi.unstubAllGlobals()
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

// jsdom不排版：替代浏览器提供的两行截断高度与宽度，保留真实组件/ResizeObserver回调。
function previewLayout(initialOverflow = false) {
  let overflow = initialOverflow, width = 180
  const observers: { callback: ResizeObserverCallback; target?: Element }[] = []
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) { return this.hasAttribute('data-table-text') ? width : 0 })
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) { return this.hasAttribute('data-table-text-measure') ? 40 : 0 })
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function (this: HTMLElement) { return this.hasAttribute('data-table-text-measure') ? (overflow ? 60 : 40) : 0 })
  vi.stubGlobal('ResizeObserver', class {
    record: { callback: ResizeObserverCallback; target?: Element }
    constructor(callback: ResizeObserverCallback) { this.record = { callback }; observers.push(this.record) }
    observe(target: Element) { this.record.target = target }
    disconnect() { this.record.target = undefined }
  })
  return { resize(nextWidth: number, nextOverflow: boolean) {
    width = nextWidth; overflow = nextOverflow
    act(() => observers.forEach(observer => observer.target && observer.callback([{ target: observer.target, contentRect: { width } } as ResizeObserverEntry], {} as ResizeObserver)))
    flushFrames()
  }, observers }
}

test('未超过两行的备注直接显示，不出现展开箭头或可展开控件', () => {
  previewLayout()
  const remark = '短备注'
  act(() => root!.render(<DataTable columns={[{ key: 'remark', title: '备注', expandableText: true }]} data={[{ id: 1, remark }]} />))
  expect(host.querySelector('tbody td')!.textContent).toBe(remark)
  expect(host.querySelector('tbody details')).toBeNull()
  expect(host.querySelector('tbody svg')).toBeNull()
})

test('备注超过两行才出现箭头，展开不误判为短文，放宽列宽后箭头消失', () => {
  const layout = previewLayout()
  const remark = '列宽变化时应保留的完整备注'
  act(() => root!.render(<DataTable columns={[{ key: 'remark', title: '备注', expandableText: true }]} data={[{ id: 1, remark }]} />))
  expect(host.querySelector('tbody details')).toBeNull()
  layout.resize(80, true)
  const details = host.querySelector('tbody details') as HTMLDetailsElement
  expect(details).not.toBeNull()
  act(() => { details.open = true; details.dispatchEvent(new Event('toggle')) })
  layout.resize(80, false) // 展开引起高度变化，列宽未变；仍按独立的两行预览判定。
  expect(host.querySelector('tbody details')).toBe(details)
  expect(details.open).toBe(true)
  layout.resize(480, false)
  expect(host.querySelector('tbody details')).toBeNull()
  expect(host.querySelector('tbody td')!.textContent).toBe(remark)
})

test('隐藏零宽不清除原判定；内容变化和再次显示后重新判断，卸载解除观察', () => {
  const layout = previewLayout(true)
  const cols = [{ key: 'remark', title: '备注', expandableText: true }]
  act(() => root!.render(<DataTable columns={cols} data={[{ id: 1, remark: '长备注' }]} />))
  expect(host.querySelector('tbody details')).not.toBeNull()
  layout.resize(0, false)
  act(() => root!.render(<DataTable columns={cols} data={[{ id: 1, remark: '新短备注' }]} />))
  expect(host.querySelector('tbody details')).not.toBeNull()
  layout.resize(180, false)
  expect(host.querySelector('tbody details')).toBeNull()
  expect(host.querySelector('tbody td')!.textContent).toBe('新短备注')
  act(() => root!.unmount()); root = null
  expect(layout.observers.every(observer => !observer.target)).toBe(true)
  expect(frames.size).toBe(0)
})

test('长备注可就地展开完整内容，商品身份仍完整显示，双击展开不打开单据', () => {
  previewLayout(true)
  const text = '用于长文本验收的备注。'.repeat(12)
  const onDetail = vi.fn()
  const cols: TableColumn<{ id: number; name: string; remark: string }>[] = [
    { key: 'name', title: '商品身份' },
    { key: 'remark', title: '备注', expandableText: true },
  ]
  act(() => root!.render(<DataTable columns={cols} data={[{ id: 1, name: text, remark: text }]} onRowDoubleClick={onDetail} />))
  const cells = host.querySelectorAll('tbody td')
  expect(cells[0].textContent).toBe(text)
  expect(cells[0].querySelector('details')).toBeNull()
  const disclosure = cells[1].querySelector('details')!
  expect(disclosure).not.toBeNull()
  expect(disclosure.textContent).toContain(text)
  act(() => disclosure.querySelector('summary')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })))
  expect(onDetail).not.toHaveBeenCalled()
})

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

test('加载已保存的列顺序和宽度，不因工具栏移除而重置', () => {
  localStorage.setItem('flowcube:table-columns:resize-test', JSON.stringify({ order: ['code', 'name', 'actions'], widths: { name: 400, code: 300, actions: 180 }, widthUnit: 'px' }))
  render()
  expect(widths()).toEqual([300, 400, 180])
  const saved = JSON.parse(localStorage.getItem('flowcube:table-columns:resize-test')!)
  expect(saved.order).toEqual(['code', 'name', 'actions'])
  expect(saved.widths).toEqual({ name: 400, code: 300, actions: 180 })
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

test('操作列可独立拖动调整宽度并在重新挂载后保留', () => {
  render(); measure([280, 300, 180])
  const handle = host.querySelector('[aria-label="调整操作列宽"]')
  expect(handle).not.toBeNull()
  act(() => handle!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 700, button: 0 })))
  move(760); up(760)
  expect(widths()).toEqual([280, 300, 240])
  act(() => root!.unmount()); root = createRoot(host); render()
  expect(widths()).toEqual([280, 300, 240])
})

test('操作列可拖到普通列之前，顺序和宽度一起保存', () => {
  render()
  const headers = host.querySelectorAll('th')
  expect(headers[2].draggable).toBe(true)
  act(() => headers[2].dispatchEvent(new Event('dragstart', { bubbles: true })))
  act(() => headers[0].dispatchEvent(new Event('drop', { bubbles: true, cancelable: true })))
  expect(Array.from(host.querySelectorAll('th span[title]'), el => el.textContent)).toEqual(['操作', '名称', '编码'])
  expect(widths()).toEqual([180, 160, 160])
  act(() => root!.unmount()); root = createRoot(host); render()
  expect(Array.from(host.querySelectorAll('th span[title]'), el => el.textContent)).toEqual(['操作', '名称', '编码'])
})

test('以标题识别的操作列支持键盘调整且双击按钮不触发行双击', () => {
  const onAction = vi.fn(); const onRowDoubleClick = vi.fn()
  act(() => root!.render(<DataTable columns={[...columns.slice(0, 2), {
    key: 'id', title: '操作', width: 120,
    render: () => <button onClick={onAction}>编辑</button>,
  }]} data={[{ id: 1, name: '商品', code: 'P001' }]} onRowDoubleClick={onRowDoubleClick} />))
  measure([280, 300, 120])
  const handle = host.querySelector('[aria-label="调整操作列宽"]')
  expect(handle).not.toBeNull()
  act(() => handle!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })))
  expect(widths()).toEqual([280, 300, 130])
  const button = host.querySelector('tbody button')!
  act(() => button.dispatchEvent(new MouseEvent('click', { bubbles: true })))
  act(() => button.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })))
  expect(onAction).toHaveBeenCalledOnce()
  expect(onRowDoubleClick).not.toHaveBeenCalled()
})
