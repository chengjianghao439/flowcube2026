export type InboundTaskStatus = 1 | 2 | 3 | 4 | 5

export const INBOUND_STATUS_LABEL: Record<InboundTaskStatus, string> = {
  1: '待收货', 2: '收货中', 3: '待上架', 4: '已完成', 5: '已取消',
}

export const INBOUND_STATUS_VARIANT: Record<InboundTaskStatus, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  1: 'outline', 2: 'secondary', 3: 'default', 4: 'default', 5: 'destructive',
}

export interface InboundTaskItem {
  id: number
  taskId: number
  purchaseOrderId: number | null
  purchaseOrderNo: string | null
  purchaseItemId: number | null
  productId: number
  productCode: string | null
  productName: string
  articleNumber: string | null
  spec: string | null
  color: string | null
  unit: string | null
  orderedQty: number
  receivedQty: number
  putawayQty: number
  qaRequired?: boolean      // 来料质检行（文档07）
  checkedQty?: number       // 已质检量（合格+让步+拒收）
  rejectedQty?: number      // 拒收量（不入库不结算）
  concessionQty?: number    // 让步接收量（合格量的子集，旁路统计）
  unitPrice: number | null
  /** 序列号管控商品：PDA 收货需逐台扫序列号登记（每箱 SN 数 == 箱数量） */
  serialManaged?: boolean
}

export interface InboundStatusView {
  key: string
  label: string
}

export interface InboundPrintSummary {
  total: number
  queued: number
  printing: number
  success: number
  failed: number
  timeout: number
}

export interface InboundPutawaySummary {
  waitingContainers: number
  storedContainers: number
  waitingQty: number
  storedQty: number
  overdueContainers: number
}

export interface InboundTimelineEvent {
  id: number
  eventType: string
  title: string
  description: string | null
  payload: Record<string, unknown> | null
  createdBy: number | null
  createdByName: string | null
  createdAt: string
}

export interface InboundRecentPrintJob {
  id: number
  status: number
  statusKey: 'queued' | 'printing' | 'success' | 'failed' | 'timeout' | 'cancelled'
  statusLabel: string
  printerCode: string | null
  printerName: string | null
  errorMessage: string | null
  dispatchReason: string | null
  containerId: number | null
  barcode: string | null
  productId: number | null
  productCode: string | null
  productName: string | null
  qty: number
  createdAt: string
  updatedAt: string
}

export interface InboundPrintBatch {
  batchKey: string
  title: string
  dispatchReason: string | null
  dispatchReasonLabel: string
  statusKey: 'queued' | 'printing' | 'success' | 'failed' | 'timeout' | 'cancelled'
  statusLabel: string
  total: number
  queued: number
  printing: number
  success: number
  failed: number
  timeout: number
  cancelled: number
  firstCreatedAt: string
  lastUpdatedAt: string
  printerNames: string[]
  barcodes: string[]
  latestErrorMessage: string | null
}

export interface InboundExceptionFlags {
  failedPrintJobs: number
  timeoutPrintJobs: number
  overduePutawayContainers: number
  hasException: boolean
}

export interface InboundTask {
  id: number
  taskNo: string
  purchaseOrderId: number | null
  purchaseOrderNo: string | null
  supplierName: string | null
  warehouseId: number
  warehouseName: string | null
  status: InboundTaskStatus
  statusName: string
  loopStatus?: 'pending_receive' | 'pending_putaway' | 'done' | 'cancelled' | 'unknown'
  operatorId: number | null
  operatorName: string | null
  remark: string | null
  submittedAt?: string | null
  submittedBy?: number | null
  submittedByName?: string | null
  auditStatus?: number
  qaStatus?: number         // 0无需/无待质检 1有待质检容器 2已完成（文档07）
  auditRemark?: string | null
  auditedAt?: string | null
  auditedBy?: number | null
  auditedByName?: string | null
  orderedQty?: number
  receivedQty?: number
  putawayQty?: number
  lineCount?: number
  receiptStatus?: InboundStatusView
  printStatus?: InboundStatusView
  putawayStatus?: InboundStatusView
  auditFlowStatus?: InboundStatusView
  printSummary?: InboundPrintSummary
  putawaySummary?: InboundPutawaySummary
  timeline?: InboundTimelineEvent[]
  recentPrintJobs?: InboundRecentPrintJob[]
  printBatches?: InboundPrintBatch[]
  exceptionFlags?: InboundExceptionFlags
  createdAt: string
  updatedAt: string
  items?: InboundTaskItem[]
}

