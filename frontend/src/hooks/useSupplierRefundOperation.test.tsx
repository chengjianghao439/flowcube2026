// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { InternalAxiosRequestConfig } from 'axios';
import client, { setApiClientBaseURL } from '@/api/client';
import { useAuthStore } from '@/store/authStore';
import { useSupplierRefundOperation } from './useSupplierRefundOperation';
import { REFUND_STORAGE, readRefundRecords, saveRefundRecord, replaceRefundRecord, removeRefundRecords, captureRefundOwner, canonicalRefund, type RefundRecord } from '@/lib/supplierRefundRecovery';
import type { RefundSpec } from '@/types/supplier-refund';
const originalAdapter = client.defaults.adapter, calls: InternalAxiosRequestConfig[] = [], unknown: string[] = [];
const spec: RefundSpec = { kind: 'create', draftIdentity: 'draft-PR11', path: '/supplier-refunds', action: 'supplier.refund.create', operationUuid: '22222222-2222-4222-8222-222222222222', requestKey: 'fixed-key', refundDate: '2026-10-01', sourceFingerprint: 'original-source', source: { purchaseReturnId: 11, purchaseOrderId: 10, paymentRecordId: 31, supplierId: 4, warehouseId: 8, incomeAccountId: 42, amount: '0.0049' }, body: { operationUuid: '22222222-2222-4222-8222-222222222222', purchaseReturnId: 11, incomeAccountId: 42, refundDate: '2026-10-01', amount: '0.0049', allocations: [{ entryId: 21, amount: '0.0049' }] } };
const ack = { id: 61, refundNo: 'RF61', status: 1 };
let post: (c: InternalAxiosRequestConfig) => Promise<unknown>, query: (c: InternalAxiosRequestConfig) => Promise<unknown>;
const response = (c: InternalAxiosRequestConfig, data: unknown) => ({ config: c, headers: {}, status: 200, statusText: 'OK', data: { success: true, data } });
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); localStorage.clear(); calls.length = 0; unknown.length = 0; setApiClientBaseURL('/a'); useAuthStore.getState().login('fixture', null, { id: 9, username: 'fixture', realName: 'fixture', roleId: 2, roleName: 'fixture', permissions: ['supplier.refund.view', 'supplier.refund.create', 'purchase.order.view', 'return.order.view', 'payment.view'] }); post = async () => { throw Error('network uncertain'); }; query = async () => ({ status: 'not_found' }); client.defaults.adapter = async (c) => { calls.push(c); if (c.method === 'post' && c.url === spec.path)
    return response(c, await post(c)); if (c.method === 'get' && c.url === `/supplier-refunds/operations/${spec.operationUuid}`)
    return response(c, await query(c)); unknown.push(`${c.method} ${c.url}`); throw Error('Unknown endpoint'); }; });
