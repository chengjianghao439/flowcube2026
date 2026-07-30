export interface CheckItem {
  id: number
  productId: number
  productCode: string
  productName: string
  unit: string
  bookQty: number
  actualQty: number | null
  diffQty: number | null
}
export interface StockCheck {
  id: number
  checkNo: string
  warehouseId: number
  warehouseName: string
  checkType: 1 | 2
  scopeType: 'abc' | 'zone' | 'manual' | null
  scopeValue: string | null
  status: 1 | 2 | 3
  statusName: string
  remark?: string
  operatorId: number
  operatorName: string
  createdAt: string
  items?: CheckItem[]
}
export interface CreateCheckParams {
  warehouseId: number; warehouseName: string; remark?: string
  checkType?: 1 | 2; scopeType?: 'abc' | 'zone' | 'manual' | null; scopeValue?: string | null; productIds?: number[]
}
export interface AbcClassRow {
  warehouseId: number; warehouseName: string; productId: number; productCode: string; productName: string
  abcClass: 'A' | 'B' | 'C'; metricType: string; metricValue: number; cumulativePct: number; windowDays: number; computedAt: string
}
export interface CycleCandidate { productIds: number[]; scopeType: string; scopeValue: string }
