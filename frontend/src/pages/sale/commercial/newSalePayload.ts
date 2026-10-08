import type { CommercialBody, CommercialInput, CommercialPreview } from '@/types/sale-commercial'
import type { CreateSaleParams } from '@/types/sale'

function invalid(reason: string): never {
  throw new Error(`${reason}，请保留草稿并重新核对预览`)
}

function positive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function validId(value: unknown): value is number {
  return positive(value) && Number.isSafeInteger(value)
}

function textPresent(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function priceIdentity(source: CommercialInput['priceSource']) {
  // The new preview API normalizes list to default before resolving the actual customer quote.
  return source === 'list' ? 'default' : source
}

export function buildNewSalePayload(body: CommercialBody, preview: CommercialPreview): CreateSaleParams | CommercialBody {
  const inputs = body.commercialGroups
  if (!Array.isArray(inputs)) invalid('商品明细不完整')
  if (inputs.some(input => input?.kind === 'kit')) return body
  if (!inputs.length || inputs.length > 200) invalid('请添加 1 至 200 条商品明细')
  if (!validId(body.customerId) || !validId(body.warehouseId)) invalid('客户或默认仓库无法识别')
  if (!preview || preview.customerId !== body.customerId || preview.warehouseId !== body.warehouseId)
    invalid('预览的客户或默认仓库与当前输入不一致')
  if (
    !Array.isArray(preview.commercialGroups) || preview.commercialGroups.length !== inputs.length ||
    preview.commercialGroups.some(group => !group || !textPresent(group.lineKey))
  )
    invalid('预览明细不完整')

  const byKey = new Map(preview.commercialGroups.map(group => [group.lineKey, group]))
  if (byKey.size !== inputs.length || [...byKey.keys()].some(key => !textPresent(key))) invalid('预览明细身份重复或缺失')
  const inputKeys = new Set<string>()
  const dimensions = new Set<string>()
  const items: CreateSaleParams['items'] = inputs.map(input => {
    if (
      !input || input.kind !== 'ordinary' || !textPresent(input.lineKey) || !validId(input.productId) ||
      !positive(input.quantity) || !['default', 'list', 'manual'].includes(input.priceSource)
    )
      invalid('商品明细身份或数量无效')
    if (inputKeys.has(input.lineKey)) invalid('商品明细身份重复')
    inputKeys.add(input.lineKey)
    const warehouseId = input.warehouseId ?? body.warehouseId
    if (!validId(warehouseId)) invalid('商品明细仓库无法识别')
    const dimension = `${input.productId}:${warehouseId}`
    if (dimensions.has(dimension)) invalid('同一商品在同一仓库重复，请先合并数量')
    dimensions.add(dimension)

    const group = byKey.get(input.lineKey)
    if (
      !group || group.kind !== 'ordinary' || group.warehouseId !== warehouseId ||
      priceIdentity(group.priceSource) !== priceIdentity(input.priceSource)
    ) invalid('商品明细与预览身份不一致')
    const metadata = group.metadata
    const resolvedInput = metadata?.input
    if (
      !resolvedInput || resolvedInput.kind !== 'ordinary' || resolvedInput.lineKey !== input.lineKey ||
      resolvedInput.productId !== input.productId || (resolvedInput.warehouseId ?? body.warehouseId) !== warehouseId ||
      resolvedInput.quantity !== input.quantity || priceIdentity(resolvedInput.priceSource) !== priceIdentity(input.priceSource) ||
      resolvedInput.unitPrice !== input.unitPrice || metadata.priceCustomerId !== body.customerId
    ) invalid('商品明细或报价客户与预览依据不一致')
    if (!Array.isArray(group.components) || group.components.length !== 1) invalid('普通商品的预览组件不完整')
    const component = group.components[0]
    if (
      !component || component.productId !== input.productId || !textPresent(component.unit) ||
      !textPresent(component.productCode) || !textPresent(component.productName)
    ) invalid('普通商品的预览组件身份不一致')

    const entry = metadata.entry
    const entryUnit = input.entryUnit ?? component.unit
    if (
      !textPresent(entryUnit) || !entry || entry.entryUnit !== entryUnit ||
      (resolvedInput.entryUnit ?? component.unit) !== entryUnit || !positive(entry.entryQty) ||
      entry.entryQty !== input.quantity || !positive(entry.entryUnitPrice) || !positive(entry.conversionRate)
    ) invalid('预览的录入单位、数量或成交价无效')
    if (input.priceSource === 'manual' && (!positive(input.unitPrice) || input.unitPrice !== entry.entryUnitPrice))
      invalid('手工成交价与预览依据不一致')

    const quote = metadata.quote
    if (
      quote != null && (
        typeof quote.referenceUnitPrice !== 'number' || !Number.isFinite(quote.referenceUnitPrice) || quote.referenceUnitPrice < 0 ||
        !textPresent(quote.resolvedPriceLevel) || !['price_list', 'price_level'].includes(quote.resolvedPriceSource)
      )
    ) invalid('预览的参考报价无效')
    if (input.priceSource !== 'manual' && !quote) invalid('默认成交价缺少预览报价依据')
    const priceSource = input.priceSource === 'manual' ? 'manual' : quote!.resolvedPriceSource === 'price_list' ? 'list' : 'default'
    return {
      productId: input.productId,
      productCode: component.productCode,
      productName: component.productName,
      unit: component.unit,
      entryUnit: entry.entryUnit,
      quantity: entry.entryQty,
      unitPrice: entry.entryUnitPrice,
      warehouseId,
      priceSource,
      // Ordinary writes accept positive reference prices or null; zero means no configured reference.
      resolvedPrice: quote && quote.referenceUnitPrice > 0 ? quote.referenceUnitPrice : null,
      resolvedPriceLevel: quote?.resolvedPriceLevel ?? null,
      articleNumber: component.articleNumber,
      spec: component.spec,
      color: component.color
    }
  })
  const { commercialModel: _commercialModel, expectedRevision: _expectedRevision, commercialGroups: _commercialGroups, ...head } = body
  return { ...head, customerName: body.customerName ?? '', warehouseName: body.warehouseName ?? '', items }
}
