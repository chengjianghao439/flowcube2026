// @vitest-environment jsdom
import { act, type ComponentType } from 'react'
import { beforeEach,afterEach,expect,test,vi } from 'vitest'
import { retentionHarness } from './workspaceRetention'
import { clearReadFixtures,readData,lastRead,paged,writeCalls } from './readOnlyApi'
import AccountsPage from '@/pages/finance/accounts'
import TransactionsPage from '@/pages/finance/transactions'
import ExpensesPage from '@/pages/finance/expenses'
import VouchersPage from '@/pages/accounting/vouchers'
import LedgerPage from '@/pages/accounting/ledger'
import InvoicesPage from '@/pages/accounting/invoices'
import AssetsPage from '@/pages/fixed-assets'
import BackfillsPage from '@/pages/accounting/backfills'
import FreightPage from '@/pages/logistics/freight-reconciliation'
const routes=vi.hoisted(()=>({values:{} as Record<string,ComponentType>}))
vi.mock('@/router/routeRegistry',async original=>({...await original<typeof import('@/router/routeRegistry')>(),resolveRouteComponent:(path:string)=>routes.values[path]||null}))
vi.mock('@/api/finance',async original=>(await import('./readOnlyApi')).mockReadApi(await original(),'finance'))
vi.mock('@/api/accounting',async original=>(await import('./readOnlyApi')).mockReadApi(await original(),'accounting'))
vi.mock('@/api/fixedAssets',async original=>(await import('./readOnlyApi')).mockReadApi(await original(),'assets'))
vi.mock('@/api/logistics',async original=>(await import('./readOnlyApi')).mockReadApi(await original(),'logistics'))
vi.mock('@/api/carriers',async original=>(await import('./readOnlyApi')).mockReadApi(await original(),'carriers'))
vi.mock('@/api/warehouses',async original=>(await import('./readOnlyApi')).mockReadApi(await original(),'warehouses'))
const h=retentionHarness()
const row={id:42,accountId:42,code:'SYN42',name:'KEEP账户',status:1,statusName:'草稿',statusTone:'draft',createdAt:'2026-10-08',totalAmount:1,amount:1,items:[],entries:[],balance:1,openingBalance:0,type:1,isActive:true,bizNo:'SYN42',bizId:42,bizType:'expense',bizTypeName:'费用',claimNo:'SYN42',title:'KEEP费用',voucherNo:'SYN42',voucherDate:'2026-10-08',summary:'KEEP业务',totalDebit:1,totalCredit:1,sourceType:'sale',period:'202610',invoiceNo:'SYN42',invoiceType:1,partyName:'KEEP供应商',invoiceDate:'2026-10-08',amountNoTax:1,taxAmount:0,taxRate:0,amountWithTax:1,assetNo:'SYN42',assetName:'KEEP设备',originalCost:100,bookValue:100,accumulatedDepreciation:0,salvageValue:0,usefulLifeMonths:20,monthlyDepreciation:5,backfillNo:'SYN42',requestNo:'SYN42',applicationNo:'SYN42',reason:'KEEP合成',businessDate:'2026-10-08',requestSnapshot:{},trackingNo:'SYN42',billPeriod:'2026-08',estFreight:1,actualFreight:1,diffFreight:0,reconciled:0}
beforeEach(()=>{
 clearReadFixtures();routes.values={'/finance/accounts':AccountsPage,'/finance/transactions':TransactionsPage,'/finance/expenses':ExpensesPage,'/accounting/vouchers':VouchersPage,'/accounting/ledger':LedgerPage,'/accounting/invoices':InvoicesPage,'/accounting/fixed-assets':AssetsPage,'/accounting/backfills':BackfillsPage,'/logistics/freight-reconciliation':FreightPage}
 readData.set('finance.getAccountsApi',{...paged(row),summary:{totalBalance:1,accountCount:1}})
 readData.set('finance.getAccountTransactionsApi',{...paged({...row,bizType:6,direction:1}),summary:{inAmount:1,outAmount:0}})
 readData.set('finance.getSupplierRefundTraceApi',{id:42,refund_no:'SYN42',status:3,amount:'1.0000',refund_date:'2026-10-08',fund_transaction_id:42,voucher_id:null,voucher_generate_error:null})
 readData.set('finance.getExpenseClaimsApi',paged(row));readData.set('finance.getExpenseClaimApi',row)
 for(const name of ['getVouchersApi','getInvoicesApi','getBackfillsApi'])readData.set('accounting.'+name,paged(row))
 readData.set('accounting.getBackfillsApi',paged({...row,status:0}));readData.set('accounting.getVoucherApi',row);readData.set('accounting.getBackfillDetailApi',{...row,status:0});readData.set('accounting.getReconciliationApi',{rows:[],summary:{}})
 const ledgerRow={...row,accountId:42,category:'asset',categoryName:'资产',isLeaf:true,openingDebit:0,openingCredit:0,periodDebit:0,periodCredit:0,closingDebit:0,closingCredit:0}
 readData.set('accounting.getTrialBalanceApi',{...paged(ledgerRow),balanced:{period:true,closing:true},totals:{openingDebit:0,openingCredit:0,periodDebit:0,periodCredit:0,closingDebit:0,closingCredit:0}})
 readData.set('accounting.getAccountLedgerApi',{list:[{voucherNo:'SYN42',voucherDate:'2026-09-08',summary:'KEEP明细',debit:0,credit:0,balance:0}],openingBalance:0,closingBalance:0,account:ledgerRow})
 readData.set('assets.listFixedAssetsApi',paged(row));readData.set('logistics.getFreightBillsApi',paged(row));readData.set('logistics.getFreightSettlementsApi',paged({...row,settlementNo:'SYN42',billCount:1,totalActualFreight:1,totalEstFreight:1,totalDiffFreight:0}));readData.set('carriers.getCarriersActiveApi',[{ id: 42, name: '合成承运商', code: 'SYN42' }])
})
afterEach(()=>expect(writeCalls).toEqual([]))
const cases=[
 {page:'/finance/accounts',api:'finance',op:'getAccountsApi',dialog:true,input:'编码 / 名称 / 账号',open:'流水',close:'关闭'},
 {page:'/finance/transactions',api:'finance',op:'getAccountTransactionsApi',dialog:true,input:'关联单号 / 往来单位',open:'SYN42',close:'关闭'},
 {page:'/finance/expenses',api:'finance',op:'getExpenseClaimsApi',dialog:true,input:'单号 / 事由 / 申请人',open:'明细',close:'关闭'},
 {page:'/accounting/vouchers',api:'accounting',op:'getVouchersApi',dialog:true,input:'凭证号 / 单号 / 摘要',open:'查看',close:'关闭'},
 {page:'/accounting/invoices',api:'accounting',op:'getInvoicesApi',dialog:true,input:'发票号 / 单位 / 单号',open:'更多操作',menuAction:'编辑',close:'取消'},
 {page:'/accounting/fixed-assets',api:'assets',op:'listFixedAssetsApi',dialog:true,input:'编号 / 名称 / 类别',enter:true,open:'处置',close:'取消'},
]
for(const c of cases)test('真实'+c.page+'应用筛选→实际明细/编辑弹窗关闭→切页返回',async()=>{
 await h.render(c.page);if(c.dialog)await h.click('查询');const input=(c.dialog?document:h.host).querySelector<HTMLInputElement>(`input[placeholder="${c.input}"]`)!;await h.input(input,'KEEP');if(c.page==='/finance/accounts'||c.enter)await h.enter(input);else if(c.dialog)await h.click('查询',document.querySelector('[role="dialog"]')!)
 expect(lastRead(c.api,c.op)?.args[0]).toMatchObject({keyword:'KEEP'});const params=lastRead(c.api,c.op)?.args[0];expect(h.activeText()).toContain('SYN42')
 await h.click(c.open);if('menuAction' in c && c.menuAction)await h.click(c.menuAction);const dialog=document.querySelector('[role="dialog"]')!;expect(dialog).not.toBeNull();expect(dialog.textContent).not.toMatch(/加载失败|与这笔流水不符/);await h.click(c.close);expect(document.querySelector('[role="dialog"]')).toBeNull()
 await h.go('/dashboard');await h.go(c.page);expect(lastRead(c.api,c.op)?.args[0]).toEqual(params);expect(h.activeText()).toContain('SYN42')
 if(c.dialog){await h.click('查询');expect(document.querySelector<HTMLInputElement>(`input[placeholder="${c.input}"]`)!.value).toBe('KEEP');await h.click('取消')}else expect(h.host.querySelector<HTMLInputElement>(`input[placeholder="${c.input}"]`)!.value).toBe('KEEP')
})
test('实际总账已应用期间→实际明细账→关闭，期间/请求/记录保持', async () => {
  await h.render('/accounting/ledger')
  const input = h.host.querySelector<HTMLInputElement>('[placeholder="YYYYMM"]')!
  await h.input(input, '202609')
  expect(lastRead('accounting', 'getTrialBalanceApi')!.args[0]).toBe('202609')

  await h.click('查看明细账')
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!
  expect(dialog.querySelector('.fc-form-dialog-body')?.textContent).toContain('SYN42')
  await h.click('关闭', dialog.querySelector('.fc-dialog-footer')!)
  expect(document.querySelector('[role="dialog"]')).toBeNull()

  await h.go('/dashboard')
  await h.go('/accounting/ledger')
  expect(input.value).toBe('202609')
  expect(lastRead('accounting', 'getTrialBalanceApi')!.args[0]).toBe('202609')
  expect(h.activeText()).toContain('SYN42')
})
test('实际补录已应用状态→独立读取真实详情→关闭，筛选和原记录保留',async()=>{
 await h.render('/accounting/backfills');await h.click('待审批');expect(lastRead('accounting','getBackfillsApi')!.args[0]).toMatchObject({status:0});const params=lastRead('accounting','getBackfillsApi')!.args[0];await h.click('详情');expect(lastRead('accounting','getBackfillDetailApi')!.args[0]).toBe(42);expect(document.querySelector('[role="dialog"]')!.textContent).toContain('KEEP合成');await h.click('关闭');await h.go('/dashboard');await h.go('/accounting/backfills');expect(h.activeText()).toContain('待审批');expect(lastRead('accounting','getBackfillsApi')!.args[0]).toEqual(params)
})
test('实际运费对账期间→现有录入弹窗取消，账单/汇总期间和原结果保持',async()=>{
 await h.render('/logistics/freight-reconciliation');await h.click('查询');const input=document.querySelector<HTMLInputElement>('[placeholder="2026-07"]')!;await h.input(input,'2026-08');await h.enter(input);const params=lastRead('logistics','getFreightBillsApi')!.args[0];expect(params).toMatchObject({billPeriod:'2026-08'});await h.click('录入账单');expect(document.querySelector('[role="dialog"]')).not.toBeNull();await h.click('取消');await h.go('/dashboard');await h.go('/logistics/freight-reconciliation');expect(h.activeText()).toContain('账期：2026-08');expect(lastRead('logistics','getFreightBillsApi')!.args[0]).toEqual(params);expect(h.activeText()).toContain('SYN42')
})