afterEach(() => { vi.restoreAllMocks(); client.defaults.adapter = originalAdapter; localStorage.clear(); expect(unknown).toEqual([]); });
async function probe(run: (get: () => ReturnType<typeof useSupplierRefundOperation>, draw: (active?: boolean) => Promise<void>, qc: QueryClient) => Promise<void>, mayWrite = () => true) { let hook!: ReturnType<typeof useSupplierRefundOperation>, active = true; function Probe() { hook = useSupplierRefundOperation('draft-PR11', active, mayWrite); return null; } const root = createRoot(document.createElement('div')), qc = new QueryClient({ defaultOptions: { queries: { retry: false } } }); const draw = async (next = true) => { active = next; await act(async () => root.render(<QueryClientProvider client={qc}><Probe /></QueryClientProvider>)); }; await draw(); try {
    await run(() => hook, draw, qc);
}
finally {
    await act(async () => root.unmount());
    qc.clear();
} }
test('POST前保存完整canonical body/原owner与代次、未知后永久只GET准确本人原action/key', async () => { await probe(async (get) => { await act(async () => { await get().submit(spec); }); const r = readRefundRecords()[0]; expect(r.body).toEqual(spec.body); expect(r.refundDate).toBe('2026-10-01'); expect(r.sessionGeneration).toBe(useAuthStore.getState().sessionGeneration); expect(r.epoch).toBeTypeOf('number'); expect(r.activeGeneration).toBeTypeOf('number'); expect(r.method).toBe('post'); expect(JSON.stringify(r)).not.toContain('fixture'); await act(async () => { await get().submit({ ...spec, requestKey: 'new' }); await get().queryOriginal(); }); expect(calls.filter(c => c.method === 'post')).toHaveLength(1); expect(calls[1].params).toEqual({ action: 'supplier.refund.create', requestKey: 'fixed-key' }); expect(calls[0].baseURL).toBe('/a'); expect(calls[0].automaticReplay).toBe(false); expect(calls[0]._erpApiFallbackTried).toBe(true); expect(calls[0].headers.get('X-Request-Key')).toBe('fixed-key'); expect(get().blocked).toBe(true); }); });
test.each(['write', 'readback', 'corrupt'])('持久%s拒绝零POST且不清历史', async (kind) => { if (kind === 'corrupt')
    localStorage.setItem(REFUND_STORAGE, 'bad');
else if (kind === 'write')
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw Error('quota'); });
else {
    const set = Storage.prototype.setItem, get = Storage.prototype.getItem;
    let wrote = false;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, k, v) { if (k === REFUND_STORAGE)
        wrote = true; set.call(this, k, v); });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, k) { return k === REFUND_STORAGE && wrote ? '[]' : get.call(this, k); });
} await probe(async (get) => { await act(async () => { await get().submit(spec); }); expect(calls).toEqual([]); expect(get().error).toBeTruthy(); }); });
test('容量满拒新请求，无TTL/LRU淘汰unknown', async () => { const owner = captureRefundOwner(); for (let i = 0; i < 30; i++)
    saveRefundRecord({ ...spec, version: 1, userId: 9, baseURL: owner.baseURL, sessionGeneration: owner.sessionGeneration, epoch: owner.epoch, activeGeneration: 0, createdAt: 1, phase: 'pending', method: 'post', draftIdentity: 'previous-' + i, operationUuid: `33333333-3333-4333-8333-${String(i).padStart(12, '0')}`, body: { ...spec.body, operationUuid: `33333333-3333-4333-8333-${String(i).padStart(12, '0')}` } } as RefundRecord); await probe(async (get) => { await act(async () => { await get().submit(spec); }); expect(calls).toEqual([]); expect(readRefundRecords()).toHaveLength(30); }); });
function aba() { setApiClientBaseURL('/b'); setApiClientBaseURL('/a'); }
test.each(['ownerABA', 'hiddenBounce'])('%s旧响应不填当前草稿、不清理、不刷新待办', async (kind) => { let resolve!: (v: unknown) => void; post = () => new Promise(r => { resolve = r; }); await probe(async (get, draw, qc) => { const invalidate = vi.spyOn(qc, 'invalidateQueries'); let pending!: Promise<unknown>; await act(async () => { pending = get().submit(spec); await new Promise(r => setTimeout(r, 5)); }); if (kind === 'ownerABA')
    await act(async () => aba());
else {
    await draw(false);
    await draw(true);
} await act(async () => { resolve(ack); await pending; }); expect(readRefundRecords()).toHaveLength(1); expect(get().result).toBeNull(); expect(invalidate).not.toHaveBeenCalled(); }); });
test('完整原success身份确认再persist再clear，同时await刷新审批与仪表盘；刷新失败不允许再POST', async () => { query = async () => ({ status: 'success', resourceType: 'supplier_refund_order', resourceId: 61, data: ack }); await probe(async (get, _draw, qc) => { await act(async () => { await get().submit(spec); }); const invalidate = vi.spyOn(qc, 'invalidateQueries').mockRejectedValue(Error('refresh failed')); await act(async () => { await get().queryOriginal(); }); expect(readRefundRecords()[0].phase).toBe('confirmed'); expect(get().result).toBeNull(); expect(get().error).toContain('刷新'); expect(invalidate.mock.calls.map(c => c[0]?.queryKey)).toContainEqual(['approval-pending']); expect(invalidate.mock.calls.map(c => c[0]?.queryKey)).toContainEqual(['dash-pending-approvals']); await act(async () => { await get().submit(spec); }); expect(calls.filter(c => c.method === 'post')).toHaveLength(1); }); });
test.each(['resource', 'status', 'id'])('原GET错%s保完整体与键，不清理不重发', async (defect) => { query = async () => ({ status: 'success', resourceType: defect === 'resource' ? 'sale_order' : 'supplier_refund_order', resourceId: 61, data: { ...ack, ...(defect === 'status' ? { status: 3 } : defect === 'id' ? { id: 62 } : {}) } }); await probe(async (get) => { await act(async () => { await get().submit(spec); await get().queryOriginal(); }); expect(readRefundRecords()[0].body).toEqual(spec.body); expect(get().blocked).toBe(true); }); });
test.each(['confirmedSave', 'clear', 'confirmedABA'])('success后%s保持block且confirmed ABA保留回执', async (fault) => { post = async () => ack; const set = Storage.prototype.setItem; let changed = false; vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, k, v) { if (k === REFUND_STORAGE && (fault === 'clear' ? v === '[]' : fault === 'confirmedSave' ? v.includes('confirmed') : false))
    throw Error('save failure'); set.call(this, k, v); if (k === REFUND_STORAGE && fault === 'confirmedABA' && v.includes('confirmed') && !changed) {
    changed = true;
    aba();
} }); await probe(async (get) => { await act(async () => { await get().submit(spec); }); expect(readRefundRecords()).toHaveLength(1); expect(get().blocked).toBe(true); expect(get().result).toBeNull(); if (fault !== 'confirmedSave')
    expect(readRefundRecords()[0].phase).toBe('confirmed'); }); });
