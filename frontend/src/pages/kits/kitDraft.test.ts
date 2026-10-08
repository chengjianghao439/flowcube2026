import { describe, expect, test } from 'vitest'
import { buildKitPayload, draftFromKit, emptyKitDraft } from './kitDraft'

import { savedKit } from './kitFixtures.test-data'
const profile = { categoryId: 2, supplierId: 3, unit: '套', spec: 'H-10', color: '银色', articleNumber: 'SUP-H10', costPrice: 80, remark: '原资料' }
describe('成套配件维护载荷', () => {
  test('报价/名称/启停编辑省略全部组成，六位原参考不被四位化', () => {
    const draft = draftFromKit(savedKit)
    draft.price = '99.9999'; draft.name = '新名'; draft.isActive = false
    expect(buildKitPayload(draft, savedKit)).toEqual({ ...profile, name: '新名', isActive: false, referenceUnitPrice: 99.9999, salePriceA: 99.9999, revision: 3 })
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
  test('新建编码由系统生成，空报价省略；明确输入零保留且不发送code', () => {
    const draft = Object.assign(emptyKitDraft(), draftFromKit(savedKit), { code: '', price: '', priceB: '0', priceC: '', priceD: '', costPrice: '10' })
    expect(buildKitPayload(draft)).toEqual({ ...profile, name: '铰链套', isActive: true, costPrice: 10, salePriceB: 0, components: [{ productId: 11, baseQty: .01 }, { productId: 12, baseQty: 4 }] })
    draft.code = '员工改不了的旧码'; draft.price = '0'
    expect(buildKitPayload(draft, savedKit)).toMatchObject({ referenceUnitPrice: 0, salePriceA: 0, salePriceB: 0, revision: 3 })
    expect(buildKitPayload(draft, savedKit)).not.toHaveProperty('code')
    expect(buildKitPayload(draft, savedKit).components).toBeUndefined()
  })
  test('DTO四档价格优先资料回填，历史缺档只回退旧A，不按进价重新计算', () => {
    const current = { ...savedKit, salePriceA: 0, salePriceB: 12, salePriceC: 13, salePriceD: 14, version: { ...savedKit.version!, salePriceA: 99, salePriceB: 98, salePriceC: 97, salePriceD: 96 } }
    expect(draftFromKit(current)).toMatchObject({ price: '0', priceB: '12', priceC: '13', priceD: '14', costPrice: '80', categoryName: '五金配件', supplierName: '配件供应商' })
    expect(draftFromKit(savedKit)).toMatchObject({ price: '100', priceB: '100', priceC: '100', priceD: '100' })
  })
  test.each(['categoryId', 'supplierId', 'unit', 'spec', 'color', 'costPrice'] as const)('新建资料必填：%s', field => {
    const draft = draftFromKit(savedKit)
    Object.assign(draft, { [field]: field.endsWith('Id') ? null : '' })
    expect(() => buildKitPayload(draft)).toThrow()
  })
  test.each(['0', '-1', '1.00001', '999999999'])('进价须为允许范围内的大于零四位金额：%s', costPrice => {
    const draft = Object.assign(draftFromKit(savedKit), { costPrice })
    expect(() => buildKitPayload(draft)).toThrow()
  })
  test.each(['priceB', 'priceC', 'priceD'] as const)('四档均验证四位精度：%s', field => {
    const draft = Object.assign(draftFromKit(savedKit), { [field]: '1.00001' })
    expect(() => buildKitPayload(draft)).toThrow('4 位')
  })
  test('编辑清空售价发送null请求按当前进价重算，零仍是显式售价', () => {
    const draft = Object.assign(draftFromKit(savedKit), { price: '', priceB: '', priceC: '0' })
    const payload = buildKitPayload(draft, savedKit)
    expect(payload).toMatchObject({ salePriceA: null, salePriceB: null, salePriceC: 0, costPrice: 80 })
    expect(payload).not.toHaveProperty('referenceUnitPrice')
    expect(payload).not.toHaveProperty('salePriceD')
    expect(payload.components).toBeUndefined()
  })
  test('历史BCD未保存时只改元资料，四档有效旧价全部省略，不制造新版本', () => {
    const legacy = { ...savedKit, version: { ...savedKit.version!, salePriceB: null, salePriceC: null, salePriceD: null } }
    const draft = draftFromKit(legacy); draft.name = '只改名称'
    const payload = buildKitPayload(draft, legacy)
    expect(payload).toEqual({ ...profile, name: '只改名称', isActive: true, revision: 3 })
  })
  test('编辑数字等值售价不发送，精度仍先验证，零与清空是独立操作', () => {
    const draft = draftFromKit(savedKit); draft.price = '100.0000'; draft.priceB = '100.0'; draft.priceC = ' 100 '; draft.priceD = '100.00'
    expect(buildKitPayload(draft, savedKit)).toEqual({ ...profile, name: '铰链套', isActive: true, revision: 3 })
    draft.priceB = '100.00000'
    expect(() => buildKitPayload(draft, savedKit)).toThrow('4 位')
    draft.priceB = '0'; draft.priceD = ''
    expect(buildKitPayload(draft, savedKit)).toMatchObject({ salePriceB: 0, salePriceD: null })
  })
  test('历史缺资料可补齐并清空选填内容，组成保持原快照', () => {
    const legacy = { ...savedKit, categoryId: null, categoryName: null, supplierId: null, supplierName: null, unit: null, spec: null, color: null, costPrice: null, articleNumber: null, remark: null }
    const draft = draftFromKit(legacy)
    expect(draft).toMatchObject({ categoryId: null, supplierId: null, unit: '套', spec: '', color: '', costPrice: '', articleNumber: '', remark: '' })
    expect(() => buildKitPayload(draft, legacy)).toThrow()
    Object.assign(draft, { ...profile, costPrice: '80', articleNumber: '', remark: '' })
    expect(buildKitPayload(draft, legacy)).toMatchObject({ ...profile, articleNumber: '', remark: '', revision: 3 })
    expect(buildKitPayload(draft, legacy).components).toBeUndefined()
  })
})
