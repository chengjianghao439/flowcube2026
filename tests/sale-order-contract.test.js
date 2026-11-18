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

test('销售明细有服务端上限，批量写入保持行顺序且每批不超过 100 行', async () => {
  const payload = { customerId: 1, customerName: '客户', warehouseId: 2, warehouseName: '仓库' }
  assert.throws(() => createSaleSchema.parse({ ...payload, items: Array.from({ length: 201 }, () => baseItem) }), /最多 200 条/)
  const { insertSaleItems } = require('../backend/src/modules/sale/sale.items')
  const queries = []
  const conn = { query: async (sql, params) => { queries.push([sql, params]); return [{}] } }
  const items = Array.from({ length: 201 }, (_, index) => ({ ...baseItem, productId: index + 1 }))
  await insertSaleItems(conn, 8, 2, '仓库', items)
  assert.equal(queries.length, 3)
  assert.ok(queries.every(([sql, params]) => sql.includes('VALUES ?') && params[0].length <= 100))
  assert.deepEqual(queries.flatMap(([, params]) => params[0].map(row => row[3])), items.map(item => item.productId))
})

test('占库契约拒绝旧直放标记，保留明细占库输入', () => {
  for (const confirmCreditOverride of [true,false]) assert.throws(()=>reserveSaleSchema.parse({confirmCreditOverride}))
  const parsed = reserveSaleSchema.parse({items:[{id:3,warehouseId:9,warehouseName:'分仓',qty:1.25}]})
  assert.equal(parsed.items[0].qty,1.25)
})

test('发货契约支持按明细数量并兼容旧 itemIds', () => {
  assert.deepEqual(shipSaleSchema.parse({ items: [{ id: 3, qty: 1.25 }] }).items, [{ id: 3, qty: 1.25 }])
  assert.deepEqual(shipSaleSchema.parse({ itemIds: [3, 4] }).itemIds, [3, 4])
})

test('数量契约拒绝超过两位小数，避免数据库舍入成零', () => {
  assert.throws(() => createSaleSchema.parse({
    customerId: 1,
    customerName: '客户',
    warehouseId: 2,
    warehouseName: '默认仓',
    items: [{ ...baseItem, quantity: 0.001 }],
  }), /2 位小数/)
  assert.throws(() => reserveSaleSchema.parse({
    items: [{ id: 3, warehouseId: 9, warehouseName: '分仓', qty: 1.001 }],
  }), /2 位小数/)
  assert.throws(() => shipSaleSchema.parse({ items: [{ id: 3, qty: 0.001 }] }), /2 位小数/)
  assert.equal(shipSaleSchema.parse({ items: [{ id: 3, qty: 9999999999.99 }] }).items[0].qty, 9999999999.99)
})

