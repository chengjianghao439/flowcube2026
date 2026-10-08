// @vitest-environment jsdom
import { act, StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test } from 'vitest'
import apiClient, { setApiClientBaseURL } from '@/api/client'
import { useAuthStore } from '@/store/authStore'
import { PERMISSIONS } from '@/lib/permission-codes'
import { TabPathContext } from '@/components/layout/TabPathContext'
import SaleFormPage from '@/pages/sale/form'
import PurchaseFormPage from '@/pages/purchase/form'
const originalAdapter = apiClient.defaults.adapter, originalBaseURL = apiClient.defaults.baseURL, originalAuth = useAuthStore.getState()
const unknownRequests: string[] = []
beforeEach(() => {
 unknownRequests.length = 0
 setApiClientBaseURL('/fixture-api')
 useAuthStore.getState().login('fixture', null, { id: 9, username: 'fixture', realName: 'fixture', roleId: 2, roleName: 'fixture', permissions: [PERMISSIONS.SALE_ORDER_CREATE, PERMISSIONS.PRODUCT_VIEW, PERMISSIONS.CUSTOMER_VIEW, PERMISSIONS.WAREHOUSE_VIEW] })
 apiClient.defaults.adapter = async config => {
  let data: unknown
  if (config.method === 'get' && (config.url === '/warehouses/active' || config.url === '/carriers/active')) data = []
  else if (config.method === 'get' && config.url === '/customers' && config.params?.pageSize === 500) data = { list: [{ id: 11, code: 'C11', name: '测试客户', isActive: true }], pagination: { page: 1, pageSize: 500, total: 1 } }
  else if (config.method === 'get' && (config.url === '/customers' || config.url === '/suppliers') && config.params?.page === 1 && config.params?.pageSize === 200) data = { list: config.url === '/customers' ? [{ id: 11, code: 'C11', name: '测试客户', isActive: true }] : [], pagination: { page: 1, pageSize: 200, total: config.url === '/customers' ? 1 : 0 } }
  else { unknownRequests.push(`${config.method} ${config.url}`); throw Error(`Unexpected order-entry adapter request: ${config.method} ${config.url}`) }
  return { config, headers: {}, status: 200, statusText: 'OK', data: { success: true, data } }
 }
})
afterEach(() => {
 apiClient.defaults.adapter = originalAdapter
 setApiClientBaseURL(originalBaseURL)
 useAuthStore.setState(originalAuth)
 expect(unknownRequests).toEqual([])
})
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
for (const kind of ['sale','purchase'] as const) test(`${kind}首次不报错，保存后同时展示往来方、仓库及明细问题`, async()=>{
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host)
 const client=new QueryClient({defaultOptions:{queries:{enabled:false,retry:false}}})
 try {
 await act(async()=>root.render(<MemoryRouter initialEntries={[`/${kind}/new`]}><QueryClientProvider client={client}><TabPathContext.Provider value={`/${kind}/new`}>{kind==='sale'?<SaleFormPage/>:<PurchaseFormPage/>}</TabPathContext.Provider></QueryClientProvider></MemoryRouter>))
 expect(host.querySelector('[role="alert"]')).toBeNull()
 act(()=>[...host.querySelectorAll('button')].find(b=>b.textContent?.includes('保存草稿'))!.click())
 const alert=host.querySelector('[role="alert"]');expect(alert?.textContent).toContain('3 处')
 expect(alert?.textContent).toContain(kind==='sale'?'请选择客户':'请选择供应商')
 expect(alert?.textContent).toContain('请选择仓库')
 expect(alert?.textContent).toContain('请添加至少一条商品明细')
 const add=[...alert!.querySelectorAll('button')].find(b=>b.textContent?.includes('商品明细'))!;act(()=>add.click())
 expect(document.activeElement).toBe(host.querySelector('[data-entry-add]'))
 }finally{await act(async()=>root.unmount());client.clear();host.remove()}
})


test('shared new sale can open its real customer finder under StrictMode without reusing an aborted request', async () => {
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host)
 const client=new QueryClient({defaultOptions:{queries:{retry:false}}})
 try {
  await act(async()=>root.render(<StrictMode><MemoryRouter initialEntries={['/sale/new']}><QueryClientProvider client={client}><TabPathContext.Provider value="/sale/new"><SaleFormPage/></TabPathContext.Provider></QueryClientProvider></MemoryRouter></StrictMode>))
  await act(async()=>[...host.querySelectorAll('button')].find(b=>b.textContent==='点击选择客户…')!.click())
  await act(async()=>{await new Promise(resolve=>setTimeout(resolve,5))})
  const dialog=document.querySelector<HTMLElement>('[role="dialog"]')!
  expect(dialog.textContent).toContain('测试客户')
  expect(dialog.textContent).not.toContain('加载已取消')
  await act(async()=>[...dialog.querySelectorAll<HTMLElement>('[role="row"]')].find(row=>row.textContent?.includes('测试客户'))!.click())
  await act(async()=>[...dialog.querySelectorAll('button')].find(b=>b.textContent==='确认选择')!.click())
  expect([...host.querySelectorAll('button')].some(b=>b.textContent==='测试客户')).toBe(true)
 } finally {await act(async()=>root.unmount());client.clear();host.remove()}
})
