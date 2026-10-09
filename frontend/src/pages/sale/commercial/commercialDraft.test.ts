import { describe, expect, it } from 'vitest'
import { draftFromGroups, draftFromOrder, toCommercialInputs, commercialPrintRows } from './commercialDraft'
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
  it('restores an exact two-decimal entry quantity despite binary division noise', () => {
    const group = { ...auxiliary, targetQty: 0.3, metadata: { ...auxiliary.metadata, entry: { ...auxiliary.metadata.entry!, conversionRate: 0.1 } } }
    const draft = draftFromGroups([group])
    expect(draft[0].quantity).toBe('3')
    expect(toCommercialInputs(draft)[0].quantity).toBe(3)
  })
  it('retains old kit version and input identity without looking up current master', () => {
    expect(toCommercialInputs(draftFromGroups([kit]))).toEqual([{ ...kit.metadata.input, quantity: 1 }])
  })
  it('restores and prints the frozen kit identity and unit instead of current product details', () => {
    const group = { ...kit, metadata: { ...kit.metadata, kitUnit: '组', kitIdentity: { spec: 'H-20', color: '银色', articleNumber: 'SUP-20' } } }
    expect(draftFromGroups([group])[0]).toMatchObject({ unit: '组', baseUnit: '组' })
    expect(commercialPrintRows([group])[0]).toMatchObject({ unit: '组', spec: 'H-20', color: '银色', articleNumber: 'SUP-20' })
    expect(commercialPrintRows([kit])[0]).toMatchObject({ unit: '套', spec: '', color: '', articleNumber: '' })
  })
  it('prints auxiliary current basic quantity with stored derived quote and original packaging basis', () => {
    const row = commercialPrintRows([auxiliary])[0]
    expect(row).toMatchObject({ quantity: 15, unit: '个', unitPrice: 1.23456, amount: 18.52, priceText: '¥1.23456' })
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

it('legacy adapter keeps saved entry quantity, four digit quote, identity, warehouse and remark', () => {
  const order = { warehouseId:1, items:[{id:31,productId:11,productCode:'P11',productName:'螺钉',unit:'个',entryUnit:'箱',entryQty:2,quantity:24,conversionRate:12,unitPrice:10.01028333,amount:240.25,warehouseId:2,remark:'保留备注',spec:'M4',color:'本色',articleNumber:'SUP'}] } as import('@/types/sale').SaleOrder
  const rows=draftFromOrder(order)
  expect(rows[0]).toMatchObject({ quantity:'2',price:'120.1234',unit:'箱',baseUnit:'个',spec:'M4',color:'本色',articleNumber:'SUP' })
  expect(toCommercialInputs(rows)).toEqual([{kind:'ordinary',lineKey:'ordinary:31',productId:11,warehouseId:2,entryUnit:'箱',quantity:2,priceSource:'manual',unitPrice:120.1234,remark:'保留备注'}])
  expect(rows[0].price).not.toBe(String(order.items![0].amount/2))
})
it('legacy auxiliary unit without a saved conversion cannot guess a quote', () => {
  const rows=draftFromOrder({warehouseId:1,items:[{id:1,productId:11,unit:'个',entryUnit:'箱',quantity:24,entryQty:2,unitPrice:10,amount:240}]} as import('@/types/sale').SaleOrder)
  expect(rows[0].packagingExpressible).toBe(false)
  expect(()=>toCommercialInputs(rows)).toThrow('原包装精度')
})
