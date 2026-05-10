export interface Product {
  id: number; code: string; name: string
  skuCode: string | null; articleNumber: string | null
  categoryId: number | null; categoryName: string | null
  supplierId: number | null; supplierName: string | null
  unit: string; spec: string | null; color: string | null; barcode: string | null
  costPrice: number | null; salePrice: number | null
  salePriceA?: number | null; salePriceB?: number | null; salePriceC?: number | null; salePriceD?: number | null
  remark: string | null; isActive: boolean; createdAt: string
}
export interface ProductOption { id: number; code: string; name: string; unit: string; spec: string | null }
export interface CreateProductParams {
  name: string; categoryId?: number | null; supplierId: number
  unit: string; spec: string; color: string
  costPrice?: number | null; remark?: string
  skuCode?: string; articleNumber?: string
  salePriceA?: number | null; salePriceB?: number | null; salePriceC?: number | null; salePriceD?: number | null
}
export interface UpdateProductParams {
  name: string; categoryId?: number | null; supplierId: number
  unit: string; spec: string; color: string
  costPrice?: number | null; remark?: string; isActive: boolean
  articleNumber?: string
  salePriceA?: number | null; salePriceB?: number | null; salePriceC?: number | null; salePriceD?: number | null
}

/** 商品选择中心返回结果 */
export interface ProductFinderResult {
  id: number; code: string; name: string
  skuCode: string | null; articleNumber: string | null
  categoryId: number | null; categoryName: string | null
  categoryPath: string | null   // 完整路径，如"电子 > 手机 > 智能手机"
  supplierId: number | null; supplierName: string | null
  unit: string; spec: string | null; color: string | null
  salePrice: number | null; costPrice: number | null
  salePriceA?: number | null; salePriceB?: number | null; salePriceC?: number | null; salePriceD?: number | null
  stock: number                 // 当前仓库可用库存（未传 warehouseId 时为 0）
}

export interface ProductFinderParams {
  page?: number; pageSize?: number
  keyword?: string
  categoryId?: number | null
  warehouseId?: number | null
}
