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
  productId: number
  productCode: string | null
  productName: string
  unit: string | null
  orderedQty: number
  receivedQty: number
  putawayQty: number
}

export interface InboundTask {
  id: number
  taskNo: string
  purchaseOrderId: number
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
  createdAt: string
  updatedAt: string
  items?: InboundTaskItem[]
}

/** 逐包收货：单次一包，生成一个待上架容器并排队打印标签 */
export interface ReceiveParams {
  productId: number
  qty: number
}

export interface ReceivePackageResult {
  containerCode: string
  containerId: number
  productName: string
  qty: number
  printJobId: number | null
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
