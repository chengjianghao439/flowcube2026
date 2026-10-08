import type { CurrentReorderSource } from '@/types/sale-reorder'
import type { DraftItem } from './form/validate'
import type { CommercialDraftRow } from './commercial/commercialDraft'
import { validReorderQuantity } from '@/lib/saleReorder'
function ordinaryDrafts(data: CurrentReorderSource, include: boolean): Omit<DraftItem, '_key'>[] {
  const rows = new Map<number, Omit<DraftItem, '_key'>>()
  for (const item of data.items) {
    if (item.identity.kind !== 'ordinary') continue
    const { product: p, quote: q, identity: identity } = item
    if (!p || !q || item.error) throw new Error('当前商品或报价未核对，原行保留')
    const qty = include && identity.baseUnit === p.unit && validReorderQuantity(identity.baseQty, p.allowDecimalQty === false) ? identity.baseQty : 0
    const old = rows.get(p.id)
    if (old) old.quantity = Math.round((old.quantity + qty) * 100) / 100
    else rows.set(p.id, { productId: p.id, productCode: p.code, productName: p.name, articleNumber: p.articleNumber, spec: p.spec, color: p.color, unit: p.unit, entryUnit: p.unit, units: p.units ?? [], quantity: qty, unitPrice: q.salePrice, priceSource: 'list', resolvedPrice: q.salePrice, resolvedPriceLevel: q.priceLevel, priceExplanation: q.source === 'price_list' ? { kind: 'price_list', name: q.priceLevelName } : q.source === 'price_level' ? { kind: 'price_level', name: q.priceLevelName, level: q.priceLevel } : { kind: 'unknown' }, costPrice: p.costPrice, remark: '' })
  }
  return [...rows.values()].map(row => ({ ...row, quantity: validReorderQuantity(row.quantity) ? row.quantity : 0 }))
}
export const ordinaryReorderDrafts = ordinaryDrafts
export function commercialReorderDrafts(data: CurrentReorderSource, include: boolean): CommercialDraftRow[] {
  const ordinary = ordinaryDrafts(data, include).map(p => ({ input: { lineKey: crypto.randomUUID(), kind: 'ordinary' as const, productId: p.productId, entryUnit: p.unit, quantity: p.quantity, priceSource: 'default' as const }, name: p.productName, code: p.productCode, spec: p.spec, color: p.color, articleNumber: p.articleNumber, costPrice: p.costPrice, unit: p.unit, baseUnit: p.unit, quantity: String(p.quantity), price: String(p.unitPrice), units: p.units ?? [], allowDecimalQty: data.items.find(i => i.product?.id === p.productId)?.product?.allowDecimalQty, packagingExpressible: true }))
  const kits = data.items.flatMap(item => {
    if (item.identity.kind !== 'kit') return []
    const k = item.kit
    if (!k?.version || item.error) throw new Error('当前套版本未核对，原行保留')
    const quantity = include && k.currentVersionId === item.identity.originalKitVersionId && validReorderQuantity(item.identity.quantity, true) ? item.identity.quantity : 0
    return [{ input: { lineKey: crypto.randomUUID(), kind: 'kit' as const, kitVersionId: k.currentVersionId, quantity, priceSource: 'kit_default' as const }, name: k.name, code: k.code, unit: k.unit || '套', baseUnit: k.unit || '套', quantity: String(quantity), price: String(k.version.referenceUnitPrice), units: [], packagingExpressible: true }]
  })
  return [...kits, ...ordinary]
}