test('storage callbacks改变调用者body/key仍发持久clone，撤写权可只GET无需VIEW/来源/主档', async () => { const mutable = JSON.parse(canonicalRefund(spec)), set = Storage.prototype.setItem; vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, k, v) { set.call(this, k, v); if (k === REFUND_STORAGE) {
    mutable.body.amount = '9.0000';
    mutable.requestKey = 'different';
} }); await probe(async (get) => { await act(async () => { await get().submit(mutable); }); expect(JSON.parse(calls[0].data)).toEqual(spec.body); }); useAuthStore.getState().updateUser({ permissions: [] }); query = async () => ({ status: 'success', resourceType: 'supplier_refund_order', resourceId: 61, data: ack }); await probe(async (get) => { await act(async () => { await get().queryOriginal(); }); expect(get().result).toEqual(ack); expect(calls.filter(c => c.method === 'post')).toHaveLength(1); }, () => false); });
import { useWorkspaceStore } from '@/store/workspaceStore';
import { AxiosError } from 'axios';
test('真实workspace同步A→B→A活动bounce合并render后旧POST仍不可应用', async () => { let resolve!: (v: unknown) => void; post = () => new Promise(r => { resolve = r; }); await probe(async (get) => { let pending!: Promise<unknown>; await act(async () => { pending = get().submit(spec); await new Promise(r => setTimeout(r, 5)); }); await act(async () => { useWorkspaceStore.getState().setActive('/supplier-refunds-other'); useWorkspaceStore.getState().setActive('/supplier-refunds'); }); await act(async () => { resolve(ack); await pending; }); expect(readRefundRecords()).toHaveLength(1); expect(get().result).toBeNull(); }); });
test('cleanup存储钩子ownerABA恢复原confirmed字节，foreign readback字节不覆写', async () => { post = async () => ack; const set = Storage.prototype.setItem; let changed = false; vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, k, v) { set.call(this, k, v); if (k === REFUND_STORAGE && v === '[]' && !changed) {
    changed = true;
    aba();
} }); await probe(async (get) => { await act(async () => { await get().submit(spec); }); expect(readRefundRecords()).toHaveLength(1); expect(readRefundRecords()[0].phase).toBe('confirmed'); expect(get().result).toBeNull(); }); vi.restoreAllMocks(); localStorage.clear(); const foreign = 'external unknown bytes'; vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, k, v) { set.call(this, k, v); if (k === REFUND_STORAGE && v.includes('pending'))
    set.call(this, k, foreign); }); await probe(async (get) => { await act(async () => { await get().submit(spec); }); expect(localStorage.getItem(REFUND_STORAGE)).toBe(foreign); expect(calls.filter(c => c.method === 'post')).toHaveLength(1); }); });
