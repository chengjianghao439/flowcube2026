import type { ProductUnit } from '@/types/products'

/**
 * 多计量单位只读友好展示（文档 03 · Phase 1）。把「基本单位数量」友好折算成最大的辅助单位，
 * 如基本单位=件、配了 1 箱=12 件，60 → "60 件（5 箱）"，不能整除则退回只显示基本单位。
 * 纯展示：库存/结算永远用基本单位数，本函数只给人看，绝不参与任何计算。
 */
export function formatQtyWithUnits(baseQty: number, units?: ProductUnit[] | null): string {
  const qty = Number(baseQty)
  const base = units?.find(u => u.isBase)
  const baseName = base?.unitName ?? ''
  const head = `${qty}${baseName ? ` ${baseName}` : ''}`
  if (!Number.isFinite(qty) || !units || units.length <= 1) return head
  // 取换算率最大且能整除的辅助单位做友好副显
  const aux = units.filter(u => !u.isBase && u.conversionRate > 1).sort((a, b) => b.conversionRate - a.conversionRate)
  const fit = aux.find(u => qty % u.conversionRate === 0 && qty >= u.conversionRate)
  if (!fit) return head
  return `${head}（${qty / fit.conversionRate} ${fit.unitName}）`
}
