export interface CheckItem {
  id: number
  productId: number
  productCode: string
  productName: string
  unit: string
  bookQty: number
  actualQty: number | null
  diffQty: number | null
  /** 序列号管控商品（文档04 Phase3b·C-full）：实盘数由 PDA 逐台扫码派生，不可手填 */
  serialManaged?: boolean
  /** 以下三项仅序列号商品返回：现场扫到的台 / 账面有但没扫到(盘亏) / 扫到但账面没有(盘盈) */
  scannedSerials?: string[]
  missingSerials?: string[]
  surplusSerials?: string[]
}

/** PDA 盘点任务池：进行中、含序列号商品的盘点单 */
export interface PendingSerialCheck {
  id: number
  checkNo: string
  warehouseId: number
  warehouseName: string
  createdAt: string
  serialItemCount: number
  pendingCount: number
}

/** PDA 盘点作业页：某盘点单的序列号商品行 */
export interface SerialCheckItem {
  id: number
  productId: number
  productCode: string
  productName: string
  unit: string
  bookQty: number
  actualQty: number | null
  scannedCount: number
}
export interface SerialCheckDetail {
  id: number
  checkNo: string
  warehouseId: number
  warehouseName: string
  status: number
  items: SerialCheckItem[]
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
