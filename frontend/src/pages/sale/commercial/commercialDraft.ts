import { commercialUnit } from '@/lib/saleCommercialDisplay'
import type { CommercialGroup, CommercialInput, CommercialComponent } from '@/types/sale-commercial'
import type { SaleOrder } from '@/types/sale'
import type { ProductUnit } from '@/types/products'
export interface CommercialDraftRow {
  input: CommercialInput
  name: string
  code: string
  unit: string
  quantity: string
  price: string
  units: ProductUnit[]
  baseUnit?: string
  spec?: string | null
  color?: string | null
  articleNumber?: string | null
  costPrice?: number | null
  allowDecimalQty?: boolean
  saved?: CommercialGroup
  components?: CommercialComponent[]
  packagingExpressible: boolean
}
export function draftFromGroups(groups: CommercialGroup[]): CommercialDraftRow[] {
  return groups.map((g) => {
    const entry = g.metadata.entry,
      input = { ...g.metadata.input }
    const q = g.kind === 'ordinary' && entry ? g.targetQty / entry.conversionRate : g.targetQty
    const packagingExpressible = Math.abs(q * 100 - Math.round(q * 100)) < 1e-6
    return {
      input,
      name: g.kind === 'kit' ? (g.kitName ?? '原套') : (g.components[0]?.productName ?? ''),
      code: g.kind === 'kit' ? (g.kitCode ?? '') : (g.components[0]?.productCode ?? ''),
      unit: g.kind === 'kit' ? commercialUnit(g) : input.kind === 'ordinary' ? (input.entryUnit ?? g.components[0]?.unit ?? '') : '',
      quantity: String(packagingExpressible ? Math.round(q * 100) / 100 : q),
      price: String(input.unitPrice ?? (g.kind === 'kit' ? g.unitPrice : (entry?.entryUnitPrice ?? g.unitPrice))),
      units: [],
      baseUnit: commercialUnit(g),
      spec: g.kind === 'kit' ? g.metadata.kitIdentity?.spec : g.components[0]?.spec,
      color: g.kind === 'kit' ? g.metadata.kitIdentity?.color : g.components[0]?.color,
      articleNumber: g.kind === 'kit' ? g.metadata.kitIdentity?.articleNumber : g.components[0]?.articleNumber,
      allowDecimalQty: g.kind === 'ordinary' ? undefined : false,
      saved: g,
      packagingExpressible
    }
  })
}
/** Legacy storage is adapted once; both edit paths use the same input contract. */
export function draftFromOrder(order?: SaleOrder): CommercialDraftRow[] {
  if (!order || order.commercialModel === 'kit-v1') return draftFromGroups(order?.commercialGroups ?? [])
  return (order.items ?? []).filter(item => item.quantity > 0).map(item => {
    const entryUnit = item.entryUnit || item.unit
    const rate = entryUnit === item.unit ? 1 : item.conversionRate
    const quantity = item.entryQty ?? item.quantity
    // Saved base price has eight digits; recover the four-digit entry quote using the saved rate.
    // Dividing the rounded line amount by quantity would change the agreed quote.
    const price = rate && rate > 0 ? Math.round(item.unitPrice * rate * 10000) / 10000 : NaN
    const packagingExpressible = Number.isFinite(price) && price > 0 && Math.abs(quantity * 100 - Math.round(quantity * 100)) < 1e-6
    return {
      input: { kind: 'ordinary', lineKey: `ordinary:${item.id}`, productId: item.productId,
        warehouseId: item.warehouseId ?? order.warehouseId, entryUnit, quantity,
        priceSource: 'manual', ...(packagingExpressible ? { unitPrice: price } : {}), remark: item.remark ?? '' },
      name: item.productName, code: item.productCode, unit: entryUnit, baseUnit: item.unit,
      spec: item.spec, color: item.color, articleNumber: item.articleNumber, costPrice: item.costPrice,
      quantity: String(quantity), price: packagingExpressible ? String(price) : '',
      allowDecimalQty: item.allowDecimalQty !== false,
      units: [], packagingExpressible
    }
  })
}
function positive(raw: string, scale: number, label: string) {
  if (!new RegExp(`^\\d+(?:\\.\\d{1,${scale}})?$`).test(raw) || !(Number(raw) > 0) || !Number.isFinite(Number(raw)))
    throw new Error(`${label}须大于零，最多 ${scale} 位小数`)
  return Number(raw)
}
export function toCommercialInputs(rows: CommercialDraftRow[]): CommercialInput[] {
  if (!rows.length || rows.length > 200) throw new Error('请添加 1 至 200 条成交明细')
  return rows.map((row) => {
    if (!row.packagingExpressible) throw new Error('当前基本量无法按原包装精度编辑；请保留原成交依据并核对订单')
    const quantity = positive(row.quantity, 2, '数量')
    if (row.input.kind === 'kit' && !Number.isSafeInteger(quantity)) throw new Error('套数须为正整数')
    if (
      row.input.kind === 'ordinary' &&
      row.allowDecimalQty === false &&
      row.unit === row.baseUnit &&
      !Number.isSafeInteger(quantity)
    )
      throw new Error(`「${row.name}」出货数量须为整数`)
    const input = { ...row.input, quantity }
    if (input.priceSource === 'manual') input.unitPrice = positive(row.price, 4, '成交价')
    // Default quote is resolved by the server; never substitute a client-side computed price.
    return input
  })
}
