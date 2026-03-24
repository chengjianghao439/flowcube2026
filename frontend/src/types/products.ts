export interface ProductCategory { id: number; name: string; sort: number }

export interface Product {
  id: number; code: string; name: string
  categoryId: number | null; categoryName: string | null
  unit: string; spec: string | null; barcode: string | null
  costPrice: number | null; salePrice: number | null
  remark: string | null; isActive: boolean; createdAt: string
}
export interface ProductOption { id: number; code: string; name: string; unit: string; spec: string | null }
export interface CreateProductParams { name: string; categoryId?: number | null; unit?: string; spec?: string; barcode?: string; costPrice?: number | null; salePrice?: number | null; remark?: string }
export interface UpdateProductParams { name: string; categoryId?: number | null; unit?: string; spec?: string; barcode?: string; costPrice?: number | null; salePrice?: number | null; remark?: string; isActive: boolean }

/** 商品选择中心返回结果 */
export interface ProductFinderResult {
  id: number; code: string; name: string
  categoryId: number | null; categoryName: string | null
  categoryPath: string | null   // 完整路径，如"电子 > 手机 > 智能手机"
  unit: string; spec: string | null
  salePrice: number | null; costPrice: number | null
  stock: number                 // 当前仓库可用库存（未传 warehouseId 时为 0）
}

export interface ProductFinderParams {
  page?: number; pageSize?: number
  keyword?: string
  categoryId?: number | null
  warehouseId?: number | null
}
