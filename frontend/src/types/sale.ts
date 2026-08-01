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
  entryUnit?: string        // 录入单位（文档03 Phase3）；缺省=基本单位 unit。quantity/unitPrice 视作该单位下的量/价
  entryQty?: number         // 录入单位下的数量（回显用）
  conversionRate?: number   // 1 录入单位 = N 基本单位（回显用）
  /** 行级发货仓库（分仓）：不填则继承订单头「默认仓库」 */
  warehouseId?: number | null
  warehouseName?: string | null
  /** 已发数量（分批累加）；shippedQty < quantity 表示该行还有未发部分 */
  shippedQty?: number
  /** 是否已派发到仓库任务（分批发货：false 表示还没发起出库，可在下次发货中选中） */
  dispatched?: boolean
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

/** 销售单关联的仓库任务（分仓：一个订单可能有多个） */
export interface SaleOrderTask {
  taskId: number
  taskNo: string
  warehouseId: number | null
  warehouseName: string | null
  status: number
  statusName: string | null
  cancelRequestedAt?: string | null
  adjustmentRequestedAt?: string | null
  shippedAt?: string | null
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
  /** 发货进度汇总（分仓/分批）：老单/未发货订单 shipped=0，isMultiWarehouse=false */
  orderedTotalQty?: number | null
  shippedTotalQty?: number | null
  warehouseCount?: number | null
  isMultiWarehouse?: boolean
  /** 仍有未派发到仓库任务的明细行 → 履约中可「继续发货」 */
  hasUndispatchedItems?: boolean
  /** partial_ship_close 表示部分发货后取消剩余、以实发结案 */
  closedReason?: string | null
  /** 回款（应收）：独立于订单状态展示，月结/现结账期不同不能混进状态徽章。
   *  为 null 表示还没生成应收记录（订单还没发过货）。 */
  receivableStatus?: 1 | 2 | 3 | null
  receivableStatusName?: string | null
  receivableDueDate?: string | null
  receivableBalance?: number | null
  receivableOverdue?: boolean
  saleDate?: string
  totalAmount: number
  remark?: string
  taskId?: number | null
  taskNo?: string | null
  /** 分仓：一个订单的多个仓库任务（详情页返回，多仓时用它而非单个 taskId） */
  tasks?: SaleOrderTask[]
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

/** 占库弹窗：某产品在某仓库的可用量 */
export interface ReserveWarehouseOption {
  warehouseId: number
  warehouseName: string
  available: number
}

/** 占库预览（GET /sale/:id/reserve-preview）：逐行商品 + 各仓可用量，供占库弹窗选仓库 */
export interface ReservePreviewItem {
  itemId: number
  productId: number
  productCode: string
  productName: string
  articleNumber?: string | null
  spec?: string | null
  color?: string | null
  unit: string
  quantity: number
  currentWarehouseId: number
  currentWarehouseName: string
  warehouses: ReserveWarehouseOption[]
}
export interface ReservePreview {
  orderId: number
  warehouseId: number
  warehouseName: string
  items: ReservePreviewItem[]
}

/** POST /sale/:id/reserve 的分仓选择：逐行覆盖发货仓库 */
export interface ReserveItemOverride {
  id: number
  warehouseId: number
  warehouseName: string
}
