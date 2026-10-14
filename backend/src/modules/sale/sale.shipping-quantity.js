'use strict'

const AppError = require('../../utils/AppError')
const { assertQtyScale, assertQtyPrecision, assertQtyPrecisionWith } = require('../../utils/qtyPrecision')
const {cashNumber,productCents}=require('../../utils/cashMoney')
const { round8 } = require('../../utils/unitConversion')

// New sales have no unit conversion path. Legacy facts are recognized only
// from locked original rows supplied by the service, never a client flag/rate.
function normalizeFixedSaleItems(items, saved = []) {
  return items.map((item, index) => {
    const original = saved.find(row => Number(row.product_id) === Number(item.productId)
      && Number(row.warehouse_id) === Number(item.warehouseId))
    const legacyEntry = original && (original.entry_unit || original.unit)
    const oldPrice = original && Math.round(Number(original.unit_price) * Number(original.conversion_rate || 1) * 10000) / 10000
    const unchanged = original && (item.entryUnit || item.unit) === legacyEntry
      && Number(item.quantity) === Number(original.entry_qty ?? original.quantity)
      && Number(item.unitPrice) === oldPrice
    if (unchanged) {
      assertQtyPrecisionWith({ name: item.productName, allowDecimal: Number(item.allowDecimalQtySnapshot) === 1 }, original.quantity, '原行基础数量')
      return { ...item, unit: original.unit, quantity: Number(original.quantity), unitPrice: Number(original.unit_price), amount: Number(original.amount),
        entryUnit: legacyEntry, entryQty: Number(original.entry_qty ?? original.quantity), conversionRate: Number(original.conversion_rate || 1),
        entryUnitPrice: oldPrice, allowDecimalQtySnapshot: original.allow_decimal_qty_snapshot ?? null }
    }
    if (item.entryUnit && item.entryUnit !== item.unit) {
      throw new AppError(`商品「${item.productName || '该商品'}」须按固定单位「${item.unit}」出货；历史单位只供原单查看`, 400, 'SALE_FIXED_UNIT_REQUIRED')
    }
    assertQtyScale(item.quantity, `第 ${index + 1} 行数量`)
    const quantity = Number(item.quantity)
    if (!(quantity > 0) || quantity > 9999999999.99) throw new AppError('出货数量须大于零且不超出允许范围', 400, 'QTY_INVALID')
    const allowDecimal = Number(item.allowDecimalQtySnapshot) === 1
    assertQtyPrecisionWith({ name: item.productName, allowDecimal }, quantity)
    const unitPrice = round8(Number(item.unitPrice))
    return { ...item, quantity, unitPrice, amount:cashNumber(productCents(quantity,unitPrice)), entryUnit: item.unit, entryQty: quantity,
      conversionRate: 1, entryUnitPrice: unitPrice, allowDecimalQtySnapshot: allowDecimal ? 1 : 0 }
  })
}

async function originalSaleItems(conn, orderId) {
  return (await conn.query('SELECT * FROM sale_order_items WHERE order_id=? ORDER BY id FOR UPDATE', [orderId]))[0]
}

// Read-only previews of legacy ordinary edits can preserve an unchanged row.
// These groups are never persisted or used to introduce a new conversion.
function legacyPreviewGroups(saved, inputs, order) {
  return saved.flatMap(original => {
    const input = inputs.find(row => row.lineKey === `ordinary:${original.id}` && row.kind === 'ordinary'
      && Number(row.productId) === Number(original.product_id)
      && Number(row.warehouseId || order.warehouse_id) === Number(original.warehouse_id || order.warehouse_id))
    const price = Math.round(Number(original.unit_price) * Number(original.conversion_rate || 1) * 10000) / 10000
    if (!input || input.priceSource !== 'manual' || Number(input.unitPrice) !== price
      || Number(input.quantity) !== Number(original.entry_qty ?? original.quantity)
      || (input.entryUnit || original.unit) !== (original.entry_unit || original.unit)) return []
    return [{ id: Number(original.id), lineKey: input.lineKey, kind: 'ordinary', warehouseId: Number(original.warehouse_id || order.warehouse_id),
      originalQty: Number(original.quantity), targetQty: Number(original.quantity), unitPrice: Number(original.unit_price), grossAmount: Number(original.amount), priceSource: 'manual',
      metadata: { input: { ...input, warehouseId: Number(original.warehouse_id || order.warehouse_id) }, priceCustomerId: Number(order.customer_id),
        quantityPolicies: { [original.product_id]: original.allow_decimal_qty_snapshot },
        entry: { entryUnit: original.entry_unit || original.unit, entryQty: Number(original.entry_qty ?? original.quantity), conversionRate: Number(original.conversion_rate || 1), entryUnitPrice: price } },
      components: [{ productId: Number(original.product_id), productCode: original.product_code, productName: original.product_name,
        unit: original.unit, baseQty: 1, sortNo: 0, amountWeight: '1.000000', allocatedAmount: Number(original.amount) }] }]
  })
}

async function assertTaskShipmentQuantity(conn, taskId, productId, qty, label = '数量') {
  const [rows] = await conn.query('SELECT id FROM warehouse_task_items WHERE task_id=? AND product_id=?', [taskId, productId])
  if (!rows.length) throw new AppError('商品不属于原出货任务', 400, 'SHIPMENT_ITEM_NOT_FOUND')
  await assertQtyPrecision(conn, [{ productId, qty, label }])
}

module.exports = { normalizeFixedSaleItems, originalSaleItems, legacyPreviewGroups, assertTaskShipmentQuantity }
