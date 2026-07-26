import type { SettlementType } from '@/generated/status'

export interface Supplier {
  id: number
  code: string
  name: string
  contact: string | null
  phone: string | null
  email: string | null
  address: string | null
  remark: string | null
  /** 结算方式：1现结 2月结 */
  settlementType: SettlementType
  settlementTypeName: string
  /** 应付账期天数，仅月结有意义（30/60/90）；其余结算方式由服务端强制归零 */
  paymentTermsDays: number
  isActive: boolean
  createdAt: string
}
export interface SupplierOption { id: number; code: string; name: string }

interface SupplierWritableFields {
  name: string
  contact?: string
  phone?: string
  email?: string
  address?: string
  remark?: string
  settlementType?: SettlementType
  paymentTermsDays?: number
}
export type CreateSupplierParams = SupplierWritableFields
export type UpdateSupplierParams = SupplierWritableFields & { isActive: boolean }
