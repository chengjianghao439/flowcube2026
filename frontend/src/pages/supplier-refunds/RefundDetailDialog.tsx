import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useSupplierRefundOperation } from '@/hooks/useSupplierRefundOperation';
import { useSupplierRefundRead } from '@/hooks/useSupplierRefundRead';
import { mayRefund, refundMoneyLabel } from '@/lib/supplierRefundRecovery';
import { PERMISSIONS as P } from '@/lib/permission-codes';
import { SUPPLIER_REFUND_ACTION_RULES, SUPPLIER_REFUND_STATUS_NAME } from '@/generated/status';
import type { SupplierRefund } from '@/types/supplier-refund';
import { createRequestKey } from '@/lib/requestKey';
import { regenerateRefundApi } from '@/api/supplier-refunds';
import { RefundRecoveryPanel } from './RecoveryPanel';
function RefundAction({ kind, row, scope, ready }: {
    kind: 'confirm' | 'receive' | 'cancel';
    row: SupplierRefund;
    scope: ReturnType<typeof useSupplierRefundRead>;
    ready: boolean;
}) {
    const [open, setOpen] = useState(false), [reason, setReason] = useState(''), [operationUuid] = useState(() => crypto.randomUUID()), [requestKey] = useState(() => createRequestKey('supplier-' + kind));
    const right = kind === 'confirm' ? P.SUPPLIER_REFUND_CONFIRM : kind === 'receive' ? P.SUPPLIER_REFUND_RECEIVE : P.SUPPLIER_REFUND_CREATE;
    const allowed = () => scope.current() && ready && mayRefund(right) && SUPPLIER_REFUND_ACTION_RULES[kind].from.some(s => s === row.status) && (kind !== 'confirm' || row.confirmAllowed === true);
    const write = useSupplierRefundOperation(`supplier-refund:${row.id}:${kind}`, scope.active, allowed);
    const label = kind === 'confirm' ? '确认退款单' : kind === 'receive' ? '登记实际已收到' : '取消退款单';
    async function submit() { if (!allowed())
        return; await write.submit({ kind, draftIdentity: `supplier-refund:${row.id}:${kind}`, refundId: row.id, path: `/supplier-refunds/${row.id}/${kind}`, action: `supplier.refund.${kind}.${row.id}`, operationUuid, requestKey, refundDate: row.refund_date, sourceFingerprint: row.source_fingerprint, source: { purchaseReturnId: row.purchase_return_id, purchaseOrderId: row.purchase_order_id, paymentRecordId: row.payment_record_id, supplierId: row.supplier_id, warehouseId: row.warehouse_id, incomeAccountId: row.income_account_id, amount: row.amount }, body: { operationUuid, ...(reason.trim() ? { reason: reason.trim() } : {}) } }); }
    return <section>{allowed() && <Button variant="outline" disabled={write.busy || write.blocked} onClick={() => { if (allowed())
        setOpen(true); }}>{label}</Button>}
 <Dialog open={open && scope.active} onOpenChange={v => { if (scope.current())
        setOpen(v); }}><DialogContent><DialogHeader><DialogTitle>{label} {row.refund_no}</DialogTitle></DialogHeader><p>{kind === 'confirm' ? '确认只冻结退款单与原付款分配，不登记收款，不动实物库存。' : kind === 'receive' ? `请确认银行款项实际已收到。按原单真实回款日 ${row.refund_date} 与收入账户登记 ${refundMoneyLabel(row.amount)}；原日期不能改为今天。业务保存与凭证核对分别显示。` : '仅草稿或待收退款可以取消并释放额度；已收到资金不能撤销。'}</p><Input aria-label={`${label}说明`} value={reason} maxLength={500} onChange={e => { if (scope.current())
        setReason(e.target.value); }}/><Button disabled={!allowed() || write.busy || write.blocked} onClick={() => void submit()}>{kind === 'receive' ? '确认实际已收到' : kind === 'confirm' ? '确认冻结退款' : '确认取消退款'}</Button>{(write.pending || write.error) && <RefundRecoveryPanel write={write}/>}</DialogContent></Dialog>
 {!open && (write.pending || write.error) && <RefundRecoveryPanel write={write}/>} {write.result && <p role="status">{kind === 'receive' ? '原回款已登记；凭证状态请重新读取合法详情核对' : kind === 'confirm' ? '原退款单已确认，尚未收款' : '原退款单已取消'}</p>}</section>;
}
export default function RefundDetailDialog({ row, ready, onClose }: {
    row: SupplierRefund;
    ready: boolean;
    onClose: () => void;
}) {
    const scope = useSupplierRefundRead(), [busy, setBusy] = useState(false), [voucher, setVoucher] = useState('');
    async function regenerate() { if (!scope.current() || !ready || row.status !== 3 || !mayRefund(P.ACCOUNTING_VOUCHER_MANAGE) || busy)
        return; setBusy(true); try {
        const result = await regenerateRefundApi(row.id, scope.config);
        if (!scope.current())
            return;
        setVoucher(result.status === 'generated' ? '凭证已生成' : result.status === 'notRequired' ? '零分投影已核对/无需分位凭证' : '回款已登记，凭证仍待核对');
    }
    catch (e) {
        if (scope.current())
            setVoucher(e instanceof Error ? e.message : '凭证待核对');
    }
    finally {
        if (scope.current())
            setBusy(false);
    } }
    const status = SUPPLIER_REFUND_STATUS_NAME[row.status];
    return <Dialog open={scope.active} onOpenChange={v => { if (!v && scope.current())
        onClose(); }}><DialogContent className="sm:max-w-3xl"><DialogHeader><DialogTitle>供应商退款 {row.refund_no}</DialogTitle></DialogHeader>{!ready && <p role="alert">详情重新核对中，已有输入保留，写动作暂停。</p>}{scope.error && <p role="alert">{scope.error}</p>}<p>状态 {status || '状态待核对'} · 金额 {refundMoneyLabel(row.amount)} · 真实银行回款日 {row.refund_date}</p><p>原采购退货 #{row.purchase_return_id} · 原采购 #{row.purchase_order_id} · 收入账户 #{row.income_account_id}</p><p>退款与实物退货独立：此处不出库、不回冲退货数量，不登记负付款。</p><ul>{row.allocations?.map(a => <li key={a.entry_id}>准确原分配 {a.entry_id} · {a.receipt_id === null ? '原独立付款' : `原收付款单 ${a.receipt_id}`} · {refundMoneyLabel(a.amount)}</li>)}</ul>
 <div className="flex flex-wrap gap-2">{(['confirm', 'receive', 'cancel'] as const).map(kind => <RefundAction key={kind} kind={kind} row={row} scope={scope} ready={ready}/>)}</div>
 {row.status === 3 && <section><p>实际回款事实已保存，资金流水 #{row.fund_transaction_id}。</p><p>{Number.isSafeInteger(row.voucher_id) && Number(row.voucher_id) > 0 && !row.voucher_generate_error ? '凭证已生成' : row.voucher_generate_error === '零分投影已核对/无需凭证' ? '零分投影已核对/无需分位凭证' : '回款已登记，凭证待核对'}。资金金额保留四位，分位凭证及舍入差另在会计勾稽中核对。</p>{mayRefund(P.ACCOUNTING_VOUCHER_MANAGE) && <Button variant="outline" disabled={!ready || busy || !scope.current()} onClick={() => void regenerate()}>核对退款凭证</Button>}{voucher && <p role="status">{voucher}</p>}</section>}
 </DialogContent></Dialog>;
}
