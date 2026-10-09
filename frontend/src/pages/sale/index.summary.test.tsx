// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { expect, test, vi } from 'vitest'
import SalePage from './index'
const state = vi.hoisted(() => ({ value: {} as Record<string, unknown> }))
vi.mock('@/hooks/useSale', () => ({ useSaleList: () => state.value, useCancelSale: () => ({ isPending: false }), useDeleteSale: () => ({ isPending: false }) }))
vi.mock('./SaleQueryDialog', () => ({ default: () => null }))
vi.mock('./components/ReserveAllocationDialog', () => ({ default: () => null }))
vi.mock('./components/StockShortageDialog', () => ({ default: () => null }))
vi.mock('@/components/shared/DataTable', () => ({ default: () => <div>订单表格</div> }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
test('sale collection limit is explicit, while an unread total is not shown as zero', () => {
  const host = document.createElement('div'), root = createRoot(host); document.body.append(host)
  const draw = () => act(() => root.render(<MemoryRouter initialEntries={['/sale?range=all']}><SalePage /></MemoryRouter>))
  try {
    state.value = { data: { list: Array.from({ length: 5000 }), pagination: { total: 5001 }, truncated: true } }; draw()
    expect(host.textContent).toMatch(/已显示\s*5,000\s*\/\s*共\s*5,001\s*单/)
    state.value = { error: new Error('查询失败'), refetch: vi.fn() }; draw()
    expect(host.textContent).not.toMatch(/共\s*0\s*单/)
    state.value = { isLoading: true }; draw()
    expect(host.textContent).not.toMatch(/共\s*0\s*单/)
    state.value = { data: { list: [], pagination: { total: 0 } } }; draw()
    expect(host.textContent).toMatch(/共\s*0\s*单/)
  } finally { act(() => root.unmount()); host.remove() }
})
