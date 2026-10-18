import type { AxiosRequestConfig } from 'axios';
import { payloadClient as client } from './client';
import { collectAllRecords } from './allRecords';
import type { PaginatedData } from '@/types';
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
/** 列表专用：把原顶层分页元数据交给共享有界收集器，不改变旧分页 API。 */
export const listAllSupplierRefundsApi = (config: AxiosRequestConfig, current: () => boolean) =>
    collectAllRecords<PaginatedData<SupplierRefund>>(async page => {
        if (!current()) throw Error('原供应商退款读取上下文已变化，请主动刷新核对');
        const batch = await listSupplierRefundsApi({ page, pageSize: 200 }, config);
        if (!current()) throw Error('原供应商退款读取上下文已变化，请主动刷新核对');
        return { list: batch.list, pagination: { page: batch.page, pageSize: batch.pageSize, total: batch.total } };
    }, config.signal);
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
