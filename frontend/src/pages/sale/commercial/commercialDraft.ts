import type { CommercialGroup, CommercialInput, CommercialPrintItem } from '@/types/sale-commercial'
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
  packagingExpressible: boolean
}
export function commercialUnit(group?: CommercialGroup): string {
  return group?.kind === 'kit' ? (group.metadata.kitUnit || '套') : (group?.components[0]?.unit ?? '')
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
      quantity: String(q),
      price: String(input.unitPrice ?? (g.kind === 'kit' ? g.unitPrice : (entry?.entryUnitPrice ?? g.unitPrice))),
      units: [],
      baseUnit: commercialUnit(g),
      spec: g.kind === 'kit' ? g.metadata.kitIdentity?.spec : g.components[0]?.spec,
      color: g.kind === 'kit' ? g.metadata.kitIdentity?.color : g.components[0]?.color,
      articleNumber: g.kind === 'kit' ? g.metadata.kitIdentity?.articleNumber : g.components[0]?.articleNumber,
      saved: g,
      packagingExpressible
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
      throw new Error(`「${row.name}」基本单位数量只能是整数`)
    const input = { ...row.input, quantity }
    if (input.priceSource === 'manual') input.unitPrice = positive(row.price, 4, '成交价')
    // Default quote is resolved by the server; never substitute a client-side computed price.
    return input
  })
}
export function commercialPrintRows(groups: CommercialGroup[]): CommercialPrintItem[] {
  return groups
    .filter((g) => g.targetQty > 0)
    .map((g) => {
      const c = g.components[0],
        entry = g.metadata.entry
      const wholeOriginal = g.targetQty === g.originalQty
      const packaging = g.kind === 'ordinary' && entry && wholeOriginal
      const unitPrice = g.kind === 'kit' ? g.unitPrice : packaging ? entry.entryUnitPrice : g.unitPrice
      return {
        productCode: g.kind === 'kit' ? (g.kitCode ?? '') : (c?.productCode ?? ''),
        productName: g.kind === 'kit' ? (g.kitName ?? '') : (c?.productName ?? ''),
        unit: g.kind === 'kit' ? commercialUnit(g) : packaging ? entry.entryUnit : (c?.unit ?? ''),
        quantity: packaging ? entry.entryQty : g.targetQty,
        unitPrice,
        priceText: `¥${Number(unitPrice).toFixed(g.kind === 'ordinary' && !packaging ? 8 : 4)}`,
        amount: g.amount,
        articleNumber: g.kind === 'ordinary' ? (c?.articleNumber ?? '') : (g.metadata.kitIdentity?.articleNumber ?? ''),
        spec: g.kind === 'ordinary' ? (c?.spec ?? '') : (g.metadata.kitIdentity?.spec ?? ''),
        color: g.kind === 'ordinary' ? (c?.color ?? '') : (g.metadata.kitIdentity?.color ?? ''),
        remark:
          g.kind === 'ordinary' && entry && !wholeOriginal
            ? `原成交依据 ${entry.entryQty}${entry.entryUnit} × ${Number(entry.entryUnitPrice).toFixed(4)}/${entry.entryUnit}；1${entry.entryUnit}=${entry.conversionRate}${c?.unit ?? ''}；本行显示当前基本量与已存基本单价`
            : ''
      }
    })
}
