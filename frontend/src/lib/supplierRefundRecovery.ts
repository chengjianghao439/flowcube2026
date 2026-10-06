import type { RefundAck, RefundApplicationAck, RefundSpec } from '@/types/supplier-refund';
import { captureDisposalOwner, disposalOwnerCurrent, disposalConfig, disposalEpoch, subscribeDisposalRecovery } from './disposalRecovery';
import { useAuthStore } from '@/store/authStore';
import { useWorkspaceStore } from '@/store/workspaceStore';
import { hasPermission } from './permissions';
import { PERMISSIONS as P, type PermissionCode } from './permission-codes';
export { captureDisposalOwner as captureRefundOwner, disposalOwnerCurrent as refundOwnerCurrent, disposalConfig as refundConfig, disposalEpoch as refundEpoch };
export const REFUND_STORAGE = 'flowcube-supplier-refund-v1';
export interface RefundRecord extends RefundSpec {
    version: 1;
    userId: number;
    baseURL: string;
    sessionGeneration: number;
    epoch: number;
    activeGeneration: number;
    method: 'post';
    createdAt: number;
    phase: 'pending' | 'confirmed';
    result?: RefundAck | RefundApplicationAck;
    periodClosed?: boolean;
}
const listeners = new Set<() => void>();
let revision = 0;
const notify = () => { revision++; listeners.forEach(fn => fn()); };
subscribeDisposalRecovery(notify);
let activityEpoch = 0, lastActive = useWorkspaceStore.getState().activeKey;
useWorkspaceStore.subscribe(s => { if (s.activeKey !== lastActive) {
    lastActive = s.activeKey;
    activityEpoch++;
    notify();
} });
export const refundActivityEpoch = () => activityEpoch;
export const subscribeRefund = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
export const refundRevision = () => revision;
if (typeof window !== 'undefined')
    window.addEventListener('storage', e => { if (e.key === REFUND_STORAGE || e.key === null)
        notify(); });
export const refundId = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0;
export const refundUuid = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
export function canonicalRefund(value: unknown): string { function sort(v: unknown): unknown { if (Array.isArray(v))
    return v.map(sort); if (object(v))
    return Object.fromEntries(Object.keys(v).sort().map(k => [k, sort(v[k])])); return v; } return JSON.stringify(sort(JSON.parse(JSON.stringify(value)))); }
export function refundMoney(v: unknown): bigint | null { if (typeof v !== 'string' || !/^\d{1,10}\.\d{4}$/.test(v))
    return null; const [whole, fraction] = v.split('.'); return BigInt(whole) * 10000n + BigInt(fraction); }
export const positiveRefundMoney = (v: unknown) => { const n = refundMoney(v); return n !== null && n > 0n && n <= 99999999999999n; };
export function inputRefundMoney(v: string): string | null { const m = /^(\d{1,10})(?:\.(\d{1,4}))?$/.exec(v); if (!m)
    return null; const n = `${BigInt(m[1])}.${(m[2] || '').padEnd(4, '0')}`; return positiveRefundMoney(n) ? n : null; }
export const refundMoneyLabel = (v: unknown) => refundMoney(v) !== null ? `¥${v}` : '—';
const date = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v + 'T00:00:00Z')) && new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) === v;
export function mayRefund(...permissions: PermissionCode[]) { const s = useAuthStore.getState(); return !!s.token && permissions.every(p => hasPermission(s.user?.permissions, p, s.user?.roleId)); }
export const REFUND_READ_PERMISSIONS = [P.SUPPLIER_REFUND_VIEW, P.PURCHASE_ORDER_VIEW, P.RETURN_ORDER_VIEW, P.PAYMENT_VIEW] as const;
export const mayReadRefund = () => mayRefund(...REFUND_READ_PERMISSIONS);
function secretFree(v: unknown): boolean { if (Array.isArray(v))
    return v.every(secretFree); return !object(v) || Object.entries(v).every(([k, child]) => !/^(authorization|token|accessToken|refreshToken|password)$/i.test(k) && secretFree(child)); }