test('流水查询的倒挂日期同时阻止点击和回车，修正后回车应用草稿', async () => {
  await h.render('/finance/transactions')
  const initial = lastRead('finance', 'getAccountTransactionsApi')
  await h.click('查询')
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!
  const end = dialog.querySelector<HTMLInputElement>('input[id$="-endDate"]')!
  const keyword = dialog.querySelector<HTMLInputElement>('input[id$="-keyword"]')!
  async function setEnd(value: string) {
    await h.input(end, value)
    await act(async () => end.dispatchEvent(new FocusEvent('focusout', { bubbles: true })))
  }
  await setEnd('2000-01-01')
  expect(end.getAttribute('aria-invalid')).toBe('true')
  expect(dialog.querySelector('[role="alert"]')?.textContent).toContain('起始日期不能晚于结束日期')
  const apply = [...dialog.querySelectorAll('button')].find(button => button.textContent === '查询')!
  expect(apply.disabled).toBe(true)
  await h.enter(keyword)
  expect(dialog.isConnected).toBe(true)
  expect(lastRead('finance', 'getAccountTransactionsApi')).toBe(initial)
  await setEnd('2099-01-01')
  await h.input(keyword, '流水筛选')
  await h.enter(keyword)
  expect(dialog.isConnected).toBe(false)
  expect(lastRead('finance', 'getAccountTransactionsApi')?.args[0]).toMatchObject({ keyword: '流水筛选', endDate: '2099-01-01' })
})