test('单位折算后不足最小库存精度时拒绝落库', async () => {
  const conn = {
    query: async () => [[{ unit_name: '盒', conversion_rate: 0.01 }]],
  }
  await assert.rejects(
    foldEntryItem(conn, { productId: 7, unit: '件', entryUnit: '盒', quantity: 0.01, unitPrice: 10 }),
    /最多保留 2 位小数/,
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
    basis_hash: "frozen",
    customer_id: 8,
    credit_limit: 1000,
    this_amount: 300,
    over_amount: 80,
  }
  assert.equal(isApprovedOverrideApplicable(approved, {
    basisHash: "frozen", customerId: 8, creditLimit: 1000, thisAmount: 300, overAmount: 60,
  }), true)
  assert.equal(isApprovedOverrideApplicable(approved, {
    basisHash: "frozen", customerId: 8, creditLimit: 1000, thisAmount: 301, overAmount: 80,
  }), false)
  assert.equal(isApprovedOverrideApplicable(approved, {
    basisHash: "frozen", customerId: 9, creditLimit: 1000, thisAmount: 300, overAmount: 80,
  }), false)
  assert.equal(isApprovedOverrideApplicable(approved, {
    basisHash: "frozen", customerId: 8, creditLimit: 1000, thisAmount: 300, overAmount: 81,
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

function saleListFixture({ pageRows = [], statusRows = [], total = 0 } = {}) {
  const { readFileSync } = require('node:fs')
  const { resolve } = require('node:path')
  const { runInNewContext } = require('node:vm')
  const base = resolve(__dirname, '../backend/src')
  function load(file, modules) {
    const filename = resolve(base, file), module = { exports: {} }
    runInNewContext(readFileSync(filename, 'utf8'), { module, require: id => modules[id] || {} }, { filename })
    return module.exports
  }
  const calls = []
  const pool = { async query(rawSql, params) {
    const sql = rawSql.replace(/\s+/g, ' ').trim()
    calls.push({ sql, params: structuredClone(params) })
    if (sql.startsWith('SELECT so.status, COUNT(*)')) return [statusRows]
    if (sql.startsWith('SELECT so.*,')) return [pageRows]
    if (sql.startsWith('SELECT order_id, SUM(quantity)')) return [[]]
    if (sql.startsWith('SELECT COUNT(*) AS total')) return [[{ total }]]
    throw new Error('意外的销售查询 ' + sql)
  } }
  const svc = load('modules/sale/sale.service.js', {
    '../../config/db': { pool },
    '../../utils/warehouseScope': load('utils/warehouseScope.js', {}),
    '../../utils/pagination': require('../backend/src/utils/pagination'),
    '../../constants/saleOrderStatus': require('../backend/src/constants/saleOrderStatus'),
    '../../constants/settlementType': require('../backend/src/constants/settlementType'),
    './sale.presentation': { loadSalePresentation: async () => new Map() },
  })
  return { calls, svc }
}

test('销售列表、分页总数共用精确筛选，状态分布应用同一基础筛选但排除当前状态', async () => {
  const { calls, svc } = saleListFixture({
    pageRows: [{ id: 19, status: 1, total_amount: 20 }],
    statusRows: [{ status: 1, count: '2' }, { status: 6, count: '3' }],
    total: 2,
  })
  const data = await svc.findAll({
    page: 2, pageSize: 1, keyword: '合成', productId: 12, customerId: 13, warehouseId: 3,
    startDate: '2026-01-01', endDate: '2026-01-17', remark: '测试', operatorId: 7,
    scopeWarehouseIds: [3, 4], focus: 'pending', status: 1,
  })
  const [stats, page, aggregation, count] = calls
  const getWhere = sql => sql.match(/ WHERE (so\.deleted_at IS NULL .+?)(?: GROUP BY so\.status| ORDER BY CASE|$)/)?.[1]
  assert.equal(getWhere(page.sql), getWhere(count.sql), '列表和总数必须复用相同谓词和订单别名')
  const base = getWhere(stats.sql)
  assert.equal(getWhere(page.sql), base + ' AND so.status=?')
  assert.match(base, /so\.order_no LIKE \? OR so\.customer_name LIKE \?/)
  assert.match(base, /soi\.order_id = so\.id AND soi\.product_id = \?/)
  assert.match(base, /so\.customer_id=\? AND so\.warehouse_id=\?/)
  assert.match(base, /so\.created_at >= \? AND so\.created_at < DATE_ADD\(\?, INTERVAL 1 DAY\)/)
  assert.match(base, /so\.remark LIKE \? AND so\.operator_id=\?/)
  assert.match(base, /so\.warehouse_id IN \(\?\).*soi_scope\.warehouse_id NOT IN \(\?\)/)
  assert.match(base, /so\.status IN \(1,2,3,6\).*focus_task\.cancel_requested_at IS NOT NULL OR focus_task\.adjustment_requested_at IS NOT NULL/)
  assert.match(page.sql, /ORDER BY CASE WHEN EXISTS .*focus_task.*THEN 0 WHEN EXISTS .*focus_credit.*THEN 1 ELSE 2 END, so\.created_at ASC,so\.id ASC LIMIT \? OFFSET \?/)
  assert.doesNotMatch(count.sql, /LEFT JOIN|LIMIT/)
  assert.deepEqual(stats.params, ['%合成%', '%合成%', 12, 13, 3, '2026-01-01 00:00:00', '2026-01-17', '%测试%', 7, [3, 4], [3, 4]])
  assert.deepEqual(count.params, [...stats.params, 1])
  assert.deepEqual(page.params, [...count.params, 1, 1])
  assert.deepEqual(aggregation.params, [[19]])
  assert.deepEqual(structuredClone(data.statusCounts), { 1: 2, 6: 3 })
  assert.deepEqual(structuredClone(data.pagination), { page: 2, pageSize: 1, total: 2 })
})

test('销售空仓范围覆盖列表、总数和状态，未限仓只按原条件查询', async () => {
  for (const scopeWarehouseIds of [[], null]) {
    const { calls, svc } = saleListFixture()
    const data = await svc.findAll({ scopeWarehouseIds })
    assert.equal(calls.length, 3, '空页不触发明细聚合')
    for (const { sql } of calls) {
      assert.equal(sql.includes('AND 1=0'), Array.isArray(scopeWarehouseIds))
      assert.doesNotMatch(sql, /IN \(\?\)|focus_task/)
    }
    assert.match(calls[1].sql, /ORDER BY so\.created_at DESC,so\.id DESC LIMIT \? OFFSET \?/)
    assert.equal(data.list.length, 0)
    assert.equal(data.pagination.total, 0)
    assert.deepEqual(structuredClone(data.statusCounts), {})
  }
})
