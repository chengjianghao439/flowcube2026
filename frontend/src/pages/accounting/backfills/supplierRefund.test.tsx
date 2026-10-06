// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import {SectionVisibilityContext} from '@/components/layout/SectionVisibilityContext';
import {TabPathContext} from '@/components/layout/TabPathContext';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, afterEach, test, expect, vi } from 'vitest';
import client, { setApiClientBaseURL } from '@/api/client';
import { useAuthStore } from '@/store/authStore';
import { useCompanyStore } from '@/store/companyStore';
import BackfillsPage from './index';
import { toast } from '@/lib/toast';
const captured = vi.hoisted(() => ({ dialogs: [] as Array<{open?:boolean;onOpenChange?:(open:boolean)=>void}>, confirms: [] as Array<{open:boolean;title:string;onCancel:()=>void}> }));
vi.mock('@/components/ui/dialog', async importOriginal => { const actual = await importOriginal<typeof import('@/components/ui/dialog')>(); return {...actual, Dialog: (props: import('react').ComponentProps<typeof actual.Dialog>) => { captured.dialogs.push(props); return createElement(actual.Dialog,props) }} });
vi.mock('@/components/shared/ConfirmDialog', async importOriginal => { const actual = await importOriginal<typeof import('@/components/shared/ConfirmDialog')>(); return {...actual, ConfirmDialog: (props: import('react').ComponentProps<typeof actual.ConfirmDialog>) => { captured.confirms.push(props); return createElement(actual.ConfirmDialog,props) }} });
const adapter = client.defaults.adapter, unknown: string[] = [], calls: string[] = [];
let kind = 'supplier_refund', zero = true, brokenSnapshot = false, rowStatus = 1;
let listReply: (()=>Promise<unknown>) | null = null; let rowId = 1; let pendingExecution = false;
let approveReply: (()=>Promise<unknown>) | null = null;
let applicationPending = false;
const operationReply = () => ({ id: rowId, applicationNo: row().applicationNo, bizType: kind, bizTypeName: row().bizTypeName, executed: true, postingPeriod: '202610', result: kind === 'supplier_refund' ? { id: 60+rowId, refundNo: `RF${60+rowId}`, status: 3, fundTransactionId: 81, amount: '0.0049', message: '回款已登记，凭证结果见详情' } : { id: 22 }, voucherRequired: kind !== 'receipt_settle' && (kind !== 'supplier_refund' || !zero), voucherResult: kind === 'supplier_refund' ? zero ? 'notRequired' : 'generated' : undefined, voucherError: null, application: applicationPending ? null : row(), applicationPending, applicationError: applicationPending ? '申请详情暂时加载失败' : null });
const createdBody = { operationUuid: '33333333-3333-4333-8333-333333333333', purchaseReturnId: 11, incomeAccountId: 42, refundDate: '2026-09-30', amount: '0.0049', allocations: [{ entryId: 21, amount: '0.0049' }] };
const frozenSource = { version: 1, po: { id: 10, orderNo: 'PO10', supplierId: 4, warehouseId: 8 }, pr: { id: 11, returnNo: 'PR11', purchaseOrderId: 10, purchaseOrderNo: 'PO10', supplierId: 4, warehouseId: 8, grossAmount: '6.0000', items: [{ id: 12, purchaseItemId: 101, productId: 3, unit: '个', quantity: '2.00', unitPrice: '3.0000' }] }, entries: [{ entryId: 21, receiptId: null, originalAmount: '100.0000', paymentDate: '2026-09-20', out: { id: 51, bizNo: 'PO10', amount: '100.0000' } }] };
const row = () => ({ id: rowId, applicationNo: `BF-20261001-000${rowId}`, period: '202609', businessDate: '2026-09-30', bizType: kind, bizTypeName: kind === 'supplier_refund' ? '供应商退款' : '收付款核销', bizId: 60+rowId, bizNo: `RF${60+rowId}`, amount: 0.0049, reason: '原日期准确申请', status: rowStatus, statusName: rowStatus===0?'待审批':'已批准', applicantId: 9, applicantName: '申请人', approverId: 10, approverName: '审批人', executedAt: rowStatus===1?'2026-10-01':null, postingPeriod: '202610', voucherGeneratedAt: rowStatus===1&&zero ? '2026-10-01' : null, voucherGenerateError: zero ? '零分投影已核对/无需分位凭证' : '待核对', voucherNotRequired: rowStatus===1&&zero, voucherPending: rowStatus===1&&!zero, pendingExecution, createdAt: '2026-10-01', requestSnapshot: { kind: 'supplier_refund', refundId: 60+rowId, actorId: 9, requestKey: 'original-key', identity: { operationUuid: '22222222-2222-4222-8222-222222222222' }, locator: { refundDate: '2026-09-30' }, frozen: { refundId: 60+rowId, companyId: 1, refundNo: `RF${60+rowId}`, amount: '0.0049', incomeAccountId: 42, refundDate: '2026-09-30', purchaseReturnId: 11, purchaseOrderId: 10, paymentRecordId: 31, supplierId: 4, warehouseId: 8, createdBy: 9, createdOperationUuid: createdBody.operationUuid, createRequestKey: 'original-create-key', createPayloadHash: 'fixture-hash', sourceFingerprint: 'fixture-fingerprint', createPayloadJson: JSON.stringify(createdBody), sourceSnapshotJson: brokenSnapshot ? '{broken' : JSON.stringify(frozenSource) } }, voucherResult: zero ? 'notRequired' : 'pending' });
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); localStorage.clear(); unknown.length = 0; calls.length = 0; kind = 'supplier_refund'; zero = true; brokenSnapshot = false; rowStatus=1; approveReply=null;listReply=null;rowId=1;pendingExecution=false;applicationPending=false;captured.dialogs.length=0;captured.confirms.length=0; setApiClientBaseURL('/a'); useCompanyStore.setState({ companyId: 1 }); useAuthStore.getState().login('fixture', null, { id: 10, username: 'fixture', realName: 'fixture', roleId: 2, roleName: 'fixture', permissions: ['finance.period.backfill.approve','supplier.refund.view','purchase.order.view','return.order.view','payment.view'] }); useWorkspaceStore.setState({tabs:[{key:'/accounting/backfills',path:'/accounting/backfills',title:'跨期补录审批',closable:true}],activeKey:'/accounting/backfills'});client.defaults.adapter = async (c) => { calls.push(`${c.method} ${c.url}`); const response = (data: unknown) => ({ config: c, headers: {}, status: 200, statusText: 'OK', data: { success: true, data } }); if (c.method === 'get' && c.url === '/accounting/backfills?page=1&pageSize=50') {
    expect(c.listMode).toBe('paged');
    if(listReply) return response(await listReply());
    return response({ list: [row()], summary: { total: 1, pending: 0, pendingExecution: 0, voucherPending: zero ? 0 : 1 }, pagination: { page: 1, pageSize: 50, total: 1 } });
} if (c.method === 'get' && c.url === '/finance/accounts/active')
    return response([{ id: 42, name: '原收入账户' }]); if (c.method === 'get' && c.url === '/warehouses/active')
    return response([]); if (c.method === 'get' && (c.url === '/accounting/backfills/1' || c.url === '/accounting/backfills/2'))
    return response(row()); if(c.method==='post'&&c.url==='/accounting/backfills/1/approve'){expect(JSON.parse(c.data)).toEqual({remark:null});return response(await approveReply?.()||operationReply())} if (c.method === 'post' && c.url === '/accounting/backfills/1/execute') {
    expect(JSON.parse(c.data)).toEqual({});
    return response(operationReply());
} if (c.method === 'post' && c.url === '/accounting/backfills/1/regenerate-voucher') {
    expect(JSON.parse(c.data)).toEqual({});
    zero = true;
    return response(operationReply());
} unknown.push(`${c.method} ${c.url}`); throw Error('unknown backfill API'); }; });
afterEach(() => { vi.restoreAllMocks(); client.defaults.adapter = adapter; localStorage.clear(); expect(unknown).toEqual([]); });
async function mount(run: (draw:(active:boolean)=>Promise<void>) => Promise<void>, waitRow = true) { const host = document.createElement('div'), qc = new QueryClient({ defaultOptions: { queries: { retry: false } } }); document.body.append(host); const actualRoot = createRoot(host); try {
    const draw=async(active:boolean)=>{await act(async () => { actualRoot.render(<MemoryRouter initialEntries={['/accounting/backfills']}><TabPathContext.Provider value='/accounting/backfills'><SectionVisibilityContext.Provider value={active}><QueryClientProvider client={qc}><BackfillsPage /></QueryClientProvider></SectionVisibilityContext.Provider></TabPathContext.Provider></MemoryRouter>); });};await draw(true);
    for (let i = 0; waitRow && i < 20 && !document.body.textContent?.includes('RF61'); i++)
        await act(async () => { await new Promise(r => setTimeout(r, 10)); });
    if(waitRow) expect(document.body.textContent).toContain('RF61');
    await run(draw);
}
finally {
    await act(async () => actualRoot.unmount());
    qc.clear();
    host.remove();
} }
async function click(text: string) { const b = Array.from(document.querySelectorAll('button')).find(b => b.textContent === text); expect(b).toBeTruthy(); await act(async () => { b!.click(); }); await act(async () => { await new Promise(r => setTimeout(r, 20)); }); if (text === '详情')
    for (let i = 0; i < 20 && document.body.textContent?.includes('加载详情…'); i++)
        await act(async () => { await new Promise(r => setTimeout(r, 10)); }); }
