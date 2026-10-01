import { describe, expect, it } from 'vitest'
import { draftFromGroups, toCommercialInputs, commercialPrintRows } from './commercialDraft'
import type { CommercialGroup } from '@/types/sale-commercial'
const auxiliary = {
  id: 3,
  lineKey: 'aux',
  kind: 'ordinary',
  warehouseId: 1,
  originalQty: 20,
  targetQty: 15,
  quantity: 15,
  unitPrice: 1.23456,
  amount: 18.52,
  originalAmount: 24.69,
  priceSource: 'manual',
  metadata: {
    input: {
      kind: 'ordinary',
      lineKey: 'aux',
      warehouseId: 1,
      productId: 11,
      entryUnit: '包',
      quantity: 2,
      unitPrice: 12.3456,
      priceSource: 'manual'
    },
    entry: { entryUnit: '包', entryQty: 2, conversionRate: 10, entryUnitPrice: 12.3456 }
  },
  components: [{ productId: 11, productCode: 'P11', productName: '螺钉', unit: '个', baseQty: 1 }]
} as CommercialGroup
const kit = {
  ...auxiliary,
  id: 1,
  lineKey: 'old-kit',
  kind: 'kit',
  kitVersionId: 19,
  kitName: '原套',
  kitCode: 'K1',
  originalQty: 2,
  targetQty: 1,
  unitPrice: 100,
  priceSource: 'kit_default',
  metadata: {
    input: {
      kind: 'kit',
      lineKey: 'old-kit',
      warehouseId: 1,
      kitVersionId: 19,
      quantity: 2,
      priceSource: 'kit_default'
    },
    entry: null
  }
} as CommercialGroup
describe('commercial draft preserves authoritative provenance', () => {
  it('restores exact manual packaging quote and current target without truncation', () => {
    const draft = draftFromGroups([auxiliary])
    expect(draft[0]).toMatchObject({ quantity: '1.5', price: '12.3456', unit: '包' })
    expect(toCommercialInputs(draft)).toEqual([{ ...auxiliary.metadata.input, quantity: 1.5 }])
  })
  it('retains old kit version and input identity without looking up current master', () => {
    expect(toCommercialInputs(draftFromGroups([kit]))).toEqual([{ ...kit.metadata.input, quantity: 1 }])
  })
  it('prints auxiliary current basic quantity with stored derived quote and original packaging basis', () => {
    const row = commercialPrintRows([auxiliary])[0]
    expect(row).toMatchObject({ quantity: 15, unit: '个', unitPrice: 1.23456, amount: 18.52, priceText: '¥1.23456000' })
    expect(row.remark).toContain('12.3456/包')
  })
  it('prints complete packs at true four decimals and kit parent only', () => {
    const row = commercialPrintRows([{ ...auxiliary, targetQty: 20, quantity: 20, amount: 24.69 }])[0]
    expect(row).toMatchObject({ quantity: 2, unit: '包', priceText: '¥12.3456', amount: 24.69 })
    expect(commercialPrintRows([kit])).toHaveLength(1)
  })
  it('rejects zero formal manual quote and fractional kit counts', () => {
    const d = draftFromGroups([kit])
    d[0].quantity = '0.8'
    expect(() => toCommercialInputs(d)).toThrow('整数')
    const a = draftFromGroups([auxiliary])
    a[0].price = '0'
    expect(() => toCommercialInputs(a)).toThrow('大于零')
  })
})
it('integer product basic unit rejects decimals while auxiliary entry keeps two-decimal conversion input', () => {
  const draft = draftFromGroups([auxiliary])
  draft[0].allowDecimalQty = false
  draft[0].baseUnit = '个'
  draft[0].unit = '个'
  draft[0].quantity = '1.5'
  expect(() => toCommercialInputs(draft)).toThrow('整数')
  draft[0].unit = '包'
  draft[0].input = {
    kind: 'ordinary',
    lineKey: 'aux',
    productId: 11,
    entryUnit: '包',
    quantity: 1.5,
    priceSource: 'manual',
    unitPrice: 12.3456
  }
  expect(toCommercialInputs(draft)[0].quantity).toBe(1.5)
})
it('customer print omits closed zero-target rows but retains their history in the draft projection', () => {
  const closed = { ...kit, targetQty: 0, amount: 0 }
  expect(commercialPrintRows([closed, auxiliary])).toHaveLength(1)
  expect(commercialPrintRows([closed, auxiliary])[0].productCode).toBe('P11')
  expect(draftFromGroups([closed])[0].saved?.originalQty).toBe(2)
})
