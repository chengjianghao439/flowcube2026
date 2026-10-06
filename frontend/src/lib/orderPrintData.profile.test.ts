import { expect, test } from 'vitest'
import { mapSaleOrderToPrint, mapPurchaseOrderToPrint, mapInboundTaskToPrint, mapReturnOrderToPrint } from './orderPrintData'
import type { SaleOrder } from '@/types/sale'
import type { PurchaseOrder } from '@/types/purchase'
import type { InboundTask } from '@/types/inbound-tasks'

test('销售/采购/收货/退货打印适配器完整透传100字符企业名与200字符地址', () => {
  const name = '𠮷'.repeat(100); const address = '详细地址'.repeat(50)
  expect(mapSaleOrderToPrint({ customerName: name, receiverAddress: address } as SaleOrder).data).toMatchObject({ customerName: name, receiverAddress: address })
  expect(mapPurchaseOrderToPrint({ supplierName: name } as PurchaseOrder).data.supplierName).toBe(name)
  expect(mapInboundTaskToPrint({ supplierName: name } as InboundTask).data.supplierName).toBe(name)
  expect(mapReturnOrderToPrint({ customerName: name }).data.customerName).toBe(name)
  expect(mapReturnOrderToPrint({ supplierName: name, type: 'purchase' }).data.supplierName).toBe(name)
})
