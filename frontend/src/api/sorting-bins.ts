import { payloadClient as client } from './client'
import type { ApiResponse } from '@/types'

export interface SortingBin {
  id: number
  code: string
  warehouseId: number
  warehouseName?: string
  status: 1 | 2          // 1=空闲 2=占用
  statusName: string
  currentTaskId: number | null
  currentTaskNo: string | null
  customerName: string | null
  remark: string | null
  createdAt: string
  updatedAt: string
}

export const scanProductForSortApi = (code: string) =>
  client.get<ApiResponse<{
    productCode: string
    productName: string
    unit: string
    requiredQty: number
    pickedQty: number
    itemId: number
    taskId: number
    taskNo: string
    customerName: string
    warehouseId: number
    sortingBinId: number | null
    sortingBinCode: string | null
    taskItemCount: number
  } | null>>('/sorting-bins/scan', { params: { code } })

export const getSortingBinsApi = (params?: { keyword?: string; status?: number }) =>
  client.get<ApiResponse<SortingBin[]>>('/sorting-bins', { params })

export const getSortingBinsByWarehouseApi = (warehouseId: number) =>
  client.get<ApiResponse<SortingBin[]>>(`/sorting-bins/warehouse/${warehouseId}`)

export const createSortingBinApi = (data: { code: string; warehouseId: number; remark?: string }) =>
  client.post<ApiResponse<{ id: number; code: string }>>('/sorting-bins', data)

export const batchCreateSortingBinsApi = (data: { warehouseId: number; prefix: string; from: number; to: number }) =>
  client.post<ApiResponse<{ id: number; code: string }[]>>('/sorting-bins/batch', data)

export const updateSortingBinApi = (id: number, data: { remark?: string }) =>
  client.patch(`/sorting-bins/${id}`, data)

export const releaseSortingBinApi = (id: number) =>
  client.post(`/sorting-bins/${id}/release`)

export const deleteSortingBinApi = (id: number) =>
  client.delete(`/sorting-bins/${id}`)
