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
  unit: string | null
  orderedQty: number
  receivedQty: number
  putawayQty: number
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

export interface InboundExceptionFlags {
  failedPrintJobs: number
  timeoutPrintJobs: number
  overduePutawayContainers: number
  pendingAuditOverdue: boolean
  auditRejected: boolean
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
  }>
}

export interface ReceivePackageResult {
  containerCode: string | null
  containerId: number | null
  productName: string
  qty: number
  totalQty?: number
  printJobId: number | null
  printJobIds?: number[]
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
  status: 'waiting_putaway' | 'stored'
  locationId: number | null
  locationCode: string | null
  createdAt: string
}

export interface InboundContainersResult {
  waiting: InboundContainerRow[]
  stored: InboundContainerRow[]
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

export interface AuditInboundTaskParams {
  action: 'approve' | 'reject'
  remark?: string
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
  unit: string | null
  orderedQty: number
  assignedQty: number
  remainingQty: number
}
