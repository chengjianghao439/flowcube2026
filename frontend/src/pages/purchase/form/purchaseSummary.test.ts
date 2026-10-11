import { describe, expect, it } from 'vitest'
import {
  groupPurchaseQuantities,
  purchaseDraftLineAmount,
  restorePurchaseEntryPrice,
  summarizePurchaseDraft,
  type PurchaseDraftSummaryItem,
} from './purchaseSummary'

const row = (overrides: Partial<PurchaseDraftSummaryItem> = {}): PurchaseDraftSummaryItem => ({
  _key: 1,
  productId: 10,
  productName: '商品甲',
  unit: '个',
  entryUnit: '个',
  quantity: 1,
  unitPrice: 1,
  ...overrides,
})

describe('采购完整草稿汇总', () => {
  it('每行先取分，再合计；不把两个半分行合并成一分', () => {
    const summary = summarizePurchaseDraft([
      row({ _key: 1, unitPrice: 0.005 }),
      row({ _key: 2, unitPrice: 0.005 }),
    ])
    expect(summary.amount).toBe(0.02)
    expect(summary.validLineCount).toBe(2)
    expect(purchaseDraftLineAmount(1, 0.005)).toBe(0.01)
  })

  it('只计算完整有效商品行，采购零单价合法、分数量不合法', () => {
    const summary = summarizePurchaseDraft([
      row({ unitPrice: 0 }),
      row({ productId: 0, quantity: 100, unitPrice: 10 }),
      row({ quantity: 1.5 }),
      row({ quantity: 0 }),
      row({ unitPrice: Number.NaN }),
      row({ unitPrice: -1 }),
      row({ unitPrice: Number.POSITIVE_INFINITY }),
      row({ quantity: Number.MAX_VALUE, unitPrice: 2 }),
    ])
    expect(summary).toMatchObject({ amount: 0, validLineCount: 1, invalidLineCount: 7 })
    expect(summary.quantityGroups).toHaveLength(1)
    expect(summary.quantityGroups[0]?.quantity).toBe(1)
    expect(purchaseDraftLineAmount(1, Number.POSITIVE_INFINITY)).toBeNull()
  })

  it('全量200行的最后一行仍参与金额与数量，无需渲染行数据', () => {
    const items = Array.from({ length: 200 }, (_, index) => row({ _key: index, quantity: 2, unitPrice: 1.2345 }))
    const before = JSON.stringify(items)
    expect(summarizePurchaseDraft(items)).toMatchObject({ amount: 494, validLineCount: 200 })
    expect(groupPurchaseQuantities(items)[0]?.quantity).toBe(400)
    expect(JSON.stringify(items)).toBe(before)
    items[199].quantity = 3
    expect(summarizePurchaseDraft(items).amount).toBe(495.23)
    expect(groupPurchaseQuantities(items)[0]?.quantity).toBe(401)
  })
})

describe('采购数量关系分组', () => {
  it('同商品同单位关系合并，不同商品、单位、基本单位或换算率保持独立', () => {
    const groups = groupPurchaseQuantities([
      row({ _key: 1, entryUnit: '箱', quantity: 2, conversionRate: 12 }),
      row({ _key: 2, entryUnit: '箱', quantity: 3, conversionRate: 12 }),
      row({ _key: 3, entryUnit: '箱', quantity: 4, conversionRate: 24 }),
      row({ _key: 4, productId: 20, entryUnit: '箱', quantity: 5, conversionRate: 12 }),
      row({ _key: 5, unit: '米', entryUnit: '箱', quantity: 6, conversionRate: 12 }),
      row({ _key: 6, entryUnit: '袋', quantity: 7, conversionRate: 12 }),
    ])
    expect(groups).toHaveLength(5)
    expect(groups.map(group => group.quantity)).toEqual([5, 4, 5, 6, 7])
    expect(groups[0]).toMatchObject({ entryUnit: '箱', baseUnit: '个', conversionRate: 12, lineCount: 2 })
  })

  it('基础单位率确定为1；辅助单位待加载时不猜1、不合并未知关系', () => {
    const groups = groupPurchaseQuantities([
      row({ _key: 1, quantity: 2 }),
      row({ _key: 2, entryUnit: '箱', quantity: 3, units: [] }),
      row({ _key: 3, entryUnit: '箱', quantity: 4, units: [] }),
    ])
    expect(groups).toHaveLength(3)
    expect(groups[0]?.conversionRate).toBe(1)
    expect(groups[1]).toMatchObject({ conversionRate: null, quantity: 3 })
    expect(groups[2]).toMatchObject({ conversionRate: null, quantity: 4 })
    expect(groups[1].key).not.toBe(groups[2].key)
    expect(groupPurchaseQuantities([row({ _key: 3, entryUnit: '箱', quantity: 4, units: [] })])[0].key).toBe(groups[2].key)
  })

  it('draft可读取当前units；显式快照优先，详情只使用历史快照', () => {
    const units = [{ unitName: '箱', conversionRate: 24, isBase: false }]
    expect(groupPurchaseQuantities([row({ entryUnit: '箱', units })])[0]?.conversionRate).toBe(24)
    expect(groupPurchaseQuantities([row({ entryUnit: '箱', conversionRate: 12, units })])[0]?.conversionRate).toBe(12)
    const saved = groupPurchaseQuantities([row({ entryUnit: '箱', quantity: 36, entryQty: 3, conversionRate: 12, units })], 'saved')
    expect(saved[0]).toMatchObject({ quantity: 3, conversionRate: 12 })
    expect(groupPurchaseQuantities([row({ entryUnit: '箱', entryQty: 3, units })], 'saved')[0]?.conversionRate).toBeNull()
  })

  it('非法显式率不退回当前资料；详情缺辅助录入量时不把基本量当箱数', () => {
    for (const conversionRate of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(groupPurchaseQuantities([row({ entryUnit: '箱', conversionRate, units: [{ unitName: '箱', conversionRate: 12 }] })])[0]?.conversionRate).toBeNull()
    }
    expect(groupPurchaseQuantities([row({ entryUnit: '箱', quantity: 36, conversionRate: 12 })], 'saved')[0]?.quantity).toBeNull()
  })

  it('详情可以显示两位录入量，草稿仍保持采购正整数要求', () => {
    const item = row({ quantity: 1.5, entryQty: 1.5 })
    expect(groupPurchaseQuantities([item], 'saved')[0]?.quantity).toBe(1.5)
    expect(groupPurchaseQuantities([item], 'draft')).toEqual([])
  })
})