test('供应商退款零分proof准确显示，不套核销不涉及凭证；actual detail原frozen金额/真实日期', async () => { await mount(async () => { expect(document.body.textContent).toContain('0.0049'); expect(document.body.textContent).toContain('零分投影已核对/无需分位凭证'); expect(document.body.textContent).not.toContain('不涉及凭证'); await click('详情'); expect(document.body.textContent).toContain('真实银行回款日'); expect(document.body.textContent).toContain('2026-09-30'); expect(document.body.textContent).toContain('原收入账户');expect(document.body.textContent).toContain('PR11');expect(document.body.textContent).toContain('PO10');expect(document.body.textContent).toContain('原付款分配 21');expect(document.body.textContent).toContain('2.00 个');expect(document.body.textContent).toContain('3.0000');expect(document.body.textContent).not.toContain('original-create-key');expect(document.body.textContent).not.toContain('fixture-hash'); expect(document.body.textContent).not.toContain('本类补录（核销）'); }); });
test('新kind重核零分success提示不报凭证已生成，失败仍列待生成；旧核销文案保持', async () => { zero = false; const success = vi.spyOn(toast, 'success'); await mount(async () => { expect(document.body.textContent).toContain('凭证待生成'); await click('重试生成凭证'); await click('确认生成'); expect(success).toHaveBeenCalledWith('零分投影已核对/无需分位凭证'); }); kind = 'receipt_settle'; zero = true; await mount(async () => { expect(document.body.textContent).toContain('不涉及凭证'); await click('详情'); expect(document.body.textContent).toContain('本类补录（核销）不产生会计凭证'); }); });
test('actual getBackfillsApi保page2/50及filters原样，禁止取齐层重置到首页', async () => {
    const { getBackfillsApi } = await import('@/api/accounting');
    client.defaults.adapter = async (c) => { calls.push(`${c.method} ${c.url}`); const legacy = c.method === 'get' && c.url === '/accounting/backfills?status=1&bizType=supplier_refund' && c.params?.page === 1 && c.params?.pageSize === 200; const paged = c.method === 'get' && c.url === '/accounting/backfills?status=1&bizType=supplier_refund&page=2&pageSize=50' && c.listMode === 'paged'; if (!legacy && !paged) {
        unknown.push(`${c.method} ${c.url}`);
        throw Error('unknown page contract');
    } ; return { config: c, headers: {}, status: 200, statusText: 'OK', data: { success: true, data: { list: [], summary: { total: 0, pending: 0, pendingExecution: 0, voucherPending: 0 }, pagination: { page: paged ? 2 : 1, pageSize: paged ? 50 : 200, total: 0 } } } }; };
    const result = await getBackfillsApi({ status: 1, bizType: 'supplier_refund', page: 2, pageSize: 50 });
    expect(result.pagination.page).toBe(2);
    expect(result.pagination.pageSize).toBe(50);
});

