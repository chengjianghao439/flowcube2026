// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, useNavigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { expect, test, vi } from 'vitest'
import ProductsPage from './index'

const fixtures = vi.hoisted(() => ({
  products: { list: [{ id: 1, code: 'P1', name: '商品一' }], pagination: { total: 1 } },
  categories: [], suppliers: { list: [] }, renders: vi.fn(),
}))
vi.mock('@/hooks/useProducts', () => ({ useProducts: () => ({ data: fixtures.products, isLoading: false }), useDeleteProduct: () => ({ mutate: vi.fn() }) }))
vi.mock('@/hooks/useCategories', () => ({ useCategoryTree: () => ({ data: fixtures.categories }) }))
vi.mock('@/hooks/useSuppliers', () => ({ useSuppliers: () => ({ data: fixtures.suppliers }) }))
// 只替代昂贵表格，观测真实页面是否在无关路由变化时重新调用表格渲染。
vi.mock('@/components/shared/DataTable', () => ({ default: (props: { data: unknown[] }) => { fixtures.renders(); return <div>表格行数 {props.data.length}</div> } }))
vi.mock('./ProductQueryDialog', () => ({ default: () => null }))

test('切换到其他菜单不重新渲染未变化的商品表格', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host)
  const query = new QueryClient()
  function Shell() {
    const navigate = useNavigate()
    return <><button onClick={() => navigate('/carrier-accounts')}>切换菜单</button><ProductsPage /></>
  }
  try {
    await act(async () => root.render(<QueryClientProvider client={query}><MemoryRouter initialEntries={['/products']}><Shell /></MemoryRouter></QueryClientProvider>))
    fixtures.renders.mockClear()
    await act(async () => (host.querySelector('button') as HTMLButtonElement).click())
    expect(fixtures.renders).not.toHaveBeenCalled()
    expect(host.textContent).toContain('表格行数 1')
  } finally {
    act(() => root.unmount()); query.clear(); host.remove()
  }
})
