import { payloadClient as client } from './client'
import type { PaginatedData } from '@/types'
import type { ProcurementPlan, GeneratePlanParams } from '@/types/procurement'

// 采购计划单据化（文档 11）
export const listPlansApi = (params: object) => client.get<PaginatedData<ProcurementPlan>>('/procurement/plans', { params })
export const generatePlanApi = (data: GeneratePlanParams) => client.post<{ id: number; code: string; itemCount: number }>('/procurement/plans', data)
export const getPlanApi = (id: number) => client.get<ProcurementPlan>(`/procurement/plans/${id}`)
export const updatePlanItemApi = (id: number, itemId: number, data: { adjustedQty?: number; supplierId?: number | null; ignore?: boolean }) =>
  client.put<ProcurementPlan>(`/procurement/plans/${id}/items/${itemId}`, data)
export const convertPlanApi = (id: number, itemIds: number[]) =>
  client.post<{ planId: number; planStatus: number; createdOrders: { purchaseOrderId: number; orderNo: string }[] }>(`/procurement/plans/${id}/convert`, { itemIds })
export const cancelPlanApi = (id: number) => client.post<null>(`/procurement/plans/${id}/cancel`)
