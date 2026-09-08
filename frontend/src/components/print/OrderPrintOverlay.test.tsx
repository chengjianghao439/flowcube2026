// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { SectionVisibilityContext } from '@/components/layout/SectionVisibilityContext'
import { OrderPrintOverlay } from './OrderPrintOverlay'

const mocks = vi.hoisted(() => ({ logo: vi.fn(), templates: vi.fn() }))
vi.mock('@/api/settings', () => ({ getLogoApi: mocks.logo }))
vi.mock('@/api/print-templates', () => ({ getPrintTemplateListApi: mocks.templates }))
vi.mock('./TemplateRenderer', () => ({ default: ({ displayScale }: { displayScale: number }) => <div data-testid="renderer" data-zoom={displayScale}><img alt="公司标志" /></div> }))
vi.mock('@/components/shared/PrintPreviewZoomControls', () => ({ PrintPreviewZoomControls: ({ onChange }: { onChange: (n: number) => void }) => <button onClick={() => onChange(1.5)}>放大测试</button> }))

let root: Root
let host: HTMLDivElement
let qc: QueryClient
let currentActive: boolean
let isOpen: boolean
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  mocks.logo.mockReset().mockResolvedValue({ url: '' })
  mocks.templates.mockReset().mockResolvedValue([{ id: 1, name: '默认模板', isDefault: true, paperSize: 'A4', layout: { elements: [] } }, { id: 2, name: '备用模板', paperSize: 'A5', layout: { elements: [] } }])
  vi.spyOn(window, 'print').mockImplementation(() => {})
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } }); currentActive = true; isOpen = true
})
afterEach(() => { act(() => root.unmount()); qc.clear(); host.remove(); vi.restoreAllMocks(); document.querySelectorAll('style[id^="fc-order-print-style"]').forEach(e => e.remove()) })
async function render(active = currentActive) {
  currentActive = active
  await act(async () => { root.render(<QueryClientProvider client={qc}><SectionVisibilityContext.Provider value={active}>{isOpen && <OrderPrintOverlay templateType={1} title="订单" data={{}} items={[]} onClose={() => { isOpen = false; void render() }} />}</SectionVisibilityContext.Provider></QueryClientProvider>) })
}
function button(text: string) { return [...document.querySelectorAll('button')].find(b => b.textContent === text)! }
async function click(text: string) { await act(async () => { button(text).click() }) }
function portal() { return document.querySelector<HTMLDivElement>('div[id^="fc-print-root"]')! }
function preview() { return document.querySelector<HTMLElement>('[data-testid="renderer"]')! }
function styles() { return document.querySelectorAll('style[id^="fc-order-print-style"]') }

test('隐藏时保留预览DOM、模板和缩放，但撤销打印样式及监听', async () => {
  await render(); await click('放大测试')
  await act(async () => { document.querySelector<HTMLButtonElement>('[aria-label="选择打印模板"]')!.click() }); await click('备用模板')
  const oldPortal = portal(); const oldPreview = preview()
  await render(false)
  expect(portal()).toBe(oldPortal); expect(preview()).toBe(oldPreview)
  expect(portal().hidden).toBe(true); expect(portal().style.display).toBe('none'); expect(styles()).toHaveLength(0)
  act(() => window.dispatchEvent(new Event('beforeprint')))
  expect(preview().dataset.zoom).toBe('1.5')
  await render(true)
  expect(portal().hidden).toBe(false); expect(document.querySelector('[aria-label="选择打印模板"]')!.textContent).toBe('备用模板')
  expect(preview().dataset.zoom).toBe('1.5'); expect(styles()).toHaveLength(1)
})
test('隐藏预览不启动品牌查询，显示后再读取', async () => {
  await render(false); expect(mocks.logo).not.toHaveBeenCalled()
  await render(true); expect(mocks.logo).toHaveBeenCalledTimes(1)
  await render(false)
  await act(async () => { await qc.invalidateQueries({ queryKey: ['brand-logo'] }) })
  expect(mocks.logo).toHaveBeenCalledTimes(1)
})
test('样式生命周期不得改写或删除其他实例持有的style', async () => {
  const other = document.createElement('style'); other.id = 'fc-order-print-style'; other.textContent = '/* other preview */'; document.head.append(other)
  await render(); expect(other.textContent).toBe('/* other preview */')
  await render(false); expect(other.isConnected).toBe(true)
})
test.each(['hidden', 'closed', 'hide-and-show'] as const)('图片decode期间%s后不能触发旧打印请求', async action => {
  await render()
  let finish!: () => void
  const image = document.querySelector('img')!
  image.decode = () => new Promise<void>(resolve => { finish = resolve })
  await click('打印')
  if (action === 'closed') { await click('关闭') } else { await render(false); if (action === 'hide-and-show') await render(true) }
  await act(async () => { finish(); await Promise.resolve() })
  expect(window.print).not.toHaveBeenCalled()
})
test('可见且解码完成后正常打印', async () => {
  await render(); const image = document.querySelector('img')!; image.decode = () => Promise.resolve()
  await click('打印'); expect(window.print).toHaveBeenCalledTimes(1)
})

test('打印阶段隐藏预览也恢复用户缩放，隐藏后不响应afterprint', async () => {
  await render(); await click('放大测试')
  act(() => window.dispatchEvent(new Event('beforeprint')))
  expect(preview().dataset.zoom).toBe('1')
  await render(false)
  expect(preview().dataset.zoom).toBe('1.5')
  act(() => window.dispatchEvent(new Event('afterprint')))
  expect(preview().dataset.zoom).toBe('1.5')
})
