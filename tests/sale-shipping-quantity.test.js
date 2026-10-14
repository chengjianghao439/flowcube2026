'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { normalizeFixedSaleItems, assertTaskShipmentQuantity } = require('../backend/src/modules/sale/sale.shipping-quantity')
const { assertQtyPrecision } = require('../backend/src/utils/qtyPrecision')
const fs = require('node:fs')
const path = require('node:path')
const base = { productId: 1, warehouseId: 2, productName: '螺钉', unit: '箱', entryUnit: '箱', quantity: 2, unitPrice: 12, allowDecimalQtySnapshot: 0 }
test('新商品缺省及关闭时只允许正整数，固定单位本身为箱也不折算', () => {
  for (const policy of [undefined, 0]) {
    const item = { ...base, allowDecimalQtySnapshot: policy }
    assert.throws(() => normalizeFixedSaleItems([{ ...item, quantity: 0.5 }]), { code: 'QTY_INTEGER_REQUIRED' })
    assert.equal(normalizeFixedSaleItems([item])[0].conversionRate, 1)
    assert.equal(normalizeFixedSaleItems([item])[0].amount, 24)
  }
  for (const quantity of [0, -1, 10000000000]) assert.throws(() => normalizeFixedSaleItems([{ ...base, quantity }]), { code: 'QTY_INVALID' })
})
test('允许小数仍只收两位原量；单价和金额精度不随数量规则收窄', () => {
  const item = { ...base, unit: '件', entryUnit: '件', allowDecimalQtySnapshot: 1, unitPrice: 1.2345, quantity: 0.25 }
  const result = normalizeFixedSaleItems([item])[0]
  assert.equal(result.quantity, 0.25); assert.equal(result.unitPrice, 1.2345); assert.equal(result.amount, 0.31)
  for (const quantity of [0.005, 1.001, '1.2301']) assert.throws(() => normalizeFixedSaleItems([{ ...item, quantity }]), { code: 'QTY_DECIMALS_EXCEEDED' })
})
test('API 不能通过旧辅助单位或客户端换算率恢复新销售换算', () => {
  assert.throws(() => normalizeFixedSaleItems([{ ...base, entryUnit: '包', quantity: 1, conversionRate: 12 }]), { code: 'SALE_FIXED_UNIT_REQUIRED' })
  const result = normalizeFixedSaleItems([{ ...base, conversionRate: 12, entryQty: 999, amount: 1 }])[0]
  assert.equal(result.quantity, 2); assert.equal(result.entryQty, 2); assert.equal(result.conversionRate, 1); assert.equal(result.amount, 24)
})
test('历史原行使用保存的单位、数量、换算率、单价和金额，忽略主档变化', () => {
  const original = { product_id: 1, warehouse_id: 2, unit: '件', entry_unit: '包', quantity: '6.00', entry_qty: '0.50', conversion_rate: '12', unit_price: '1.23456667', amount: '7.40', allow_decimal_qty_snapshot: null }
  const input = { ...base, unit: '箱', entryUnit: '包', quantity: 0.5, unitPrice: 14.8148, allowDecimalQtySnapshot: 0 }
  const result = normalizeFixedSaleItems([input], [original])[0]
  assert.equal(result.unit, '件'); assert.equal(result.entryUnit, '包'); assert.equal(result.quantity, 6)
  assert.equal(result.entryQty, 0.5); assert.equal(result.conversionRate, 12)
  assert.equal(result.unitPrice, 1.23456667); assert.equal(result.amount, 7.4); assert.equal(result.allowDecimalQtySnapshot, null)
  assert.throws(() => normalizeFixedSaleItems([{ ...input, quantity: 0.25 }], [original]), { code: 'SALE_FIXED_UNIT_REQUIRED' })
  assert.throws(() => normalizeFixedSaleItems([input]), { code: 'SALE_FIXED_UNIT_REQUIRED' }, '复制不能获得旧行兼容待遇')
})
test('当前商品规则不能被历史快照或调用参数豁免', async () => {
  const conn = { query: async () => [[{ id: 1, name: '当前关闭', allow_decimal_qty: 0 }]] }
  for (const allowDecimalSnapshot of [null, 0, 1]) await assert.rejects(assertQtyPrecision(conn, [{ productId: 1, qty: 0.25, allowDecimalSnapshot }]), { code: 'QTY_INTEGER_REQUIRED' })
  await assert.rejects(assertQtyPrecision(conn, [{ productId: 1, qty: 0.25 }], { enforceShippingPolicy: false }), { code: 'QTY_INTEGER_REQUIRED' })
  await assert.rejects(assertQtyPrecision(conn, [{ productId: 1, qty: 0.005, allowDecimalSnapshot: null }]), { code: 'QTY_DECIMALS_EXCEEDED' })

})
test('仓库装箱使用当前商品规则，历史字段不能豁免', async () => {
  const conn = flag => ({ query: async sql => sql.includes('FROM product_items') ? [[{id:1,allow_decimal_qty:flag}]] : [[{id:8,allow_decimal_qty_snapshot:1}]] })
  await assert.rejects(assertTaskShipmentQuantity(conn(0),8,1,.5), {code:'QTY_INTEGER_REQUIRED'})
  await assert.doesNotReject(assertTaskShipmentQuantity(conn(1),8,1,.5))
  await assert.rejects(assertTaskShipmentQuantity({query:async()=>[[]]},8,1,1), {code:'SHIPMENT_ITEM_NOT_FOUND'})
  await assert.rejects(assertTaskShipmentQuantity(conn(1),8,1,.005), {code:'QTY_DECIMALS_EXCEEDED'})
})
test('迁移只改变新商品默认及增加空快照，不批量重写存量规则或原事实', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../backend/src/database/288_sale_shipping_quantity_policy.sql'), 'utf8')
  assert.match(sql, /ALTER COLUMN allow_decimal_qty SET DEFAULT 0/)
  assert.equal((sql.match(/ADD COLUMN allow_decimal_qty_snapshot TINYINT NULL DEFAULT NULL/g) || []).length, 2)
  assert.doesNotMatch(sql, /\bUPDATE\s+(?:product_items|sale_order_items|warehouse_task_items)\b/i)
  assert.match(sql, /information_schema\.COLUMNS/)
})
