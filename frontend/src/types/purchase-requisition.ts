import type { StatusTone } from '@/lib/statusTone'

export interface RequisitionItem {
  id?: number
  productId: number
  productCode?: string
  productName?: string
  unit?: string
  spec?: string | null
  quantity: number
  estimatedPrice?: number | null
  suggestedSupplierId?: number | null
  suggestedSupplierName?: string | null
  convertedQty?: number
  remark?: string | null
}

export interface PurchaseRequisition {
  id: number
  requisitionNo: string
  title: string | null
  warehouseId: number
  warehouseName: string
  applicantId: number
  applicantName: string
  estimatedAmount: number
  status: number
  statusName: string
  statusTone: StatusTone
  source: string
  itemCount?: number
  submittedAt: string | null
  approvedByName: string | null
  approvedAt: string | null
  rejectReason: string | null
  expectedDate: string | null
  remark: string | null
  createdAt: string
  items?: RequisitionItem[]
}

export interface CreateRequisitionParams {
  title?: string
  warehouseId: number
  expectedDate?: string | null
  source?: 'manual' | 'replenishment'
  items: Array<{ productId: number; quantity: number; estimatedPrice?: number | null; suggestedSupplierId?: number | null; remark?: string }>
  remark?: string
}

export interface ConvertLine {
  requisitionItemId: number
  quantity: number
  supplierId: number
  supplierName?: string
  unitPrice: number
}
