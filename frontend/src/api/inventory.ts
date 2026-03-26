import apiClient from './client'
import type { ApiResponse, PaginatedData, QueryParams } from '@/types'
import type { StockItem, InventoryLog, StockChangeParams, InventoryOverviewParams, InventoryOverviewResult, InventoryContainer } from '@/types/inventory'

export const getStockApi    = async (p: QueryParams) => (await apiClient.get<ApiResponse<PaginatedData<StockItem>>>('/inventory/stock', { params: p })).data.data
export const getLogsApi     = async (p: QueryParams) => (await apiClient.get<ApiResponse<PaginatedData<InventoryLog>>>('/inventory/logs', { params: p })).data.data
export const inboundApi     = async (d: StockChangeParams) => (await apiClient.post<ApiResponse<unknown>>('/inventory/inbound', d)).data
export const outboundApi    = async (d: StockChangeParams) => (await apiClient.post<ApiResponse<unknown>>('/inventory/outbound', d)).data
export const adjustApi      = async (d: Omit<StockChangeParams,'supplierId'|'unitPrice'>) => (await apiClient.post<ApiResponse<unknown>>('/inventory/adjust', d)).data

export const getInventoryOverviewApi = async (p: InventoryOverviewParams) =>
  (await apiClient.get<ApiResponse<InventoryOverviewResult>>('/inventory/overview', { params: p })).data.data!

export const getInventoryContainersApi = async (productId: number, warehouseId: number | null) =>
  (await apiClient.get<ApiResponse<InventoryContainer[]>>('/inventory/containers', {
    params: { productId, ...(warehouseId ? { warehouseId } : {}) },
  })).data.data!

export const getContainerByBarcodeApi = async (barcode: string) =>
  apiClient.get<ApiResponse<{
    containerId: number; barcode: string; productId: number; productCode: string
    productName: string; warehouseId: number; warehouseName: string
    locationId: number | null; locationCode: string | null
    remainingQty: number; unit: string
    containerStatus?: 'waiting_putaway' | 'stored'
    inboundTaskId?: number | null
  }>>(`/inventory/containers/barcode/${encodeURIComponent(barcode)}`)

export const assignContainerLocationApi = async (containerId: number, locationId: number) =>
  apiClient.put<ApiResponse<{ containerId: number; barcode: string; locationCode: string }>>(
    `/inventory/containers/${containerId}/location`,
    { locationId },
  )

export interface SplitContainerResult {
  sourceContainerId: number
  sourceBarcode: string
  sourceRemainingAfter: number
  newContainerId: number
  newBarcode: string
  productId: number
  warehouseId: number
}

export const splitContainerApi = async (
  containerId: number,
  body: { qty: number; remark?: string; printLabel?: boolean },
) =>
  (await apiClient.post<ApiResponse<SplitContainerResult>>(`/inventory/containers/${containerId}/split`, body)).data
    .data!
