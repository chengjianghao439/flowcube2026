export interface Location {
  id: number
  warehouseId: number
  warehouseName: string | null
  code: string
  barcode?: string | null
  zone: string | null
  aisle: string | null
  rack: string | null
  level: string | null
  position: string | null
  capacity: number
  status: number
  remark: string | null
  containerCount?: number
  createdAt: string
}

export const LOCATION_STATUS_OPTIONS = [
  { value: 1, label: '启用' },
  { value: 2, label: '停用' },
] as const

export interface CreateLocationParams {
  warehouseId: number
  code: string
  zone?: string
  aisle?: string
  rack?: string
  level?: string
  position?: string
  capacity?: number
  status?: number
  remark?: string
}

export interface UpdateLocationParams {
  code: string
  zone?: string
  aisle?: string
  rack?: string
  level?: string
  position?: string
  capacity?: number
  status?: number
  remark?: string
}
