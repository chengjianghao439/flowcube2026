import { payloadClient as apiClient } from './client'
import type { PaginatedData, QueryParams } from '@/types'
import type { StockItem, InventoryLog, StockChangeParams, InventoryOverviewParams, InventoryOverviewResult, InventoryContainer } from '@/types/inventory'

export const getStockApi    = async (p: QueryParams) => apiClient.get<PaginatedData<StockItem>>('/inventory/stock', { params: p })
export const getLogsApi     = async (p: QueryParams) => apiClient.get<PaginatedData<InventoryLog>>('/inventory/logs', { params: p })
export const inboundApi     = async (d: StockChangeParams) => apiClient.post<unknown>('/inventory/inbound', d)
export const outboundApi    = async (d: StockChangeParams) => apiClient.post<unknown>('/inventory/outbound', d)
export const adjustApi      = async (d: Omit<StockChangeParams,'supplierId'|'unitPrice'>) => apiClient.post<unknown>('/inventory/adjust', d)

export const getInventoryOverviewApi = async (p: InventoryOverviewParams) =>
  apiClient.get<InventoryOverviewResult>('/inventory/overview', { params: p })

export const getInventoryContainersApi = async (productId: number, warehouseId: number | null) =>
  apiClient.get<InventoryContainer[]>('/inventory/containers', {
    params: { productId, ...(warehouseId ? { warehouseId } : {}) },
  })

export interface ContainerLogItem {
  qty: number
  type: number
  moveType: number | null
  moveTypeName: string | null
  remark: string | null
  refType: string | null
  refNo: string | null
  operatorName: string | null
  productName: string | null
  createdAt: string
}

/** 单容器流水（库存条码/塑料盒通用），个体条码的追溯时间线 */
export const getContainerLogsApi = async (containerId: number) =>
  apiClient.get<ContainerLogItem[]>(`/inventory/containers/${containerId}/logs`)

export const getContainerByBarcodeApi = async (barcode: string) =>
  apiClient.get<{
    containerId: number; barcode: string; productId: number; productCode: string
    productName: string; warehouseId: number; warehouseName: string
    locationId: number | null; locationCode: string | null
    remainingQty: number; unit: string
    containerKind?: 'inventory' | 'plastic_box'
    containerStatus?: 'waiting_putaway' | 'stored'
    lockedByTaskId?: number | null   // 非空=已被拣货任务锁定，不可拆分（拆分须在拣货前完成）
    lockedByTaskNo?: string | null
    individual?: boolean             // 单件库存条码（一件一码）：不可拆分/并货
    inboundTaskId?: number | null
  }>(`/inventory/containers/barcode/${encodeURIComponent(barcode)}`)

export const assignContainerLocationApi = async (containerId: number, locationId: number) =>
  apiClient.put<{ containerId: number; barcode: string; locationCode: string }>(
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
  body: { qty: number; remark?: string; printLabel?: boolean; targetContainerId?: number },
) =>
  apiClient.post<SplitContainerResult>(`/inventory/containers/${containerId}/split`, body)

// ─── 补货建议与补货策略（文档 01）──────────────────────────────────────────────

export interface ReplenishmentItem {
  id: string
  productId: number
  productCode: string
  productName: string
  unit: string
  warehouseId: number
  warehouseName: string
  onHand: number
  reserved: number
  available: number
  inTransit: number
  safetyStock: number
  reorderPoint: number
  targetStock: number
  suggestQty: number
}

export const getReplenishmentApi = async (p: { page?: number; pageSize?: number; keyword?: string; warehouseId?: number | null }) =>
  apiClient.get<PaginatedData<ReplenishmentItem>>('/inventory/replenishment', { params: p })

export interface StockPolicy {
  productId: number
  warehouseId: number
  warehouseName: string | null
  safetyStock: number
  reorderPoint: number
  targetStock: number | null
}

export const getStockPoliciesApi = async (productId: number) =>
  apiClient.get<StockPolicy[]>('/inventory/stock-policies', { params: { productId } })

export const saveStockPoliciesApi = async (
  items: Array<{ productId: number; warehouseId: number; safetyStock?: number; reorderPoint?: number; targetStock?: number | null }>,
) => apiClient.put<{ saved: number; deleted: number }>('/inventory/stock-policies', { items })

// ─── 库龄与呆滞报表（文档 09）──────────────────────────────────────────────────

export interface AgingBucket { bucket: string; skuCount: number; totalQty: number; totalValue: number }
export interface AgingItem {
  id: string
  productId: number; productCode: string; productName: string; unit: string
  warehouseId: number; warehouseName: string
  qty0_30: number; qty30_60: number; qty60_90: number; qty90p: number
  totalQty: number; avgAgeDays: number; maxAgeDays: number; totalValue: number
  lastOutboundAt: string | null; daysSinceOutbound: number | null; isStale: boolean
}
export interface InventoryAgingReport {
  buckets: AgingBucket[]
  list: AgingItem[]
  pagination: { page: number; pageSize: number; total: number }
  staleDays: number
}
export interface ExpiryAlert {
  id: string
  productId: number; productCode: string; productName: string; unit: string
  warehouseId: number; warehouseName: string
  batchNo: string | null; expDate: string | null; remainingQty: number
  daysToExpiry: number | null; expiryState: 'expired' | 'near_expiry' | 'ok'
}

export const getInventoryAgingApi = (p: { page?: number; pageSize?: number; keyword?: string; warehouseId?: number | null; staleDays?: number }) =>
  apiClient.get<InventoryAgingReport>('/inventory/aging', { params: p })

export const getExpiryAlertsApi = (p: { warehouseId?: number | null; warnDays?: number }) =>
  apiClient.get<{ warnDays: number; list: ExpiryAlert[] }>('/inventory/aging/expiry', { params: p })

// ─── 采购计划预测（文档 11 · MVP 只读报表）────────────────────────────────────

export interface ProcurementPlanItem {
  id: string
  productId: number; productCode: string; productName: string; unit: string
  warehouseId: number; warehouseName: string
  adu: number; forecastDemand: number; safetyStock: number; available: number; inTransit: number
  leadTimeDays: number; suggestedQty: number; expectedArrival: string
  supplierId: number | null; supplierName: string | null
}

export const getProcurementPlanApi = (p: { window?: number; horizon?: number; keyword?: string; warehouseId?: number | null; defaultLeadTime?: number }) =>
  apiClient.get<{ list: ProcurementPlanItem[]; params: { window: number; horizon: number; defaultLeadTime: number } }>('/inventory/procurement-plan', { params: p })
