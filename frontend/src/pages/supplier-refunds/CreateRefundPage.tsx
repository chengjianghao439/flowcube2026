import { useContext, useId, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { TabPathContext } from '@/components/layout/TabPathContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import PageHeader from '@/components/shared/PageHeader';
import DataTable from '@/components/shared/DataTable';
import { Label } from '@/components/ui/label';
import { QueryErrorState } from '@/components/shared/QueryErrorState';
import type { SupplierRefundSource } from '@/types/supplier-refund';
import { supplierRefundSourceApi } from '@/api/supplier-refunds';
import { getActiveAccountsApi } from '@/api/finance';
import { useSupplierRefundRead, useRefundReadQuery } from '@/hooks/useSupplierRefundRead';
import { useSupplierRefundOperation } from '@/hooks/useSupplierRefundOperation';
import { canonicalRefund, inputRefundMoney, refundMoney, refundMoneyLabel, mayRefund } from '@/lib/supplierRefundRecovery';
import { PERMISSIONS as P } from '@/lib/permission-codes';
import { createRequestKey } from '@/lib/requestKey';
import { buildWorkspaceTabRegistrationFromPath } from '@/router/workspaceRouteMeta';
import { MAX_WORKSPACE_TABS, useWorkspaceStore } from '@/store/workspaceStore';
import { RefundRecoveryPanel } from './RecoveryPanel';
function CreateRefundDraft({ purchaseReturnId, identity }: {
    purchaseReturnId: number;
    identity: string;
}) {
    const fieldId = useId();
    const [submitted, setSubmitted] = useState<{ source: SupplierRefundSource; amount: string } | null>(null);
    const scope = useSupplierRefundRead(), navigate = useNavigate(), [operationUuid] = useState(() => crypto.randomUUID()), [requestKey] = useState(() => createRequestKey('supplier-refund'));
    const write = useSupplierRefundOperation(identity, scope.active, () => scope.current() && mayRefund(P.SUPPLIER_REFUND_CREATE, P.FINANCE_ACCOUNT_VIEW));
    const [date, setDate] = useState(''), [account, setAccount] = useState(''), [remark, setRemark] = useState(''), [amounts, setAmounts] = useState<Record<number, string>>({}), [error, setError] = useState('');
    const source = useRefundReadQuery('supplier-refund-source', purchaseReturnId, scope, async () => { const r = await supplierRefundSourceApi(purchaseReturnId, scope.config); if (r.purchaseReturnId !== purchaseReturnId)
        throw Error('原采购退货身份不一致'); return r; }, !write.pending && !write.blocked);
    const accountRight = mayRefund(P.FINANCE_ACCOUNT_VIEW);
    const accounts = useRefundReadQuery('supplier-refund-accounts', 'active', scope, () => getActiveAccountsApi(scope.config), accountRight && !write.pending && !write.blocked);
    const canonical = source.data?.entries.flatMap(e => { const amount = inputRefundMoney(amounts[e.entryId] || ''); return amount ? [{ entryId: e.entryId, amount }] : []; }) || [];
    const sum = canonical.reduce((n, a) => n + refundMoney(a.amount)!, 0n), amount = `${sum / 10000n}.${String(sum % 10000n).padStart(4, '0')}`;
    const ready = source.ready && accounts.ready && scope.current() && !write.blocked && mayRefund(P.SUPPLIER_REFUND_CREATE, P.FINANCE_ACCOUNT_VIEW);
    async function save() {
        if (!ready || !source.data)
            return;
        const s = source.data;
        if (!date || !accounts.data?.some(a => a.id === Number(account)) || !sum || Object.entries(amounts).some(([, v]) => v !== '' && !inputRefundMoney(v)) || sum > refundMoney(s.availableAmount)! || sum > refundMoney(s.currentPaidAmount)! || canonical.some(a => refundMoney(a.amount)! > refundMoney(s.entries.find(e => e.entryId === a.entryId)!.availableAmount)!)) {
            setError('请填写真实日期、收入账户与准确四位分配，不能超过各自剩余额度和当前已付金额');
            return;
        }
        setError('');
        setSubmitted({ source: s, amount });
        await write.submit({ kind: 'create', draftIdentity: identity, operationUuid, requestKey, path: '/supplier-refunds', action: 'supplier.refund.create', refundDate: date, sourceFingerprint: canonicalRefund(s), source: { purchaseReturnId: s.purchaseReturnId, purchaseOrderId: s.purchaseOrderId, paymentRecordId: s.paymentRecordId, supplierId: s.supplierId, warehouseId: s.warehouseId, incomeAccountId: Number(account), amount }, body: { operationUuid, purchaseReturnId: s.purchaseReturnId, incomeAccountId: Number(account), refundDate: date, amount, allocations: canonical.sort((a, b) => a.entryId - b.entryId), remark } });
    }
    function openCreated() { const ack = write.result; if (!ack || !write.canApply(ack) || !scope.current())
        return; const registration = buildWorkspaceTabRegistrationFromPath(`/supplier-refunds?detailId=${ack.id}`), store = useWorkspaceStore.getState(); if (!store.tabs.some(t => t.key === registration.key) && store.tabs.length >= MAX_WORKSPACE_TABS) {
        setError('工作区标签已满，已创建记录保留');
        return;
    } if (store.addTab({ ...registration, title: '供应商退款' }))
        navigate(registration.path); }
    const frozenDisplay = submitted && (write.pending || write.result || write.blocked) && scope.current();
    const displaySource = source.data || (frozenDisplay ? submitted.source : undefined);
    const displayAmount = frozenDisplay ? submitted.amount : amount;
    return <div className="space-y-4">
      <PageHeader title="供应商退款" description="退款草稿来自准确采购退货，确认仅冻结退款；实际收款另行登记。" />
      {scope.error && <p role="alert" className="text-sm text-destructive-ink">{scope.error}</p>}
      {!accountRight && <p role="alert" className="text-sm text-warning-ink">选择收入账户需要账户查看权限，请联系管理人员核对授权。</p>}
      {(source.isError || accounts.isError) && <QueryErrorState compact error={source.error || accounts.error} title="退款来源核对失败" description="准确来源或收入账户读取失败，原输入保留，写动作暂停。" onRetry={() => { source.retry(); accounts.retry(); }} />}
      {displaySource && <section aria-label="准确退款来源" className="space-y-3">
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 text-sm">
          <p>原采购退货 <span className="text-doc-code">{displaySource.returnNo}</span></p>
          <p>原采购 <span className="text-doc-code">{displaySource.orderNo}</span></p>
        </div>
        <dl className="grid grid-cols-1 gap-4 rounded-lg border border-border bg-card p-4 sm:grid-cols-3">
          <div><dt className="text-xs text-muted-foreground">退货原价总额</dt><dd className="mt-1 text-base font-semibold tabular-nums">{refundMoneyLabel(displaySource.grossAmount)}</dd></div>
          <div><dt className="text-xs text-muted-foreground">本退货剩余额度</dt><dd className="mt-1 text-base font-semibold tabular-nums">{refundMoneyLabel(displaySource.availableAmount)}</dd></div>
          <div><dt className="text-xs text-muted-foreground">当前净已付</dt><dd className="mt-1 text-base font-semibold tabular-nums">{refundMoneyLabel(displaySource.currentPaidAmount)}</dd></div>
        </dl>
        <p className="text-sm leading-6 text-muted-foreground">这三项是不同口径，最终可退款由系统逐笔核对。无原单、手工应付、预付无分配或历史身份不完整请人工核对。</p>
        <DataTable data={displaySource.items} rowKey="id" columns={[
          { key: 'productId', title: '商品编码', width: 160, render: (_, item) => displaySource?.itemLabels?.find(l => l.id === item.id)?.productCode || '历史编码未记录' },
          { key: 'id', title: '商品名称与规格', render: (_, item) => { const label = displaySource?.itemLabels?.find(l => l.id === item.id); return <div className="space-y-1"><p>{label?.productName || '历史商品名称未记录，请人工核对'}</p>{(label?.articleNumber || label?.spec || label?.color) && <p className="text-xs text-muted-foreground">{[label.articleNumber && `供应商型号 ${label.articleNumber}`, label.spec && `型号 ${label.spec}`, label.color && `颜色 ${label.color}`].filter(Boolean).join(' · ')}</p>}<p className="text-xs text-muted-foreground">原退货行 {item.id} / 原采购行 {item.purchaseItemId}</p></div> } },
          { key: 'quantity', title: '基本量', width: 120, align: 'right', render: (_, item) => <span className="tabular-nums">{item.quantity} {item.unit}</span> },
          { key: 'unitPrice', title: '原成交单价', width: 140, align: 'right', render: value => <span className="tabular-nums">{refundMoneyLabel(value)}</span> },
        ]} />
      </section>}
      <fieldset disabled={!ready || write.busy} className="space-y-4 rounded-lg border border-border bg-card p-4">
        <div className="grid max-w-3xl gap-4 sm:grid-cols-2">
          <div className="space-y-1.5"><Label htmlFor={`${fieldId}-date`}>真实银行回款日 *</Label><Input id={`${fieldId}-date`} type="date" aria-label="真实银行回款日" value={date} onChange={e => { if (scope.current()) setDate(e.target.value); }} /></div>
          <div className="space-y-1.5"><Label htmlFor={`${fieldId}-account`}>收入账户 *</Label><select id={`${fieldId}-account`} aria-label="收入账户" className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50" value={account} onChange={e => { if (scope.current()) setAccount(e.target.value); }}><option value="">请选择收入账户</option>{accounts.data?.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></div>
        </div>
        <section aria-label="准确原付款分配" className="space-y-3">
          <h2 className="text-sm font-semibold">原付款分配</h2>
          <p className="text-sm text-muted-foreground">逐笔填写退款金额（最多四位小数），不新增负付款。</p>
          {displaySource?.entries.map(e => <div key={e.entryId} className="grid gap-3 border-t border-border pt-3 sm:grid-cols-[minmax(0,1fr)_14rem]">
            <div className="space-y-1 text-sm"><p><span className="font-medium">{e.receipt?.receiptNo || e.out.bizNo}</span> · 原分配 {e.entryId}</p><p className="text-xs text-muted-foreground">原日期 {e.paymentDate} · 原本金 {refundMoneyLabel(e.originalAmount)} · 剩余 {refundMoneyLabel(e.availableAmount)}</p></div>
            <div className="space-y-1.5"><Label htmlFor={`${fieldId}-allocation-${e.entryId}`}>本笔退款金额</Label><Input id={`${fieldId}-allocation-${e.entryId}`} aria-label={`原付款分配${e.entryId}退款金额`} className="text-right tabular-nums" inputMode="decimal" value={amounts[e.entryId] || ''} onChange={event => { if (scope.current()) setAmounts(a => ({ ...a, [e.entryId]: event.target.value })); }} /></div>
          </div>)}
        </section>
        <div className="max-w-3xl space-y-1.5"><Label htmlFor={`${fieldId}-remark`}>退款事由</Label><Input id={`${fieldId}-remark`} aria-label="退款事由" value={remark} maxLength={500} onChange={e => { if (scope.current()) setRemark(e.target.value); }} /></div>
        {error && <p role="alert" className="text-sm text-destructive-ink">{error}</p>}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4"><p className="text-sm">{frozenDisplay ? '原请求退款合计' : '本次退款合计'} <span className="ml-2 text-base font-semibold tabular-nums">{refundMoneyLabel(displayAmount)}</span></p><Button disabled={!ready || write.busy} onClick={() => void save()}>{write.busy ? '保存中…' : '保存退款草稿'}</Button></div>
      </fieldset>
      <RefundRecoveryPanel write={write} />
      {write.result && <section className="space-y-2"><p role="status">退款单 {write.result.refundNo} 已创建，尚未实际收款。</p><Button onClick={openCreated}>查看已创建退款单</Button></section>}
    </div>;

}
export default function SupplierRefundCreatePage() {
    const tab = useContext(TabPathContext), location = useLocation(), path = tab || location.pathname + location.search, params = new URLSearchParams(path.split('?')[1] || ''), values = params.getAll('purchaseReturnId');
    const id = values.length === 1 && /^[1-9]\d*$/.test(values[0]) && Number.isSafeInteger(Number(values[0])) ? Number(values[0]) : null;
    if (path.split('?')[0] !== '/supplier-refunds/new' || !id)
        return <p role="alert">退款来源定位无效或缺少完整原单查看权限，请从准确采购退货草稿打开；原输入保留。</p>;
    return <CreateRefundDraft key={buildWorkspaceTabRegistrationFromPath(path).key} purchaseReturnId={id} identity={buildWorkspaceTabRegistrationFromPath(path).key}/>;
}
