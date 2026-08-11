export interface ProcurementPlanItem {
  id: number
  planId: number
  productId: number
  productCode: string
  productName: string
  unit: string
  warehouseId: number
  warehouseName: string
  supplierId: number | null
  supplierName: string | null
  adu: number
  forecastDemand: number
  safetyStock: number
  available: number
  inTransit: number
  leadTimeDays: number
  suggestedQty: number
  adjustedQty: number
  expectedArrival: string | null
  status: 1 | 2 | 3          // 1待处理 2已转采购 3已忽略
  statusName: string
  purchaseOrderId: number | null
}

export interface ProcurementPlan {
  id: number
  code: string
  name: string | null
  horizonDays: number
  forecastMethod: string
  forecastWindow: number
  defaultLeadTime: number
  status: 1 | 2 | 3 | 4       // 1草稿 2部分转采购 3已完成 4已作废
  statusName: string
  itemCount: number
  operatorId: number
  operatorName: string | null
  remark: string | null
  createdAt: string
  updatedAt: string
  items?: ProcurementPlanItem[]
}

export interface GeneratePlanParams {
  window?: number
  horizon?: number
  warehouseId?: number | null
  name?: string | null
  defaultLeadTime?: number
  forecastMethod?: 'sma' | 'wma'
  remark?: string | null
}
