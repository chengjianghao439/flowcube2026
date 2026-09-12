import { collectOrderIssues } from '@/lib/orderEntry'
import type { SaleOrderItem } from '@/types/sale'
import type { ProductUnit } from '@/types/products'

export { PHONE_RE } from '@/lib/orderEntry'

export function parsePositiveQuantity(value: string) {
  if (!value.trim()) return 0
  const num = Number.parseFloat(value)
  return Number.isFinite(num) ? num : 0
}

export function parsePrice(value: string) {
  if (!value.trim()) return 0
  const num = Number.parseFloat(value)
  return Number.isFinite(num) ? num : 0
}

export interface DraftItem extends Omit<SaleOrderItem, 'id' | 'amount'> {
  _key: number
  spec?: string | null
  color?: string | null
  priceSource?: 'list' | 'default' | 'manual'
  units?: ProductUnit[]   // UI-only：该商品多计量单位（供单位下拉），不发后端；后端按 product_units 折算权威
}

/** 录入单位下的数量折算成基本单位量（仅前端呈现；权威折算在后端）。 */
export function baseQtyOf(item: DraftItem): number {
  const u = (item.units || []).find(x => x.unitName === (item.entryUnit || item.unit))
  const rate = u ? Number(u.conversionRate) : 1
  return Math.round((Number(item.quantity) || 0) * rate * 10000) / 10000
}

export interface ScanRow {
  rowKey: string
  productCode: string
  articleNumber?: string | null
  spec?: string | null
  productName: string
  color?: string | null
  unit: string
  barcode: string
  qtyLabel: string
  operatorName: string | null
  scannedAt: string | null
}

/** CreateView 和 EditView 共用的表单校验：通过则返回过滤后的有效明细，否则设置字段错误并返回 null（页面统一显示完整问题列表） */
export function validateSaleForm(input: {
  items: DraftItem[]
  customerId: string
  customerName: string
  warehouseId: string
  warehouseName: string
  receiverPhone: string
  discountAmount?: string | number
  priceLoading?: Record<number, boolean>
  priceErrors?: Record<number, string>
  setCustomerError: (v: boolean) => void
  setWarehouseError: (v: boolean) => void
  setInvalidItemKeys: (v: Set<number>) => void
}): DraftItem[] | null {
  const issues = collectOrderIssues({ ...input, kind: 'sale', partyId: input.customerId, partyName: input.customerName })
  input.setCustomerError(issues.some(i => i.target === 'party'))
  input.setWarehouseError(issues.some(i => i.target === 'warehouse'))
  input.setInvalidItemKeys(new Set(issues.flatMap(i => i.itemKey === undefined ? [] : [i.itemKey])))
  return issues.length ? null : input.items.filter(i => i.productId > 0)
}
