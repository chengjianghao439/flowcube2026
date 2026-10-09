import type { CommercialBody, CommercialPreview } from '@/types/sale-commercial'
export function saleEditorTestPreview(body: CommercialBody): CommercialPreview {
  const groups = body.commercialGroups.map(input => {
    const rate = input.kind === 'ordinary' && input.entryUnit === '箱' ? 12 : 1
    const price = input.unitPrice ?? 10
    const quantity = input.quantity * rate
    const amount = Math.round(input.quantity * price * 100) / 100
    return { id: 0, lineKey: input.lineKey, kind: input.kind, warehouseId: input.warehouseId ?? body.warehouseId,
      kitVersionId: input.kind === 'kit' ? input.kitVersionId : null, kitCode: null, kitName: input.kind === 'kit' ? '套装' : null,
      originalQty: quantity, targetQty: quantity, quantity, unitPrice: price / rate, amount, originalAmount: amount, priceSource: input.priceSource,
      metadata: { input, priceCustomerId: body.customerId, quote: { referenceUnitPrice: 10, resolvedPriceSource: 'price_level', resolvedPriceLevel: 'A', priceListId: null },
        entry: input.kind === 'ordinary' ? { entryUnit: input.entryUnit ?? '个', entryQty: input.quantity, conversionRate: rate, entryUnitPrice: price } : null },
      components: [{ productId: input.kind === 'ordinary' ? input.productId : 9, productCode: 'P-9', productName: '示例商品', unit: '个', baseQty: 1 }]
    }
  })
  return { customerId: body.customerId, warehouseId: body.warehouseId, commercialGroups: groups, amount: groups.reduce((sum,g) => sum+g.amount,0),
    physicalItems: [], canFulfillEntireVector: true, expected: null, readyDate: null, readyDateExplanation: '', inventoryExplanation: '' }
}
