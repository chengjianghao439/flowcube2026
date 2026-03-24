export const WAREHOUSE_TYPES = [
  { value: 1, label: '成品仓' },
  { value: 2, label: '原料仓' },
  { value: 3, label: '退货仓' },
  { value: 4, label: '其他' },
] as const

export interface Warehouse {
  id: number
  code: string
  name: string
  type: number
  typeName: string
  manager: string | null
  phone: string | null
  address: string | null
  remark: string | null
  isActive: boolean
  createdAt: string
}

export interface WarehouseOption {
  id: number
  code: string
  name: string
  type: number
}

export interface CreateWarehouseParams {
  name: string
  type: number
  manager?: string
  phone?: string
  address?: string
  remark?: string
}

export interface UpdateWarehouseParams {
  name: string
  type: number
  manager?: string
  phone?: string
  address?: string
  remark?: string
  isActive: boolean
}
