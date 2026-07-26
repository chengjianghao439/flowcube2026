import type { SettlementType } from '@/generated/status'

export interface Customer {
  id: number
  code: string
  name: string
  contact?: string
  phone?: string
  email?: string
  address?: string
  remark?: string
  /** 结算方式：1现结 2月结 */
  settlementType: SettlementType
  settlementTypeName: string
  /** 应收账期天数，仅月结有意义（30/60/90）；其余结算方式由服务端强制归零 */
  paymentTermsDays: number
  isActive: boolean
  priceLevel?: 'A' | 'B' | 'C' | 'D'
  priceLevelName?: string
  createdAt: string
}
export interface CustomerOption { id: number; code: string; name: string; priceLevel?: 'A' | 'B' | 'C' | 'D' }

interface CustomerWritableFields {
  name: string
  contact?: string
  phone?: string
  email?: string
  address?: string
  remark?: string
  settlementType?: SettlementType
  paymentTermsDays?: number
}
export type CreateCustomerParams = CustomerWritableFields
export type UpdateCustomerParams = CustomerWritableFields & { isActive: boolean }