test('供应商退款原frozen业务JSON损坏明确不可核对，不向当前主档猜值',async()=>{brokenSnapshot=true;await mount(async()=>{await click('详情');expect(document.body.textContent).toContain('原退款依据不可核对');expect(document.body.textContent).not.toContain('原付款分配 21');expect(calls.every(c=>!c.includes('/suppliers')&&!c.includes('/products'))).toBe(true)})})

import {useWorkspaceStore} from '@/store/workspaceStore'
function changeContext(change:string){if(change==='server'){setApiClientBaseURL('/b');setApiClientBaseURL('/a')}else if(change==='actor')useAuthStore.getState().updateUser({id:20});else{useWorkspaceStore.getState().setActive('/elsewhere');useWorkspaceStore.getState().setActive('/accounting/backfills')}}
test.each(['server','actor','workspaceBounce'])('RF补录审批target冻结%s代次，确认前变化零POST与原输入不清',async change=>{rowStatus=0;await mount(async()=>{await click('批准');await act(async()=>changeContext(change));await click('确认批准并记账');expect(calls.filter(c=>c.startsWith('post '))).toEqual([]);expect(document.body.textContent).toContain('审批备注');expect(document.body.textContent).toContain('上下文已变化')})})
test('RF审批已发请求迟到回应不toast、不关闭原modal、固定owner配置无replay/fallback',async()=>{rowStatus=0;let resolve!:(v:unknown)=>void;approveReply=()=>new Promise(r=>{resolve=r});const success=vi.spyOn(toast,'success'),warning=vi.spyOn(toast,'warning');const configured=client.defaults.adapter,configs:import('axios').InternalAxiosRequestConfig[]=[];client.defaults.adapter=async c=>{if(c.method==='post')configs.push(c);return (configured as import('axios').AxiosAdapter)(c)};await mount(async()=>{await click('批准');await click('确认批准并记账');await act(async()=>changeContext('server'));await act(async()=>{rowStatus=1;resolve(row());await new Promise(r=>setTimeout(r,20))});expect(success).not.toHaveBeenCalled();expect(warning).not.toHaveBeenCalled();expect(document.body.textContent).toContain('审批备注');expect(configs).toHaveLength(1);expect(configs[0].baseURL).toBe('/a');expect(configs[0].automaticReplay).toBe(false);expect(configs[0]._erpApiFallbackTried).toBe(true)})})

