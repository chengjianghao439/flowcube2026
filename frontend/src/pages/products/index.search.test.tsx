// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { expect, test, vi } from 'vitest'
import ProductsPage from './index'

vi.mock('@/hooks/useProducts', () => ({
  useProducts: () => ({ data: {list:[{id:1,code:'P1',name:'连接器',articleNumber:'SUP-01',spec:'M6',color:'黑',isActive:false,searchMatch:'供应商型号'}],pagination:{total:1}}, isLoading:false }),
  useDeleteProduct: () => ({mutate:vi.fn()}),
}))
vi.mock('@/hooks/useCategories', () => ({useCategoryTree:()=>({data:[]})}))
vi.mock('@/hooks/useSuppliers', () => ({useSuppliers:()=>({data:{list:[]}})}))
vi.mock('@/hooks/usePermission', () => ({usePermission:()=>({can:()=>false})}))
vi.mock('@/components/shared/AppDialog', () => ({AppDialog:({open,children,footer}:{open:boolean;children:React.ReactNode;footer:React.ReactNode})=>open?<div>{children}{footer}</div>:null}))

test('真实商品页有关键词才展示命中，查询提示六字段并保留停用/查询上下文', async () => {
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true})
  const host=document.createElement('div');document.body.append(host);const root=createRoot(host)
  try {
    await act(async()=>root.render(<MemoryRouter initialEntries={['/products?keyword=SUP-01&status=0&supplierId=4&minPrice=5']}><ProductsPage /></MemoryRouter>))
    expect(host.querySelector('tbody')?.textContent).toContain('命中：供应商型号')
    expect(host.textContent).toContain('状态：停用')
    expect(host.textContent).toContain('售价≥5')
    await act(async()=>Array.from(host.querySelectorAll('button')).find(b=>b.textContent==='查询')!.click())
    expect(host.textContent).toContain('编码 / 名称 / 条码 / 供应商型号 / 型号 / 颜色')
    expect(host.querySelector<HTMLInputElement>('input[placeholder="请输入关键字…"]')?.value).toBe('SUP-01')
    await act(async()=>Array.from(host.querySelectorAll('button')).find(b=>b.textContent==='取消')!.click())
    await act(async()=>host.querySelector<HTMLButtonElement>('button[aria-label="移除「关键字：SUP-01」"]')!.click())
    expect(host.querySelector('tbody')?.textContent).not.toContain('命中：')
    expect(host.textContent).toContain('状态：停用')
  } finally {await act(async()=>root.unmount());host.remove()}
})
