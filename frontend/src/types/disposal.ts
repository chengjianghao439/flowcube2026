/** 滞销库存处理单（P2-9） */

export type DisposeType = 1 | 2 | 3

export interface DisposalSuggestion {
  productId: number
  productCode: string
  productName: string
  unit: string
  articleNumber: string | null
  spec: string | null
  color: string | null
  warehouseId: number
  warehouseName: string
  /** 扣缓存reserved后的原参考数量，不是总在库 */
  totalQty: number
  onHandQty: number
  reservedQty: number
  valuationBasis: 'avg_cost' | 'cost_price' | 'sale_price' | 'none'
  unitValue: number
  totalValue: number
  lastOutboundAt: string | null
  avgCost: number
}

export interface DisposalItem {
  id: number
  productId: number
  productCode: string
  productName: string
  unit: string
  articleNumber: string | null
  spec: string | null
  color: string | null
  quantity: number
  unitValue: number
  value: number
  disposeType: DisposeType
  disposeTypeName: string
  remark?: string | null
}

export interface DisposalOrder {
  id: number
  disposalNo: string
  warehouseId: number
  warehouseName: string
  status: 1 | 2 | 3 | 4 | 5 | 6
  statusName: string
  totalValue: number
  remark?: string | null
  operatorId: number | null
  operatorName: string | null
  approvedBy: number | null
  approvedByName: string | null
  approvedAt: string | null
  rejectReason: string | null
  disposedAt: string | null
  createdAt: string
  items?: DisposalItem[]
}

export interface CreateDisposalParams {
  disposalSource?: import('./disposal-handling').DisposalSourceInput
  warehouseId: number
  warehouseName: string
  remark?: string
  items: { productId: number; quantity: number; disposeType: 3; remark?: string }[]
}

export interface DisposalSuggestionParams {
  page?: number
  pageSize?: number
  keyword?: string
  warehouseId?: number | null
  staleDays?: number
}

export const DISPOSE_TYPE_LABELS: Record<DisposeType, string> = {
  1: '降价促销',
  2: '退货供应商',
  3: '报废',
}

export const DISPOSE_TYPE_TONES: Record<DisposeType, 'info' | 'warning' | 'danger'> = {
  1: 'info',
  2: 'warning',
  3: 'danger',
}

export interface DisposalExecutionResult { id: number; disposalNo: string; disposedValue: number }
