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
  /** 授信额度：null=不启用信控；>=0=启用（0=现款现货） */
  creditLimit: number | null
  isActive: boolean
  priceLevel?: 'A' | 'B' | 'C' | 'D'
  priceLevelName?: string
  createdAt: string
}
export interface CustomerOption { id: number; code: string; name: string; priceLevel?: 'A' | 'B' | 'C' | 'D' }

/** 客户常用收货地址（地址簿） */
export interface CustomerAddress {
  id: number
  customerId: number
  receiverName?: string | null
  receiverPhone?: string | null
  receiverAddress: string
  isDefault: boolean
  createdAt: string
}
export interface CustomerAddressWritable {
  receiverName?: string
  receiverPhone?: string
  receiverAddress: string
  isDefault?: boolean
}
export type CreateCustomerAddressParams = CustomerAddressWritable & { customerId: number }

interface CustomerWritableFields {
  name: string
  contact?: string
  phone?: string
  email?: string
  address?: string
  remark?: string
  settlementType?: SettlementType
  paymentTermsDays?: number
  creditLimit?: number | null
}
export type CreateCustomerParams = CustomerWritableFields
export type UpdateCustomerParams = CustomerWritableFields & { isActive: boolean }
