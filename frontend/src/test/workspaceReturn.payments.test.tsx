// @vitest-environment jsdom
import type { ComponentType } from 'react'
import { beforeEach,afterEach,expect,test,vi } from 'vitest'
import { retentionHarness } from './workspaceRetention'
import { clearReadFixtures,readData,lastRead,paged,writeCalls } from './readOnlyApi'
import PayablePage from '@/pages/payments/payable'
import ReceivablePage from '@/pages/payments/receivable'
import ReconciliationPayable from '@/pages/reports/reconciliation-payable'
import ReconciliationReceivable from '@/pages/reports/reconciliation-receivable'
const routes=vi.hoisted(()=>({values:{} as Record<string,ComponentType>}))
vi.mock('@/router/routeRegistry',async original=>({...await original<typeof import('@/router/routeRegistry')>(),resolveRouteComponent:(path:string)=>routes.values[path]||null}))
vi.mock('@/api/payments',async original=>(await import('./readOnlyApi')).mockReadApi(await original(),'payments'))
vi.mock('@/api/reports',async original=>(await import('./readOnlyApi')).mockReadApi(await original(),'reports'))
vi.mock('@/api/finance',async original=>(await import('./readOnlyApi')).mockReadApi(await original(),'finance'))
vi.mock('@/api/customers',async original=>(await import('./readOnlyApi')).mockReadApi(await original(),'customers'))
vi.mock('@/api/suppliers',async original=>(await import('./readOnlyApi')).mockReadApi(await original(),'suppliers'))
const h=retentionHarness()
beforeEach(()=>{
 clearReadFixtures();routes.values={'/payments/payable':PayablePage,'/payments/receivable':ReceivablePage,'/reports/reconciliation/payable':ReconciliationPayable,'/reports/reconciliation/receivable':ReconciliationReceivable}
 for(const key of ['payments.getPaymentsApi','payments.getStatementsApi','reports.getReconciliationApi'])readData.set(key,{list:[],pagination:{total:0},summary:{}})
})
afterEach(()=>expect(writeCalls).toEqual([]))
for(const c of [{page:'/payments/payable',type:1},{page:'/payments/receivable',type:2},{page:'/reports/reconciliation/payable',type:1},{page:'/reports/reconciliation/receivable',type:2}])test('实际'+c.page+'核销筛选→实际核销明细→关闭/回原标签',async()=>{
 const receipt={id:42,type:c.type,receiptNo:'RC-KEEP',partyId:9,partyName:'合成往来单位',amount:1,settledAmount:1,unsettledAmount:0,paymentDate:'2026-10-08',paymentMethod:1,paymentMethodName:'现金',remark:'合成',createdAt:'2026-10-08',settlements:[]}
 readData.set('payments.getReceiptsApi',paged(receipt));readData.set('payments.getReceiptDetailApi',receipt)
 await h.render(c.page);await h.click(c.type===1?'付款核销':'收款核销');await h.click('查询');const dialog=document.querySelector('[role="dialog"]')!;await h.input(dialog.querySelector<HTMLInputElement>('input')!,'RC-KEEP');await h.click('查询',dialog)
 expect(lastRead('payments','getReceiptsApi')!.args[0]).toMatchObject({type:String(c.type),receiptNo:'RC-KEEP'});const params=lastRead('payments','getReceiptsApi')!.args[0];await h.click('明细');expect(lastRead('payments','getReceiptDetailApi')!.args[0]).toBe(42);expect(document.querySelector('[role="dialog"]')!.textContent).toContain('核销明细');expect(document.querySelector('[role="dialog"]')!.textContent).toContain('RC-KEEP');await h.click('关闭')
 await h.go('/dashboard');await h.go(c.page);expect(lastRead('payments','getReceiptsApi')!.args[0]).toEqual(params);expect(h.activeText()).toContain('RC-KEEP');await h.click('查询');expect(document.querySelector<HTMLInputElement>('[role="dialog"] input')!.value).toBe('RC-KEEP');await h.click('取消')
})
