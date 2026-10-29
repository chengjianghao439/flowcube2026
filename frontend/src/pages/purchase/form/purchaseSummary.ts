import { hasQuantityPrecision, roundQuantity } from '@/lib/qtyStep'

/** UI projection only: draft quantity is entry quantity; saved quantity is base quantity. */
export interface PurchaseQuantityItem {
  _key?: number | string
  id?: number | string
  productId: number
  productName?: string
  productCode?: string | null; spec?: string | null; color?: string | null; articleNumber?: string | null
  unit: string
  entryUnit?: string | null
  quantity: number
  entryQty?: number | null
  /** An explicitly supplied snapshot takes precedence over current unit metadata. */
  conversionRate?: number | null
  units?: readonly { unitName: string; conversionRate: number }[]
}

export interface PurchaseDraftSummaryItem extends PurchaseQuantityItem {
  unitPrice: number
}

export interface PurchaseQuantityGroup {
  key: string
  productId: number
  productName: string
  productCode?: string | null; spec?: string | null; color?: string | null; articleNumber?: string | null
  entryUnit: string
  baseUnit: string
  conversionRate: number | null
  /** null means the saved auxiliary entry quantity is unavailable, never zero. */
  quantity: number | null
  lineCount: number
}

export interface PurchaseDraftSummary {
  /** null denotes an unsafe numeric aggregate, never an invented zero amount. */
  amount: number | null
  validLineCount: number
  invalidLineCount: number
  quantityGroups: PurchaseQuantityGroup[]
}

export interface PurchaseSavedPriceInput {
  unit: string
  entryUnit?: string | null
  unitPrice: number
  quantity: number
  entryQty?: number | null
  conversionRate?: number | null
  amount?: number | null
}

export interface PurchaseEntryPriceRestoration {
  entryUnitPrice: number | null
  /** Checks stored four-place quote evidence; it does not authorize a save or current units. */
  verified: boolean
  warning: string | null
}

const round2 = (value: number) => Math.round(value * 100) / 100
const round4 = (value: number) => Math.round(value * 10_000) / 10_000
const round8 = (value: number) => Math.round(value * 100_000_000) / 100_000_000
const validProduct = (productId: number) => Number.isSafeInteger(productId) && productId > 0
const validRate = (rate: number | null | undefined): rate is number => typeof rate === 'number' && Number.isFinite(rate) && rate > 0

function displayRate(item: PurchaseQuantityItem, entryUnit: string, baseUnit: string, mode: 'draft' | 'saved'): number | null {
  if (entryUnit === baseUnit) return 1
  if (item.conversionRate !== undefined) return validRate(item.conversionRate) ? item.conversionRate : null
  if (mode === 'saved') return null
  const rate = item.units?.find(unit => unit.unitName === entryUnit)?.conversionRate
  return validRate(rate) ? rate : null
}

/**
 * Conservatively group only the same product and known unit relationship.
 * Product units have no global packaging identity, so even same-name units on
 * different products remain separate. Unknown auxiliary relationships retain
 * stable line identity and never fall back to a 1:1 conversion.
 */
export function groupPurchaseQuantities(items: readonly PurchaseQuantityItem[], mode: 'draft' | 'saved' = 'draft'): PurchaseQuantityGroup[] {
  const groups = new Map<string, PurchaseQuantityGroup>()
  items.forEach((item, index) => {
    if (!validProduct(item.productId)) return
    const baseUnit = item.unit.trim()
    const entryUnit = item.entryUnit?.trim() || baseUnit
    if (!baseUnit || !entryUnit) return
    const rawQty = mode === 'draft'
      ? item.quantity
      : item.entryQty ?? (entryUnit === baseUnit ? item.quantity : null)
    if (rawQty != null && (!Number.isFinite(rawQty) || rawQty <= 0 || !hasQuantityPrecision(rawQty))) return
    if (mode === 'draft' && !Number.isSafeInteger(rawQty)) return
    const rate = displayRate(item, entryUnit, baseUnit, mode)
    const relationship = rate ?? `unknown:${item._key ?? item.id ?? index}`
    const key = JSON.stringify([item.productId, entryUnit, baseUnit, relationship])
    const existing = groups.get(key)
    if (existing) {
      existing.quantity = existing.quantity == null || rawQty == null ? null : roundQuantity(existing.quantity + rawQty)
      existing.lineCount += 1
      return
    }
    groups.set(key, {
      key,
      productId: item.productId,
      productName: item.productName || '',
      productCode: item.productCode, spec: item.spec, color: item.color, articleNumber: item.articleNumber,
      entryUnit,
      baseUnit,
      conversionRate: rate,
      quantity: rawQty,
      lineCount: 1,
    })
  })
  return [...groups.values()]
}

