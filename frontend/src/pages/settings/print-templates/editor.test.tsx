// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, afterEach, expect, test, vi } from 'vitest'
import { TabPathContext } from '@/components/layout/TabPathContext'
import { DEFAULT_LABEL_ELEMENTS } from '@/constants/printFieldDefs'
import PrintTemplateEditor from './editor'

const mocks = vi.hoisted(() => ({ detail: vi.fn(), sample: vi.fn(), save: vi.fn(), generation: 1 }))
vi.mock('@/api/print-templates', () => ({ getPrintTemplateDetailApi: mocks.detail, getPrintTemplatePreviewApi: mocks.sample, updatePrintTemplateApi: mocks.save, createPrintTemplateApi: mocks.save }))
vi.mock('@/api/settings', () => ({ getLogoApi: async () => ({ url: '' }) }))
vi.mock('@/store/authStore', () => ({ useAuthStore: (select: (s: { sessionGeneration: number; isAuthenticated: boolean }) => unknown) => select({ sessionGeneration: mocks.generation, isAuthenticated: true }) }))
vi.mock('@/lib/toast', () => ({ toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() } }))
let root: Root
let host: HTMLDivElement
let qc: QueryClient
const tpl = { id: 10, type: 8, name: '商品标签', paperSize: 'thermal75', layout: { elements: DEFAULT_LABEL_ELEMENTS[8], canvasWidthMm: 75, canvasHeightMm: 50 } }
const real = { type: 8, kind: 'label', sourceLabel: 'REAL-001', data: { product_code: 'REAL-001', product_name: '真实测试商品', spec: '真实型号' } }
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, ResizeObserver: class { observe() {} disconnect() {} unobserve() {} } })
  mocks.generation = 1; mocks.detail.mockReset().mockResolvedValue(tpl); mocks.sample.mockReset().mockResolvedValue(real); mocks.save.mockReset().mockResolvedValue(null)
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
})
afterEach(() => { act(() => root.unmount()); qc.clear(); host.remove(); vi.restoreAllMocks() })
async function render(path = '/settings/print-templates/10') {
  await act(async () => { root.render(<MemoryRouter><QueryClientProvider client={qc}><TabPathContext.Provider value={path}><PrintTemplateEditor /></TabPathContext.Provider></QueryClientProvider></MemoryRouter>) })
  for (let i = 0; i < 3; i++) await act(async () => { await new Promise(r => setTimeout(r, 20)) })
}
function btn(text: string) { return [...host.querySelectorAll('button')].find(b => b.textContent?.trim() === text || b.getAttribute('aria-label') === text)! }
async function click(text: string) { await act(async () => { btn(text).click() }); await act(async () => { await new Promise(r => setTimeout(r, 20)) }) }

test('打开模板自动使用真实字段，保存不包含预览值', async () => {
  await render(); expect(host.textContent).toContain('真实测试商品'); expect(host.textContent).toContain('REAL-001')
  await click('保存')
  expect(mocks.save).toHaveBeenCalledTimes(1)
  expect(JSON.stringify(mocks.save.mock.calls[0][0])).not.toContain('真实测试商品')
  expect(mocks.save.mock.calls[0][0].layout.elements).toEqual(DEFAULT_LABEL_ELEMENTS[8])
})
test('无真实记录保持原空白布局', async () => {
  mocks.sample.mockResolvedValue(null); mocks.detail.mockResolvedValue({ ...tpl, layout: { elements: [] } })
  await render(); expect(host.textContent).toContain('暂无可用业务数据'); expect(host.textContent).toContain('从左侧拖拽字段到这里'); expect(host.textContent).not.toContain('真实测试商品')
})
test('初始空白但有真实记录时提供可编辑默认字段布局', async () => {
  mocks.detail.mockResolvedValue({ ...tpl, layout: { elements: [] } })
  await render(); expect(host.textContent).toContain('真实测试商品'); expect(host.textContent).not.toContain('从左侧拖拽字段到这里')
})
test('真实记录缺字段不混入假样例', async () => {
  mocks.sample.mockResolvedValue({ ...real, data: { product_code: 'REAL-001', product_name: '真实测试商品' } })
  await render(); expect(host.textContent).not.toContain('500g'); expect(host.textContent).not.toContain('示例 SKU')
})
test('加载失败明确提示，可重试取真实数据', async () => {
  mocks.sample.mockRejectedValueOnce(new Error('network'))
  await render(); expect(host.textContent).toContain('真实数据加载失败')
  await click('重试'); expect(host.textContent).toContain('真实测试商品')
})
test('切换账号后不继续展示旧账号真实数据', async () => {
  await render(); expect(host.textContent).toContain('真实测试商品')
  mocks.generation = 2; mocks.sample.mockReturnValue(new Promise(() => {})); await render()
  expect(host.textContent).not.toContain('真实测试商品')
})

