// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { SectionVisibilityContext } from '@/components/layout/SectionVisibilityContext'
import type { TemplateElement } from '@/types/print-template'
import TemplateRenderer from './TemplateRenderer'
import { OrderPrintOverlay } from './OrderPrintOverlay'

const mocks = vi.hoisted(() => ({ templates: vi.fn(), logo: vi.fn() }))
vi.mock('@/api/print-templates', () => ({ getPrintTemplateListApi: mocks.templates }))
vi.mock('@/api/settings', () => ({ getLogoApi: mocks.logo }))
let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
let qc: QueryClient
let measurable = true
let fitsAt = 9
let scale = 1
const data = { customerName: '𠮷'.repeat(100), supplierName: '企业名称'.repeat(25), receiverAddress: '完整地址'.repeat(50), remark: '其他字段保持原模板' }
const field = (key = 'customerName', fontSize = 12): TemplateElement => ({ id: key, type: 'text', fieldKey: key, label: '客户', x: 10, y: 10, width: 70, height: 7, fontSize, fontWeight: 'normal', textAlign: 'left', border: false })
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  measurable = true; fitsAt = 9; scale = 1
  mocks.logo.mockReset().mockResolvedValue({ url: '' })
  mocks.templates.mockReset().mockResolvedValue([{ id: 1, name: '模板', isDefault: true, paperSize: 'A4', layout: { elements: [field()] } }])
  // jsdom has no layout. This adapter makes only the actual party text boxes
  // measurable and reports overflow from the font applied by the component.
  for (const key of ['clientWidth', 'clientHeight', 'scrollWidth', 'scrollHeight'] as const) {
    vi.spyOn(HTMLElement.prototype, key, 'get').mockImplementation(function (this: HTMLElement) {
      if (!this.dataset.partyPrintField || !measurable || this.closest('[hidden]')) return 0
      if (key === 'clientWidth' || key === 'scrollWidth') return 260 * scale
      if (key === 'clientHeight') return 24 * scale
      const content = this.querySelector<HTMLElement>('[data-party-print-content]')
      return (parseFloat(content?.style.fontSize || '12') <= fitsAt * scale ? 22 : 100) * scale
    })
  }
  vi.spyOn(window, 'print').mockImplementation(() => {})
})
afterEach(async () => { await act(async () => root.unmount()); qc.clear(); host.remove(); vi.restoreAllMocks() })
const box = (key = 'customerName') => document.querySelector<HTMLElement>(`[data-party-print-field="${key}"]`)
const content = (key = 'customerName') => box(key)!.querySelector<HTMLElement>('[data-party-print-content]')!
async function render(elements = [field()], values = data, displayScale = 1) {
  scale = displayScale
  await act(async () => root.render(<TemplateRenderer layout={{ elements }} paperSize="A4" data={values} items={[]} displayScale={displayScale} />))
}
async function overlay(active = true, values = data) {
  await act(async () => root.render(<QueryClientProvider client={qc}><SectionVisibilityContext.Provider value={active}><OrderPrintOverlay templateType={1} title="订单" data={values} items={[]} onClose={() => {}} /></SectionVisibilityContext.Provider></QueryClientProvider>))
}
async function print() { await act(async () => { [...document.querySelectorAll('button')].find(b => b.textContent === '打印')!.click() }) }

test('限定三种企业资料字段按实际测量缩放和换行，文本不截断', async () => {
  await render([field(), field('supplierName'), field('receiverAddress'), field('remark')])
  for (const key of ['customerName', 'supplierName', 'receiverAddress'] as const) {
    expect(box(key)).not.toBeNull()
    expect(box(key)!.dataset.printFit).toBe('fit')
    expect(parseFloat(content(key).style.fontSize)).toBeLessThanOrEqual(9)
    expect(parseFloat(content(key).style.fontSize)).toBeGreaterThanOrEqual(8)
    expect(content(key).textContent).toContain(data[key])
    expect(content(key).style.whiteSpace).toBe('pre-wrap')
  }
  expect(box('remark')).toBeNull()
  expect(host.textContent).toContain(data.remark)
})
test('8pt仍放不下时标注溢出，原模板更小字号不继续缩小', async () => {
  fitsAt = 7
  await render()
  expect(box()?.dataset.printFit).toBe('overflow')
  expect(content().style.fontSize).toBe('8pt')
  await render([field('customerName', 6)])
  expect(content().style.fontSize).toBe('6pt')
  expect(box()!.dataset.printFit).toBe('fit')
})
test('无法测量保持未确认，空字段不会误判溢出，缩放按同一物理字号', async () => {
  measurable = false
  await render()
  expect(box()?.dataset.printFit).toBe('unavailable')
  expect(content().textContent).toContain(data.customerName)
  await render([field()], { ...data, customerName: '' })
  expect(box()!.dataset.printFit).toBe('empty')
  measurable = true
  await render([field()], data, 1.5)
  expect(box()!.dataset.printFit).toBe('fit')
  expect(parseFloat(content().style.fontSize)).toBeGreaterThanOrEqual(12)
})
test('明显溢出预览给出调整模板提示，打印前复测并拒绝裁切', async () => {
  fitsAt = 7
  await overlay()
  expect(document.body.textContent).toContain('请增大打印模板中的客户文本框')
  await print()
  expect(window.print).not.toHaveBeenCalled()
  expect(content().textContent).toContain(data.customerName)
})
test('隐藏未测量不被当成溢出；再显示后复测且合法版面可打印', async () => {
  await overlay(false)
  expect(box()?.dataset.printFit).toBe('unavailable')
  expect(document.body.textContent).not.toContain('请增大打印模板')
  await overlay(true)
  expect(box()!.dataset.printFit).toBe('fit')
  await print()
  expect(window.print).toHaveBeenCalledOnce()
})
test('字体就绪后打印前重新测量，不沿用旧fit结论', async () => {
  let finish!: () => void
  const ready = new Promise<void>(resolve => { finish = resolve })
  const previous = Object.getOwnPropertyDescriptor(document, 'fonts')
  Object.defineProperty(document, 'fonts', { configurable: true, value: { ready } })
  try {
    await overlay()
    expect(box()?.dataset.printFit).toBe('fit')
    await print()
    expect(window.print).not.toHaveBeenCalled()
    fitsAt = 7
    await act(async () => { finish(); await ready })
    expect(box()!.dataset.printFit).toBe('overflow')
    expect(window.print).not.toHaveBeenCalled()
  } finally {
    if (previous) Object.defineProperty(document, 'fonts', previous)
    else Reflect.deleteProperty(document, 'fonts')
  }
})

