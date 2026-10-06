import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { postSupplierRefundApi, ownSupplierRefundApi, ownRefundApplicationApi } from '@/api/supplier-refunds';
import type { RefundAck, RefundApplicationAck, RefundSpec } from '@/types/supplier-refund';
import { captureRefundOwner, refundOwnerCurrent, refundConfig, refundEpoch, refundActivityEpoch, refundRevision, subscribeRefund, canonicalRefund, ownRefundRecords, readRefundRecords, saveRefundRecord, replaceRefundRecord, confirmRefundRecord, removeRefundRecords, refundRecordIdentity, refundRecordImmutableIdentity, refundAckMatches, refundApplicationMatches, type RefundRecord } from '@/lib/supplierRefundRecovery';
const running = new Set<string>();
export function useOwnRefundRecords() { useSyncExternalStore(subscribeRefund, refundRevision); return ownRefundRecords(); }
/** Complete immutable POST snapshot; only an explicit own-result GET resolves uncertainty. */
export function useSupplierRefundOperation(draftIdentity: string, active: boolean, mayWrite: () => boolean) {
    useSyncExternalStore(subscribeRefund, refundRevision);
    const [owner] = useState(captureRefundOwner), qc = useQueryClient(), mounted = useRef(true);
    const latest = useRef({ draftIdentity, active, generation: 0, mayWrite });
    if (latest.current.draftIdentity !== draftIdentity || latest.current.active !== active)
        latest.current.generation++;
    Object.assign(latest.current, { draftIdentity, active, mayWrite });
    const generation = latest.current.generation, activity = refundActivityEpoch();
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
    const [busy, setBusy] = useState(false), [feedback, setFeedback] = useState<{
        text: string;
        epoch: number;
    } | null>(null), [, draw] = useState(0);
    const answer = useRef<{
        ack: RefundAck;
        epoch: number;
    } | null>(null), application = useRef<{
        ack: RefundApplicationAck;
        epoch: number;
    } | null>(null), completed = useRef(false);
    const current = (o = captureRefundOwner()) => mounted.current && latest.current.active && latest.current.draftIdentity === draftIdentity && latest.current.generation === generation && refundActivityEpoch() === activity && refundOwnerCurrent(o);
    const writeCurrent = () => current(owner) && latest.current.mayWrite();
    const originals = (o = captureRefundOwner()) => readRefundRecords().filter(r => r.draftIdentity === draftIdentity && r.userId === o.userId && r.baseURL === o.baseURL);
    const state = ownRefundRecords(), runKey = canonicalRefund([owner.userId, owner.baseURL, draftIdentity]);
    const error = (o: ReturnType<typeof captureRefundOwner>, text: string) => { if (current(o))
        setFeedback({ text, epoch: o.epoch }); };
    async function finish(record: RefundRecord, ack: RefundAck, o: ReturnType<typeof captureRefundOwner>, originalApps: RefundRecord[] = []) {
        // This caller's receipt and members stay fixed across every refresh await.
        const frozen: RefundRecord[] = JSON.parse(canonicalRefund([{ ...record, phase: 'confirmed', result: ack }, ...originalApps]));
        const cash = frozen[0], cashAck = cash.result as RefundAck;
        try {
            if (!current(o)) return null;
            if (!refundAckMatches(record, cashAck) || record.phase === 'confirmed' && canonicalRefund(record.result) !== canonicalRefund(cashAck))
                throw Error('原确认结果已变化，请人工核对');
            if (record.phase !== 'confirmed') confirmRefundRecord(record, cashAck);
            if (!current(o)) return null;
            function checkedOriginalGroup() {
                for (const app of frozen.slice(1)) {
                    const parent = app.parentRequest;
                    if (cash.kind !== 'receive' || app.kind !== 'backfill' || app.userId !== cash.userId || app.baseURL !== cash.baseURL || app.draftIdentity !== cash.draftIdentity
                        || app.refundId !== cash.refundId || app.path !== cash.path || app.action !== cash.action || app.operationUuid !== cash.operationUuid || app.requestKey !== cash.requestKey
                        || app.refundDate !== cash.refundDate || app.sourceFingerprint !== cash.sourceFingerprint || canonicalRefund(app.source) !== canonicalRefund(cash.source)
                        || !parent || parent.action !== cash.action || parent.operationUuid !== cash.operationUuid || parent.requestKey !== cash.requestKey || canonicalRefund(parent.body) !== canonicalRefund(cash.body))
                        throw Error('原补录申请完整身份或来源已变化，完整请求组保留');
                    if (app.phase !== 'confirmed' || !refundApplicationMatches(app, app.result))
                        throw Error('原补录申请仍待核对；原回款已成功，完整请求组保留');
                }
                const all = originals(o);
                if (all.length !== frozen.length) throw Error('原确认请求组已变化，完整请求保留');
                return frozen.map(expected => {
                    const saved = all.find(r => refundRecordIdentity(r) === refundRecordIdentity(expected));
                    if (!saved || saved.phase !== 'confirmed' || refundRecordImmutableIdentity(saved) !== refundRecordImmutableIdentity(expected)
                        || canonicalRefund(saved.result) !== canonicalRefund(expected.result)
                        || !(expected.kind === 'backfill' ? refundApplicationMatches(expected, saved.result) : refundAckMatches(expected, saved.result)))
                        throw Error('原确认完整身份或结果已变化，请人工核对');
                    return saved;
                });
            }
            checkedOriginalGroup();
            // Keep the durable confirmed body/key if refresh fails or this activity loses ownership.
            let refreshFailed = false;
            for (const queryKey of [['supplier-refunds'], ['supplier-refund-detail'], ['returns'], ['payments'], ['approval-pending'], ['dash-pending-approvals'], ['acct-backfills']]) {
                if (!current(o)) return null;
                try { await qc.invalidateQueries({ queryKey }); } catch { refreshFailed = true; }
                if (!current(o)) return null;
            }
            if (refreshFailed) throw Error('原动作已成功，列表刷新失败；完整记录已保留，请主动核对原结果');
            if (!current(o)) return null;
            removeRefundRecords(checkedOriginalGroup(), () => current(o));
            if (!current(o)) return null;
            completed.current = true;
            answer.current = { ack: cashAck, epoch: o.epoch };
            error(o, '原结果已确认，禁止重复提交');
            return cashAck;
        } catch (e) {
            if (current(o)) { answer.current = null; application.current = null; }
            throw e;
        }
    }
    async function acceptApplication(record: RefundRecord, ack: RefundApplicationAck, o: ReturnType<typeof captureRefundOwner>) {
        if (!current(o))
            return null;
        if (record.phase === 'confirmed') {
            const previous = record.result;
            if (!refundApplicationMatches(record, previous) || (['id', 'applicationId', 'applicationNo', 'businessDate', 'period'] as const).some(key => previous[key] !== ack[key]))
                throw Error('原补录申请永久结果身份已变化，请人工核对');
        }
        if (record.phase !== 'confirmed' || canonicalRefund(record.result) !== canonicalRefund(ack))
            confirmRefundRecord(record, ack);
        if (!current(o))
            return null;
        application.current = { ack, epoch: o.epoch };
        await qc.invalidateQueries({ queryKey: ['acct-backfills'] });
        if (!current(o))
            return null;
        error(o, ack.executed ? '原补录已执行，请查询原回款结果核对；凭证结果另见详情' : ack.rejected ? '原补录已驳回，请保留原申请并核对' : '原补录申请已保存，等待其他人审批；尚未登记收到退款');
        return ack;
    }
    async function guarded(o: ReturnType<typeof captureRefundOwner>, run: () => Promise<RefundAck | RefundApplicationAck | null>) { if (running.has(runKey))
        return null; running.add(runKey); if (current(o))
        setBusy(true); try {
        return await run();
    }
    catch (e) {
        if (current(o)) { answer.current = null; application.current = null; }
        error(o, e instanceof Error ? e.message : '原退款结果待核对');
        return null;
    }
    finally {
        running.delete(runKey);
        if (mounted.current) {
            setBusy(false);
            draw(n => n + 1);
        }
    } }
    const makeRecord = (spec: RefundSpec, o: ReturnType<typeof captureRefundOwner>): RefundRecord => JSON.parse(canonicalRefund({ ...spec, version: 1, userId: o.userId, baseURL: o.baseURL, sessionGeneration: o.sessionGeneration, epoch: o.epoch, activeGeneration: generation, method: 'post', createdAt: Date.now(), phase: 'pending' }));
    async function send(record: RefundRecord, o: ReturnType<typeof captureRefundOwner>) {
        try {
            const ack = await postSupplierRefundApi(record.path, record.body, record.requestKey, refundConfig(o));
            if (!current(o))
                return null;
            if (record.kind === 'backfill' || refundApplicationMatches({ ...record, kind: 'backfill' }, ack)) {
                if (!refundApplicationMatches(record, ack))
                    throw Error('原补录申请身份不一致，请人工核对');
                return acceptApplication(record, ack, o);
            }
            if (!refundAckMatches(record, ack))
                throw Error('成功结果身份不一致，原请求已保留');
            return finish(record, ack, o);
        }
        catch (e) {
            if (current(o) && record.kind === 'receive' && typeof e === 'object' && e !== null && 'code' in e && e.code === 'FINANCE_PERIOD_CLOSED') {
                replaceRefundRecord(record, { ...record, periodClosed: true });
                throw Error('真实回款期间已结账，原日期与请求已保留；可申请跨期补录');
            }
            throw e;
        }
    }
    async function submit(spec: RefundSpec) { return guarded(owner, async () => { if (!writeCurrent() || spec.draftIdentity !== draftIdentity || originals(owner).length || completed.current)
        return null; const record = makeRecord(spec, owner); saveRefundRecord(record); if (!writeCurrent())
        return null; return send(record, owner); }); }
    async function requestBackfill(reason: string) { return guarded(owner, async () => { if (!writeCurrent())
        return null; const original = originals(owner).find(r => r.kind === 'receive' && r.phase === 'pending' && r.periodClosed); if (!original || originals(owner).some(r => r.kind === 'backfill'))
        return null; const app = makeRecord({ ...original, kind: 'backfill', body: { ...original.body, backfillRequest: true, backfillReason: reason.trim() }, parentRequest: { action: original.action, operationUuid: original.operationUuid, requestKey: original.requestKey, body: original.body } }, owner); saveRefundRecord(app); if (!writeCurrent())
        return null; return send(app, owner); }); }
    async function queryOriginal() {
        const o = captureRefundOwner();
        return guarded(o, async () => {
            if (!current(o))
                return null;
            const records = originals(o), original = records.find(r => r.kind !== 'backfill'), app = records.find(r => r.kind === 'backfill');
            let originalApps: RefundRecord[] = app ? [JSON.parse(canonicalRefund(app))] : [];
            if (!original)
                return null;
            if (app) {
                const result = await ownRefundApplicationApi(app.operationUuid, { action: app.action, requestKey: app.requestKey }, refundConfig(o));
                if (!current(o))
                    return null;
                if ('backfillRequested' in result) {
                    if (!refundApplicationMatches(app, result))
                        throw Error('原补录申请身份不一致');
                    await acceptApplication(app, result, o);
                    originalApps = [JSON.parse(canonicalRefund({ ...app, phase: 'confirmed', result }))];
                    if (!current(o) || !result.executed)
                        return null;
                }
                else if (result.status !== 'not_found')
                    throw Error('原补录申请结果不明确');
                else originalApps = [{ ...originalApps[0], phase: 'pending' }];
            }
            if (original.phase === 'confirmed')
                return finish(original, original.result as RefundAck, o, originalApps);
            const receipt = await ownSupplierRefundApi(original.operationUuid, { action: original.action, requestKey: original.requestKey }, refundConfig(o));
            if (!current(o))
                return null;
            if (receipt.status !== 'success') {
                if (!['pending', 'not_found'].includes(receipt.status))
                    throw Error('原结果状态不明确');
                error(o, receipt.status === 'pending' ? '原请求仍在处理，请稍后主动查询' : '暂未找到原结果；完整请求已保留，请人工核对，不会自动重发');
                return null;
            }
            if (receipt.resourceType !== 'supplier_refund_order' || receipt.resourceId !== receipt.data?.id || !refundAckMatches(original, receipt.data))
                throw Error('原结果资源或身份不一致，请人工核对');
            return finish(original, receipt.data, o, originalApps);
        });
    }
    return { submit, queryOriginal, requestBackfill, busy,
        result: current() && answer.current?.epoch === refundEpoch() ? answer.current.ack : null,
        application: current() && application.current?.epoch === refundEpoch() ? application.current.ack : null,
        error: state.error || (current() && feedback?.epoch === refundEpoch() ? feedback.text : ''),
        pending: state.records.some(r => r.draftIdentity === draftIdentity),
        periodClosed: state.records.some(r => r.draftIdentity === draftIdentity && r.periodClosed && !state.records.some(a => a.draftIdentity === draftIdentity && a.kind === 'backfill')),
        get blocked() { try {
            return !!state.error || completed.current || running.has(runKey) || originals(owner).length > 0 || !refundOwnerCurrent(owner);
        }
        catch {
            return true;
        } },
        canApply: (ack: RefundAck) => current() && answer.current?.ack === ack && answer.current.epoch === refundEpoch(),
    };
}