test('单据表格使用真实明细，真实空明细不填假商品', async () => {
  mocks.detail.mockResolvedValue({ ...tpl, type: 1, paperSize: 'A4', layout: { elements: [{ ...DEFAULT_LABEL_ELEMENTS[8][1], type: 'table', fieldKey: 'itemsTable', label: '明细', width: 180, height: 90, tableColumns: ['name', 'qty'] }] } })
  mocks.sample.mockResolvedValue({ type: 1, kind: 'sale', sourceLabel: 'SO-REAL', record: { orderNo: 'SO-REAL', items: [{ productCode: 'ONE', productName: '真实明细商品', unit: '件', quantity: 3, unitPrice: 2, amount: 6 }] } })
  await render(); expect(host.textContent).toContain('真实明细商品'); expect(host.textContent).not.toContain('商品A')
  mocks.generation = 2; mocks.sample.mockResolvedValue({ type: 1, kind: 'sale', sourceLabel: 'SO-EMPTY', record: { orderNo: 'SO-EMPTY', items: [] } })
  await render(); expect(host.textContent).not.toContain('真实明细商品'); expect(host.textContent).not.toContain('商品A')
})
test('旧类型迟到响应不覆盖新类型', async () => {
  let resolveOld!: (v: unknown) => void
  mocks.sample.mockImplementation(type => type === 8 ? new Promise(resolve => { resolveOld = resolve }) : Promise.resolve({ type: 5, kind: 'label', sourceLabel: 'H-REAL', data: { rack_barcode: 'H000001', rack_code: '真实货架' } }))
  await render()
  mocks.detail.mockResolvedValue({ ...tpl, id: 11, type: 5, layout: { elements: DEFAULT_LABEL_ELEMENTS[5] } })
  await render('/settings/print-templates/11')
  await act(async () => { resolveOld(real) })
  expect(host.textContent).toContain('真实货架'); expect(host.textContent).not.toContain('真实测试商品')
})
test('自动提供的布局可以撤销，数据刷新不会重新塞入', async () => {
  mocks.detail.mockResolvedValue({ ...tpl, layout: { elements: [] } })
  await render(); expect(host.textContent).toContain('真实测试商品')
  await click('撤销'); expect(host.textContent).toContain('从左侧拖拽字段到这里')
  await act(async () => { await qc.invalidateQueries({ queryKey: ['print-template-preview'] }) })
  expect(host.textContent).toContain('从左侧拖拽字段到这里')
})
test('没有业务权限时保持空白并解释来源', async () => {
  mocks.sample.mockRejectedValue({ status: 403 }); mocks.detail.mockResolvedValue({ ...tpl, layout: { elements: [] } })
  await render(); expect(host.textContent).toContain('暂无可用业务数据（无查看权限）'); expect(host.textContent).toContain('从左侧拖拽字段到这里')
})
test('已有真实数据后刷新失败也提供重试，保留当前预览', async () => {
  await render(); mocks.sample.mockRejectedValueOnce(new Error('断网'))
  await act(async () => { await qc.invalidateQueries({ queryKey: ['print-template-preview'] }) }); await act(async () => { await new Promise(r => setTimeout(r, 20)) })
  expect(host.textContent).toContain('真实测试商品'); expect(host.textContent).toContain('真实数据加载失败'); expect(btn('重试')).toBeDefined()
})
test('刷新时业务权限撤销，立即撤掉此前真实数据', async () => {
  await render(); mocks.sample.mockRejectedValue({ status: 403 })
  await act(async () => { await qc.invalidateQueries({ queryKey: ['print-template-preview'] }) }); await act(async () => { await new Promise(r => setTimeout(r, 20)) })
  expect(host.textContent).not.toContain('真实测试商品'); expect(host.textContent).not.toContain('REAL-001'); expect(host.textContent).toContain('无查看权限')
})
test('撤权后重试仍失败不能恢复旧数据，重新成功才显示', async () => {
  await render(); mocks.sample.mockRejectedValueOnce({ status: 403 }).mockRejectedValueOnce(new Error('断网'))
  await act(async () => { await qc.invalidateQueries({ queryKey: ['print-template-preview'] }) }); await act(async () => { await new Promise(r => setTimeout(r, 20)) })
  await click('重试'); expect(host.textContent).not.toContain('真实测试商品'); expect(host.textContent).not.toContain('REAL-001')
  await click('重试'); expect(host.textContent).toContain('真实测试商品')
})


test('新增标签字段可拖入并显示真实值，保存仅保存字段定义', async () => {
  mocks.sample.mockResolvedValue({ ...real, data: { ...real.data, article_number: 'SUP-REAL-99', color: '真实蓝色' } })
  await render()
  const field = [...host.querySelectorAll('[draggable="true"]')].find(el => el.textContent === '供应商型号')
  expect(field).toBeDefined()
  expect(host.textContent).not.toContain('SUP-REAL-99')
  await act(async () => { field!.dispatchEvent(new MouseEvent('dragstart', { bubbles: true })) })
  const canvas = host.querySelector('.cursor-crosshair')!
  await act(async () => { canvas.dispatchEvent(new MouseEvent('drop', { bubbles: true, clientX: 20, clientY: 120 })) })
  expect(host.textContent).toContain('SUP-REAL-99')
  await click('保存')
  const saved = mocks.save.mock.calls[0][0].layout.elements
  expect(saved).toHaveLength(DEFAULT_LABEL_ELEMENTS[8].length + 1)
  expect(saved.at(-1).fieldKey).toBe('article_number')
  expect(JSON.stringify(saved)).not.toContain('SUP-REAL-99')
})
