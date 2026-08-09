import type { InboundStatusView } from './inbound-tasks'

export interface PurchaseOrderItem {
  id: number
  productId: number
  productCode: string
  productName: string
  unit: string
  entryUnit?: string        // 录入单位（文档03 Phase2）；缺省=基本单位 unit。quantity/unitPrice 视作该单位下的量/价
  articleNumber?: string | null
  spec?: string | null
  color?: string | null
  quantity: number          // 基本单位量（= entryQty × conversionRate，后端折算权威）
  entryQty?: number         // 录入单位下的数量（回显用）
  conversionRate?: number   // 1 录入单位 = N 基本单位（回显用）
  unitPrice: number
  amount: number
  remark?: string
}
export interface PurchaseOrder {
  id: number
  orderNo: string
  supplierId: number
  supplierName: string
  warehouseId: number
  warehouseName: string
  status: 1 | 2 | 3 | 4 | 5
  statusName: string
  expectedDate?: string
  totalAmount: number
  totalOrderedQty?: number
  totalReceivedQty?: number
  /** 是否满足"关闭剩余"的前提（相关收货订单均已上架完成 + 已有实收数量）；仅列表接口返回 */
  canCloseRemaining?: boolean
  /** 审计 4.7：是否需审批（金额超阈值），待审批单 status=5 */
  needApproval?: boolean
  approvedById?: number | null
  approvedByName?: string | null
  approvedAt?: string | null
  rejectReason?: string | null
  remark?: string
  operatorId: number
  operatorName: string
  createdAt: string
  items?: PurchaseOrderItem[]
  inboundTasks?: { id: number; taskNo: string; status: number; receiptStatus?: InboundStatusView }[]
}
export interface CreatePurchaseParams {
  supplierId: number
  supplierName: string
  warehouseId: number
  warehouseName: string
  expectedDate?: string
  remark?: string
  items: Omit<PurchaseOrderItem, 'id' | 'amount'>[]
}