function usePhysicalGeometry() {
  vi.restoreAllMocks()
  const metrics: Array<{ zoom: number; clientHeight: number; scrollHeight: number }> = []
  for (const key of ['clientWidth', 'clientHeight', 'scrollWidth', 'scrollHeight'] as const) {
    vi.spyOn(HTMLElement.prototype, key, 'get').mockImplementation(function (this: HTMLElement) {
      if (!this.dataset.partyPrintField || this.closest('[hidden]')) return 0
      const height = Math.round(parseFloat(this.style.height))
      const width = Math.round(parseFloat(this.style.width))
      const text = this.querySelector<HTMLElement>('[data-party-print-content]')!
      // Two explicit lines: point-to-pixel conversion, line-height 1.3 and the
      // component's fixed 1px padding. Geometry is not proportional to zoom.
      const scroll = Math.max(height, Math.round(2 * parseFloat(text.style.fontSize) * 4 / 3 * 1.3 + 2))
      if (key === 'clientWidth' || key === 'scrollWidth') return width
      if (key === 'clientHeight') return height
      metrics.push({ zoom: parseFloat(text.style.fontSize) / 8, clientHeight: height, scrollHeight: scroll })
      return scroll
    })
  }
  return metrics
}
async function zoomIn() {
  for (let i = 0; i < 5; i++) await act(async () => document.querySelector<HTMLButtonElement>('button[title="放大"]')!.click())
}
test('150%预览可容纳而物理尺寸溢出时先拒绝打印并恢复员工缩放', async () => {
  const metrics = usePhysicalGeometry()
  const printSpy = vi.spyOn(window, 'print').mockImplementation(() => window.dispatchEvent(new Event('beforeprint')))
  mocks.templates.mockResolvedValue([{ id: 1, name: '模板', isDefault: true, paperSize: 'A4', layout: { elements: [{ ...field('receiverAddress', 8), label: '', height: 7.5 }] } }])
  await overlay(true, { ...data, receiverAddress: '第一行\n第二行' })
  await zoomIn()
  expect(box('receiverAddress')!.dataset.printFit).toBe('fit')
  await print()
  expect(metrics).toContainEqual({ zoom: 1.5, clientHeight: 43, scrollHeight: 44 })
  expect(metrics).toContainEqual({ zoom: 1, clientHeight: 28, scrollHeight: 30 })
  expect(printSpy).not.toHaveBeenCalled()
  expect(content('receiverAddress').style.fontSize).toBe('12pt')
  expect(document.body.textContent).toContain('收货地址文本框')
})
test('物理尺寸合法时打印前按100%测量，afterprint恢复原150%缩放', async () => {
  const metrics = usePhysicalGeometry()
  const printSpy = vi.spyOn(window, 'print').mockImplementation(() => window.dispatchEvent(new Event('beforeprint')))
  mocks.templates.mockResolvedValue([{ id: 1, name: '模板', isDefault: true, paperSize: 'A4', layout: { elements: [{ ...field('receiverAddress', 8), label: '', height: 9 }] } }])
  await overlay(true, { ...data, receiverAddress: '第一行\n第二行' })
  await zoomIn()
  await print()
  expect(printSpy).toHaveBeenCalledOnce()
  expect(content('receiverAddress').style.fontSize).toBe('8pt')
  expect(metrics).toContainEqual({ zoom: 1, clientHeight: 34, scrollHeight: 34 })
  await act(async () => window.dispatchEvent(new Event('afterprint')))
  expect(content('receiverAddress').style.fontSize).toBe('12pt')
})
