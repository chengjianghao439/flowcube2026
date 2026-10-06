import { useContext, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { TabPathContext } from '@/components/layout/TabPathContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import PageHeader from '@/components/shared/PageHeader';
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
        await write.submit({ kind: 'create', draftIdentity: identity, operationUuid, requestKey, path: '/supplier-refunds', action: 'supplier.refund.create', refundDate: date, sourceFingerprint: canonicalRefund(s), source: { purchaseReturnId: s.purchaseReturnId, purchaseOrderId: s.purchaseOrderId, paymentRecordId: s.paymentRecordId, supplierId: s.supplierId, warehouseId: s.warehouseId, incomeAccountId: Number(account), amount }, body: { operationUuid, purchaseReturnId: s.purchaseReturnId, incomeAccountId: Number(account), refundDate: date, amount, allocations: canonical.sort((a, b) => a.entryId - b.entryId), remark } });
    }
    function openCreated() { const ack = write.result; if (!ack || !write.canApply(ack) || !scope.current())
        return; const registration = buildWorkspaceTabRegistrationFromPath(`/supplier-refunds?detailId=${ack.id}`), store = useWorkspaceStore.getState(); if (!store.tabs.some(t => t.key === registration.key) && store.tabs.length >= MAX_WORKSPACE_TABS) {
        setError('工作区标签已满，已创建记录保留');
        return;
    } if (store.addTab({ ...registration, title: '供应商退款' }))
        navigate(registration.path); }
    return <div className="space-y-4"><PageHeader title="供应商退款" description="退款草稿来自准确采购退货，确认仅冻结退款；实际收款另行登记。"/>{scope.error && <p role="alert">{scope.error}</p>}{!accountRight && <p role="alert">选择收入账户需要账户查看权限，请联系管理人员核对授权。</p>}{(source.isError || accounts.isError) && <p role="alert">准确来源或收入账户读取失败，原输入保留。<Button onClick={() => { source.retry(); accounts.retry(); }}>重新核对</Button></p>}
 {source.data && <section aria-label="准确退款来源"><p>原采购退货 {source.data.returnNo} · 原采购 {source.data.orderNo}</p><p>退货原价总额 {refundMoneyLabel(source.data.grossAmount)} · 本退货剩余额度 {refundMoneyLabel(source.data.availableAmount)} · 当前净已付 {refundMoneyLabel(source.data.currentPaidAmount)}</p><p>这三项是不同口径，最终可退款由系统逐笔核对。无原单、手工应付、预付无分配或历史身份不完整请人工核对。</p><table><thead><tr><th>商品编码</th><th>商品名称与规格</th><th>基本量</th><th>原成交单价</th></tr></thead><tbody>{source.data.items.map(i => <tr key={i.id}><td>{source.data?.itemLabels?.find(l => l.id === i.id)?.productCode || '历史编码未记录'}</td><td>{source.data?.itemLabels?.find(l => l.id === i.id)?.productName || '历史商品名称未记录，请人工核对'} <small>（原退货行 {i.id} / 原采购行 {i.purchaseItemId}）</small></td><td>{i.quantity} {i.unit}</td><td>{refundMoneyLabel(i.unitPrice)}</td></tr>)}</tbody></table></section>}
 <fieldset disabled={!ready || write.busy} className="space-y-3"><label>真实银行回款日<Input type="date" aria-label="真实银行回款日" value={date} onChange={e => { if (scope.current())
        setDate(e.target.value); }}/></label><label>收入账户<select aria-label="收入账户" value={account} onChange={e => { if (scope.current())
        setAccount(e.target.value); }}><option value="">请选择收入账户</option>{accounts.data?.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
 <section aria-label="准确原付款分配"><p>请选择精确原付款分配与退款金额（四位），不新增负付款。</p>{source.data?.entries.map(e => <label key={e.entryId} className="block">原分配 {e.entryId} · {e.receipt?.receiptNo || `原付款 ${e.out.bizNo}`} · 原日期 {e.paymentDate} · 原本金 {refundMoneyLabel(e.originalAmount)} · 剩余 {refundMoneyLabel(e.availableAmount)}<Input aria-label={`原付款分配${e.entryId}退款金额`} inputMode="decimal" value={amounts[e.entryId] || ''} onChange={event => { if (scope.current())
        setAmounts(a => ({ ...a, [e.entryId]: event.target.value })); }}/></label>)}</section><p>本次退款合计 {refundMoneyLabel(amount)}</p><label>退款事由<Input aria-label="退款事由" value={remark} maxLength={500} onChange={e => { if (scope.current())
        setRemark(e.target.value); }}/></label><Button disabled={!ready || write.busy} onClick={() => void save()}>保存退款草稿</Button></fieldset>{error && <p role="alert">{error}</p>}
 <RefundRecoveryPanel write={write}/>{write.result && <section><p>退款单 {write.result.refundNo} 已创建，尚未实际收款。</p><Button onClick={openCreated}>查看已创建退款单</Button></section>}</div>;
}
export default function SupplierRefundCreatePage() {
    const tab = useContext(TabPathContext), location = useLocation(), path = tab || location.pathname + location.search, params = new URLSearchParams(path.split('?')[1] || ''), values = params.getAll('purchaseReturnId');
    const id = values.length === 1 && /^[1-9]\d*$/.test(values[0]) && Number.isSafeInteger(Number(values[0])) ? Number(values[0]) : null;
    if (path.split('?')[0] !== '/supplier-refunds/new' || !id)
        return <p role="alert">退款来源定位无效或缺少完整原单查看权限，请从准确采购退货草稿打开；原输入保留。</p>;
    return <CreateRefundDraft key={buildWorkspaceTabRegistrationFromPath(path).key} purchaseReturnId={id} identity={buildWorkspaceTabRegistrationFromPath(path).key}/>;
}