function keys(v: Record<string, unknown>, required: string[], optional: string[] = []) { return required.every(k => Object.hasOwn(v, k)) && Object.keys(v).every(k => required.includes(k) || optional.includes(k)); }
export function validRefundSpec(r: RefundSpec) {
    if (!refundUuid(r.operationUuid) || typeof r.requestKey !== 'string' || !r.requestKey || r.requestKey !== r.requestKey.trim() || r.requestKey.length > 64 || !r.draftIdentity || !date(r.refundDate) || !r.sourceFingerprint || !object(r.source) || !object(r.body) || !secretFree(r))
        return false;
    const s = r.source, b = r.body;
    if (![s.purchaseReturnId, s.purchaseOrderId, s.paymentRecordId, s.supplierId, s.warehouseId, s.incomeAccountId].every(refundId) || !positiveRefundMoney(s.amount) || b.operationUuid !== r.operationUuid)
        return false;
    if (r.kind === 'create')
        return r.refundId === undefined && r.parentRequest === undefined && r.action === 'supplier.refund.create' && r.path === '/supplier-refunds' && keys(b, ['operationUuid', 'purchaseReturnId', 'incomeAccountId', 'refundDate', 'amount', 'allocations'], ['remark']) && b.purchaseReturnId === s.purchaseReturnId && b.incomeAccountId === s.incomeAccountId && b.refundDate === r.refundDate && b.amount === s.amount && Array.isArray(b.allocations) && b.allocations.length > 0 && b.allocations.length <= 200 && b.allocations.every(a => object(a) && keys(a, ['entryId', 'amount']) && refundId(a.entryId) && positiveRefundMoney(a.amount)) && new Set(b.allocations.map(a => a.entryId)).size === b.allocations.length && b.allocations.reduce((sum, a) => sum + refundMoney(a.amount)!, 0n) === refundMoney(s.amount);
    if (!refundId(r.refundId) || r.action !== `supplier.refund.${r.kind === 'backfill' ? 'receive' : r.kind}.${r.refundId}` || r.path !== `/supplier-refunds/${r.refundId}/${r.kind === 'backfill' ? 'receive' : r.kind}`)
        return false;
    if (r.kind === 'backfill')
        return keys(b, ['operationUuid', 'backfillRequest', 'backfillReason'], ['reason']) && b.backfillRequest === true && typeof b.backfillReason === 'string' && b.backfillReason.trim().length >= 4 && b.backfillReason.trim().length <= 300 && !!r.parentRequest && r.parentRequest.action === r.action && r.parentRequest.requestKey === r.requestKey && r.parentRequest.operationUuid === r.operationUuid && canonicalRefund(r.parentRequest.body) === canonicalRefund(Object.fromEntries(Object.entries(b).filter(([k]) => !['backfillRequest', 'backfillReason'].includes(k))));
    return ['confirm', 'receive', 'cancel'].includes(r.kind) && r.parentRequest === undefined && keys(b, ['operationUuid'], ['reason']) && (b.reason === undefined || typeof b.reason === 'string' && !!b.reason.trim() && b.reason.length <= 500);
}
export function refundAckMatches(r: RefundSpec, v: unknown): v is RefundAck { if (!object(v) || !refundId(v.id) || !v.refundNo || typeof v.refundNo !== 'string')
    return false; const status = { create: 1, confirm: 2, receive: 3, cancel: 4, backfill: 3 }[r.kind]; if (v.status !== status || r.refundId !== undefined && v.id !== r.refundId)
    return false; return status === 3 ? keys(v, ['id', 'refundNo', 'status', 'fundTransactionId', 'amount', 'message']) && refundId(v.fundTransactionId) && v.amount === r.source.amount && v.message === '回款已登记，凭证结果见详情' : keys(v, ['id', 'refundNo', 'status']); }
export function refundApplicationMatches(r: RefundSpec, v: unknown): v is RefundApplicationAck { return object(v) && r.kind === 'backfill' && keys(v, ['id', 'applicationId', 'applicationNo', 'backfillRequested', 'reused', 'status', 'executed', 'rejected', 'period', 'businessDate']) && refundId(v.id) && v.applicationId === v.id && typeof v.applicationNo === 'string' && !!v.applicationNo && v.backfillRequested === true && typeof v.reused === 'boolean' && typeof v.status === 'number' && [0, 1, 2, 3, 4].includes(v.status) && typeof v.executed === 'boolean' && typeof v.rejected === 'boolean' && v.businessDate === r.refundDate && v.period === r.refundDate.replaceAll('-', '').slice(0, 6); }
export const refundRecordIdentity = (r: Pick<RefundRecord, 'userId' | 'baseURL' | 'draftIdentity' | 'kind'>) => canonicalRefund([r.userId, r.baseURL, r.draftIdentity, r.kind === 'backfill' ? 'application' : 'operation']);
const completeIdentity = (r: RefundRecord) => canonicalRefund({ ...r, phase: 'pending', result: undefined, periodClosed: undefined });
/** Request identity excludes only the three explicitly mutable recovery-state fields. */
export const refundRecordImmutableIdentity = completeIdentity;
function validRecord(v: unknown): v is RefundRecord { if (!object(v))
    return false; const r = v as unknown as RefundRecord; return r.version === 1 && refundId(r.userId) && !!r.baseURL && r.method === 'post' && [r.sessionGeneration, r.epoch, r.activeGeneration].every(n => Number.isSafeInteger(n) && n >= 0) && Number.isSafeInteger(r.createdAt) && r.createdAt > 0 && validRefundSpec(r) && ['pending', 'confirmed'].includes(r.phase) && (r.phase !== 'confirmed' || refundAckMatches(r, r.result) || refundApplicationMatches(r, r.result)); }
