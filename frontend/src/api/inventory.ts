import { payloadClient as apiClient } from './client'
import type { ApiResponse, PaginatedData, QueryParams } from '@/types'
import type { StockItem, InventoryLog, StockChangeParams, InventoryOverviewParams, InventoryOverviewResult, InventoryContainer } from '@/types/inventory'

export const getStockApi    = async (p: QueryParams) => apiClient.get<ApiResponse<PaginatedData<StockItem>>>('/inventory/stock', { params: p })
export const getLogsApi     = async (p: QueryParams) => apiClient.get<ApiResponse<PaginatedData<InventoryLog>>>('/inventory/logs', { params: p })
export const inboundApi     = async (d: StockChangeParams) => apiClient.post<ApiResponse<unknown>>('/inventory/inbound', d)
export const outboundApi    = async (d: StockChangeParams) => apiClient.post<ApiResponse<unknown>>('/inventory/outbound', d)
export const adjustApi      = async (d: Omit<StockChangeParams,'supplierId'|'unitPrice'>) => apiClient.post<ApiResponse<unknown>>('/inventory/adjust', d)

export const getInventoryOverviewApi = async (p: InventoryOverviewParams) =>
  apiClient.get<ApiResponse<InventoryOverviewResult>>('/inventory/overview', { params: p })

export const getInventoryContainersApi = async (productId: number, warehouseId: number | null) =>
  apiClient.get<ApiResponse<InventoryContainer[]>>('/inventory/containers', {
    params: { productId, ...(warehouseId ? { warehouseId } : {}) },
  })

export const getContainerByBarcodeApi = async (barcode: string) =>
  apiClient.get<ApiResponse<{
    containerId: number; barcode: string; productId: number; productCode: string
    productName: string; warehouseId: number; warehouseName: string
    locationId: number | null; locationCode: string | null
    remainingQty: number; unit: string
    containerKind?: 'inventory' | 'plastic_box'
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
  newContainerKind?: 'inventory' | 'plastic_box'
  productId: number
  warehouseId: number
}

export const splitContainerApi = async (
  containerId: number,
  body: { qty: number; remark?: string; printLabel?: boolean },
) =>
  apiClient.post<ApiResponse<SplitContainerResult>>(`/inventory/containers/${containerId}/split`, body)
