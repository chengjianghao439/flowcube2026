export interface Rack {
  id: number
  warehouseId: number
  warehouseName: string | null
  /** 唯一条码 Hxxxxxx */
  barcode: string | null
  zone: string
  code: string
  name: string
  maxLevels: number
  maxPositions: number
  status: number
  remark: string | null
  createdAt: string
}

export const RACK_STATUS_OPTIONS = [
  { value: 1, label: '启用' },
  { value: 2, label: '停用' },
] as const

export interface CreateRackParams {
  warehouseId: number
  zone?: string
  code: string
  name?: string
  maxLevels?: number
  maxPositions?: number
  remark?: string
}

export interface UpdateRackParams {
  zone?: string
  code?: string
  name?: string
  maxLevels?: number
  maxPositions?: number
  status?: number
  remark?: string
}