export function readRefundRecords(): RefundRecord[] { const raw = localStorage.getItem(REFUND_STORAGE); if (raw === null)
    return []; let data: unknown; try {
    data = JSON.parse(raw);
}
catch {
    throw Error('原退款请求记录损坏，请保留并人工核对');
} ; if (!Array.isArray(data) || data.length > 30 || data.some(r => !validRecord(r)) || new Set(data.map(refundRecordIdentity)).size !== data.length)
    throw Error('原退款完整身份不可核对，请保留并人工核对'); return data; }
function persist(records: RefundRecord[], stillCurrent?: () => boolean, expected?: string | null) { const text = canonicalRefund(records); if (text.length > 2000000)
    throw Error('原退款记录容量已满，禁止新请求'); const previous = localStorage.getItem(REFUND_STORAGE); if (expected !== undefined && previous !== expected)
    throw Error('原退款记录已变化，禁止覆盖清理'); try {
    localStorage.setItem(REFUND_STORAGE, text);
    if (localStorage.getItem(REFUND_STORAGE) !== text)
        throw Error('退款请求保存核对失败，禁止发送');
    if (stillCurrent && !stillCurrent())
        throw Error('原退款清理上下文已变化，保留已确认记录');
}
catch (e) {
    try {
        if (localStorage.getItem(REFUND_STORAGE) === text) {
            if (previous === null)
                localStorage.removeItem(REFUND_STORAGE);
            else
                localStorage.setItem(REFUND_STORAGE, previous);
        }
    }
    catch { /* Original bytes or storage fault remain blocked; never infer failure by time. */ }
    throw e;
} notify(); if (stillCurrent && !stillCurrent()) {
    if (localStorage.getItem(REFUND_STORAGE) === text && previous !== null)
        localStorage.setItem(REFUND_STORAGE, previous);
    throw Error('原退款清理上下文已变化，保留已确认记录');
} }
export function saveRefundRecord(r: RefundRecord) { if (!validRecord(r))
    throw Error('退款请求完整体不合法，禁止发送'); const raw = localStorage.getItem(REFUND_STORAGE), all = readRefundRecords(); if (all.length >= 30 || all.some(x => refundRecordIdentity(x) === refundRecordIdentity(r)))
    throw Error('已有原退款待核对或容量已满，禁止新请求'); persist([...all, r], undefined, raw); }
export function replaceRefundRecord(r: RefundRecord, next: RefundRecord) { const raw = localStorage.getItem(REFUND_STORAGE), all = readRefundRecords(), found = all.find(x => refundRecordIdentity(x) === refundRecordIdentity(r)); if (!found || canonicalRefund(found) !== canonicalRefund(r) || completeIdentity(next) !== completeIdentity(r) || !validRecord(next))
    throw Error('原退款记录已变化，请人工核对'); persist(all.map(x => x === found ? next : x), undefined, raw); }
export function confirmRefundRecord(r: RefundRecord, result: RefundAck | RefundApplicationAck) { replaceRefundRecord(r, { ...r, phase: 'confirmed', result }); }
export function removeRefundRecords(records: RefundRecord[], stillCurrent?: () => boolean) { const raw = localStorage.getItem(REFUND_STORAGE), all = readRefundRecords(); if (raw === null || !records.length || new Set(records.map(refundRecordIdentity)).size !== records.length)
    throw Error('原退款确认组不完整，禁止清理'); for (const r of records) {
    const found = all.find(x => refundRecordIdentity(x) === refundRecordIdentity(r));
    if (!found || found.phase !== 'confirmed' || canonicalRefund(found) !== canonicalRefund(r) || !validRecord(found))
        throw Error('原确认退款或补录仍待核对，禁止清理');
} if (stillCurrent && !stillCurrent())
    throw Error('原退款清理上下文已变化'); persist(all.filter(x => !records.some(r => refundRecordIdentity(r) === refundRecordIdentity(x))), stillCurrent, raw); }
export function removeRefundRecord(r: RefundRecord, stillCurrent?: () => boolean) { removeRefundRecords([r], stillCurrent); }
export function ownRefundRecords() { const owner = captureDisposalOwner(); try {
    return { records: readRefundRecords().filter(r => r.userId === owner.userId && r.baseURL === owner.baseURL), error: '' };
}
catch (e) {
    return { records: [] as RefundRecord[], error: e instanceof Error ? e.message : '原退款记录不可读取' };
} }