/** 逐包收货：单次一包，生成一个待上架容器并排队打印标签 */
export interface ReceiveParams {
  productId: number
  qty?: number
  packages?: Array<{
    qty: number
    /** 序列号管控商品：该箱逐台扫入的序列号，长度须等于该箱 qty；非管控商品省略 */
    serialNos?: string[]
  }>
  confirmOverReceive?: boolean
  /** 重复扫码防护：后端 30 秒内发现同商品同箱型的重复提交会要求确认，确认后带上放行 */
  confirmDuplicate?: boolean
  /** 超收原因码：确认超收时必填，写入 over_receive 事件供财务追溯 */
  overReceiveReason?: 'supplier_over_delivery' | 'previous_short_makeup' | 'scan_mistake' | 'other'
  /** 错货防护：扫码核对通过时带上原始扫码值，后端兜底比对商品条码/编码 */
  scannedBarcode?: string
  /** 批次/效期（batch_managed 商品后端强制；效期可由生产日期+保质期推算） */
  batchNo?: string
  mfgDate?: string
  expDate?: string
}

export interface ReceivePackageResult {
  containerCode: string | null
  containerId: number | null
  productName: string
  qty: number
  totalQty?: number
  printJobId: number | null
  printJobIds?: number[]
  noPrinterCount?: number
  containers?: Array<{
    containerCode: string
    containerId: number
    qty: number
  }>
}

/** 上架：单容器单库位 */
export interface PutawayParams {
  containerId: number
  locationId: number
  /** 定向上架偏离留痕：扫到非推荐库位并确认后带上 */
  deviatedFromSuggestion?: boolean
  suggestedLocationCode?: string
}

export interface InboundContainerRow {
  id: number
  barcode: string
  taskId: number | null
  productId: number
  productCode: string | null
  productName: string | null
  qty: number
  unit: string | null
  status: 'waiting_putaway' | 'stored' | 'rejected'
  locationId: number | null
  locationCode: string | null
  createdAt: string
}

export interface InboundContainersResult {
  waiting: InboundContainerRow[]
  stored: InboundContainerRow[]
  rejected: InboundContainerRow[]   // 质检拒收容器（REJECTED，文档07 Phase2），处置后转 VOID 即消失
}

/** 来料质检拒收处置单（文档07 Phase2）：退供应商/报废，只消费 REJECTED 容器、零 GL */
export interface QaDispositionItem {
  id: number
  inboundTaskItemId: number | null
  productId: number
  productCode: string | null
  productName: string
  unit: string | null
  quantity: number
  unitPrice: number
  amount: number
  containerCount: number
}

export interface QaDisposition {
  id: number
  dispositionNo: string
  inboundTaskId: number
  inboundTaskNo: string | null
  purchaseOrderId: number | null
  purchaseOrderNo: string | null
  supplierId: number | null
  supplierName: string | null
  warehouseId: number
  warehouseName: string | null
  dispositionType: 1 | 2       // 1退供应商 2报废
  dispositionTypeName: string
  status: 1 | 2                 // 1待扫出（PDA 物理出场确认中） 2已完成
  statusName: string
  scannedCount: number | null  // 已扫出容器数
  pendingCount: number | null  // 待扫出容器数
  totalQty: number
  totalAmount: number          // 参考货值（拒收量×采购单价），非入账金额
  containerCount: number
  reason: string | null
  remark: string | null
  operatorId: number | null
  operatorName: string | null
  createdAt: string
  items: QaDispositionItem[]
}

// PDA 拒收处置扫出：单个处置单的待扫/已扫容器清单（文档07 Phase3）
export interface QaDispositionScanContainer {
  id: number
  containerId: number
  barcode: string
  qty: number
  productId: number
  productName: string | null
  productCode: string | null
  scanned: boolean
  scannedAt: string | null
}
export interface QaDispositionScanDetail extends QaDisposition {
  containers: QaDispositionScanContainer[]
}
export interface QaDisposeScanResult {
  dispositionId: number
  containerId: number
  barcode: string
  pending: number
  done: boolean
}

export interface QaDisposeParams {
  dispositionType: 1 | 2
  productIds?: number[]
  reason?: string
  remark?: string
}

export interface QaDisposeResult {
  id: number
  dispositionNo: string
  dispositionType: 1 | 2
  status: 1 | 2                // 新建恒为 1 待扫出
  totalQty: number
  totalAmount: number
  containerCount: number
}

export interface CreateInboundTaskResult {
  taskId: number
  taskNo: string
}

export interface CreateInboundTaskParams {
  supplierId: number
  supplierName: string
  remark?: string
  items: Array<{
    purchaseItemId: number
    qty: number
  }>
}

export interface ReprintInboundTaskParams {
  mode?: 'task' | 'item' | 'barcode'
  itemId?: number
  barcode?: string
}

export interface ReprintInboundTaskResult {
  taskId: number
  mode: 'task' | 'item' | 'barcode'
  count: number
  jobIds: number[]
  barcodes: string[]
}

export interface InboundPurchaseCandidate {
  purchaseItemId: number
  purchaseOrderId: number
  purchaseOrderNo: string
  supplierId: number
  supplierName: string
  warehouseId: number
  warehouseName: string
  productId: number
  productCode: string
  productName: string
  articleNumber: string | null
  spec: string | null
  color: string | null
  unit: string | null
  orderedQty: number
  assignedQty: number
  remainingQty: number
  receivedQty: number
  unitPrice: number
}
