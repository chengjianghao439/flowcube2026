export interface ScanLog {
  barcode: string
  qty: number
  operatorName: string | null
  scannedAt: string
}

export interface SaleOrderItem {
  id: number
  productId: number
  productCode: string
  productName: string
  spec?: string | null
  color?: string | null
  unit: string
  quantity: number
  unitPrice: number
  amount: number
  remark?: string
  priceSource?: 'list' | 'default' | 'manual'
  resolvedPrice?: number | null
  resolvedPriceLevel?: string | null
  costPrice?: number | null
  belowCost?: boolean
  scans?: ScanLog[]
}
export interface SaleOrderTimelineEvent {
  id: number | string
  eventType: string
  title: string
  description?: string | null
  createdBy?: number | null
  createdByName?: string | null
  createdAt: string
  payload?: Record<string, unknown> | null
}
export interface PackageItem {
  productCode: string
  productName: string
  unit: string
  qty: number
}

export interface Package {
  id: number
  barcode: string
  status: number
  items: PackageItem[]
}

export interface SaleOrder {
  id: number
  orderNo: string
  customerId: number
  customerName: string
  warehouseId: number
  warehouseName: string
  status: 1 | 2 | 3 | 4 | 5
  statusName: string
  warehouseTaskStatus?: number | null
  warehouseTaskStatusName?: string | null
  saleDate?: string
  totalAmount: number
  remark?: string
  taskId?: number | null
  taskNo?: string | null
  carrierId?: number | null
  carrier?: string | null
  freightType?: 1 | 2 | 3 | null
  freightTypeName?: string | null
  receiverName?: string | null
  receiverPhone?: string | null
  receiverAddress?: string | null
  operatorId: number
  operatorName: string
  createdAt: string
  items?: SaleOrderItem[]
  timeline?: SaleOrderTimelineEvent[]
  packages?: Package[]
}
export interface CreateSaleParams {
  customerId: number
  customerName: string
  warehouseId: number
  warehouseName: string
  remark?: string
  carrierId?: number | null
  carrier?: string
  freightType?: number | null
  receiverName?: string
  receiverPhone?: string
  receiverAddress?: string
  items: Omit<SaleOrderItem, 'id' | 'amount' | 'belowCost'>[]
}
export interface UpdateSaleParams extends CreateSaleParams {
  id: number
}
