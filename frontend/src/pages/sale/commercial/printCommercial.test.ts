import { expect, it } from 'vitest'
import { mapSaleOrderToPrint } from '@/lib/orderPrintData'
import { adaptTemplatePreview } from '@/lib/printTemplatePreview'
import type { SaleOrder } from '@/types/sale'
const order = {
  commercialModel: 'kit-v1',
  totalAmount: 24.69,
  createdAt: '2026-10-01',
  items: [
    { productCode: 'physical', productName: '物理汇总', unit: '个', quantity: 20, unitPrice: 1.2345, amount: 24.69 }
  ],
  commercialGroups: [
    {
      id: 1,
      kind: 'ordinary',
      originalQty: 20,
      targetQty: 20,
      amount: 24.69,
      unitPrice: 1.23456,
      metadata: { entry: { entryUnit: '包', entryQty: 2, conversionRate: 10, entryUnitPrice: 12.3456 } },
      components: [{ productCode: 'P', productName: '螺钉', unit: '个' }]
    }
  ]
} as unknown as SaleOrder
it('customer print uses commercial packaging and four decimal quote instead of merged physical rows', () => {
  expect(mapSaleOrderToPrint(order).items[0]).toMatchObject({ productCode: 'P', quantity: 2, unit: '包' })
  expect(adaptTemplatePreview({ kind: 'sale', type: 1, sourceLabel: '本单', record: order }).items[0].price).toBe(
    '¥12.3456'
  )
})
it('ordinary print keeps old two decimal formatting', () => {
  expect(
    adaptTemplatePreview({ kind: 'sale', type: 1, sourceLabel: '本单', record: { ...order, commercialModel: null } })
      .items[0].price
  ).toBe('¥1.23')
})
