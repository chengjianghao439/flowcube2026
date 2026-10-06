import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import PageHeader from '@/components/shared/PageHeader';
import DataTable from '@/components/shared/DataTable';
import { useSupplierRefundRead, useRefundReadQuery } from '@/hooks/useSupplierRefundRead';
import { useApprovalDetailHandoff } from '@/hooks/useApprovalDetailHandoff';
import { useOwnRefundRecords } from '@/hooks/useSupplierRefundOperation';
import { listSupplierRefundsApi, supplierRefundDetailApi } from '@/api/supplier-refunds';
import { refundMoneyLabel, mayReadRefund } from '@/lib/supplierRefundRecovery';
import { SUPPLIER_REFUND_STATUS_NAME } from '@/generated/status';
import { PERMISSIONS as P } from '@/lib/permission-codes';
import type { SupplierRefund } from '@/types/supplier-refund';
import type { TableColumn } from '@/types';
import RefundDetailDialog from './RefundDetailDialog';
import { RefundRecoveryEntry } from './RefundRecoveryPage';
export { default as SupplierRefundCreatePage } from './CreateRefundPage';
export default function SupplierRefundPage() {
    const scope = useSupplierRefundRead(), navigate = useNavigate(), [page, setPage] = useState(1), [selected, setSelected] = useState<number | null>(null), own = useOwnRefundRecords();
    const list = useRefundReadQuery('supplier-refunds', page, scope, () => listSupplierRefundsApi({ page, pageSize: 20 }, scope.config));
    const read = async (id: number) => { if (!scope.current())
        throw Error('原详情读取已暂停'); const r = await supplierRefundDetailApi(id, scope.config); if (!scope.current() || r.id !== id)
        throw Error('原退款详情身份已变化'); return r; };
    const handoff = useApprovalDetailHandoff('/supplier-refunds', P.SUPPLIER_REFUND_VIEW, read, selected !== null || !mayReadRefund());
    const detail = useRefundReadQuery<SupplierRefund>('supplier-refund-detail', selected, scope, () => read(selected!), selected !== null);
    const retained = useRef<SupplierRefund | null>(null);
    if (detail.data && scope.current())
        retained.current = detail.data;
    const manual = selected !== null && retained.current?.id === selected ? retained.current : null;
    const rows = list.data?.list || [], total = list.data?.total || 0, last = Math.max(1, Math.ceil(total / 20));
    const columns: TableColumn<SupplierRefund>[] = [{ key: 'refund_no', title: '退款单号', render: (_, r) => <Button variant="link" disabled={!scope.current() || !list.ready} onClick={() => { if (scope.current())
                setSelected(r.id); }}>{r.refund_no}</Button> }, { key: 'purchase_return_id', title: '原采购退货', render: v => `#${v}` }, { key: 'amount', title: '退款金额', align: 'right', render: v => refundMoneyLabel(v) }, { key: 'refund_date', title: '真实银行回款日' }, { key: 'status', title: '状态', render: (_, r) => SUPPLIER_REFUND_STATUS_NAME[r.status] || '状态待核对' }];
    return <div className="space-y-4"><PageHeader title="供应商退款" description="从准确采购退货草稿发起退款，确认冻结后另行登记实际已收到。"/>{scope.error && <p role="alert">{scope.error}</p>}<div className="flex gap-2"><Button variant="outline" disabled={!scope.current()} onClick={() => { if (scope.current())
        navigate('/returns/purchase'); }}>查看采购退货来源</Button><RefundRecoveryEntry /></div>{own.error && <p role="alert">{own.error}</p>}{list.isError && <p role="alert">退款列表读取失败。<Button onClick={list.retry}>重新读取</Button></p>}<DataTable columns={columns} data={rows} rowKey="id" loading={list.isFetching} emptyText="当前范围没有供应商退款单"/>
 <nav aria-label="供应商退款分页"><Button disabled={page <= 1 || !list.ready} onClick={() => setPage(n => n - 1)}>上一页</Button><span>第 {page} / {last} 页，共 {total} 单</span><Button disabled={page >= last || !list.ready} onClick={() => setPage(n => n + 1)}>下一页</Button></nav>{handoff.message && <p role="status">{handoff.message}{handoff.canRetry && <Button onClick={handoff.retry}>重读原单</Button>}</p>}
 {handoff.open && handoff.data && <RefundDetailDialog row={handoff.data} ready={handoff.ready && scope.current()} onClose={handoff.close}/>}{manual && <RefundDetailDialog row={manual} ready={detail.ready} onClose={() => { if (scope.current())
        setSelected(null); }}/>}{selected !== null && detail.isError && <p role="alert">原退款详情读取失败。<Button onClick={detail.retry}>重读原退款</Button></p>}</div>;
}
