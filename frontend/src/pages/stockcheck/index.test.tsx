// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import StockCheckPage from './index'
import { SectionVisibilityContext } from '@/components/layout/SectionVisibilityContext'

const fixture = vi.hoisted(() => ({
  query: { data: undefined as unknown, isLoading: false, error: null as unknown, refetch: vi.fn() },
  params: [] as { keyword: string }[],
}))
vi.mock('@/hooks/useStockCheck', () => ({
  useCheckList: (params: { keyword: string }) => { fixture.params.push(params); return fixture.query },
  useCreateCheck: () => ({ isPending: false, mutateAsync: vi.fn() }),
}))
vi.mock('@/hooks/useWarehouses', () => ({ useWarehousesActive: () => ({ data: [] }) }))
vi.mock('@/hooks/usePermission', () => ({ usePermission: () => ({ can: () => false }) }))
// Detail business data is synthetic; use the actual portal/focus-return boundary.
vi.mock('./components/CheckDetailDialog', async () => {
  const { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } = await import('@/components/ui/dialog')
  return { default: ({ open, checkId, onClose }: { open: boolean; checkId: number | null; onClose: () => void }) => <Dialog open={open} onOpenChange={value => { if (!value) onClose() }}><DialogContent><DialogHeader><DialogTitle>详情{checkId}</DialogTitle><DialogDescription>合成只读详情</DialogDescription></DialogHeader><button onClick={onClose}>关闭详情{checkId}</button></DialogContent></Dialog> }
})

const rows = (n: number) => Array.from({ length: n }, (_, index) => ({ id: index + 1, checkNo: `SC-${index + 1}`, warehouseName: '合成仓', checkType: 1, status: 1, statusName: '盘点中', createdAt: '2026-10-15T00:00:00Z' }))
let host: HTMLDivElement, root: Root
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  fixture.query = { data: { list: rows(1000), pagination: { total: 1000 }, truncated: false }, isLoading: false, error: null, refetch: vi.fn() }
  fixture.params = []
  host = document.createElement('div'); host.dataset.workspaceScroll = ''; document.body.append(host)
  Object.defineProperties(host, { clientHeight: { value: 480 }, offsetHeight: { value: 480 }, offsetWidth: { value: 800 } })
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const height = this === host ? 480 : this.tagName === 'TR' ? 48 : 0
    return { height, width: 800, top: this === host ? 0 : -host.scrollTop, left: 0, bottom: height, right: 800, x: 0, y: 0, toJSON() {} }
  })
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  host.scrollTo = vi.fn((options: ScrollToOptions) => { host.scrollTop = options.top || 0 }) as typeof host.scrollTo
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
function render(active = true) { act(() => root.render(<SectionVisibilityContext.Provider value={active}><StockCheckPage /></SectionVisibilityContext.Provider>)) }
function scrollEnd(count = 1000) { act(() => { host.scrollTop = count * 48 - 480; host.dispatchEvent(new Event('scroll')) }) }
function input(value: string) {
  const search = host.querySelector('input')!
  act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(search, value); search.dispatchEvent(new Event('input', { bubbles: true })) })
  return search
}
test('1000盘点单只挂载可见行，末行可达且隐藏恢复保留滚动', () => {
  render(); expect(host.querySelectorAll('tbody tr:not([aria-hidden])').length).toBeLessThan(50)
  expect(host.textContent).toContain('SC-1'); expect(host.textContent).not.toContain('SC-1000')
  scrollEnd(); expect(host.textContent).toContain('SC-1000')
  render(false); render(true); expect(host.scrollTop).toBeGreaterThan(45000); expect(host.textContent).toContain('SC-1000')
})
test.each([5000, 5001])('截断时显示已读/总匹配%s，不把总数当已加载', total => {
  fixture.query.data = { list: rows(5000), pagination: { total }, truncated: total > 5000 }
  render()
  const summary = host.querySelector('[role="status"]')?.textContent
  if (total > 5000) { expect(summary).toMatch(/5,000.*5,001.*缩小查询范围/); expect(host.querySelector('.desktop-page-description')?.textContent).toContain('请缩小查询范围') }
  else expect(summary).toBe('共 5,000 单')
  expect(host.querySelectorAll('tbody tr:not([aria-hidden])').length).toBeLessThan(50)
})
test('读取失败展示原错误和重试，不显示旧列表与成功计数，重试保留搜索草稿', () => {
  render(); input('未应用草稿')
  fixture.query.error = new Error('合成读取失败'); render()
  expect(host.textContent).toContain('加载失败'); expect(host.textContent).toContain('合成读取失败')
  expect(host.querySelector('tbody')).toBeNull(); expect(host.textContent).not.toContain('共 1,000 单')
  act(() => Array.from(host.querySelectorAll('button')).find(button => button.textContent === '重试')!.click())
  expect(fixture.query.refetch).toHaveBeenCalledOnce(); expect(host.querySelector('input')?.value).toBe('未应用草稿')
  expect(fixture.params.at(-1)?.keyword).toBe('')
})
test('加载时不显示旧成功计数，小列表仍完整呈现', () => {
  fixture.query.isLoading = true; render(); expect(host.textContent).not.toContain('共 1,000 单')
  fixture.query.isLoading = false; fixture.query.data = { list: rows(3), pagination: { total: 3 } }; render()
  expect(host.querySelectorAll('tbody tr')).toHaveLength(3); expect(host.textContent).toContain('共 3 单')
})
test('搜索条件、未应用草稿和末行详情关闭均不清空或重挂列表', async () => {
  render(); const search = input('仓A')
  act(() => search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
  input('未应用草稿'); scrollEnd()
  const action = Array.from(host.querySelectorAll('button')).filter(button => button.textContent === '查看/填写').at(-1)!
  await act(async () => { action.focus(); action.click() })
  expect(document.body.textContent).toContain('关闭详情1000')
  await act(async () => Array.from(document.querySelectorAll('button')).find(button => button.textContent === '关闭详情1000')!.click())
  render(false); render(true)
  expect(host.querySelector('input')?.value).toBe('未应用草稿'); expect(fixture.params.at(-1)?.keyword).toBe('仓A')
  expect(host.scrollTop).toBeGreaterThan(45000); expect(host.textContent).toContain('SC-1000')
})
test('焦点行滚远后开启真实模态仍保留来源按钮，关闭回到原按钮', async () => {
  render(); const action = Array.from(host.querySelectorAll('button')).find(button => button.textContent === '查看/填写')!
  act(() => action.focus()); scrollEnd()
  await act(async () => action.click())
  expect(document.querySelector('[role="dialog"]')).not.toBeNull()
  expect(action.isConnected).toBe(true)
  await act(async () => Array.from(document.querySelectorAll('button')).find(button => button.textContent === '关闭详情1')!.click())
  await vi.waitFor(() => expect(document.activeElement).toBe(action))
  expect(host.scrollTop).toBeGreaterThan(45000)
})
test('聚焦的操作按钮滚出视口仍保留焦点，失焦后不继续挂载该行', () => {
  render(); const action = Array.from(host.querySelectorAll('button')).find(button => button.textContent === '查看/填写')!
  act(() => action.focus()); scrollEnd()
  expect(document.activeElement).toBe(action); expect(action.isConnected).toBe(true)
  expect(host.textContent).toContain('SC-1000')
  act(() => host.querySelector('input')!.focus())
  expect(action.isConnected).toBe(false)
})
