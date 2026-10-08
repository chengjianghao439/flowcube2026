export interface RefundSourceIdentity {
    purchaseReturnId: number;
    purchaseOrderId: number;
    paymentRecordId: number;
    supplierId: number;
    warehouseId: number;
    incomeAccountId: number;
    amount: string;
}
export interface SupplierRefundSource {
    purchaseReturnId: number;
    returnNo: string;
    purchaseOrderId: number;
    orderNo: string;
    supplierId: number;
    warehouseId: number;
    grossAmount: string;
    availableAmount: string;
    paymentRecordId: number;
    currentPaidAmount: string;
    itemLabels?: {
        id: number;
        productCode: string | null;
        productName: string | null;
        articleNumber: string | null;
        spec: string | null;
        color: string | null;
    }[];
    items: {
        id: number;
        purchaseItemId: number;
        productId: number;
        unit: string;
        quantity: string;
        unitPrice: string;
    }[];
    entries: {
        entryId: number;
        recordId: number;
        originalAmount: string;
        availableAmount: string;
        receiptId: number | null;
        paymentDate: string;
        receipt: {
            id: number;
            receiptNo: string;
            amount: string;
            paymentDate: string;
        } | null;
        out: {
            id: number;
            bizNo: string;
            amount: string;
        };
    }[];
}
export interface SupplierRefund {
    id: number;
    refund_no: string;
    purchase_return_id: number;
    purchase_order_id: number;
    /** Original document display snapshots; never inferred from current master data. */
    purchase_return_no?: string;
    purchase_order_no?: string;
    supplier_name?: string;
    warehouse_name?: string;
    payment_record_id: number;
    supplier_id: number;
    warehouse_id: number;
    income_account_id: number;
    amount: string;
    refund_date: string;
    status: 1 | 2 | 3 | 4;
    created_by: number;
    confirmAllowed?: boolean;
    remark?: string | null;
    source_fingerprint: string;
    fund_transaction_id: number | null;
    voucher_id: number | null;
    voucher_generate_error: string | null;
    allocations: {
        entry_id: number;
        receipt_id: number | null;
        amount: string;
        budget_state: string;
    }[];
}
export interface RefundAck {
    id: number;
    refundNo: string;
    status: number;
    fundTransactionId?: number;
    amount?: string;
    message?: string;
}
export interface RefundApplicationAck {
    id: number;
    applicationId: number;
    applicationNo: string;
    backfillRequested: true;
    reused: boolean;
    status: number;
    executed: boolean;
    rejected: boolean;
    period: string;
    businessDate: string;
}
export type RefundKind = 'create' | 'confirm' | 'receive' | 'cancel' | 'backfill';
export interface RefundSpec {
    kind: RefundKind;
    draftIdentity: string;
    path: string;
    action: string;
    operationUuid: string;
    requestKey: string;
    refundId?: number;
    refundDate: string;
    sourceFingerprint: string;
    source: RefundSourceIdentity;
    body: Record<string, unknown>;
    parentRequest?: {
        action: string;
        requestKey: string;
        operationUuid: string;
        body: Record<string, unknown>;
    };
}