describe('采购编辑录入价恢复', () => {
  it('基础单位保留四位原报价，不按两位金额除数量倒价', () => {
    expect(restorePurchaseEntryPrice({ unit: '个', unitPrice: 1.2345, quantity: 3, amount: 3.70 })).toEqual({
      entryUnitPrice: 1.2345, verified: true, warning: null,
    })
    expect(restorePurchaseEntryPrice({ unit: '个', unitPrice: 3.4567, quantity: 1, amount: 3.46 })).toEqual({
      entryUnitPrice: 3.4567, verified: true, warning: null,
    })
  })

  it('辅助单位由八位基本价和快照率恢复四位候选，核对已存金额', () => {
    expect(restorePurchaseEntryPrice({ unit: '个', entryUnit: '箱', conversionRate: 12, unitPrice: 0.102875, quantity: 36, entryQty: 3, amount: 3.70 })).toEqual({
      entryUnitPrice: 1.2345, verified: true, warning: null,
    })
  })

  it('候选价不能复现原金额时返回警告，不用amount/qty覆盖报价', () => {
    const result = restorePurchaseEntryPrice({ unit: '个', entryUnit: '箱', conversionRate: 12, unitPrice: 0.1, quantity: 36, entryQty: 3, amount: 4 })
    expect(result.entryUnitPrice).toBe(1.2)
    expect(result.verified).toBe(false)
    expect(result.warning ?? '').toContain('金额')
  })

  it('辅助快照缺失、非法或缺录入量时不能声称已恢复', () => {
    for (const conversionRate of [undefined, 0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const result = restorePurchaseEntryPrice({ unit: '个', entryUnit: '箱', conversionRate, unitPrice: 0.1, quantity: 36, entryQty: 3, amount: 3.60 })
      expect(result.entryUnitPrice).toBeNull()
      expect(result.verified).toBe(false)
      expect(result.warning ?? '').toContain('换算')
    }
    const missingEntryQty = restorePurchaseEntryPrice({ unit: '个', entryUnit: '箱', conversionRate: 12, unitPrice: 0.1, quantity: 36, amount: 3.60 })
    expect(missingEntryQty.verified).toBe(false)
    expect(missingEntryQty.warning ?? '').toContain('录入数量')
  })

  it('大换算率即使金额相符仍检查多种四位报价映射同一个八位基本价', () => {
    const result = restorePurchaseEntryPrice({ unit: '个', entryUnit: '箱', conversionRate: 1_000_000, unitPrice: 0.00000123, quantity: 1_000_000, entryQty: 1, amount: 1.23 })
    expect(result.entryUnitPrice).toBe(1.23)
    expect(result.verified).toBe(false)
    expect(result.warning ?? '').toContain('唯一')
  })

  it('保留零报价；缺金额或非法价格不伪装为零报价', () => {
    expect(restorePurchaseEntryPrice({ unit: '个', unitPrice: 0, quantity: 1, amount: 0 })).toMatchObject({ entryUnitPrice: 0, verified: true })
    expect(restorePurchaseEntryPrice({ unit: '个', unitPrice: Number.NaN, quantity: 1, amount: 0 })).toMatchObject({ entryUnitPrice: null, verified: false })
    expect(restorePurchaseEntryPrice({ unit: '个', unitPrice: 1, quantity: 1 })).toMatchObject({ entryUnitPrice: 1, verified: false })
  })
})
