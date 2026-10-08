import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import DataTable from '@/components/shared/DataTable';
import { SoftStatusLabel } from '@/components/shared/StatusBadge';
import { QueryErrorState } from '@/components/shared/QueryErrorState';
import type { StatusTone } from '@/lib/statusTone';
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
        setOpen(v); }}><DialogContent><DialogHeader><DialogTitle>{label} {row.refund_no}</DialogTitle></DialogHeader><DialogDescription>{kind === 'confirm' ? '确认只冻结退款单与原付款分配，不登记收款，不动实物库存。' : kind === 'receive' ? `请确认银行款项实际已收到。按原单真实回款日 ${row.refund_date} 与收入账户登记 ${refundMoneyLabel(row.amount)}；原日期不能改为今天。业务保存与凭证核对分别显示。` : '仅草稿或待收退款可以取消并释放额度；已收到资金不能撤销。'}</DialogDescription><Input aria-label={`${label}说明`} disabled={write.busy || write.blocked} value={reason} maxLength={500} onChange={e => { if (scope.current())
        setReason(e.target.value); }}/><Button disabled={!allowed() || write.busy || write.blocked} onClick={() => void submit()}>{kind === 'receive' ? '确认实际已收到' : kind === 'confirm' ? '确认冻结退款' : '确认取消退款'}</Button>{(write.pending || write.error) && <RefundRecoveryPanel write={write}/>}</DialogContent></Dialog>
 {!open && (write.pending || write.error) && <RefundRecoveryPanel write={write}/>} {write.result && <p role="status">{kind === 'receive' ? '原回款已登记；凭证状态请重新读取合法详情核对' : kind === 'confirm' ? '原退款单已确认，尚未收款' : '原退款单已取消'}</p>}</section>;
}
export default function RefundDetailDialog({ row, ready, error, onRetry, onClose }: {
    row: SupplierRefund;
    ready: boolean;
    error?: unknown;
    onRetry?: () => void;
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
    return <Dialog open={scope.active} onOpenChange={v => { if (!v && scope.current()) onClose(); }}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader><DialogTitle>供应商退款 <span className="text-doc-code">{row.refund_no}</span></DialogTitle></DialogHeader>
        {error ? <QueryErrorState compact error={error} title="原退款详情核对失败" description="已有输入保留，写动作暂停。" onRetry={() => onRetry?.()} /> : !ready && <p role="status" className="text-sm text-muted-foreground">详情重新核对中，已有输入保留，写动作暂停。</p>}
        {scope.error && <p role="alert" className="text-sm text-warning-ink">{scope.error}</p>}
        <div className="flex flex-wrap items-center justify-between gap-3"><SoftStatusLabel label={status || '状态待核对'} tone={({ 1: 'draft', 2: 'active', 3: 'success', 4: 'danger' } as Record<number, StatusTone>)[row.status] || 'warning'} /><p className="text-sm">退款金额 <span className="ml-2 text-lg font-semibold tabular-nums">{refundMoneyLabel(row.amount)}</span></p></div>
        <dl className="grid gap-x-6 gap-y-3 border-y border-border py-4 text-sm sm:grid-cols-2">
          <div><dt className="text-xs text-muted-foreground">供应商</dt><dd className="mt-1 break-words">{row.supplier_name || '原单未记录供应商名称'}</dd></div>
          <div><dt className="text-xs text-muted-foreground">仓库</dt><dd className="mt-1">{row.warehouse_name || `原仓库 #${row.warehouse_id}`}</dd></div>
          <div><dt className="text-xs text-muted-foreground">原采购退货</dt><dd className="mt-1 text-doc-code">{row.purchase_return_no || `#${row.purchase_return_id}`}</dd></div>
          <div><dt className="text-xs text-muted-foreground">原采购</dt><dd className="mt-1 text-doc-code">{row.purchase_order_no || `#${row.purchase_order_id}`}</dd></div>
          <div><dt className="text-xs text-muted-foreground">真实银行回款日</dt><dd className="mt-1">{row.refund_date}</dd></div>
          <div><dt className="text-xs text-muted-foreground">收入账户</dt><dd className="mt-1">原账户 #{row.income_account_id}</dd></div>
          {row.remark && <div className="sm:col-span-2"><dt className="text-xs text-muted-foreground">退款事由</dt><dd className="mt-1 break-words whitespace-pre-wrap">{row.remark}</dd></div>}
        </dl>
        <section aria-label="原付款分配" className="space-y-2"><h2 className="text-sm font-semibold">原付款分配</h2><DataTable data={row.allocations || []} rowKey="entry_id" columns={[
          { key: 'entry_id', title: '准确原分配', width: 140 },
          { key: 'receipt_id', title: '原收付款来源', render: v => v === null ? '原独立付款' : `原收付款单 #${v}` },
          { key: 'amount', title: '退款金额', align: 'right', width: 150, render: v => <span className="tabular-nums">{refundMoneyLabel(v)}</span> },
        ]} /></section>
        <DialogDescription className="text-sm leading-6 text-muted-foreground">退款与实物退货独立：此处不出库、不回冲退货数量，不登记负付款。</DialogDescription>
        <div className="flex flex-wrap gap-2">{(['confirm', 'receive', 'cancel'] as const).map(kind => <RefundAction key={kind} kind={kind} row={row} scope={scope} ready={ready} />)}</div>
        {row.status === 3 && <section className="space-y-2 border-t border-border pt-4 text-sm"><p>实际回款事实已保存，资金流水 #{row.fund_transaction_id}。</p><p className="leading-6 text-muted-foreground">{Number.isSafeInteger(row.voucher_id) && Number(row.voucher_id) > 0 && !row.voucher_generate_error ? '凭证已生成' : row.voucher_generate_error === '零分投影已核对/无需凭证' ? '零分投影已核对/无需分位凭证' : '回款已登记，凭证待核对'}。资金金额保留四位，分位凭证及舍入差另在会计勾稽中核对。</p>{mayRefund(P.ACCOUNTING_VOUCHER_MANAGE) && <Button variant="outline" disabled={!ready || busy || !scope.current()} onClick={() => void regenerate()}>核对退款凭证</Button>}{voucher && <p role="status">{voucher}</p>}</section>}
      </DialogContent>
    </Dialog>;
}
