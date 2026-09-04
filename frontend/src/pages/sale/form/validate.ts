import { toast } from '@/lib/toast'
import type { SaleOrderItem } from '@/types/sale'
import type { ProductUnit } from '@/types/products'

export const PHONE_RE = /^[0-9+()\-\s]{3,30}$/

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

/** CreateView 和 EditView 共用的表单校验：通过则返回过滤后的有效明细，否则弹 toast 提示并返回 null */
export function validateSaleForm(input: {
  items: DraftItem[]
  customerId: string
  customerName: string
  warehouseId: string
  warehouseName: string
  receiverPhone: string
  setCustomerError: (v: boolean) => void
  setWarehouseError: (v: boolean) => void
  setInvalidItemKeys: (v: Set<number>) => void
}): DraftItem[] | null {
  const { items, customerId, customerName, warehouseId, warehouseName, receiverPhone, setCustomerError, setWarehouseError, setInvalidItemKeys } = input
  const filledItems = items.filter(i => i.productId > 0)
  const missingCustomer = !customerId || !customerName
  const missingWarehouse = !warehouseId || !warehouseName
  setCustomerError(missingCustomer)
  setWarehouseError(missingWarehouse)
  if (missingCustomer) { toast.warning('请选择客户'); return null }
  if (missingWarehouse) { toast.warning('请选择仓库'); return null }
  if (!filledItems.length) { toast.warning('请添加至少一条明细'); return null }
  const badItemKeys = new Set(filledItems.filter(i => i.quantity <= 0 || i.unitPrice <= 0).map(i => i._key))
  setInvalidItemKeys(badItemKeys)
  if (filledItems.find(i => !Number.isFinite(i.quantity) || i.quantity <= 0)) { toast.warning('销售数量必须大于 0'); return null }
  if (filledItems.find(i => i.unitPrice <= 0)) { toast.warning('商品价格必须大于 0'); return null }
  if (receiverPhone && !PHONE_RE.test(receiverPhone)) { toast.warning('请输入正确的联系电话'); return null }
  return filledItems
}