test('实际SectionVisibility隐藏再显示保原RF审批输入与Portal隔离，旧target代次零POST',async()=>{rowStatus=0;await mount(async draw=>{await click('批准');const input=document.querySelector('input[maxlength="300"]') as HTMLInputElement;await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,'核对中的原备注');input.dispatchEvent(new Event('input',{bubbles:true}))});await draw(false);expect(document.body.textContent).not.toContain('确认批准并记账');await draw(true);expect((document.querySelector('input[maxlength="300"]') as HTMLInputElement).value).toBe('核对中的原备注');await click('确认批准并记账');expect(calls.filter(c=>c.startsWith('post '))).toEqual([])})})

test('隐藏前发出的actual list迟到不取得恢复后RF资格，显式fresh读取固定原owner配置',async()=>{
 let resolve!:(v:unknown)=>void; listReply=()=>new Promise(r=>{resolve=r}); const configs:import('axios').InternalAxiosRequestConfig[]=[];const actual=client.defaults.adapter;
 client.defaults.adapter=async c=>{if(c.url?.startsWith('/accounting/backfills?'))configs.push(c);return (actual as import('axios').AxiosAdapter)(c)};
 await mount(async draw=>{
   await act(async()=>{await new Promise(r=>setTimeout(r,20))}); expect(configs).toHaveLength(1)
   await draw(false); await draw(true); await act(async()=>{resolve({list:[row()],pagination:{page:1,pageSize:50,total:1}});await new Promise(r=>setTimeout(r,20))})
   expect(document.body.textContent).not.toContain('RF61');expect(document.body.textContent).not.toContain('BF-20261001-0001')
   listReply=null;rowId=2;await click('刷新');expect(document.body.textContent).toContain('RF62')
   for(const c of configs){expect(c.baseURL).toBe('/a');expect(c.automaticReplay).toBe(false);expect(c._erpApiFallbackTried).toBe(true)}
 },false)
})
test('实际Remark Dialog旧关闭回调不得清新RF目标，隐藏bounce保原审批备注',async()=>{
 rowStatus=0;await mount(async draw=>{
   await click('批准');const old=captured.dialogs.filter(p=>p.open).at(-1)!.onOpenChange!;
   await draw(false);await act(async()=>old(false));await draw(true);expect(document.body.textContent).toContain('审批备注')
 })
 await mount(async()=>{
   await click('批准');const old=captured.dialogs.filter(p=>p.open).at(-1)!.onOpenChange!;
   await click('取消');rowId=2;await click('刷新');await click('批准');await act(async()=>old(false));expect(document.body.textContent).toContain('BF-20261001-0002');expect(document.body.textContent).toContain('审批备注')
 })
})
test.each(['detail','execute','regen'])('实际%s旧Portal取消回调不得清新RF目标或失活原target',async which=>{
 pendingExecution=which==='execute';zero=which!=='regen';await mount(async draw=>{
 const button=which==='detail'?'详情':which==='execute'?'重试记账':'重试生成凭证';await click(button);
 const old=which==='detail'?()=>captured.dialogs.filter(p=>p.open).at(-1)!.onOpenChange!(false):captured.confirms.filter(p=>p.open).at(-1)!.onCancel;
 const frozen=which==='detail'?captured.dialogs.filter(p=>p.open).at(-1)!.onOpenChange!:null;
 const invoke=()=>frozen?frozen(false):old();
 await draw(false);await act(async()=>invoke());await draw(true);expect(document.body.textContent).toContain('原退款上下文已变化')
 })
 pendingExecution=which==='execute';zero=which!=='regen';await mount(async()=>{
 const button=which==='detail'?'详情':which==='execute'?'重试记账':'重试生成凭证';await click(button);
 const old=which==='detail'?captured.dialogs.filter(p=>p.open).at(-1)!.onOpenChange!:null;const cancel=which==='detail'?null:captured.confirms.filter(p=>p.open).at(-1)!.onCancel;
 await act(async()=>old?old(false):cancel!());rowId=2;await click('刷新');await click(button);await act(async()=>old?old(false):cancel!());expect(document.querySelector('[role="dialog"]')?.textContent).toContain('BF-20261001-0002')
 })
})

