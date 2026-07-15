import type { InboundStatusView } from './inbound-tasks'

export interface PurchaseOrderItem {
  id: number
  productId: number
  productCode: string
  productName: string
  unit: string
  articleNumber?: string | null
  spec?: string | null
  color?: string | null
  quantity: number
  unitPrice: number
  amount: number
  remark?: string
}
export interface PurchaseOrder {
  id: number
  orderNo: string
  supplierId: number
  supplierName: string
  warehouseId: number
  warehouseName: string
  status: 1 | 2 | 3 | 4
  statusName: string
  expectedDate?: string
  totalAmount: number
  totalOrderedQty?: number
  totalReceivedQty?: number
  remark?: string
  operatorId: number
  operatorName: string
  createdAt: string
  items?: PurchaseOrderItem[]
  inboundTasks?: { id: number; taskNo: string; status: number; receiptStatus?: InboundStatusView }[]
}
export interface CreatePurchaseParams {
  supplierId: number
  supplierName: string
  warehouseId: number
  warehouseName: string
  expectedDate?: string
  remark?: string
  items: Omit<PurchaseOrderItem, 'id' | 'amount'>[]
}
