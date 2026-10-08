import type { KitDefinition } from '@/types/kits'
export const savedKit: KitDefinition = {
  id: 7, code: 'K7', name: '铰链套', isActive: true, deletedAt: null, revision: 3, currentVersionId: 19,
  categoryId: 2, categoryName: '五金配件', supplierId: 3, supplierName: '配件供应商', unit: '套', spec: 'H-10', color: '银色', articleNumber: 'SUP-H10', costPrice: 80, remark: '原资料',
  version: { id: 19, kitId: 7, versionNo: 2, referenceUnitPrice: 100, createdBy: 1, createdAt: '2026-10-01 09:00:00', referenceBasis: 'version_product_a_snapshot_or_explicit_weights', referenceSnapshotAt: null, referenceBasisExplanation: '原始采样时间未单独保存', components: [
    { id: 1, productId: 11, baseQty: 0.01, referencePrice: 0.0001, amountWeight: '0.000001', weightSource: 'product_a', sortNo: 0, productCode: 'P11', productName: '铰链', unit: '个', productActive: true, allowDecimal: true },
    { id: 2, productId: 12, baseQty: 4, referencePrice: 20, amountWeight: '80.000000', weightSource: 'product_a', sortNo: 1, productCode: 'P12', productName: '螺钉', unit: '粒', productActive: true, allowDecimal: false },
  ] },
}
