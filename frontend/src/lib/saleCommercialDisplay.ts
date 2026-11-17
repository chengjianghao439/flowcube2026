import { unitPrice as formatUnitPrice } from '@/lib/format'
import type { CommercialGroup, CommercialPrintItem } from '@/types/sale-commercial'

export function commercialUnit(group?: CommercialGroup): string {
  return group?.kind === 'kit' ? (group.metadata.kitUnit || '套') : (group?.components[0]?.unit ?? '')
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
        priceText: formatUnitPrice(unitPrice, g.kind === 'ordinary' && !packaging ? 8 : 4),
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
