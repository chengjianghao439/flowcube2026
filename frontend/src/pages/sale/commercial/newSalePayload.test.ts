import { describe, expect, it } from 'vitest'
import { buildNewSalePayload } from './newSalePayload'
import type { CreateSaleParams } from '@/types/sale'
import type { CommercialBody, CommercialGroup, CommercialInput, CommercialPreview } from '@/types/sale-commercial'

function fixture() {
  const input: CommercialInput = {
    lineKey: 'pack-line', kind: 'ordinary', productId: 11, entryUnit: '包', quantity: 1.5, priceSource: 'default'
  }
  const body: CommercialBody = {
    commercialModel: 'kit-v1', expectedRevision: 7, customerId: 3, customerName: '测试客户',
    warehouseId: 1, warehouseName: '测试仓', commercialGroups: [input], discountAmount: 2,
    remark: '保留备注', carrierId: 4, freightType: 1, shippingProduct: '标准快递',
    receiverName: '测试收件人', receiverPhone: '13800000000', receiverAddress: '测试地址'
  }
  const group: CommercialGroup = {
    id: 0, lineKey: input.lineKey, kind: 'ordinary', warehouseId: 1,
    kitVersionId: null, kitCode: null, kitName: null,
    originalQty: 15, targetQty: 15, quantity: 15, unitPrice: 1.2345,
    amount: 18.52, originalAmount: 18.52, priceSource: 'default',
    components: [{
      productId: 11, productCode: 'P11', productName: '测试螺钉', unit: '个', baseQty: 1,
      quantity: 15, allocatedAmount: 18.52, spec: 'M4', color: '银色', articleNumber: 'SUP-11'
    }],
    metadata: {
      input: { ...input, warehouseId: 1 }, priceCustomerId: 3,
      entry: { entryUnit: '包', entryQty: 1.5, conversionRate: 10, entryUnitPrice: 12.345 },
      quote: { referenceUnitPrice: 1.2345, resolvedPriceSource: 'price_level', resolvedPriceLevel: 'B', priceListId: null }
    }
  }
  const preview: CommercialPreview = {
    customerId: 3, warehouseId: 1, commercialGroups: [group], physicalItems: [], amount: 18.52,
    canFulfillEntireVector: false, expected: null, readyDate: null,
    readyDateExplanation: '未承诺交期', inventoryExplanation: '只读现货参考'
  }
  return { body, preview, input, group }
}
type Fixture = ReturnType<typeof fixture>

function ordinaryPayload(f: Fixture): CreateSaleParams {
  const payload = buildNewSalePayload(f.body, f.preview)
  expect(payload).not.toHaveProperty('commercialModel')
  if (!('items' in payload)) throw new Error('应生成普通创建载荷')
  return payload
}

function addLine(f: Fixture, overrides: Partial<CommercialInput> = {}) {
  const input = { ...f.input, lineKey: 'other-line', productId: 12, ...overrides } as CommercialInput
  const group = structuredClone(f.group)
  group.lineKey = input.lineKey
  group.metadata.input = { ...input, warehouseId: input.warehouseId ?? f.body.warehouseId }
  group.warehouseId = input.warehouseId ?? f.body.warehouseId
  group.components[0].productId = input.kind === 'ordinary' ? input.productId : 11
  group.components[0].productCode = 'P12'
  f.body.commercialGroups.push(input)
  f.preview.commercialGroups.push(group)
}

