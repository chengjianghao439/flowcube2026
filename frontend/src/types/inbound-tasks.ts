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
  operatorId: number | null
  operatorName: string | null
  remark: string | null
  createdAt: string
  updatedAt: string
  items?: InboundTaskItem[]
}

export interface ReceiveParams {
  items: { itemId: number; qty: number }[]
}

export interface PutawayParams {
  items: { itemId: number; qty: number; locationId?: number }[]
}