test('旧核销仅原审批权限仍读取与显示，不附加RF完整VIEW门',async()=>{kind='receipt_settle';useAuthStore.getState().updateUser({permissions:['finance.period.backfill.approve']});await mount(async()=>{expect(document.body.textContent).toContain('收付款核销');expect(document.body.textContent).toContain('不涉及凭证');await click('详情');expect(document.body.textContent).toContain('本类补录（核销）不产生会计凭证')})})

test.each([
 {action:'approve',kind:'supplier_refund',zero:true,label:'批准',confirm:'确认批准并记账',expected:'零分投影已核对/无需分位凭证'},
 {action:'execute',kind:'supplier_refund',zero:false,label:'重试记账',confirm:'确认重试',expected:'调整凭证已生成'},
 {action:'regen',kind:'supplier_refund',zero:true,label:'重试生成凭证',confirm:'确认生成',expected:'零分投影已核对/无需分位凭证'},
 {action:'regen',kind:'payment',zero:true,label:'重试生成凭证',confirm:'确认生成',expected:'调整凭证已生成'},
 {action:'approve',kind:'receipt_settle',zero:true,label:'批准',confirm:'确认批准并记账',expected:'无需生成调整凭证'},
])('真实补录$kind $action成功与详情待加载分开，不因application null套错种类',async scenario=>{
 kind=scenario.kind;zero=scenario.zero;applicationPending=true;rowStatus=scenario.action==='approve'?0:1;pendingExecution=scenario.action==='execute';const warning=vi.spyOn(toast,'warning'),success=vi.spyOn(toast,'success');
 if(scenario.action==='regen')zero=false;
 await mount(async()=>{await click(scenario.label);await click(scenario.confirm);expect(warning).toHaveBeenCalledWith(expect.stringContaining('详情待加载'));const message=warning.mock.calls.at(-1)?.[0]||'';expect(message).toContain(scenario.expected);expect(message).not.toContain('凭证未生成成功');if(scenario.kind==='receipt_settle')expect(message).not.toContain('已生成');expect(success).not.toHaveBeenCalled()});
})
