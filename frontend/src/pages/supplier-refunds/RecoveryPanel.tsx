import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useSupplierRefundOperation } from '@/hooks/useSupplierRefundOperation';
import { mayRefund, mayReadRefund } from '@/lib/supplierRefundRecovery';
import { PERMISSIONS as P } from '@/lib/permission-codes';
export function RefundRecoveryPanel({ write }: {
    write: ReturnType<typeof useSupplierRefundOperation>;
}) {
    const [reason, setReason] = useState('');
    return <section aria-label="原退款请求恢复" className="space-y-2 rounded-md border p-3"><p>结果不明时保留完整原请求与日期，只查询本人原结果；不会自动重发。</p>{write.error && <p role="alert">{write.error}</p>}{write.pending && <Button variant="outline" disabled={write.busy} onClick={() => void write.queryOriginal()}>查询原结果</Button>}
 {write.periodClosed && mayReadRefund() && mayRefund(P.SUPPLIER_REFUND_RECEIVE, P.FINANCE_PERIOD_BACKFILL) && <div className="space-y-2"><p>真实回款期间已结账。补录保留原日期，由其他人批准后登记资金，凭证落在准确批准日所属期间。</p><Input aria-label="跨期补录申请原因" value={reason} onChange={e => setReason(e.target.value)}/><Button disabled={write.busy || reason.trim().length < 4 || reason.trim().length > 300} onClick={() => void write.requestBackfill(reason)}>申请跨期补录</Button></div>}
 {write.application && <p>原申请 {write.application.applicationNo}：{write.application.executed ? '已执行，请核对原回款与凭证' : write.application.rejected ? '已驳回，保留原申请核对' : '等待他人审批，尚未登记收到退款'}</p>}</section>;
}
