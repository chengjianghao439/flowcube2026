import { hasQuantityPrecision } from './qtyStep'
export interface EntryIssue { target: string; message: string; itemKey?: number }
interface EntryItem { _key: number; productId: number; productName?: string; quantity: number; unitPrice: number }
interface EntryInput {
  kind: 'sale' | 'purchase'
  partyId: string; partyName: string; warehouseId: string; warehouseName: string
  items: EntryItem[]; receiverPhone?: string; discountAmount?: string | number
  priceLoading?: Record<number, boolean>; priceErrors?: Record<number, string>
}
export const PHONE_RE = /^[0-9+()\-\s]{3,30}$/
/** 仅录入反馈；价格、单位折算和库存等业务事实仍由后端校验。 */
export function collectOrderIssues(input: EntryInput): EntryIssue[] {
  const issues: EntryIssue[] = []
  const sale = input.kind === 'sale'
  if (!input.partyId || !input.partyName) issues.push({ target: 'party', message: sale ? '请选择客户' : '请选择供应商' })
  if (!input.warehouseId || !input.warehouseName) issues.push({ target: 'warehouse', message: '请选择仓库' })
  if (!(sale ? input.items.some(i => i.productId > 0) : input.items.length)) issues.push({ target: 'add', message: '请添加至少一条商品明细' })
  input.items.forEach((item, index) => {
    const add = (field: string, message: string) => issues.push({ target: `item-${item._key}-${field}`, itemKey: item._key, message: `第 ${index + 1} 行${item.productName ? `（${item.productName}）` : ''}：${message}` })
    if (!(item.productId > 0)) { if (!sale) add('product', '请选择商品'); return }
    if (!Number.isFinite(item.quantity) || item.quantity <= 0 || (!sale && !Number.isInteger(item.quantity))) add('quantity', sale ? '数量必须大于 0' : '数量必须为大于 0 的整数')
    else if (!hasQuantityPrecision(item.quantity)) add('quantity', '数量最多保留两位小数')
    if (!Number.isFinite(item.unitPrice) || (sale ? item.unitPrice <= 0 : item.unitPrice < 0)) add('price', sale ? '单价必须大于 0' : '单价必须为不小于 0 的有效数字')
    else if (input.priceLoading?.[item._key]) add('price', '正在查询价格，请稍候')
    else if (input.priceErrors?.[item._key]) add('price', input.priceErrors[item._key])
  })
  if (sale && input.receiverPhone && !PHONE_RE.test(input.receiverPhone)) issues.push({ target: 'phone', message: '请输入正确的联系电话' })
  const discount = Number(input.discountAmount || 0)
  const total = input.items.filter(i => i.productId > 0).reduce((sum, item) => sum + item.quantity * item.unitPrice, 0)
  if (sale && (!Number.isFinite(discount) || discount < 0 || (Number.isFinite(total) && discount > total))) issues.push({ target: 'discount', message: '折扣金额须为不小于 0 且不超过订单合计的有效数字' })
  return issues
}