/** Mirror purchase foldEntryItems: round each entry-quantity × entry-price to cents first. */
export function purchaseDraftLineAmount(quantity: number, unitPrice: number): number | null {
  if (!Number.isSafeInteger(quantity) || quantity <= 0 || !Number.isFinite(unitPrice) || unitPrice < 0) return null
  const cents = Math.round(quantity * unitPrice * 100)
  return Number.isSafeInteger(cents) ? cents / 100 : null
}

/** Always receives the complete draft, independent of the virtual table's mounted rows. */
export function summarizePurchaseDraft(items: readonly PurchaseDraftSummaryItem[]): PurchaseDraftSummary {
  const validItems: PurchaseDraftSummaryItem[] = []
  let totalCents = 0
  items.forEach(item => {
    const amount = purchaseDraftLineAmount(item.quantity, item.unitPrice)
    if (!validProduct(item.productId) || !item.unit.trim() || amount == null) return
    validItems.push(item)
    totalCents += Math.round(amount * 100)
  })
  return {
    amount: Number.isSafeInteger(totalCents) ? totalCents / 100 : null,
    validLineCount: validItems.length,
    invalidLineCount: items.length - validItems.length,
    quantityGroups: groupPurchaseQuantities(validItems),
  }
}

/**
 * Recover a four-place entry-price candidate from stored basic price and the
 * original conversion snapshot. Never reverse the two-place amount into a
 * quote. Verify both the saved amount and the eight-place basic-price evidence;
 * high conversion rates can leave multiple valid four-place quotes, so matching
 * the amount alone is insufficient. No current master-data or save rule changes.
 */
export function restorePurchaseEntryPrice(item: PurchaseSavedPriceInput): PurchaseEntryPriceRestoration {
  const fail = (entryUnitPrice: number | null, warning: string): PurchaseEntryPriceRestoration => ({ entryUnitPrice, verified: false, warning })
  if (!Number.isFinite(item.unitPrice) || item.unitPrice < 0) return fail(null, '原单单价无效，请核对录入单价')
  const baseUnit = item.unit.trim()
  const auxiliary = !!item.entryUnit && item.entryUnit.trim() !== baseUnit
  const rate = auxiliary ? item.conversionRate : 1
  if (!validRate(rate)) return fail(null, '原单辅助单位换算信息不完整，请核对录入单价')
  const candidate = round4(item.unitPrice * rate)
  if (!Number.isFinite(candidate) || !Number.isSafeInteger(Math.round(candidate * 10_000))) return fail(null, '原单单价超出可可靠回显范围，请核对录入单价')
  const entryQty = item.entryQty ?? (auxiliary ? null : item.quantity)
  if (entryQty == null || !Number.isFinite(entryQty) || entryQty <= 0) return fail(candidate, '原单录入数量不完整，请核对录入单价')
  const savedAmount = item.amount
  if (savedAmount == null || !Number.isFinite(savedAmount) || savedAmount < 0 || round2(entryQty * candidate) !== savedAmount) {
    return fail(candidate, '录入单价候选与原单金额无法核对，请核对后再保存')
  }
  if (!auxiliary && candidate !== item.unitPrice) return fail(candidate, '原单报价超出四位精度，请核对录入单价')
  if (auxiliary) {
    const matches = (quote: number) => quote >= 0 && round8(quote / rate) === item.unitPrice && round2(entryQty * quote) === savedAmount
    if (!matches(candidate)) return fail(candidate, '原单基本单价无法还原四位录入报价，请核对后再保存')
    if (matches(round4(candidate + 0.0001)) || (candidate >= 0.0001 && matches(round4(candidate - 0.0001)))) {
      return fail(candidate, '原单换算信息无法唯一还原录入报价，请核对后再保存')
    }
  }
  return { entryUnitPrice: candidate, verified: true, warning: null }
}
