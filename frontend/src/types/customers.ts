export interface Customer {
  id: number
  code: string
  name: string
  contact?: string
  phone?: string
  email?: string
  address?: string
  remark?: string
  isActive: boolean
  createdAt: string
}
export interface CustomerOption { id: number; code: string; name: string }
export interface CreateCustomerParams { name: string; contact?: string; phone?: string; email?: string; address?: string; remark?: string }
export interface UpdateCustomerParams { name: string; contact?: string; phone?: string; email?: string; address?: string; remark?: string; isActive: boolean }
