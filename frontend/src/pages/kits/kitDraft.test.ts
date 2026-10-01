import { describe, expect, test } from 'vitest'
import { buildKitPayload, draftFromKit } from './kitDraft'

import { savedKit } from './kitFixtures.test-data'
describe('成套配件维护载荷', () => {
  test('报价/名称/启停编辑省略全部组成，六位原参考不被四位化', () => {
    const draft = draftFromKit(savedKit)
    draft.price = '99.9999'; draft.name = '新名'; draft.isActive = false
    expect(buildKitPayload(draft, savedKit)).toEqual({ code: 'K7', name: '新名', isActive: false, referenceUnitPrice: 99.9999, revision: 3 })
    expect(draft.components[0].weight).toBe('')
    expect(savedKit.version?.components[0].amountWeight).toBe('0.000001')
  })
  test('组成真改才发送基本量，不带默认权重与辅助单位', () => {
    const draft = draftFromKit(savedKit); draft.components[1].quantity = '5'
    expect(buildKitPayload(draft, savedKit).components).toEqual([{ productId: 11, baseQty: .01 }, { productId: 12, baseQty: 5 }])
  })
  test('显式模式不能隐式复用A价派生权重，必须所有组件主动填写', () => {
    const draft = draftFromKit(savedKit); draft.mode = 'explicit'; draft.components[0].weight = '0'
    expect(() => buildKitPayload(draft, savedKit)).toThrow('全部组件')
    draft.components[1].weight = '2.1234'
    expect(buildKitPayload(draft, savedKit).components).toEqual([{ productId: 11, baseQty: .01, amountWeight: 0 }, { productId: 12, baseQty: 4, amountWeight: 2.1234 }])
  })
  test('已存显式权重等值回填仍省略组成', () => {
    const kit = structuredClone(savedKit)
    kit.version!.components.forEach((c, i) => { c.weightSource = 'explicit'; c.amountWeight = i ? '2.123400' : '0.000000' })
    const draft = draftFromKit(kit); draft.components[1].weight = '2.1234'; draft.price = '200'
    expect(buildKitPayload(draft, kit).components).toBeUndefined()
  })
  test.each(['0', '-1', '1.001', '99999999999'])('拒绝非法每套基本量 %s', quantity => {
    const draft = draftFromKit(savedKit); draft.components[0].quantity = quantity
    expect(() => buildKitPayload(draft, savedKit)).toThrow()
  })
  test('整数商品禁止小数；重复商品禁止；不足1或超过50组件禁止', () => {
    const draft = draftFromKit(savedKit); draft.components[1].quantity = '1.5'
    expect(() => buildKitPayload(draft, savedKit)).toThrow('整数')
    draft.components[1].quantity = '4'; draft.components[1].productId = 11
    expect(() => buildKitPayload(draft, savedKit)).toThrow('重复')
    draft.components = []; expect(() => buildKitPayload(draft, savedKit)).toThrow('1 至 50')
    draft.components = Array.from({ length: 51 }, (_, i) => ({ ...draftFromKit(savedKit).components[0], productId: i + 1 }))
    expect(() => buildKitPayload(draft, savedKit)).toThrow('1 至 50')
  })
  test('四位报价/手动权重，个别零合法且总和须大于零', () => {
    const draft = draftFromKit(savedKit); draft.price = '1.00001'
    expect(() => buildKitPayload(draft, savedKit)).toThrow('4 位')
    draft.price = '0'; draft.mode = 'explicit'; draft.components.forEach(c => { c.weight = '0' })
    expect(() => buildKitPayload(draft, savedKit)).toThrow('大于零')
    draft.components[1].weight = '0.00001'; expect(() => buildKitPayload(draft, savedKit)).toThrow('4 位')
  })
})
