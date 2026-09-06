import { payloadClient } from './client'

export interface TransferCandidate { warehouseId: number; warehouseName: string; quantity: number; arrivalCondition: string; expectedArrival: string | null }
export interface ProcurementSupply {
  id: string; productId: number; productCode: string; productName: string; unit: string
  articleNumber?: string | null; spec?: string | null; color?: string | null
  warehouseId: number; warehouseName: string; supplierId: number | null; supplierName: string | null
  onHand: number; reserved: number; confirmedDemand: number; draftSalesDemand: number; forecastDemand: number; residualForecast: number; grossDemand: number
  safetyStock: number; targetStock: number; inTransit: number; expectedBound: number
  planCoverage?: number; requisitionCoverage?: number; draftCoverage?: number; provisionalCoverage: number
  netRequirement: number; suggestedQty: number; excessQty: number; packMultiple: number; minimumOrderQty: number
  entryUnit: string; conversionRate: number; transferCandidates: TransferCandidate[]
  earliestDemandDate?: string | null; arrivalUnconfirmedQty?: number; lateSupplyQty?: number
  expectedArrivals?: { quantity: number; expectedDate: string | null }[]
}
export interface PurchasePolicy {
  productId: number; supplierId: number | null; baseUnit: string; entryUnit: string; conversionRate: number
  packMultiple: number; minimumOrderQty: number; units: { unitName: string; conversionRate: number }[]
}
export const getPurchasePolicyApi = (productId: number, supplierId: number) => payloadClient.get<PurchasePolicy>('/procurement/purchase-policy', { params: { productId, supplierId } })
export const savePurchasePolicyApi = (data: Pick<PurchasePolicy, 'productId' | 'supplierId' | 'entryUnit' | 'packMultiple' | 'minimumOrderQty'>) => payloadClient.put<PurchasePolicy>('/procurement/purchase-policy', data)

export const prepareProcurementTransfer = (row: ProcurementSupply, candidate: TransferCandidate) => {
  const key = `procurement-transfer-${Date.now()}`
  const data = { fromWarehouseId: candidate.warehouseId, fromWarehouseName: candidate.warehouseName, toWarehouseId: row.warehouseId, toWarehouseName: row.warehouseName, remark: `采购建议调拨：${candidate.arrivalCondition}`, items: [{ productId: row.productId, productCode: row.productCode, productName: row.productName, unit: row.unit, articleNumber: row.articleNumber, spec: row.spec, color: row.color, quantity: candidate.quantity, remark: '' }] }
  sessionStorage.setItem(key, JSON.stringify(data))
  return `/transfer/new?procurement=${key}`
}
