const test = require('node:test')
const assert = require('node:assert/strict')
const { foldEntryItem } = require('../backend/src/utils/unitConversion')

const {
  createSaleSchema,
  reserveSaleSchema,
  shipSaleSchema,
  calculateDiscountApplied,
  getNetOrderAmount,
  getOutstandingOrderAmount,
  scansForSaleItem,
  selectDispatchRows,
  assertDiscountWithinTotal,
  saleOperationAction,
  isApprovedOverrideApplicable,
} = require('../backend/src/modules/sale/sale.contracts')

const baseItem = {
  productId: 7,
  productCode: 'CLIENT-CODE',
  productName: '客户端商品名',
  unit: '件',
  quantity: 1.5,
  unitPrice: 20,
  warehouseId: 9,
  warehouseName: '分仓',
}

test('销售建单契约保留折扣、分仓和小数数量', () => {
  const parsed = createSaleSchema.parse({
    customerId: 1,
    customerName: '客户',
    warehouseId: 2,
    warehouseName: '默认仓',
    discountAmount: 8.5,
    receiverName: '华东区域收货组',
    receiverPhone: '+86 021-5555-8888',
    receiverAddress: '上海市浦东新区金桥出口加工区非常完整的企业收货地址 18 号 3 楼',
    items: [baseItem],
  })

  assert.equal(parsed.discountAmount, 8.5)
  assert.equal(parsed.items[0].warehouseId, 9)
  assert.equal(parsed.items[0].quantity, 1.5)
  assert.equal(parsed.receiverPhone, '+86 021-5555-8888')
})

test('销售建单拒绝过短联系电话和超过订单语义的负折扣', () => {
  const payload = {
    customerId: 1,
    customerName: '客户',
    warehouseId: 2,
    warehouseName: '默认仓',
    items: [baseItem],
  }
  assert.throws(() => createSaleSchema.parse({ ...payload, receiverPhone: '1' }))
  assert.throws(() => createSaleSchema.parse({ ...payload, discountAmount: -1 }))
})

test('占库契约保留一次性授信放行确认', () => {
  const parsed = reserveSaleSchema.parse({
    confirmCreditOverride: true,
    items: [{ id: 3, warehouseId: 9, warehouseName: '分仓', qty: 1.25 }],
  })
  assert.equal(parsed.confirmCreditOverride, true)
  assert.equal(parsed.items[0].qty, 1.25)
})

test('发货契约支持按明细数量并兼容旧 itemIds', () => {
  assert.deepEqual(shipSaleSchema.parse({ items: [{ id: 3, qty: 1.25 }] }).items, [{ id: 3, qty: 1.25 }])
  assert.deepEqual(shipSaleSchema.parse({ itemIds: [3, 4] }).itemIds, [3, 4])
})

test('数量契约拒绝超过四位小数，避免数据库舍入成零', () => {
  assert.throws(() => createSaleSchema.parse({
    customerId: 1,
    customerName: '客户',
    warehouseId: 2,
    warehouseName: '默认仓',
    items: [{ ...baseItem, quantity: 0.00001 }],
  }), /4 位小数/)
  assert.throws(() => reserveSaleSchema.parse({
    items: [{ id: 3, warehouseId: 9, warehouseName: '分仓', qty: 1.00001 }],
  }), /4 位小数/)
  assert.throws(() => shipSaleSchema.parse({ items: [{ id: 3, qty: 0.00001 }] }), /4 位小数/)
  assert.equal(shipSaleSchema.parse({ items: [{ id: 3, qty: 9999999999.9999 }] }).items[0].qty, 9999999999.9999)
})

test('单位折算后不足最小库存精度时拒绝落库', async () => {
  const conn = {
    query: async () => [[{ unit_name: '盒', conversion_rate: 0.01 }]],
  }
  await assert.rejects(
    foldEntryItem(conn, { productId: 7, unit: '件', entryUnit: '盒', quantity: 0.0001, unitPrice: 10 }),
    /折算后小于库存最小精度/,
  )
})

test('改单后的货款不足以覆盖原折扣时拒绝保存', () => {
  assert.doesNotThrow(() => assertDiscountWithinTotal(90, 100))
  assert.throws(() => assertDiscountWithinTotal(90, 10), /折扣金额不能超过订单合计/)
})

test('订单写操作幂等动作绑定订单 ID', () => {
  assert.equal(saleOperationAction('cancel', 12), 'sale.cancel:12')
  assert.notEqual(saleOperationAction('cancel', 12), saleOperationAction('cancel', 13))
})

test('授信审批只覆盖原客户、原额度、原订单金额及获批超额范围', () => {
  const approved = {
    customer_id: 8,
    credit_limit: 1000,
    this_amount: 300,
    over_amount: 80,
  }
  assert.equal(isApprovedOverrideApplicable(approved, {
    customerId: 8, creditLimit: 1000, thisAmount: 300, overAmount: 60,
  }), true)
  assert.equal(isApprovedOverrideApplicable(approved, {
    customerId: 8, creditLimit: 1000, thisAmount: 301, overAmount: 80,
  }), false)
  assert.equal(isApprovedOverrideApplicable(approved, {
    customerId: 9, creditLimit: 1000, thisAmount: 300, overAmount: 80,
  }), false)
  assert.equal(isApprovedOverrideApplicable(approved, {
    customerId: 8, creditLimit: 1000, thisAmount: 300, overAmount: 81,
  }), false)
})

test('折扣按已发原值占订单原值的比例分摊', () => {
  assert.equal(calculateDiscountApplied({ discount: 109, shippedGross: 1000, orderGross: 1090 }), 100)
  assert.equal(calculateDiscountApplied({ discount: 109, shippedGross: 90, orderGross: 1090 }), 9)
})

test('授信使用折后净额且不会小于零', () => {
  assert.equal(getNetOrderAmount(1090, 109), 981)
  assert.equal(getNetOrderAmount(50, 80), 0)
  assert.equal(getOutstandingOrderAmount(1090, 109, 181), 800)
  assert.equal(getOutstandingOrderAmount(100, 10, 120), 0)
})

test('同商品分仓时扫码记录按任务仓库归属', () => {
  const tasks = [
    { taskId: 11, warehouseId: 1 },
    { taskId: 12, warehouseId: 2 },
  ]
  const scans = [
    { task_id: 11, product_id: 7, barcode: 'A' },
    { task_id: 12, product_id: 7, barcode: 'B' },
  ]
  assert.deepEqual(scansForSaleItem(scans, tasks, { productId: 7, warehouseId: 1 }).map(s => s.barcode), ['A'])
  assert.deepEqual(scansForSaleItem(scans, tasks, { productId: 7, warehouseId: 2 }).map(s => s.barcode), ['B'])
})

test('按数量发货只派发请求量并拒绝超过已占未发量', () => {
  const rows = [{ id: 3, product_name: '商品A', reserved_qty: 10, dispatched_qty: 3 }]
  assert.equal(selectDispatchRows(rows, { items: [{ id: 3, qty: 2 }] })[0].requested_ship_qty, 2)
  assert.equal(selectDispatchRows(rows, { itemIds: [3] })[0].requested_ship_qty, 7)
  assert.throws(() => selectDispatchRows(rows, { items: [{ id: 3, qty: 8 }] }), /不能超过/)
  assert.throws(() => selectDispatchRows(rows, { items: [{ id: 3, qty: 1 }, { id: 3, qty: 1 }] }), /重复/)
  assert.throws(() => selectDispatchRows(rows, { items: [{ id: 3, qty: 1 }, { id: 99, qty: 1 }] }), /不存在或不可发货/)
})
