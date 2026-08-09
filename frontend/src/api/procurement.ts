import { payloadClient as client } from './client'
import type { PaginatedData } from '@/types'
import type { ProcurementPlan, GeneratePlanParams } from '@/types/procurement'

// 采购计划单据化（文档 11）
export const listPlansApi = (params: object) => client.get<PaginatedData<ProcurementPlan>>('/procurement/plans', { params })
export const generatePlanApi = (data: GeneratePlanParams, config?: Parameters<typeof client.post>[2]) => client.post<{ id: number; code: string; itemCount: number }>('/procurement/plans', data, config)
export const getPlanApi = (id: number) => client.get<ProcurementPlan>(`/procurement/plans/${id}`)
export const updatePlanItemApi = (id: number, itemId: number, data: { adjustedQty?: number; supplierId?: number | null; ignore?: boolean }, config?: Parameters<typeof client.put>[2]) =>
  client.put<ProcurementPlan>(`/procurement/plans/${id}/items/${itemId}`, data, config)
export const convertPlanApi = (id: number, itemIds: number[], config?: Parameters<typeof client.post>[2]) =>
  client.post<{ planId: number; planStatus: number; createdOrders: { purchaseOrderId: number; orderNo: string }[] }>(`/procurement/plans/${id}/convert`, { itemIds }, config)
export const cancelPlanApi = (id: number, config?: Parameters<typeof client.post>[2]) => client.post<null>(`/procurement/plans/${id}/cancel`, {}, config)
