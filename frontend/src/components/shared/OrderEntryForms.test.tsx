// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { expect, test } from 'vitest'
import { TabPathContext } from '@/components/layout/TabPathContext'
import SaleFormPage from '@/pages/sale/form'
import PurchaseFormPage from '@/pages/purchase/form'
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
for (const kind of ['sale','purchase'] as const) test(`${kind}首次不报错，保存后同时展示往来方、仓库及明细问题`, async()=>{
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host)
 const client=new QueryClient({defaultOptions:{queries:{enabled:false,retry:false}}})
 try {
 await act(async()=>root.render(<MemoryRouter><QueryClientProvider client={client}><TabPathContext.Provider value={`/${kind}/new`}>{kind==='sale'?<SaleFormPage/>:<PurchaseFormPage/>}</TabPathContext.Provider></QueryClientProvider></MemoryRouter>))
 expect(host.querySelector('[role="alert"]')).toBeNull()
 act(()=>[...host.querySelectorAll('button')].find(b=>b.textContent?.includes('保存草稿'))!.click())
 const alert=host.querySelector('[role="alert"]');expect(alert?.textContent).toContain('3 处')
 expect(alert?.textContent).toContain(kind==='sale'?'请选择客户':'请选择供应商')
 expect(alert?.textContent).toContain('请选择仓库')
 expect(alert?.textContent).toContain('请添加至少一条商品明细')
 const add=[...alert!.querySelectorAll('button')].find(b=>b.textContent?.includes('商品明细'))!;act(()=>add.click())
 expect(document.activeElement).toBe(host.querySelector('[data-entry-add]'))
 }finally{act(()=>root.unmount());client.clear();host.remove()}
})
