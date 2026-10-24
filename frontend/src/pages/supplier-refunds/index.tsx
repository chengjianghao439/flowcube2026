import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import PageHeader from '@/components/shared/PageHeader';
import DataTable from '@/components/shared/DataTable';
import ListSummary from '@/components/shared/ListSummary';
import { QueryErrorState } from '@/components/shared/QueryErrorState';
import { SoftStatusLabel } from '@/components/shared/StatusBadge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { StatusTone } from '@/lib/statusTone';
import { useSupplierRefundRead, useRefundReadQuery } from '@/hooks/useSupplierRefundRead';
import { useApprovalDetailHandoff } from '@/hooks/useApprovalDetailHandoff';
import { useOwnRefundRecords } from '@/hooks/useSupplierRefundOperation';
import { listAllSupplierRefundsApi, supplierRefundDetailApi } from '@/api/supplier-refunds';
import { refundCashLabel, mayReadRefund } from '@/lib/supplierRefundRecovery';
import { SUPPLIER_REFUND_STATUS_NAME } from '@/generated/status';
import { PERMISSIONS as P } from '@/lib/permission-codes';
import type { SupplierRefund } from '@/types/supplier-refund';
import type { TableColumn } from '@/types';
import RefundDetailDialog from './RefundDetailDialog';
import { RefundRecoveryEntry } from './RefundRecoveryPage';
export { default as SupplierRefundCreatePage } from './CreateRefundPage';
export default function SupplierRefundPage() {
    const scope = useSupplierRefundRead(), navigate = useNavigate(), [selected, setSelected] = useState<number | null>(null), own = useOwnRefundRecords();
    const readable = scope.current();
    // 连续列表独立消费取消信号，详情仍沿原读取合同。
    const listQuery = useQuery({ queryKey: ['supplier-refunds', ...scope.key, 'all'], queryFn: ({ signal }) => listAllSupplierRefundsApi({ ...scope.config, signal }, scope.current), enabled: readable, subscribed: readable, staleTime: 0, gcTime: 0, refetchOnMount: 'always', retry: false });
    const ready = readable && !listQuery.isFetching && !listQuery.isPaused && !listQuery.isError;
    const list = { ...listQuery, data: ready ? listQuery.data : undefined, ready: ready && listQuery.data !== undefined, retry: () => { if (readable) void listQuery.refetch(); } };
    const read = async (id: number) => { if (!scope.current())
        throw Error('原详情读取已暂停'); const r = await supplierRefundDetailApi(id, scope.config); if (!scope.current() || r.id !== id)
        throw Error('原退款详情身份已变化'); return r; };
    const handoff = useApprovalDetailHandoff('/supplier-refunds', P.SUPPLIER_REFUND_VIEW, read, selected !== null || !mayReadRefund());
    const detail = useRefundReadQuery<SupplierRefund>('supplier-refund-detail', selected, scope, () => read(selected!), selected !== null);
    const selectedTrigger = useRef<HTMLButtonElement | null>(null);
    const closeManual = () => {
        if (!scope.current()) return;
        const trigger = selectedTrigger.current;
        setSelected(null);
        // 加载占位与详情是独立 Dialog，保留最初的列表回焦归属。
        window.setTimeout(() => {
            if (scope.current() && trigger?.isConnected && !trigger.disabled && document.activeElement === document.body)
                trigger.focus({ preventScroll: true });
        }, 0);
    };
    const retained = useRef<SupplierRefund | null>(null);
    if (detail.data && scope.current())
        retained.current = detail.data;
    const manual = selected !== null && retained.current?.id === selected ? retained.current : null;
    const rows = list.data?.list || [], total = list.data?.pagination.total || 0;
    const columns: TableColumn<SupplierRefund>[] = [
      { key: 'refund_no', title: '退款单号', width: 260, render: (_, r) => <Button variant="link" className="h-auto whitespace-normal px-0 text-left text-doc-code" disabled={!scope.current() || !list.ready} onClick={event => { if (scope.current()) { selectedTrigger.current = event.currentTarget; setSelected(r.id); } }}>{r.refund_no}</Button> },
      { key: 'supplier_name', title: '供应商 / 仓库', width: 240, render: (_, r) => <div className="space-y-1"><p>{r.supplier_name || '原单未记录供应商名称'}</p><p className="text-xs text-muted-foreground">{r.warehouse_name || `原仓库 #${r.warehouse_id}`}</p></div> },
      { key: 'purchase_return_no', title: '关联原单', width: 200, render: (_, r) => <div className="space-y-1 text-xs"><p>采购退货 <span className="text-doc-code">{r.purchase_return_no || `#${r.purchase_return_id}`}</span></p><p className="text-muted-foreground">采购 <span className="text-doc-code">{r.purchase_order_no || `#${r.purchase_order_id}`}</span></p></div> },
      { key: 'amount', title: '退款金额', width: 130, align: 'right', render: v => <span className="tabular-nums">{refundCashLabel(v)}</span> },
      { key: 'refund_date', title: '真实银行回款日', width: 150 },
      { key: 'status', title: '业务阶段', width: 100, render: (_, r) => <SoftStatusLabel label={SUPPLIER_REFUND_STATUS_NAME[r.status] || '状态待核对'} tone={({ 1: 'draft', 2: 'active', 3: 'success', 4: 'danger' } as Record<number, StatusTone>)[r.status] || 'warning'} /> },
    ];
    return <div className="space-y-4">
      <PageHeader title="供应商退款"
        description="确认冻结退款单后，另行登记银行实际回款；退款与实物退货分别处理。"  actions={<><Button variant="outline" disabled={!scope.current() || list.isFetching} onClick={list.retry}>刷新</Button><Button disabled={!scope.current()} onClick={() => { if (scope.current()) navigate('/returns/purchase'); }}>选择采购退货来源</Button></>} />

      {scope.error && <p role="alert" className="text-sm text-warning-ink">{scope.error}</p>}
      <RefundRecoveryEntry />
      {own.error && <p role="alert" className="text-sm text-destructive-ink">{own.error}</p>}
      {list.isError ? <QueryErrorState compact error={list.error} title="供应商退款加载失败" onRetry={list.retry} /> : <DataTable virtualized preserveFocus retainFocusedRow={selected !== null} columns={columns} data={rows} rowKey="id" loading={list.isFetching} emptyText="当前范围没有供应商退款单" />}
      {list.ready && (list.data?.truncated ? <p role="status" className="px-1 py-3 text-xs text-warning-ink">已加载 {rows.length.toLocaleString()} 单，匹配 {total.toLocaleString()} 单，请缩小查询范围。</p> : <ListSummary total={total} unit="单" />)}
      {handoff.message && <p role="status" className="text-sm text-muted-foreground">{handoff.message}{handoff.canRetry && <Button variant="outline" onClick={handoff.retry}>重读原单</Button>}</p>}
      {handoff.open && handoff.data && <RefundDetailDialog row={handoff.data} ready={handoff.ready && scope.current()} onClose={handoff.close} />}
      {manual && <RefundDetailDialog row={manual} ready={detail.ready} error={detail.isError ? detail.error : undefined} onRetry={detail.retry} onClose={closeManual} />}
      {selected !== null && !manual && <Dialog open={scope.active} onOpenChange={open => { if (!open) closeManual(); }}><DialogContent><DialogHeader description={"核对原供应商退款单的当前状态。"}><DialogTitle>供应商退款详情</DialogTitle></DialogHeader>{detail.isError ? <QueryErrorState compact error={detail.error} title="原退款详情加载失败" onRetry={detail.retry} /> : <p role="status" className="text-sm text-muted-foreground">正在核对原退款单…</p>}</DialogContent></Dialog>}
    </div>;

}