describe('unified new sale preserves the ordinary model and authoritative entry quote', () => {
  it('keeps the line remark distinct from the order remark and rejects a stale remark preview', () => {
    const f = fixture()
    f.input.remark = '本行分箱包装'
    f.group.metadata.input.remark = '本行分箱包装'
    const payload = ordinaryPayload(f)
    expect(payload.remark).toBe('保留备注')
    expect(payload.items[0].remark).toBe('本行分箱包装')
    f.group.metadata.input.remark = '旧备注'
    expect(() => ordinaryPayload(f)).toThrow(/商品备注与预览不一致/)
  })
  it('strips commercial fields and preserves all ordinary header fields', () => {
    const f = fixture()
    expect(ordinaryPayload(f)).toEqual({
      customerId: 3, customerName: '测试客户', warehouseId: 1, warehouseName: '测试仓', discountAmount: 2,
      remark: '保留备注', carrierId: 4, freightType: 1, shippingProduct: '标准快递',
      receiverName: '测试收件人', receiverPhone: '13800000000', receiverAddress: '测试地址',
      items: [{
        productId: 11, productCode: 'P11', productName: '测试螺钉', unit: '个', entryUnit: '包',
        quantity: 1.5, unitPrice: 12.345, warehouseId: 1, priceSource: 'default',
        resolvedPrice: 1.2345, resolvedPriceLevel: 'B', spec: 'M4', color: '银色', articleNumber: 'SUP-11'
      }]
    })
  })

  it('uses entry quantity and price even when rounded amount and physical display price differ', () => {
    const f = fixture()
    f.group.unitPrice = 8.88888888
    f.group.amount = 99
    f.group.components[0].baseQty = 55
    f.preview.physicalItems = [{
      id: 9, productId: 11, productCode: 'WRONG', productName: '物料汇总', unit: '个', warehouseId: 1,
      quantity: 15, unitPrice: 6.6, amount: 99,
      inventory: { quantity: 0, reserved: 0, available: 0, required: 15, shortage: 15 }
    }]
    const item = ordinaryPayload(f).items[0]
    expect(item).toMatchObject({ productCode: 'P11', quantity: 1.5, unitPrice: 12.345 })
    expect(item).not.toHaveProperty('priceIsBase')
    expect(item).not.toHaveProperty('costPrice')
    expect(item).not.toHaveProperty('amount')
  })

  it.each([
    ['default', 'price_list', 'list'],
    ['list', 'price_level', 'default']
  ] as const)('maps requested %s through the actual %s quote to %s', (source, resolved, expected) => {
    const f = fixture()
    f.input.priceSource = source
    f.group.metadata.input.priceSource = 'default'
    f.group.metadata.quote!.resolvedPriceSource = resolved
    expect(ordinaryPayload(f).items[0].priceSource).toBe(expected)
  })

  it('keeps a manual entry price and audit reference separately', () => {
    const f = fixture()
    Object.assign(f.input, { priceSource: 'manual', unitPrice: 7.8912 })
    Object.assign(f.group.metadata.input, { priceSource: 'manual', unitPrice: 7.8912 })
    f.group.priceSource = 'manual'
    f.group.metadata.entry!.entryUnitPrice = 7.8912
    expect(ordinaryPayload(f).items[0]).toMatchObject({
      priceSource: 'manual', unitPrice: 7.8912, resolvedPrice: 1.2345, resolvedPriceLevel: 'B'
    })
  })

  it('keeps a positive manual transaction with an unconfigured zero audit reference', () => {
    const f = fixture()
    Object.assign(f.input, { priceSource: 'manual', unitPrice: 7.8912 })
    Object.assign(f.group.metadata.input, { priceSource: 'manual', unitPrice: 7.8912 })
    f.group.priceSource = 'manual'
    f.group.metadata.entry!.entryUnitPrice = 7.8912
    f.group.metadata.quote!.referenceUnitPrice = 0
    expect(ordinaryPayload(f).items[0]).toMatchObject({ priceSource: 'manual', unitPrice: 7.8912, resolvedPrice: null })
  })

  it('uses the component base unit when no entry unit was explicitly selected', () => {
    const f = fixture()
    f.input.entryUnit = null
    Object.assign(f.group.metadata.input, { entryUnit: null })
    Object.assign(f.group.metadata.entry!, { entryUnit: '个', conversionRate: 1, entryUnitPrice: 1.2345 })
    expect(ordinaryPayload(f).items[0]).toMatchObject({ unit: '个', entryUnit: '个', quantity: 1.5, unitPrice: 1.2345 })
  })

  it('matches by line key and keeps request order when preview order changes', () => {
    const f = fixture()
    addLine(f, { warehouseId: 2 })
    f.preview.commercialGroups.reverse()
    expect(ordinaryPayload(f).items.map(i => [i.productId, i.warehouseId])).toEqual([[11, 1], [12, 2]])
  })

  it('permits the same SKU in different warehouses', () => {
    const f = fixture()
    addLine(f, { productId: 11, warehouseId: 2 })
    expect(ordinaryPayload(f).items.map(i => [i.productId, i.warehouseId])).toEqual([[11, 1], [11, 2]])
  })

  it('supplies empty ordinary header names when optional names are absent', () => {
    const f = fixture()
    delete f.body.customerName
    delete f.body.warehouseName
    expect(ordinaryPayload(f)).toMatchObject({ customerName: '', warehouseName: '' })
  })

  it('returns the same mixed commercial body as soon as any kit is present', () => {
    const f = fixture()
    f.body.commercialGroups.push({ lineKey: 'kit-line', kind: 'kit', kitVersionId: 7, quantity: 2, priceSource: 'kit_default' })
    f.preview.commercialGroups = []
    expect(buildNewSalePayload(f.body, f.preview)).toBe(f.body)
  })

  it('does not mutate either the draft body or authoritative preview', () => {
    const f = fixture()
    const before = structuredClone({ body: f.body, preview: f.preview })
    ordinaryPayload(f)
    expect({ body: f.body, preview: f.preview }).toEqual(before)
  })
})

