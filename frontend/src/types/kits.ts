export interface KitComponent { id: number; productId: number; baseQty: number; referencePrice: number; amountWeight: string; weightSource: 'product_a' | 'explicit'; sortNo: number; productCode: string | null; productName: string | null; unit: string | null; productActive: boolean; allowDecimal: boolean }
export interface KitTierPrices { salePriceA?: number | null; salePriceB?: number | null; salePriceC?: number | null; salePriceD?: number | null }
export interface KitProductProfile {
  categoryId?: number | null; categoryName?: string | null; supplierId?: number | null; supplierName?: string | null
  unit?: string | null; spec?: string | null; color?: string | null; articleNumber?: string | null; costPrice?: number | null; remark?: string | null
}
export interface KitVersion extends KitTierPrices { id: number; kitId: number; versionNo: number; referenceUnitPrice: number; createdBy: number | null; createdAt: string; referenceBasis: 'version_product_a_snapshot_or_explicit_weights'; referenceSnapshotAt: string | null; referenceBasisExplanation: string; components: KitComponent[] }
export interface KitDefinition extends KitProductProfile, KitTierPrices { id: number; code: string; name: string; isActive: boolean; deletedAt: string | null; revision: number; currentVersionId: number; version: KitVersion | null }
export interface KitComponentInput { productId: number; baseQty: number; amountWeight?: number }
export interface CreateKitInput extends Omit<KitProductProfile, 'categoryName' | 'supplierName'>, KitTierPrices { code?: string; name: string; isActive: boolean; referenceUnitPrice?: number; components: KitComponentInput[] }
export type UpdateKitInput = Partial<CreateKitInput> & { revision: number }
export interface KitListParams { page: number; pageSize: number; keyword: string }
