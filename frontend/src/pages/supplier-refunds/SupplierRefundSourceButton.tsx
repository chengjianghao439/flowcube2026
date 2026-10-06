import { useNavigate } from 'react-router-dom';
import { useSupplierRefundRead } from '@/hooks/useSupplierRefundRead';
import { Button } from '@/components/ui/button';
import { mayReadRefund, mayRefund, refundId } from '@/lib/supplierRefundRecovery';
import { PERMISSIONS as P } from '@/lib/permission-codes';
import { buildWorkspaceTabRegistrationFromPath } from '@/router/workspaceRouteMeta';
import { MAX_WORKSPACE_TABS, useWorkspaceStore } from '@/store/workspaceStore';
export function SupplierRefundSourceButton({ purchaseReturnId, disabled = false }: {
    purchaseReturnId: number;
    disabled?: boolean;
}) { const navigate = useNavigate(), scope = useSupplierRefundRead(); if (!mayReadRefund() || !mayRefund(P.SUPPLIER_REFUND_CREATE))
    return null; function open() { if (!scope.current() || disabled || !refundId(purchaseReturnId) || !mayReadRefund() || !mayRefund(P.SUPPLIER_REFUND_CREATE))
    return; const registration = buildWorkspaceTabRegistrationFromPath(`/supplier-refunds/new?purchaseReturnId=${purchaseReturnId}`), store = useWorkspaceStore.getState(); const existing = store.tabs.find(t => t.key === registration.key); if (existing) {
    store.setActive(existing.key);
    navigate(existing.path);
    return;
} if (store.tabs.length >= MAX_WORKSPACE_TABS)
    return; if (store.addTab({ ...registration, title: '供应商退款' }))
    navigate(registration.path); } return <Button variant="outline" disabled={disabled || !scope.current()} onClick={open}>发起供应商退款</Button>; }
