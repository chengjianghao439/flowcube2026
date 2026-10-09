import { expect, test } from 'vitest'
import { mapSaleOrderToPrint, mapPurchaseOrderToPrint } from './orderPrintData'
import type { SaleOrder } from '@/types/sale'
import type { PurchaseOrder } from '@/types/purchase'

test('sales print keeps gross field compatible and supplies discount and net for the same order', () => {
  const order = { totalAmount: 226.3, discountAmount: 1.2345, items: [{ productCode: 'P1', productName: '商品', unit: '个', quantity: 1, unitPrice: 23.1234, amount: 23.12 }] } as SaleOrder
  const result = mapSaleOrderToPrint(order)
  expect(result.data.totalAmount).toBe('¥226.30')
  expect(result.data.discountAmount).toBe('¥1.23')
  expect(result.data.netAmount).toBe('¥225.07')
  expect(result.items[0].priceText).toBe('¥23.1234')
  expect(mapSaleOrderToPrint({ ...order, discountAmount: 0 }).data.netAmount).toBe('¥226.30')
  const purchase = mapPurchaseOrderToPrint({ totalAmount: 226.3, items: [] } as unknown as PurchaseOrder)
  expect(purchase.data.totalAmount).toBe('¥226.30')
  expect(purchase.data.netAmount).toBeUndefined()
})
