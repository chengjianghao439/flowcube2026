export interface CheckItem {
  id: number
  productId: number
  productCode: string
  productName: string
  unit: string
  bookQty: number
  actualQty: number | null
  diffQty: number | null
}
export interface StockCheck {
  id: number
  checkNo: string
  warehouseId: number
  warehouseName: string
  status: 1 | 2 | 3
  statusName: string
  remark?: string
  operatorId: number
  operatorName: string
  createdAt: string
  items?: CheckItem[]
}
export interface CreateCheckParams { warehouseId: number; warehouseName: string; remark?: string }
