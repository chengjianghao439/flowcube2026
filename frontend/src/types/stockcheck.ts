export interface CheckItem {
  id: number
  productId: number
  productCode: string
  productName: string
  unit: string
  bookQty: number
  actualQty: number | null
  diffQty: number | null
  /** PDA 扫码盘点行：实盘数由扫码集派生，ERP 手填锁定 */
  scanDriven?: boolean
  scannedContainerCount?: number
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
  articleNumber: string | null; spec: string | null; color: string | null
  abcClass: 'A' | 'B' | 'C'; metricType: string; metricValue: number; cumulativePct: number; windowDays: number; computedAt: string
}
export interface CycleCandidate { productIds: number[]; scopeType: string; scopeValue: string }
export interface CycleRule {
  abcClass: 'A' | 'B' | 'C'
  intervalDays: number
  batchLimit: number
  enabled: boolean
  isOverride: boolean   // 该行是本仓覆盖(true)还是继承全局默认(false)
}
export interface CycleRulesResult { warehouseId: number; rules: CycleRule[] }

/** 按期盘点率（文档08）：各仓各 档位的应盘/到期未盘/按期盘点率 */
export interface CoverageRow {
  rowKey: string
  warehouseId: number
  warehouseName: string
  abcClass: string
  totalItems: number
  dueItems: number
  coverageRate: number
}

/** PDA 扫码盘点（文档13 §4.3）：任务池行 */
export interface PendingScanCheck {
  id: number
  checkNo: string
  warehouseId: number
  warehouseName: string
  createdAt: string
  itemCount: number
  pendingCount: number
}

/** 某行已扫的一个容器 */
export interface ScanEntry {
  containerId: number
  barcode: string
  countedQty: number
  /** 单件库存条码（一件一码）：扫到即计 1，无数量录入 */
  individual: boolean
}

/** PDA 扫码盘点作业页：某盘点单的明细行 */
export interface ScanCheckItem {
  id: number
  productId: number
  productCode: string
  productName: string
  unit: string
  bookQty: number
  actualQty: number | null
  bookContainerCount: number
  scannedContainerCount: number
  scans: ScanEntry[]
}
export interface ScanCheckDetail {
  id: number
  checkNo: string
  warehouseId: number
  warehouseName: string
  status: number
  items: ScanCheckItem[]
}
