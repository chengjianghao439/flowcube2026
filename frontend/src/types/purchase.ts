export interface PurchaseOrderItem {
  id: number
  productId: number
  productCode: string
  productName: string
  unit: string
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
  remark?: string
  operatorId: number
  operatorName: string
  createdAt: string
  /** 存在未完结入库任务时返回（已完成/已取消的任务不算） */
  openInboundTaskId?: number | null
  openInboundTaskNo?: string | null
  items?: PurchaseOrderItem[]
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
