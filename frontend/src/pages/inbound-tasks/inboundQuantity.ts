import type { InboundQuantityField, InboundQuantityGroup } from '@/types/inbound-tasks'

const fields = ['orderedQty', 'receivedQty', 'putawayQty'] as const
const knownQuantity = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

/** 收货数量为基本单位事实；不同商品/身份规格或未知单位不做包装换算。 */
export function groupInboundQuantities(rows: readonly {
  productId: number; productName: string; productCode?: string | null; unit: string | null; spec?: string | null; color?: string | null; articleNumber?: string | null
  orderedQty: number | null | undefined; receivedQty: number | null | undefined; putawayQty: number | null | undefined
}[]): InboundQuantityGroup[] {
  const groups = new Map<string, InboundQuantityGroup>()
  rows.forEach((row, index) => {
    const key = JSON.stringify([row.productId, row.unit || `unknown-${index}`, row.spec, row.color, row.articleNumber])
    const previous = groups.get(key)
    const quantityState = {} as NonNullable<InboundQuantityGroup['quantityState']>
    const group: InboundQuantityGroup = { ...row, key, orderedQty: NaN, receivedQty: NaN, putawayQty: NaN, quantityState }
    for (const field of fields) {
      const raw = row[field]
      // 任一原量未知即传播未知；null不能经加法变成0，后续正常行也不能洗掉。
      const total = (previous ? previous[field] : 0) + (knownQuantity(raw) ? raw : NaN)
      const known = knownQuantity(raw) && knownQuantity(total)
      group[field] = known ? total : NaN
      quantityState[field] = { known, allZero: known && (previous?.quantityState?.[field].allZero ?? true) && raw === 0 }
    }
    const remainingKnown = knownQuantity(row.orderedQty) && knownQuantity(row.receivedQty) && quantityState.orderedQty.known && quantityState.receivedQty.known
    quantityState.remainingQty = { known: remainingKnown, allZero: remainingKnown && (previous?.quantityState?.remainingQty.allZero ?? true) && Math.max(0, row.orderedQty! - row.receivedQty!) === 0 }
    groups.set(key, group)
  })
  return [...groups.values()]
}

export function inboundQuantityValue(group: InboundQuantityGroup, field: InboundQuantityField): number {
  if (group.quantityState?.[field].known === false) return NaN
  if (field === 'remainingQty') return knownQuantity(group.orderedQty) && knownQuantity(group.receivedQty) ? Math.max(0, group.orderedQty - group.receivedQty) : NaN
  return knownQuantity(group[field]) ? group[field] : NaN
}

export function areInboundQuantitiesZero(groups: readonly InboundQuantityGroup[], field: InboundQuantityField): boolean {
  return groups.length > 0 && groups.every(group => inboundQuantityValue(group, field) === 0 && (!group.quantityState || group.quantityState[field].allZero))
}
