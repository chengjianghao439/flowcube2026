import { payloadClient as apiClient } from './client'
import { withRequestKeyHeaders } from '@/lib/requestKey'
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

// ── 历史序列号导入（文档04 Phase2）──
export interface SerialImportCandidateContainer {
  containerId: number
  barcode: string
  warehouseId: number
  warehouseName: string | null
  locationCode: string | null
  remainingQty: number
  snCount: number
  locked: boolean
}

export interface SerialImportCandidates {
  product: { id: number; code: string; name: string; unit: string; serialManaged: boolean }
  containers: SerialImportCandidateContainer[]
  totalQty: number
  blockers: {
    alreadySerialized: boolean
    pendingContainers: number
    lockedContainers: number
    outOfScopeStock: number
    noStock: boolean
  }
}

export interface ImportSerialsResult {
  productId: number
  containerCount: number
  importedCount: number
}

export const getSerialImportCandidatesApi = async (productId: number) =>
  apiClient.get<SerialImportCandidates>('/serials/import-candidates', { params: { productId } })

export const importSerialsApi = async (
  data: { productId: number; containers: Array<{ containerId: number; serialNos: string[] }> },
  requestKey?: string,
) =>
  apiClient.post<ImportSerialsResult>('/serials/import', data, requestKey ? { headers: withRequestKeyHeaders(requestKey) } : undefined)
