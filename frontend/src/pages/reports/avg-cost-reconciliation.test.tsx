// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import AvgCostReconciliationPage from './avg-cost-reconciliation'
import KeepAliveSection from '@/components/shared/KeepAliveSection'
const state = vi.hoisted(() => ({ data: { ok: false, driftedCount: 1, totalDiffValue: 2.3456, totalRows: 0, list: [] as object[] }, canAdjust: false, resync: vi.fn() }))
vi.mock('@/hooks/useAvgCostReconciliation', () => ({ useAvgCostReconciliation: () => ({ data: state.data, isLoading: false, isError: false, refetch: vi.fn() }) }))
vi.mock('@/hooks/usePermission', () => ({ usePermission: () => ({ can: () => state.canAdjust }) }))
vi.mock('@/api/inventory', () => ({ resyncStockApi: state.resync }))
vi.mock('@/lib/toast', () => ({ toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() } }))
let host: HTMLDivElement, root: Root, client: QueryClient
function row(unitCost: unknown, id: number, unitCostSource?: string) {
  return { rowKey: id + '-8', productId: id, productCode: 'P-' + id, productName: '合成商品' + id, unit: '个',
    articleNumber: null, spec: null, color: null, warehouseId: 8, unitCost, unitCostSource,
    cacheQty: 2, containerQty: 1, diffQty: 1, cacheValue: 8, containerValue: 4, diffValue: 2.3456, drifted: true }
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  state.canAdjust = false; state.resync.mockReset(); state.data = { ok: false, driftedCount: 1, totalDiffValue: 2.3456, totalRows: 0, list: [] }
  host = document.createElement('div'); document.body.append(host); root = createRoot(host); client = new QueryClient()
})
afterEach(() => { act(() => root.unmount()); client.clear(); host.remove(); vi.unstubAllGlobals() })
function draw(active = true) { act(() => root.render(<QueryClientProvider client={client}><KeepAliveSection active={active}><AvgCostReconciliationPage /></KeepAliveSection></QueryClientProvider>)) }
test('单位成本可区分四位，价值差异保持两位且无写入', () => {
  state.data.list = [row(3.4567, 1), row(3.4568, 2)]; draw()
  expect(host.textContent).toContain('¥3.4567'); expect(host.textContent).toContain('¥3.4568')
  expect(host.textContent).toContain('¥2.35'); expect(host.textContent).not.toContain('¥2.3456')
  expect(host.textContent).not.toContain('校正账面'); expect(state.resync).not.toHaveBeenCalled()
})
test.each([null, undefined, Number.NaN])('异常单位成本%s显示缺失，不被Number转为0', value => {
  state.data.list = [row(value, 1)]; draw()
  const cell = host.querySelector('tbody tr td:nth-child(2)')
  expect(cell?.textContent).toBe('—'); expect(cell?.textContent).not.toContain('0.00')
})
test.each([['avg_cost','当前移动均价'],['cost_price','当前进价估值'],['zero_fallback','当前按0估值'],[undefined,'来源未记录']])('来源%s只在按需打开时显示，隐藏浮层不泄漏', async (source, label) => {
  state.data.list = [row(0, 1, source)]; draw()
  expect(host.textContent).not.toContain(label)
  const button = host.querySelector<HTMLButtonElement>('[aria-label="查看合成商品1的当前估值来源"]')
  expect(button).not.toBeNull(); expect(button?.textContent).toBe('¥0.00')
  const user = userEvent.setup()
  await act(async () => { await user.click(button!) })
  expect(host.querySelector('[aria-label="合成商品1的当前估值来源"]')?.textContent).toContain(label); expect(host.textContent).toContain('原销售行首次记录的成本')
  draw(false); expect(host.textContent).not.toContain(label); expect(state.resync).not.toHaveBeenCalled()
})

test('仅实际截断时简短显示200/201行范围，金额合计保持接口两位',()=>{
  Object.assign(state.data,{truncated:true,matchedRows:201,totalRows:200,list:[row(3.4567,1)]});draw()
  expect(host.querySelector('.desktop-page-description')?.textContent).toContain('检测到 1 项账面差异')
  expect(host.querySelector('.desktop-page-description')?.textContent).toContain('200 / 201')
  expect(host.textContent?.match(/价值差合计为已显示范围/g)).toHaveLength(1)
  expect(host.textContent).toContain('200 / 201');expect(host.textContent).toContain('价值差合计为已显示范围')
  Object.assign(state.data,{truncated:false,matchedRows:200});draw()
  expect(host.textContent).not.toContain('价值差合计为已显示范围')
})