test('invalidate失败卸载重挂confirmed仍阻断POST，重新核对只GET或已确认本地回执', async () => { query = async () => ({ status: 'success', resourceType: 'supplier_refund_order', resourceId: 61, data: ack }); await probe(async (get, _draw, qc) => { await act(async () => { await get().submit(spec); }); vi.spyOn(qc, 'invalidateQueries').mockRejectedValue(Error('refresh')); await act(async () => { await get().queryOriginal(); }); expect(readRefundRecords()[0].phase).toBe('confirmed'); }); await probe(async (get) => { expect(get().blocked).toBe(true); await act(async () => { await get().submit(spec); await get().queryOriginal(); }); expect(get().result).toEqual(ack); expect(readRefundRecords()).toEqual([]); }); expect(calls.filter(c => c.method === 'post')).toHaveLength(1); });
test('闭期真实receive原日期不改，补录未知单独application→operation GET，固定原UUID/key/body不重新申请', async () => {
    const receive: RefundSpec = { ...spec, kind: 'receive', draftIdentity: 'draft-PR11', refundId: 61, path: '/supplier-refunds/61/receive', action: 'supplier.refund.receive.61', body: { operationUuid: spec.operationUuid, reason: '核实原日期' } };
    let applications = 0, applicationFound = false, executed = false;
    const received = { id: 61, refundNo: 'RF61', status: 3, fundTransactionId: 81, amount: '0.0049', message: '回款已登记，凭证结果见详情' };
    client.defaults.adapter = async (c) => {
        calls.push(c);
        if (c.method === 'post' && c.url === receive.path) {
            const body = JSON.parse(c.data);
            expect(c.headers.get('X-Request-Key')).toBe('fixed-key');
            expect(c.baseURL).toBe('/a');
            if (!body.backfillRequest)
                throw new AxiosError('closed', 'ERR_BAD_REQUEST', c, undefined, { config: c, headers: {}, status: 409, statusText: 'Conflict', data: { success: false, message: '已结账', code: 'FINANCE_PERIOD_CLOSED' } });
            applications++;
            expect(body).toEqual({ ...receive.body, backfillRequest: true, backfillReason: '原真实日期已核对' });
            throw Error('application uncertain');
        }
        if (c.method === 'get' && c.url === `/supplier-refunds/backfill-applications/${spec.operationUuid}`) {
            expect(c.params).toEqual({ action: 'supplier.refund.receive.61', requestKey: 'fixed-key' });
            return response(c, applicationFound ? { id: 5, applicationId: 5, applicationNo: 'BF-5', backfillRequested: true, reused: true, status: 1, executed, rejected: false, period: '202610', businessDate: '2026-10-01' } : { status: 'not_found' });
        }
        if (c.method === 'get' && c.url === `/supplier-refunds/operations/${spec.operationUuid}`)
            return response(c, executed ? { status: 'success', resourceType: 'supplier_refund_order', resourceId: 61, data: received } : { status: 'not_found' });
        unknown.push(`${c.method} ${c.url}`);
        throw Error('unknown RF application endpoint');
    };
    await probe(async (get) => { await act(async () => { await get().submit(receive); }); expect(get().periodClosed).toBe(true); expect(readRefundRecords()[0].refundDate).toBe('2026-10-01'); await act(async () => { await get().requestBackfill('原真实日期已核对'); }); const records = readRefundRecords(); expect(records).toHaveLength(2); expect(records[0].body).toEqual(receive.body); expect(records[1].parentRequest?.body).toEqual(receive.body); expect(records[1].requestKey).toBe(records[0].requestKey); await act(async () => { await get().queryOriginal(); await get().requestBackfill('新原因不换申请'); }); expect(applications).toBe(1); expect(readRefundRecords()).toHaveLength(2); applicationFound = true; await act(async () => { await get().queryOriginal(); }); expect(get().application?.executed).toBe(false); expect(get().result).toBeNull(); expect(readRefundRecords()).toHaveLength(2); executed = true; await act(async () => { await get().queryOriginal(); }); expect(get().result).toEqual(received); expect(readRefundRecords()).toEqual([]); expect(applications).toBe(1); });
});
test.each(['applicationPending', 'groupClearFailure'])('原申请%s与cash ACK成功须保原operation+application完整组，重挂不POST', async (fault) => {
    const receive: RefundSpec = { ...spec, kind: 'receive', refundId: 61, path: '/supplier-refunds/61/receive', action: 'supplier.refund.receive.61', body: { operationUuid: spec.operationUuid } }, owner = captureRefundOwner();
    const original: RefundRecord = { ...receive, version: 1, userId: 9, baseURL: owner.baseURL, sessionGeneration: owner.sessionGeneration, epoch: owner.epoch, activeGeneration: 0, createdAt: 1, phase: 'pending', method: 'post', periodClosed: true };
    const app: RefundRecord = { ...original, kind: 'backfill', periodClosed: undefined, body: { ...receive.body, backfillRequest: true, backfillReason: '原真实日期已核对' }, parentRequest: { action: receive.action, requestKey: receive.requestKey, operationUuid: receive.operationUuid, body: receive.body } };
    saveRefundRecord(original);
    saveRefundRecord(app);
    const received = { id: 61, refundNo: 'RF61', status: 3, fundTransactionId: 81, amount: '0.0049', message: '回款已登记，凭证结果见详情' };
    client.defaults.adapter = async (c) => { calls.push(c); expect(c.method).toBe('get'); expect(c.params).toEqual({ action: receive.action, requestKey: receive.requestKey }); if (c.url === `/supplier-refunds/backfill-applications/${spec.operationUuid}`)
        return response(c, fault === 'applicationPending' ? { status: 'not_found' } : { id: 5, applicationId: 5, applicationNo: 'BF-5', backfillRequested: true, reused: true, status: 1, executed: true, rejected: false, period: '202610', businessDate: '2026-10-01' }); if (c.url === `/supplier-refunds/operations/${spec.operationUuid}`)
        return response(c, { status: 'success', resourceType: 'supplier_refund_order', resourceId: 61, data: received }); unknown.push(`${c.method} ${c.url}`); throw Error('unknown original identity'); };
    const set = Storage.prototype.setItem;
    if (fault === 'groupClearFailure')
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, k, v) { if (k === REFUND_STORAGE && v === '[]')
            throw Error('group clear failed'); set.call(this, k, v); });
    await probe(async (get) => { await act(async () => { await get().queryOriginal(); }); expect(readRefundRecords()).toHaveLength(2); expect(readRefundRecords().find(r => r.kind === 'receive')?.phase).toBe('confirmed'); expect(get().result).toBeNull(); });
    vi.restoreAllMocks();
    await probe(async (get) => { expect(get().blocked).toBe(true); await act(async () => { await get().submit(receive); await get().queryOriginal(); }); if (fault === 'applicationPending')
        expect(readRefundRecords()).toHaveLength(2);
    else
        expect(get().result).toEqual(received); });
    expect(calls.every(c => c.method === 'get')).toBe(true);
});

