/** 商品计量单位（文档 03）：基本单位 rate 恒 1，辅助单位 rate>1 表示 1 本单位=N 基本单位 */
export interface ProductUnit { unitName: string; conversionRate: number; isBase: boolean }

export interface Product {
  batchManaged?: boolean
  /** 迁移 254：false = 该商品数量只能是整数（不允许小数出货） */
  allowDecimalQty?: boolean
  shelfLifeDays?: number | null
  safetyStock?: number | null
  reorderPoint?: number | null
  units?: ProductUnit[]
  id: number; code: string; name: string
  skuCode: string | null; articleNumber: string | null
  categoryId: number | null; categoryName: string | null
  supplierId: number | null; supplierName: string | null
  unit: string; spec: string | null; color: string | null; barcode: string | null
  costPrice: number | null; salePrice: number | null
  salePriceA?: number | null; salePriceB?: number | null; salePriceC?: number | null; salePriceD?: number | null
  /**
   * 标签使用的原始 `product_items.sale_price`（**只读**）。
   *
   * 写入面（**不要简写成"只由审批写"**）：**新建时按价格A初始化** → **普通商品编辑不写它**
   * → **改价审批**（`price-change` 的 `sale` 类型）可把它调成与 A 不同的值。
   *
   * 与 `salePrice`（= 价格A）是两个不同的存储契约，别混用：`salePrice` 供详情/Finder/订单报价口径，
   * 本字段只在商品编辑页**只读展示**给员工看「标签上会印的价」。
   * 详见 `docs/export-filters-fix-2026-09-27.md` §18。
   */
  labelSalePrice?: number | null
  remark: string | null; isActive: boolean; createdAt: string
  /** 编辑乐观锁（迁移 264）：详情必返；编辑保存时必须原样回传，过期即 409 */
  revision: number
}
export interface CreateProductParams {
  name: string; categoryId?: number | null; supplierId: number
  unit: string; spec: string; color: string
  costPrice?: number | null; remark?: string
  batchManaged?: boolean; allowDecimalQty?: boolean; shelfLifeDays?: number | null
  safetyStock?: number | null; reorderPoint?: number | null
  units?: { unitName: string; conversionRate: number }[]
  skuCode?: string; articleNumber?: string
  salePriceA?: number | null; salePriceB?: number | null; salePriceC?: number | null; salePriceD?: number | null
}
export interface UpdateProductParams {
  name: string; categoryId?: number | null; supplierId: number
  unit: string; spec: string; color: string
  costPrice?: number | null; remark?: string; isActive: boolean
  batchManaged?: boolean; allowDecimalQty?: boolean; shelfLifeDays?: number | null
  safetyStock?: number | null; reorderPoint?: number | null
  units?: { unitName: string; conversionRate: number }[]
  articleNumber?: string
  salePriceA?: number | null; salePriceB?: number | null; salePriceC?: number | null; salePriceD?: number | null
  /**
   * 编辑乐观锁（迁移 264）：服务端**要求必填**（缺失即 400 `PRODUCT_REVISION_REQUIRED`），
   * 故这里也声明为**必填**——让类型检查守住将来新增的调用点，而不是等运行时 400。
   * 回传的应是「读取详情时拿到的」版本；不符即 409 `PRODUCT_VERSION_CONFLICT`。
   */
  revision: number
}

/** 数量小数策略（迁移 254）：商品级开关，供数量输入框联动 step */
export interface ProductQtyPolicy { id: number; allowDecimal: boolean }

/** 商品选择中心返回结果 */
export interface ProductFinderResult {
  barcode?: string | null
  id: number; code: string; name: string
  skuCode: string | null; articleNumber: string | null
  categoryId: number | null; categoryName: string | null
  categoryPath: string | null   // 完整路径，如"电子 > 手机 > 智能手机"
  supplierId: number | null; supplierName: string | null
  unit: string; spec: string | null; color: string | null
  salePrice: number | null; costPrice: number | null
  salePriceA?: number | null; salePriceB?: number | null; salePriceC?: number | null; salePriceD?: number | null
  stock: number                 // 当前仓库可用库存（未传 warehouseId 时为 0）
  /** 迁移 254：false = 该商品只能按整数出入库 */
  allowDecimalQty?: boolean
}

export interface ProductFinderParams {
  page?: number; pageSize?: number
  keyword?: string
  categoryId?: number | null
  warehouseId?: number | null
}
