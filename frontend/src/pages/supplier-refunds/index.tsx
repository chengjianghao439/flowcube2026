import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import PageHeader from '@/components/shared/PageHeader';
import DataTable from '@/components/shared/DataTable';
import { QueryErrorState } from '@/components/shared/QueryErrorState';
import { SoftStatusLabel } from '@/components/shared/StatusBadge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { StatusTone } from '@/lib/statusTone';
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
    const columns: TableColumn<SupplierRefund>[] = [
      { key: 'refund_no', title: '退款单号', width: 260, render: (_, r) => <Button variant="link" className="h-auto whitespace-normal px-0 text-left text-doc-code" disabled={!scope.current() || !list.ready} onClick={() => { if (scope.current()) setSelected(r.id); }}>{r.refund_no}</Button> },
      { key: 'supplier_name', title: '供应商 / 仓库', width: 240, render: (_, r) => <div className="space-y-1"><p>{r.supplier_name || '原单未记录供应商名称'}</p><p className="text-xs text-muted-foreground">{r.warehouse_name || `原仓库 #${r.warehouse_id}`}</p></div> },
      { key: 'purchase_return_no', title: '关联原单', width: 200, render: (_, r) => <div className="space-y-1 text-xs"><p>采购退货 <span className="text-doc-code">{r.purchase_return_no || `#${r.purchase_return_id}`}</span></p><p className="text-muted-foreground">采购 <span className="text-doc-code">{r.purchase_order_no || `#${r.purchase_order_id}`}</span></p></div> },
      { key: 'amount', title: '退款金额', width: 130, align: 'right', render: v => <span className="tabular-nums">{refundMoneyLabel(v)}</span> },
      { key: 'refund_date', title: '真实银行回款日', width: 150 },
      { key: 'status', title: '业务阶段', width: 100, render: (_, r) => <SoftStatusLabel label={SUPPLIER_REFUND_STATUS_NAME[r.status] || '状态待核对'} tone={({ 1: 'draft', 2: 'active', 3: 'success', 4: 'danger' } as Record<number, StatusTone>)[r.status] || 'warning'} /> },
    ];
    return <div className="space-y-4">
      <PageHeader title="供应商退款" description="确认冻结退款单后，另行登记银行实际回款；退款与实物退货分别处理。" actions={<><Button variant="outline" disabled={!scope.current() || list.isFetching} onClick={list.retry}>刷新</Button><Button disabled={!scope.current()} onClick={() => { if (scope.current()) navigate('/returns/purchase'); }}>选择采购退货来源</Button></>} />
      {scope.error && <p role="alert" className="text-sm text-warning-ink">{scope.error}</p>}
      <RefundRecoveryEntry />
      {own.error && <p role="alert" className="text-sm text-destructive-ink">{own.error}</p>}
      {list.isError ? <QueryErrorState compact error={list.error} title="供应商退款加载失败" onRetry={list.retry} /> : <DataTable columns={columns} data={rows} rowKey="id" loading={list.isFetching} emptyText="当前范围没有供应商退款单" />}
      {list.ready && <nav aria-label="供应商退款分页" className="flex flex-wrap items-center justify-between gap-3 px-1 text-xs text-muted-foreground"><span>共 {total.toLocaleString()} 单 · 第 {page} / {last} 页</span><div className="flex gap-2"><Button size="sm" variant="outline" disabled={page <= 1 || !list.ready} onClick={() => setPage(n => n - 1)}>上一页</Button><Button size="sm" variant="outline" disabled={page >= last || !list.ready} onClick={() => setPage(n => n + 1)}>下一页</Button></div></nav>}
      {handoff.message && <p role="status" className="text-sm text-muted-foreground">{handoff.message}{handoff.canRetry && <Button variant="outline" onClick={handoff.retry}>重读原单</Button>}</p>}
      {handoff.open && handoff.data && <RefundDetailDialog row={handoff.data} ready={handoff.ready && scope.current()} onClose={handoff.close} />}
      {manual && <RefundDetailDialog row={manual} ready={detail.ready} error={detail.isError ? detail.error : undefined} onRetry={detail.retry} onClose={() => { if (scope.current()) setSelected(null); }} />}
      {selected !== null && !manual && <Dialog open={scope.active} onOpenChange={open => { if (!open && scope.current()) setSelected(null); }}><DialogContent><DialogHeader><DialogTitle>供应商退款详情</DialogTitle></DialogHeader>{detail.isError ? <QueryErrorState compact error={detail.error} title="原退款详情加载失败" onRetry={detail.retry} /> : <p role="status" className="text-sm text-muted-foreground">正在核对原退款单…</p>}</DialogContent></Dialog>}
    </div>;

}