test.each(['newRequest','newAck','newSessionAndTime','sameRequestChangedBodySourceDate'])('等待真实invalidate后同coarse %s不能被旧finish清理或显示旧ACK',async fault=>{
 post=async()=>ack;await probe(async(get,_draw,qc)=>{
 let release!:()=>void;const wait=new Promise<void>(r=>{release=r});vi.spyOn(qc,'invalidateQueries').mockImplementation(({queryKey}={})=>queryKey?.[0]==='supplier-refunds'?wait:Promise.resolve());
 let pending!:Promise<unknown>;await act(async()=>{pending=get().submit(spec);await new Promise(r=>setTimeout(r,5))});const original=readRefundRecords()[0];expect(original.phase).toBe('confirmed');
 const replacement:RefundRecord=JSON.parse(canonicalRefund(fault==='newAck'?{...original,result:{...ack,id:62,refundNo:'RF62'}}:fault==='sameRequestChangedBodySourceDate'?{...original,refundDate:'2026-09-30',body:{...original.body,refundDate:'2026-09-30',remark:'新完整原体'},source:{...original.source,warehouseId:9},sourceFingerprint:'new-source-date'}:fault==='newSessionAndTime'?{...original,sessionGeneration:original.sessionGeneration+1,epoch:original.epoch+1,activeGeneration:original.activeGeneration+1,createdAt:original.createdAt+1}:{...original,operationUuid:'44444444-4444-4444-8444-444444444444',requestKey:'other-request',body:{...original.body,operationUuid:'44444444-4444-4444-8444-444444444444',remark:'另一请求完整体'},sourceFingerprint:'other-frozen-source',result:{...ack,id:62,refundNo:'RF62'}}));
 await act(async()=>{if(fault==='newAck')replaceRefundRecord(original,replacement);else{removeRefundRecords([original]);saveRefundRecord(replacement)}});const bytes=localStorage.getItem(REFUND_STORAGE);
 await act(async()=>{release();await pending});expect(localStorage.getItem(REFUND_STORAGE)).toBe(bytes);expect(get().blocked).toBe(true);expect(get().result).toBeNull();expect(calls.filter(c=>c.method==='post')).toHaveLength(1);expect(get().error).toContain('变化');
 })
})
test.each(['appSource','appParent','replaceGroup'])('原receive/app组%s必须完整父请求及等待前身份一致，换组保当前bytes零POST',async fault=>{
 const receive:RefundSpec={...spec,kind:'receive',refundId:61,path:'/supplier-refunds/61/receive',action:'supplier.refund.receive.61',body:{operationUuid:spec.operationUuid}},owner=captureRefundOwner();const received={id:61,refundNo:'RF61',status:3,fundTransactionId:81,amount:'0.0049',message:'回款已登记，凭证结果见详情'};const appAck={id:5,applicationId:5,applicationNo:'BF5',backfillRequested:true as const,reused:true,status:1,executed:true,rejected:false,period:'202610',businessDate:'2026-10-01'};
 const cash:RefundRecord={...receive,version:1,userId:9,baseURL:owner.baseURL,sessionGeneration:owner.sessionGeneration,epoch:owner.epoch,activeGeneration:0,createdAt:1,phase:'pending',method:'post',periodClosed:true};const parentBody=fault==='appParent'?{...receive.body,reason:'另一原回款'}:receive.body;
 const app:RefundRecord={...cash,kind:'backfill',phase:'confirmed',periodClosed:undefined,result:appAck,source:fault==='appSource'?{...cash.source,warehouseId:9}:cash.source,sourceFingerprint:fault==='appSource'?'other-source':cash.sourceFingerprint,body:{...parentBody,backfillRequest:true,backfillReason:'原日期已核对'},parentRequest:{action:receive.action,requestKey:receive.requestKey,operationUuid:receive.operationUuid,body:parentBody}};saveRefundRecord(cash);saveRefundRecord(app);
 client.defaults.adapter=async c=>{calls.push(c);expect(c.method).toBe('get');expect(c.params).toEqual({action:receive.action,requestKey:receive.requestKey});if(c.url===`/supplier-refunds/backfill-applications/${spec.operationUuid}`)return response(c,appAck);if(c.url===`/supplier-refunds/operations/${spec.operationUuid}`)return response(c,{status:'success',resourceType:'supplier_refund_order',resourceId:61,data:received});unknown.push(`${c.method} ${c.url}`);throw Error('unknown group identity endpoint')};
 await probe(async(get,_draw,qc)=>{
 let release!:()=>void;const wait=new Promise<void>(r=>{release=r});vi.spyOn(qc,'invalidateQueries').mockImplementation(({queryKey}={})=>fault==='replaceGroup'&&queryKey?.[0]==='supplier-refunds'?wait:Promise.resolve());let pending!:Promise<unknown>;
 await act(async()=>{pending=get().queryOriginal();await new Promise(r=>setTimeout(r,5))});expect(readRefundRecords().find(r=>r.kind==='receive')?.phase).toBe('confirmed');
 let bytes=localStorage.getItem(REFUND_STORAGE);if(fault==='replaceGroup'){await act(async()=>{const old=readRefundRecords();removeRefundRecords(old);const uuid='55555555-5555-4555-8555-555555555555',newBody={operationUuid:uuid,reason:'新原回款'};const next:RefundRecord={...old.find(r=>r.kind==='receive')!,operationUuid:uuid,requestKey:'new-cash-key',body:newBody,sourceFingerprint:'new-group-source',createdAt:2,result:{...received,fundTransactionId:82}};const nextApp:RefundRecord={...old.find(r=>r.kind==='backfill')!,operationUuid:uuid,requestKey:next.requestKey,body:{...newBody,backfillRequest:true,backfillReason:'新原申请已核对'},sourceFingerprint:next.sourceFingerprint,createdAt:2,parentRequest:{action:next.action,requestKey:next.requestKey,operationUuid:uuid,body:newBody},result:{...appAck,id:6,applicationId:6,applicationNo:'BF6'}};saveRefundRecord(next);saveRefundRecord(nextApp)});bytes=localStorage.getItem(REFUND_STORAGE);release()}
 await act(async()=>{await pending});expect(localStorage.getItem(REFUND_STORAGE)).toBe(bytes);expect(get().blocked).toBe(true);expect(get().result).toBeNull();expect(get().application).toBeNull();expect(calls.every(c=>c.method==='get')).toBe(true);expect(get().error).toContain('变化')
 })
})

