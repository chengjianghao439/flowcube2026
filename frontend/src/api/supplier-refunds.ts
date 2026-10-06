import type { AxiosRequestConfig } from 'axios';
import { payloadClient as client } from './client';
import type { RefundAck, RefundApplicationAck, SupplierRefund, SupplierRefundSource } from '@/types/supplier-refund';
export const listSupplierRefundsApi = (params: {
    page: number;
    pageSize: number;
}, config: AxiosRequestConfig) => client.get<{
    list: SupplierRefund[];
    total: number;
    page: number;
    pageSize: number;
}>('/supplier-refunds', { ...config, params, listMode: 'paged' });
export const supplierRefundSourceApi = (purchaseReturnId: number, config: AxiosRequestConfig) => client.get<SupplierRefundSource>('/supplier-refunds/source', { ...config, params: { purchaseReturnId } });
export const supplierRefundDetailApi = (id: number, config: AxiosRequestConfig) => client.get<SupplierRefund>(`/supplier-refunds/${id}`, config);
export const postSupplierRefundApi = (path: string, body: object, key: string, config: AxiosRequestConfig) => client.post<RefundAck | RefundApplicationAck>(path, body, { ...config, headers: { ...config.headers, 'X-Request-Key': key }, automaticReplay: false, _erpApiFallbackTried: true, skipGlobalError: true });
export const ownSupplierRefundApi = (uuid: string, params: {
    action: string;
    requestKey: string;
}, config: AxiosRequestConfig) => client.get<{
    status: 'success' | 'pending' | 'not_found';
    resourceType?: string;
    resourceId?: number;
    data?: RefundAck;
}>(`/supplier-refunds/operations/${uuid}`, { ...config, params });
export const ownRefundApplicationApi = (uuid: string, params: {
    action: string;
    requestKey: string;
}, config: AxiosRequestConfig) => client.get<RefundApplicationAck | {
    status: 'not_found';
}>(`/supplier-refunds/backfill-applications/${uuid}`, { ...config, params });
export const regenerateRefundApi = (id: number, config: AxiosRequestConfig) => client.post<{
    status: 'generated' | 'notRequired' | 'pending';
    voucherId?: number;
}>(`/supplier-refunds/${id}/regenerate-voucher`, {}, { ...config, automaticReplay: false, _erpApiFallbackTried: true, skipGlobalError: true });
