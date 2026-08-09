/** 已收款退货退款单（P2-6） */

export interface RefundOrder {
  id: number
  refundNo: string
  saleOrderId: number
  saleOrderNo: string
  customerName: string
  amount: number
  status: 1 | 2 | 3 | 4
  statusName: string
  paymentRecordId: number | null
  accountId: number | null
  refundDate: string | null
  remark: string | null
  operatorId: number | null
  operatorName: string | null
  confirmedByName: string | null
  confirmedAt: string | null
  refundedAt: string | null
  createdAt: string
}

export interface CreateRefundParams {
  saleOrderId?: number | null
  saleOrderNo?: string
  amount: number
  accountId?: number | null
  refundDate?: string
  remark?: string
}
