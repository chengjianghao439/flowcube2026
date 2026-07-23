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
  /** 是否满足"关闭剩余"的前提（相关收货订单均已上架完成 + 已有实收数量）；仅列表接口返回 */
  canCloseRemaining?: boolean
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
