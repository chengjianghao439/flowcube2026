import { collectOrderIssues } from '@/lib/orderEntry'
import { roundQuantity } from '@/lib/qtyStep'
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

/** 仅供界面解释本次取得的单价，不作为定价凭据或金额事实源。 */
export type PriceExplanation =
  | { kind: 'price_list'; name: string }
  | { kind: 'price_level'; name: string; level: string | null }
  | { kind: 'default' | 'manual' | 'saved' | 'unknown' }

export interface DraftItem extends Omit<SaleOrderItem, 'id' | 'amount'> {
  _key: number
  spec?: string | null
  color?: string | null
  priceSource?: 'list' | 'default' | 'manual'
  priceExplanation?: PriceExplanation // UI-only：不保存、不参与脏检查
  units?: ProductUnit[]   // 旧草稿兼容字段；新销售没有单位选择，不提交后端
}

/** 新建、编辑、改单共用：剥离界面字段，业务量价与原定价凭据原样提交。 */
export function serializeSaleItems(items: DraftItem[]): Array<Omit<DraftItem, '_key' | 'units' | 'priceExplanation'>> {
  return items.map(({ _key: _key, units: _units, priceExplanation: _priceExplanation, ...item }) => item)
}

/** 原单量的展示：仅使用原单保存的换算率，新行固定单位率为 1。 */
export function baseQtyOf(item: DraftItem): number {
  const rate = (item.entryUnit || item.unit) === item.unit ? 1 : Number(item.conversionRate || 1)
  return roundQuantity((Number(item.quantity) || 0) * rate)
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
