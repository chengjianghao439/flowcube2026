export interface Supplier {
  id: number
  code: string
  name: string
  contact: string | null
  phone: string | null
  email: string | null
  address: string | null
  remark: string | null
  isActive: boolean
  createdAt: string
}
export interface SupplierOption { id: number; code: string; name: string }
export interface CreateSupplierParams { name: string; contact?: string; phone?: string; email?: string; address?: string; remark?: string }
export interface UpdateSupplierParams { name: string; contact?: string; phone?: string; email?: string; address?: string; remark?: string; isActive: boolean }
