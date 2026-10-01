'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const target = '../backend/src/modules/kits/kits.composition'
const exists = fs.existsSync(require('node:path').resolve(__dirname, `${target}.js`))
const api = exists ? require(target) : {}
const call = (name, ...args) => { assert.equal(typeof api[name], 'function', `missing kit composition behavior: ${name}`); return api[name](...args) }
const products = new Map([[1, { id: 1, name: '铰链', sale_price_a: '80', allow_decimal_qty: 0 }], [2, { id: 2, name: '螺钉', sale_price_a: '5', allow_decimal_qty: 0 }]])
const parts = () => call('snapshotComponents', [{ productId: 1, baseQty: 1 }, { productId: 2, baseQty: 4 }], products)
const kit = (lineKey, unitPrice, quantity = 1, components = parts()) => ({ kind: 'kit', lineKey, kitVersionId: 10, warehouseId: 3, quantity, unitPrice, components })
test('A-price snapshots explain 80:20 weights and remain independent of later prices', () => {
  const snapshot = parts()
  assert.deepEqual(snapshot.map(p => [p.referencePrice, Number(p.amountWeight), p.weightSource]), [[80, 80, 'product_a'], [5, 20, 'product_a']])
  const changed = new Map(products); changed.set(1, { ...products.get(1), sale_price_a: 999 })
  assert.equal(snapshot[0].referencePrice, 80)
  assert.equal(call('snapshotComponents', [{ productId: 1, baseQty: 1 }], changed)[0].referencePrice, 999)
})
test('kit A100+B200 shares physical components but preserves commercial allocation', () => {
  const result = call('expandCommercialGroups', [kit('A', 100), kit('B', 200)])
  assert.deepEqual(result.commercialGroups.map(g => g.components.map(c => c.amount)), [[80, 20], [160, 40]])
  assert.deepEqual(result.physicalItems.map(i => [i.productId, i.quantity, i.amount]), [[1, 2, 240], [2, 8, 60]])
  assert.equal(result.amount, 300)
})
test('ordinary hinge remains a separate commercial group while demand merges to 3 and 270', () => {
  const result = call('expandCommercialGroups', [kit('A', 100), kit('B', 200), { kind: 'ordinary', lineKey: 'O', productId: 1, warehouseId: 3, quantity: 1, unitPrice: 30 }])
  assert.equal(result.commercialGroups[2].kind, 'ordinary')
  assert.deepEqual(result.physicalItems.map(i => [i.productId, i.quantity, i.amount]), [[1, 3, 270], [2, 8, 60]])
  assert.equal(result.amount, 330)
})
test('equal-weight one-cent tail goes to fixed sort/id order, including when input order changes', () => {
  const components = [{ id: 9, productId: 1, baseQty: 1, amountWeight: 1, sortNo: 1 }, { id: 2, productId: 2, baseQty: 1, amountWeight: 1, sortNo: 0 }]
  for (const input of [components, [...components].reverse()]) {
    const g = call('expandCommercialGroups', [kit('T', 0.01, 1, input)]).commercialGroups[0]
    assert.deepEqual(g.components.map(c => [c.productId, c.amount]), [[2, 0.01], [1, 0]])
  }
})
test('all allocated cents sum to the parent across prices, quantities, and awkward weights', () => {
  for (const price of [0, 0.01, 0.015, 0.3333, 123456.7891]) {
    for (const quantity of [1, 3, 17]) {
      const cs = [1, 7, 13].map((w, i) => ({ productId: i + 1, baseQty: 1, amountWeight: w, sortNo: i }))
      const g = call('expandCommercialGroups', [kit('T', price, quantity, cs)]).commercialGroups[0]
      assert.equal(g.components.reduce((sum, c) => sum + Math.round(c.amount * 100), 0), Math.round(g.amount * 100))
    }
  }
})
test('duplicate components, >50, original excessive decimals and integer violation reject', () => {
  for (const [input, code] of [
    [[{ productId: 1, baseQty: 1 }, { productId: 1, baseQty: 2 }], 'KIT_COMPONENT_DUPLICATE'],
    [Array.from({ length: 51 }, (_, i) => ({ productId: i + 1, baseQty: 1 })), 'KIT_COMPONENT_LIMIT'],
    [[{ productId: 1, baseQty: 1.001 }], 'QTY_DECIMALS_EXCEEDED'],
    [[{ productId: 1, baseQty: 1.5 }], 'QTY_INTEGER_REQUIRED'],
  ]) assert.throws(() => call('snapshotComponents', input, products), e => e.code === code)
})
test('zero A prices require explicit positive weights, never automatic equal split', () => {
  const zero = new Map([...products].map(([id, p]) => [id, { ...p, sale_price_a: 0 }]))
  const input = [{ productId: 1, baseQty: 1 }, { productId: 2, baseQty: 4 }]
  assert.throws(() => call('snapshotComponents', input, zero), e => e.code === 'KIT_WEIGHTS_ZERO')
  assert.throws(() => call('snapshotComponents', input.map(p => ({ ...p, amountWeight: 0 })), zero), e => e.code === 'KIT_WEIGHTS_ZERO')
  const explicit = call('snapshotComponents', input.map((p, i) => ({ ...p, amountWeight: i === 0 ? 8 : 2 })), zero)
  assert.deepEqual(explicit.map(p => p.weightSource), ['explicit', 'explicit'])
})
test('mixed explicit and derived weights reject as an ambiguous policy', () => {
  assert.throws(() => call('snapshotComponents', [{ productId: 1, baseQty: 1, amountWeight: 8 }, { productId: 2, baseQty: 4 }], products), e => e.code === 'KIT_WEIGHT_POLICY_MIXED')
})
test('kit quantities are positive integers, line keys unique and groups bounded', () => {
  for (const quantity of [0, -1, 1.5]) assert.throws(() => call('expandCommercialGroups', [kit('A', 100, quantity)]), e => e.code === 'KIT_QUANTITY_INTEGER')
  assert.throws(() => call('expandCommercialGroups', [kit('A', 100), kit('A', 200)]), e => e.code === 'KIT_LINE_KEY_DUPLICATE')
  assert.throws(() => call('expandCommercialGroups', Array.from({ length: 201 }, (_, i) => kit(String(i), 1))), e => e.code === 'KIT_GROUP_LIMIT')
})
test('same product in different warehouses does not merge', () => {
  const result = call('expandCommercialGroups', [kit('A', 100), { ...kit('B', 200), warehouseId: 4 }])
  assert.equal(result.physicalItems.length, 4)
})
test('A-price times quantity preserves micro-units, including values beyond safe integer micros', () => {
  const tiny = new Map([[1, { name: '微价', sale_price_a: '0.0001', allow_decimal_qty: 1 }]])
  assert.equal(call('snapshotComponents', [{ productId: 1, baseQty: 0.01 }], tiny)[0].amountWeight, '0.000001')
  const large = new Map([[1, { name: '大价', sale_price_a: '99999999.9999', allow_decimal_qty: 1 }]])
  assert.equal(call('snapshotComponents', [{ productId: 1, baseQty: 999999.99 }], large)[0].amountWeight, '99999998999900.000001')
})
test('200 physical dimensions are bounded independently of commercial groups', () => {
  const many = Array.from({ length: 5 }, (_, i) => kit(String(i), 1, 1, Array.from({ length: 41 }, (_, j) => ({ productId: i * 41 + j + 1, baseQty: 1, amountWeight: '1', sortNo: j }))))
  assert.throws(() => call('expandCommercialGroups', many), e => e.code === 'KIT_PHYSICAL_LIMIT')
})
test('tiny nonzero price beyond four decimals is rejected instead of silently becoming zero', () => {
  assert.throws(() => call('assertPrice', 1e-20), e => e.code === 'KIT_PRICE_INVALID')
})
test('new kit parent amount is exact half-up from price4 and quantity2, including 1.005 binary edge', () => {
  for (const [price, quantity, expected] of [[1.005, 1, 1.01], [0.0049, 2, 0.01], [0.0067, 3, 0.02]]) {
    const group = call('expandCommercialGroups', [kit('K', price, quantity)]).commercialGroups[0]
    assert.equal(group.unitPrice, price)
    assert.equal(group.quantity, quantity)
    assert.equal(group.amount, expected)
    assert.equal(group.components.reduce((sum, c) => sum + Math.round(c.amount * 100), 0), Math.round(expected * 100))
  }
  const ordinary = call('expandCommercialGroups', [{ kind: 'ordinary', lineKey: 'O', productId: 1, warehouseId: 3, quantity: 1, unitPrice: 1.005 }])
  assert.equal(ordinary.amount, 1.01)
})
test('new amounts respect existing DECIMAL(14,4) capacity before Number conversion and aggregation', () => {
  assert.equal(call('amountFromPriceQuantity', 99999999.9999, 100), 9999999999.99)
  assert.throws(() => call('expandCommercialGroups', [kit('X', 10000000, 1000)]), e => e.code === 'KIT_AMOUNT_OVERFLOW')
  assert.throws(() => call('expandCommercialGroups', [kit('A', 6000000, 1000), kit('B', 6000000, 1000)]), e => e.code === 'KIT_AMOUNT_OVERFLOW')
})
