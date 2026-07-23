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
  articleNumber?: string | null
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
  articleNumber?: string | null
  spec?: string | null
  color?: string | null
  unit: string
  qty: number
  packedAt?: string | null
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
  /** 非空表示仓库任务正在「取消收尾中」，已拣容器还没逐个扫码归还完，不算真正完成取消 */
  warehouseTaskCancelRequestedAt?: string | null
  /** 非空表示有改单正在等待仓库确认（拆箱/归还库位），确认完成前不能推进拣货/分拣/复核/打包/出库 */
  warehouseTaskAdjustmentRequestedAt?: string | null
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
export interface AdjustSaleResult {
  adjustmentId: number | null
  adjustmentNo: string | null
  /** true 表示涉及已拣/已打包实物的归还，需 PDA 逐项扫码确认后才真正生效 */
  pending: boolean
}
