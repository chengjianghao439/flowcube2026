const test = require('node:test')
const assert = require('node:assert/strict')
const { foldEntryItems, resolveConversionRate, foldEntryItemWithRate } = require('../backend/src/utils/unitConversion')

function database() {
  const queries = []
  return { queries, async query(sql) {
    queries.push(sql)
    if (sql.includes('product_units')) return [[{ product_id: 7, unit_name: '箱', conversion_rate: 12 }]]
    if (sql.includes('product_items')) return [[{ id: 7, unit: '件', allow_decimal_qty: 1 }]]
    throw new Error(`Unexpected SQL: ${sql}`)
  } }
}
test('旧客户端不能再用已配置的辅助单位创建新业务', async () => {
  const db = database()
  await assert.rejects(foldEntryItems(db, [{ productId: 7, unit: '件', entryUnit: '箱', quantity: 2, unitPrice: 120 }]), { code: 'PRODUCT_MULTI_UNIT_REMOVED' })
  assert.ok(db.queries.every(sql => !sql.includes('product_units')))
})
test('不能把辅助单位伪装成商品的固定单位', async () => {
  await assert.rejects(foldEntryItems(database(), [{ productId: 7, unit: '箱', entryUnit: '箱', quantity: 2, unitPrice: 120 }]), { code: 'PRODUCT_UNIT_MISMATCH' })
})
test('固定单位新录入保留数量和高精度单价', async () => {
  const [item] = await foldEntryItems(database(), [{ productId: 7, unit: '件', quantity: 1.25, unitPrice: 12.345678 }])
  assert.equal(item.quantity, 1.25)
  assert.equal(item.entryQty, 1.25)
  assert.equal(item.entryUnit, '件')
  assert.equal(item.conversionRate, 1)
  assert.equal(item.unitPrice, 12.345678)
})
test('采购策略不能继续解析辅助单位，历史快照的纯折算函数仍保持原金额', async () => {
  await assert.rejects(resolveConversionRate(database(), 7, '箱', '件'), { code: 'PRODUCT_MULTI_UNIT_REMOVED' })
  const old = foldEntryItemWithRate({ productId: 7, unit: '件', entryUnit: '箱', quantity: 2, unitPrice: 120.1234 }, 12)
  assert.equal(old.quantity, 24)
  assert.equal(old.amount, 240.25)
})


test('有源退货只按原单基本单位验证，不用今天主档单位改写历史', async () => {
  const fs = require('node:fs'), vm = require('node:vm')
  const AppError = require('../backend/src/utils/AppError')
  for (const [file, validator] of [['returns-sale', 'validateSaleReturnItems'], ['returns-purchase', 'validatePurchaseReturnItems']]) {
    const filename = require.resolve(`../backend/src/modules/returns/${file}.service`)
    const context = { module: { exports: {} }, require: id => id.endsWith('/AppError') ? AppError : {} }
    vm.runInNewContext(fs.readFileSync(filename, 'utf8') + `\nmodule.exports.validator = ${validator}`, context, { filename })
    const original = { id: 2, product_id: 7, unit: '件', unit_price: 12.345678, quantity: 3, shipped_qty: 3, received_qty: 3, returned_qty: 0 }
    const conn = { async query(sql) { return [sql.includes('SELECT soi.id') || sql.includes('SELECT poi.id') ? [original] : []] } }
    const input = { sourceItemId: 2, productId: 7, unit: '箱', quantity: 1, unitPrice: 999 }
    await assert.rejects(context.module.exports.validator(conn, 1, [input]), { code: 'RETURN_SOURCE_UNIT_MISMATCH' })
    input.unit = '件'
    await context.module.exports.validator(conn, 1, [input])
    assert.equal(input.unitPrice, 12.345678)
    input.quantity = 4
    await assert.rejects(context.module.exports.validator(conn, 1, [input]), /退货数量超出实际/)
  }
})