test('actual单次CAS storage helper不会用旧完整snapshot清同coarse新confirmed',()=>{
 const owner=captureRefundOwner();const original:RefundRecord={...spec,version:1,userId:9,baseURL:owner.baseURL,sessionGeneration:owner.sessionGeneration,epoch:owner.epoch,activeGeneration:0,createdAt:1,phase:'confirmed',method:'post',result:ack};saveRefundRecord(original);removeRefundRecords([original]);const uuid='66666666-6666-4666-8666-666666666666';const next:RefundRecord={...original,operationUuid:uuid,requestKey:'new-original-key',body:{...original.body,operationUuid:uuid},result:{...ack,id:62,refundNo:'RF62'}};saveRefundRecord(next);const bytes=localStorage.getItem(REFUND_STORAGE);expect(()=>removeRefundRecords([original])).toThrow('禁止清理');expect(localStorage.getItem(REFUND_STORAGE)).toBe(bytes);expect(calls).toEqual([])
})

test.each(['applicationId','applicationNo'])('原app已confirmed的新ACK不得把%s变化当合法状态转移',async defect=>{
 const receive:RefundSpec={...spec,kind:'receive',refundId:61,path:'/supplier-refunds/61/receive',action:'supplier.refund.receive.61',body:{operationUuid:spec.operationUuid}},owner=captureRefundOwner();const oldAck={id:5,applicationId:5,applicationNo:'BF5',backfillRequested:true as const,reused:false,status:0,executed:false,rejected:false,period:'202610',businessDate:'2026-10-01'};const cash:RefundRecord={...receive,version:1,userId:9,baseURL:owner.baseURL,sessionGeneration:owner.sessionGeneration,epoch:owner.epoch,activeGeneration:0,createdAt:1,phase:'pending',method:'post',periodClosed:true};const app:RefundRecord={...cash,kind:'backfill',phase:'confirmed',periodClosed:undefined,result:oldAck,body:{...receive.body,backfillRequest:true,backfillReason:'原真实日期已核对'},parentRequest:{action:cash.action,requestKey:cash.requestKey,operationUuid:cash.operationUuid,body:cash.body}};saveRefundRecord(cash);saveRefundRecord(app);const bytes=localStorage.getItem(REFUND_STORAGE);const newAck={...oldAck,reused:true,status:1,executed:true,...(defect==='applicationId'?{id:6,applicationId:6}: {applicationNo:'BF-other'})};
 let applicationReads=0;client.defaults.adapter=async c=>{calls.push(c);expect(c.method).toBe('get');expect(c.params).toEqual({action:cash.action,requestKey:cash.requestKey});if(c.url===`/supplier-refunds/backfill-applications/${spec.operationUuid}`)return response(c,++applicationReads===1?oldAck:newAck);if(c.url===`/supplier-refunds/operations/${spec.operationUuid}`)return response(c,{status:'success',resourceType:'supplier_refund_order',resourceId:61,data:{id:61,refundNo:'RF61',status:3,fundTransactionId:81,amount:'0.0049',message:'回款已登记，凭证结果见详情'}});unknown.push(`${c.method} ${c.url}`);throw Error('unknown application permanent identity')};
 await probe(async get=>{await act(async()=>{await get().queryOriginal()});expect(get().application).toEqual(oldAck);expect(get().result).toBeNull();expect(localStorage.getItem(REFUND_STORAGE)).toBe(bytes);await act(async()=>{await get().queryOriginal()});expect(localStorage.getItem(REFUND_STORAGE)).toBe(bytes);expect(get().result).toBeNull();expect(get().application).toBeNull();expect(get().blocked).toBe(true);expect(get().error).toContain('变化');expect(calls).toHaveLength(2)})
})
