export interface StockItem {
  id: number; quantity: number
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

// ─── 容器 ─────────────────────────────────────────────────────────────────────

export interface InventoryContainer {
  id:            number
  barcode:       string
  batchNo:       string | null
  initialQty:    number
  remainingQty:  number
  sourceRefType: string | null
  sourceRefNo:   string | null
  mfgDate:       string | null
  expDate:       string | null
  unit:          string | null
  remark:        string | null
  warehouseName: string
  createdAt:     string
}
