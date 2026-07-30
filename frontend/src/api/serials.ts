import { payloadClient as apiClient } from './client'
import type { PaginatedData, QueryParams } from '@/types'

export interface SerialLedgerItem {
  id: number
  serialNo: string
  productId: number
  productCode: string
  productName: string
  unit: string
  status: number
  statusLabel: string
  warehouseId: number | null
  warehouseName: string | null
  containerId: number | null
  containerBarcode: string | null
  purchaseOrderId: number | null
  inboundTaskId: number | null
  saleOrderId: number | null
  warehouseTaskId: number | null
  shippedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface SerialEvent {
  id: number
  eventType: string
  fromStatus: number | null
  toStatus: number | null
  containerId: number | null
  containerBarcode: string | null
  warehouseId: number | null
  refType: string | null
  refId: number | null
  remark: string | null
  operatorName: string | null
  createdAt: string
}

export interface SerialTraceMatch {
  serial: SerialLedgerItem
  events: SerialEvent[]
}

export interface SerialTraceResult {
  serialNo: string
  matchCount: number
  matches: SerialTraceMatch[]
}

export interface SerialConsistencyMismatch {
  containerId: number
  barcode: string
  productId: number
  productCode: string
  productName: string
  warehouseId: number | null
  warehouseName: string | null
  remainingQty: number
  inStockSerialCount: number
}

export interface SerialConsistencyResult {
  checkedContainers: number
  mismatchCount: number
  consistent: boolean
  mismatches: SerialConsistencyMismatch[]
}

export const getSerialsApi = async (p: QueryParams) =>
  apiClient.get<PaginatedData<SerialLedgerItem>>('/serials', { params: p })

export const traceSerialApi = async (serialNo: string, productId?: number) =>
  apiClient.get<SerialTraceResult>('/serials/trace', { params: { serialNo, ...(productId ? { productId } : {}) } })

export const checkSerialConsistencyApi = async (warehouseId?: number) =>
  apiClient.get<SerialConsistencyResult>('/serials/check-consistency', { params: warehouseId ? { warehouseId } : {} })
