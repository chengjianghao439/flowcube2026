export interface StockItem {
  id: number; quantity: number; reserved?: number; available?: number
  productId: number; productCode: string; productName: string; unit: string
  warehouseId: number; warehouseName: string
}

export interface InventoryLog {
  id: number; type: number; typeName: string
  productId: number; productCode: string; productName: string; unit: string
  warehouseId: number; warehouseName: string
  supplierId: number | null; supplierName: string | null
  quantity: number; beforeQty: number; afterQty: number
  unitPrice: number | null; remark: string | null
  operatorId: number; operatorName: string; createdAt: string
  containerId?: number | null
  logSourceType?: string | null
  logSourceRefId?: number | null
}

export interface StockChangeParams {
  productId: number; warehouseId: number; quantity: number
  supplierId?: number | null; unitPrice?: number | null; remark?: string
}

// ─── 库存总览 ─────────────────────────────────────────────────────────────────

export interface InventoryOverviewStats {
  totalSkus:      number
  totalOnHand:    number
  totalReserved:  number
  totalAvailable: number
}

export interface InventoryOverviewItem {
  id:           number
  productId:    number
  productCode:  string
  productName:  string
  unit:         string
  articleNumber: string | null
  spec:         string | null
  color:        string | null
  categoryId:   number | null
  categoryPath: string
  warehouseId:  number
  warehouseName: string
  onHand:       number
  reserved:     number
  available:    number
  updatedAt:    string | null
}

export interface InventoryOverviewResult {
  stats:      InventoryOverviewStats
  list:       InventoryOverviewItem[]
  pagination: { page: number; pageSize: number; total: number }
}

export interface InventoryOverviewParams {
  page?:        number
  pageSize?:    number
  keyword?:     string
  warehouseId?: number | null
  categoryId?:  number | null
}

export interface InventoryReservationParams { productId: number; warehouseId: number; page?: number; pageSize?: number }
export interface InventoryReservationSummary {
  activeQuantity: number; cacheOnHand: number; reserved: number; available: number; expected: number; atp: number; pickableQuantity: number
  reservationQuantity: number; expectedBindingQuantity: number; expectedPoolBindingQuantity: number
  cacheDifference: number; reservationDifference: number; bindingPoolDifference: number
  visibleReservationQuantity: number; hiddenReservationQuantity: number; orphanReservationQuantity: number; unknownReservationQuantity: number
  visibleBindingQuantity: number; hiddenBindingQuantity: number; orphanBindingQuantity: number
}
export interface InventoryReservationSource {
  saleOrderId: number; orderNo: string; customerName: string | null; status: number; createdAt: string | null
  reservationQuantity: number; expectedBindingQuantity: number; hiddenBindingQuantity: number; orphanBindingQuantity: number
  bindings: Array<{ bindingId: number; saleOrderItemId: number; quantity: number; sourceState: 'expected_supply' | 'outside_expected_supply' | 'putaway_exceeds_order'
    purchase: { purchaseOrderId: number; purchaseItemId: number; orderNo: string; status: number; expectedDate: string | null; openQuantity: number; boundQuantity: number } }>
}
export interface InventoryReservationsResult {
  productId: number; warehouseId: number; summary: InventoryReservationSummary; list: InventoryReservationSource[]
  pagination: { page: number; pageSize: number; total: number }
}

// ─── 容器 ─────────────────────────────────────────────────────────────────────

export interface InventoryContainer {
  id:            number
  barcode:       string
  batchNo:       string | null
  initialQty:    number
  remainingQty:  number
  /** 一件一码的个体条码（库存容器且入库数量就是 1），不可拆分/并货 */
  individual?:   boolean
  sourceRefType: string | null
  sourceRefNo:   string | null
  mfgDate:       string | null
  expDate:       string | null
  unit:          string | null
  remark:        string | null
  warehouseName: string
  createdAt:     string
}