describe('ordinary conversion rejects incomplete or mismatched preview without losing the draft', () => {
  it('rejects duplicate same SKU and effective warehouse rather than merging quantities', () => {
    const f = fixture()
    addLine(f, { productId: 11, warehouseId: 1 })
    const before = structuredClone(f.body)
    expect(() => buildNewSalePayload(f.body, f.preview)).toThrow(/合并/)
    expect(f.body).toEqual(before)
  })

  const invalid: [string, (f: Fixture) => void][] = [
    ['empty request', f => { f.body.commercialGroups = [] }],
    ['missing preview group', f => { f.preview.commercialGroups = [] }],
    ['extra preview group', f => { f.preview.commercialGroups.push(structuredClone(f.group)) }],
    ['duplicate request line key', f => { addLine(f, { lineKey: f.input.lineKey }) }],
    ['duplicate preview line key', f => { addLine(f); f.preview.commercialGroups[1].lineKey = f.group.lineKey }],
    ['unknown preview line key', f => { f.group.lineKey = 'another-line' }],
    ['wrong customer', f => { f.preview.customerId = 4 }],
    ['missing customer identity', f => { Reflect.deleteProperty(f.preview, 'customerId') }],
    ['wrong header warehouse', f => { f.preview.warehouseId = 2 }],
    ['wrong group warehouse', f => { f.group.warehouseId = 2 }],
    ['wrong group kind', f => { f.group.kind = 'kit' }],
    ['wrong group price source', f => { f.group.priceSource = 'manual' }],
    ['null preview group', f => { Object.assign(f.preview.commercialGroups, { 0: null }) }],
    ['missing metadata input', f => { Reflect.deleteProperty(f.group.metadata, 'input') }],
    ['wrong metadata line key', f => { f.group.metadata.input.lineKey = 'wrong-line' }],
    ['wrong metadata product', f => { Object.assign(f.group.metadata.input, { productId: 12 }) }],
    ['wrong metadata warehouse', f => { f.group.metadata.input.warehouseId = 2 }],
    ['wrong metadata unit', f => { Object.assign(f.group.metadata.input, { entryUnit: '箱' }) }],
    ['wrong metadata quantity', f => { f.group.metadata.input.quantity = 2 }],
    ['wrong metadata price source', f => { f.group.metadata.input.priceSource = 'manual' }],
    ['unsupported request price source', f => {
      Object.assign(f.input, { priceSource: 'unrecognized' })
      Object.assign(f.group.metadata.input, { priceSource: 'unrecognized' })
    }],
    ['missing quote customer', f => { Reflect.deleteProperty(f.group.metadata, 'priceCustomerId') }],
    ['wrong quote customer', f => { f.group.metadata.priceCustomerId = 4 }],
    ['missing entry', f => { f.group.metadata.entry = null }],
    ['wrong entry unit', f => { f.group.metadata.entry!.entryUnit = '箱' }],
    ['wrong entry quantity', f => { f.group.metadata.entry!.entryQty = 2 }],
    ['missing component', f => { f.group.components = [] }],
    ['multiple components', f => { f.group.components.push(structuredClone(f.group.components[0])) }],
    ['wrong component product', f => { f.group.components[0].productId = 12 }],
    ['null component', f => { Object.assign(f.group.components, { 0: null }) }],
    ['missing component base unit', f => { Reflect.deleteProperty(f.group.components[0], 'unit') }],
    ['missing component code', f => { Reflect.deleteProperty(f.group.components[0], 'productCode') }],
    ['missing component name', f => { Reflect.deleteProperty(f.group.components[0], 'productName') }],
    ['missing automatic quote', f => { f.group.metadata.quote = null }],
    ['unknown automatic quote source', f => { f.group.metadata.quote!.resolvedPriceSource = 'fallback' }],
    ['nonfinite audit reference', f => { f.group.metadata.quote!.referenceUnitPrice = Infinity }],
    ['negative audit reference', f => { f.group.metadata.quote!.referenceUnitPrice = -1 }],
    ['missing audit reference', f => { Reflect.deleteProperty(f.group.metadata.quote!, 'referenceUnitPrice') }],
    ['missing audit level', f => { Reflect.deleteProperty(f.group.metadata.quote!, 'resolvedPriceLevel') }],
    ['manual metadata quote drift', f => {
      Object.assign(f.input, { priceSource: 'manual', unitPrice: 12.3456 })
      Object.assign(f.group.metadata.input, { priceSource: 'manual', unitPrice: 12.34 })
      f.group.priceSource = 'manual'
    }],
    ['manual entry quote drift', f => {
      Object.assign(f.input, { priceSource: 'manual', unitPrice: 12.3456 })
      Object.assign(f.group.metadata.input, { priceSource: 'manual', unitPrice: 12.3456 })
      f.group.priceSource = 'manual'
      f.group.metadata.entry!.entryUnitPrice = 12.34
    }]
  ]
  it.each(invalid)('rejects %s', (_name, change) => {
    const f = fixture()
    change(f)
    const before = structuredClone({ body: f.body, preview: f.preview })
    expect(() => buildNewSalePayload(f.body, f.preview)).toThrow(/保留.*草稿|草稿.*保留/)
    expect({ body: f.body, preview: f.preview }).toEqual(before)
  })

  it.each(['entryQty', 'entryUnitPrice', 'conversionRate'] as const)('rejects zero, missing and nonfinite %s', field => {
    for (const value of [0, -1, NaN, Infinity, undefined, null, '1.5']) {
      const f = fixture()
      Object.assign(f.group.metadata.entry!, { [field]: value })
      expect(() => buildNewSalePayload(f.body, f.preview)).toThrow(/保留.*草稿|草稿.*保留/)
    }
  })
})
