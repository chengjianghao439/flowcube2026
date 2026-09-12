#!/usr/bin/env node
'use strict'

/**
 * 报表数值正确性回归测试（审计 4.6）。
 *   node tests/reports-values.smoke.test.js
 *
 * 此前 smoke-reports.js 只测「结构存在」（Object.keys 有值），数字对没对不管。
 * 报表错法是「静默出错」：界面正常、数字悄悄不对。本测试锁死几个核心口径：
 *
 *   1. purchaseStats.byMonth.totalAmount === 底层 purchase_orders.total_amount SUM
 *   2. saleStats.byMonth.totalAmount    === 底层 sale_orders.total_amount SUM
 *   3. purchaseStats.byMonth.orderCount === 底层 COUNT
 *   4. inventoryStats.byWarehouse.totalQty === 底层 inventory_stock.quantity SUM（该仓）
 *   5. 范围筛选（startDate/endDate）生效：报表只统计筛选窗口内的单
 *
 *   6. profitAnalysis：折后净额/商品分摊/成本快照、全量库存滞销汇总、整单及库存仓库范围
 *   7. KPI：月区间/净额与成本、卡片趋势分仓一致、回款来源权限、参数边界及负基数环比
 *
 * 用独立随机商品/仓库造数；采购/销售历史兼容检查用新增量下界，
 * 利润库存按专属仓库及日期做精确断言，finally 清理本次夹具。
 */

const {
  createLogger,
  prepareSmokeContext,
  randomRef,
} = require('./helpers/smokeTestKit')
const reportsSvc = require('../backend/src/modules/reports/reports.service')

/**
 * 按 mysql2 连接 timezone=+08:00 计算 YYYY-MM-DD。
 * mysql2 写入 JS Date 时按 +08:00 序列化（UTC 时刻 + 8h 后取日期），
 * 报表 DATE(created_at) 也取这个日期。若用进程本地时区（CI runner 是 UTC）或
 * toISOString()（纯 UTC），日期会与 created_at 错位一天 → 范围筛选查不到 → flaky。
 */
function cnYmd(d) {
  const t = new Date(d.getTime() + 8 * 3600000) // 转 +08:00 表示
  const pad = (n) => String(n).padStart(2, '0')
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`
}

// 利润库存用专属仓库做精确断言；每次只清理本函数创建的 ID。
async function verifyProfitAnalysis(ctx, log) {
  const { pool, customer } = ctx
  const products = []
  const warehouses = []
  const orders = []
  const near = (actual, expected) => Math.abs(Number(actual) - expected) < 0.0001
  const stamp = randomRef('PROFIT')
  const day = '2040-06-15'
  try {
    for (let i = 0; i < 3; i++) {
      const [row] = await pool.query('INSERT INTO inventory_warehouses (name, code) VALUES (?, ?)',
        ['利润同名仓', `${stamp}-W${i}`])
      warehouses.push(row.insertId)
    }
    const [a, b, outside] = warehouses
    // 35 个同价商品超过 30 条排行榜；同名仓不能合并同商品的库存行。
    for (let i = 0; i < 36; i++) {
      const [row] = await pool.query(
        "INSERT INTO product_items (code, name, unit, cost_price, sale_price) VALUES (?, ?, '个', 2, 5)",
        [`${stamp}-P${i}`, `利润商品${i}`])
      products.push(row.insertId)
      await pool.query('INSERT INTO inventory_stock (product_id, warehouse_id, quantity, reserved) VALUES (?, ?, 1, 0)',
        [row.insertId, i < 35 ? a : outside])
    }
    await pool.query('INSERT INTO inventory_stock (product_id, warehouse_id, quantity, reserved) VALUES (?, ?, 2, 0), (?, ?, 100, 0)',
      [products[0], b, products[0], outside])
    // 范围外的最近出库不能掩盖授权仓的滞销；授权仓有最近出库则排除。
    await pool.query('INSERT INTO inventory_logs (product_id, warehouse_id, type, quantity, change_qty, created_at) VALUES (?, ?, 2, 1, -1, NOW()), (?, ?, 2, 1, -1, NOW())',
      [products[0], outside, products[1], a])

    const addOrder = async (total, discount, items, { date = day, status = 4 } = {}) => {
      const [row] = await pool.query(
        `INSERT INTO sale_orders (order_no, customer_id, customer_name, warehouse_id, warehouse_name,
          total_amount, discount_amount, status, operator_id, operator_name, created_at)
         VALUES (?, ?, ?, ?, '利润同名仓', ?, ?, ?, 1, '报表测试员', ?)`,
        [randomRef('PRSO'), customer.id, customer.name, a, total, discount, status, `${date} 12:00:00`])
      orders.push(row.insertId)
      for (const [product, qty, amount, snapshot, wh = a] of items) {
        await pool.query(
          `INSERT INTO sale_order_items (order_id, product_id, product_code, product_name, unit,
            quantity, unit_price, amount, cost_snapshot, warehouse_id)
           VALUES (?, ?, ?, '利润商品', '个', ?, ?, ?, ?, ?)`,
          [row.insertId, products[product], `${stamp}-P${product}`, qty, amount / qty, amount, snapshot, wh])
      }
      return row.insertId
    }
    const items = [[0, 10, 100, 3], [1, 10, 200, 0]]
    const first = await addOrder(300, 30, items)
    const second = await addOrder(300, 30, items)
    await addOrder(0, 0, [[2, 2, 0, null]])
    const split = await addOrder(400, 0, [[0, 1, 200, 3], [1, 1, 200, 0, outside]])
    await addOrder(900, 0, [[0, 1, 900, 3]], { date: '2040-06-14' })
    await addOrder(900, 0, [[0, 1, 900, 3]], { status: 5 })
    const params = { startDate: day, endDate: day, scopeWarehouseIds: [a] }
    const data = await reportsSvc.profitAnalysis(params)
    log.assert('同额多行销售单各计一次，销售额扣整单折扣并排除跨仓/日期外/取消单', near(data.summary.saleAmount, 540), JSON.stringify(data.summary))
    log.assert('成本快照优先、零快照保留、缺快照回退主档成本', near(data.summary.costAmount, 64))
    log.assert('汇总毛利与折后销售额一致', near(data.summary.grossProfit, 476))
    log.assert('订单毛利按折后额计算', data.saleOrders.filter(r => [first, second].includes(r.id)).every(r => near(r.totalAmount, 270) && near(r.grossProfit, 240)))
    log.assert('相同毛利/日期订单以唯一 ID 稳定排序', data.saleOrders[0]?.id === second && data.saleOrders[1]?.id === first)
    const p0 = data.products.find(r => r.id === products[0])
    const p1 = data.products.find(r => r.id === products[1])
    const p2 = data.products.find(r => r.id === products[2])
    log.assert('商品按明细金额比例分摊整单折扣', near(p0?.revenueAmount, 180) && near(p1?.revenueAmount, 360))
    log.assert('商品毛利合计与销售汇总闭合', near(data.products.reduce((sum, r) => sum + r.grossProfit, 0), 476))
    log.assert('零金额明细无除零且成本仍计入', near(p2?.revenueAmount, 0) && near(p2?.grossProfit, -4) && p2?.marginRate === 0)
    log.assert('库存排行榜保留 30 条且按商品 ID 稳定排序', data.stockValue.length === 30 && data.stockValue.every((r, i) => r.id === products[i]))
    log.assert('库存金额汇总覆盖完整 35 条，不受排行榜截断', near(data.summary.stockValue, 70), `stockValue=${data.summary.stockValue}`)
    log.assert('滞销汇总覆盖完整 34 商品，不受排行榜截断', data.summary.slowMovingCount === 34 && near(data.summary.slowMovingValue, 68), JSON.stringify(data.summary))
    log.assert('滞销排行保留 30 条且不泄漏范围外库存量', data.slowMoving.length === 30 && data.slowMoving.every(r => r.currentQty === 1 && r.stockValue === 2))
    log.assert('范围外最近出库不掩盖授权仓滞销', data.slowMoving.some(r => r.id === products[0]) && !data.slowMoving.some(r => r.id === products[1]))
    log.assert('范围外独有商品不进入滞销排行', !data.slowMoving.some(r => r.id === products[35]))
    const two = await reportsSvc.profitAnalysis({ ...params, scopeWarehouseIds: [a, b] })
    const sameName = two.stockValue.filter(r => r.id === products[0])
    log.assert('同名仓按 warehouseId 分组并返回前端身份', sameName.length === 2 && sameName.some(r => r.warehouseId === a && r.totalQty === 1) && sameName.some(r => r.warehouseId === b && r.totalQty === 2))
    log.assert('多个授权仓的库存/滞销汇总一致', near(two.summary.stockValue, 74) && near(two.summary.slowMovingValue, 72))
    const full = await reportsSvc.profitAnalysis({ ...params, scopeWarehouseIds: warehouses })
    log.assert('授权全部明细仓后跨仓销售整单计入', full.saleOrders.some(r => r.id === split) && near(full.summary.saleAmount, 940))
    const empty = await reportsSvc.profitAnalysis({ ...params, scopeWarehouseIds: [] })
    log.assert('空仓库范围所有汇总与排行均为空', Object.values(empty.summary).every(v => v === 0) && ['saleOrders', 'products', 'stockValue', 'slowMoving'].every(k => empty[k].length === 0))
    const { getProfitAnalysisExportPayload } = require('../backend/src/modules/export/export.service')
    const exported = await getProfitAnalysisExportPayload(params)
    log.assert('导出复用折后毛利与授权仓库存口径', exported.sheets[0].rows.some(r => r.totalAmount === '270.00' && r.grossProfit === '240.00') && exported.sheets[2].rows.length === 30 && exported.sheets[3].rows.every(r => r.currentQty === '1.00'))
  } finally {
    if (orders.length) {
      await pool.query('DELETE FROM sale_order_items WHERE order_id IN (?)', [orders])
      await pool.query('DELETE FROM sale_orders WHERE id IN (?)', [orders])
    }
    if (products.length) {
      await pool.query('DELETE FROM inventory_logs WHERE product_id IN (?)', [products])
      await pool.query('DELETE FROM inventory_stock WHERE product_id IN (?)', [products])
      await pool.query('DELETE FROM product_items WHERE id IN (?)', [products])
    }
    if (warehouses.length) await pool.query('DELETE FROM inventory_warehouses WHERE id IN (?)', [warehouses])
  }
}

async function verifyKpiMetrics(ctx, log) {
  const { pool, customer } = ctx
  const warehouses = [], products = [], orders = [], records = []
  const stamp = randomRef('KPI')
  const near = (a, b) => Math.abs(Number(a) - b) < 0.0001
  const queries = require('../backend/src/modules/reports/reports.query')
  const metric = (data, key) => data.metrics.find(r => r.key === key)
  const getKpi = async (params) => {
    try { return await reportsSvc.kpiMetrics(params) } catch (e) {
      log.assert(`KPI 查询应成功 ${JSON.stringify(params)}`, false, e.message)
      return { period: params.period, prevPeriod: '', trend: [], byWarehouse: [], metrics: ['gmv', 'grossProfit', 'orderCount', 'received', 'avgOrderValue'].map(key => ({ key, current: 0, previous: 0, changePct: 0 })) }
    }
  }
  try {
    for (let i = 0; i < 3; i++) {
      const [r] = await pool.query('INSERT INTO inventory_warehouses (code, name) VALUES (?, ?)', [`${stamp}-W${i}`, 'KPI同名仓'])
      warehouses.push(r.insertId)
    }
    const [a, b, outside] = warehouses
    for (let i = 0; i < 2; i++) {
      const [r] = await pool.query("INSERT INTO product_items (code, name, unit, cost_price, sale_price) VALUES (?, 'KPI商品', '个', 2, 5)", [`${stamp}-P${i}`])
      products.push(r.insertId)
    }
    const addOrder = async (date, total = 300, discount = 30, { wh = a, itemWh = wh, status = 4, deleted = false, costs = [3, 0], quantity = 10, name = 'KPI同名仓' } = {}) => {
      const [r] = await pool.query(
        `INSERT INTO sale_orders (order_no, customer_id, customer_name, warehouse_id, warehouse_name, sale_date,
          total_amount, discount_amount, status, operator_id, operator_name, created_at, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'KPI测试员', '2041-12-15 12:00:00', ?)`,
        [randomRef('KPISO'), customer.id, customer.name, wh, name, date, total, discount, status, deleted ? '2041-12-16 00:00:00' : null])
      orders.push(r.insertId)
      for (let i = 0; i < 2; i++) await pool.query(
        `INSERT INTO sale_order_items (order_id, product_id, product_code, product_name, unit, warehouse_id, quantity, unit_price, amount, cost_snapshot)
         VALUES (?, ?, ?, 'KPI商品', '个', ?, ?, ?, ?, ?)`,
        [r.insertId, products[i], `${stamp}-P${i}`, i === 1 ? itemWh : wh, quantity, total / 2 / quantity, total / 2, costs[i]])
      return r.insertId
    }
    const addReceipt = async (orderId, entries, type = 2) => {
      const [r] = await pool.query(
        "INSERT INTO payment_records (type, order_id, order_no, party_name, total_amount, paid_amount, balance, status) VALUES (?, ?, ?, 'KPI往来方', 9999, 9999, 0, 3)",
        [type, orderId, randomRef('KPIPR')])
      records.push(r.insertId)
      for (const [date, amount] of entries) await pool.query('INSERT INTO payment_entries (record_id, amount, payment_date) VALUES (?, ?, ?)', [r.insertId, amount, date])
    }
    const [[baseline]] = await pool.query("SELECT COALESCE(SUM(pe.amount),0) AS amount FROM payment_entries pe JOIN payment_records pr ON pr.id=pe.record_id AND pr.type=2 WHERE pe.payment_date >= '2040-02-01' AND pe.payment_date < '2040-03-01'")
    const first = await addOrder('2040-02-01')
    await addOrder('2040-02-29', 300, 30, { name: 'KPI历史仓名' })
    await addOrder('2040-02-15', 100, 100, { costs: [null, 0], quantity: 1 })
    const jan = await addOrder('2040-01-31', 100, 10, { costs: [3, 0], quantity: 1 })
    const mar = await addOrder('2040-03-01', 1000, 0)
    const whB = await addOrder('2040-02-20', 100, 10, { wh: b, costs: [null, 0], quantity: 1 })
    const whOut = await addOrder('2040-02-20', 100, 0, { wh: outside, quantity: 1 })
    const split = await addOrder('2040-02-20', 400, 0, { itemWh: outside, quantity: 1 })
    const deleted = await addOrder('2040-02-20', 900, 0, { deleted: true })
    const draft = await addOrder('2040-02-20', 900, 0, { status: 1 })
    await addOrder('2040-02-20', 900, 0, { status: 5 })
    await addOrder('2039-02-28', 100, 10, { quantity: 1 })
    // 亏损由 -100 改善到 -50，再恶化到 -150。
    await addOrder('2040-04-01', 100, 0, { costs: [20, 0] })
    await addOrder('2040-05-01', 100, 0, { costs: [15, 0] })
    await addOrder('2040-06-01', 100, 0, { costs: [25, 0] })
    await addReceipt(first, [['2040-02-01', 30], ['2040-02-29', 40]])
    await addReceipt(jan, [['2040-01-31', 12]])
    await addReceipt(mar, [['2040-03-01', 1000]])
    await addReceipt(whB, [['2040-02-20', 20]])
    await addReceipt(whOut, [['2040-02-20', 99]])
    await addReceipt(split, [['2040-02-20', 88]])
    await addReceipt(deleted, [['2040-02-20', 55]])
    await addReceipt(draft, [['2040-02-20', 11]])
    await addReceipt(null, [['2040-02-20', 77]])
    await addReceipt(999999999, [['2040-02-20', 66]])
    await addReceipt(first, [['2040-02-20', 999]], 1)
    const params = { period: '2040-02', scopeWarehouseIds: [a], months: 3 }
    const data = await getKpi(params)
    const current = Object.fromEntries(data.metrics.map(r => [r.key, r.current]))
    const previous = Object.fromEntries(data.metrics.map(r => [r.key, r.previous]))
    log.assert('KPI 闰年2月按sale_date统计净额且同额多行单不重复', near(current.gmv, 540) && current.orderCount === 3 && near(current.avgOrderValue, 180), JSON.stringify(current))
    log.assert('KPI 毛利保留快照零值与缺省成本，整单折扣计入', near(current.grossProfit, 478))
    log.assert('KPI 上月半开区间包含1月31日且排除2月1日', near(previous.gmv, 90) && previous.orderCount === 1 && near(previous.grossProfit, 87))
    log.assert('KPI 回款按到账日期与来源销售整单权限，仅排除无归属和越权款', near(current.received, 81) && near(previous.received, 12), JSON.stringify({ current, previous }))
    const curTrend = data.trend.find(r => r.month === '2040-02')
    const prevTrend = data.trend.find(r => r.month === '2040-01')
    log.assert('KPI 卡片与趋势当期/上期五项数值一致', Object.keys(current).every(k => near(curTrend?.[k], current[k]) && near(prevTrend?.[k], previous[k])))
    log.assert('KPI 趋势范围精确并补零空月', data.trend.length === 3 && data.trend[0].month === '2039-12' && data.trend[0].gmv === 0 && data.trend.every(r => r.month <= '2040-02'))
    log.assert('KPI 同一头仓历史名称变化不拆成两仓且分仓与卡片一致', data.byWarehouse.length === 1 && data.byWarehouse[0].warehouseId === a && near(data.byWarehouse[0].gmv, 540) && near(data.byWarehouse[0].grossProfit, 478))
    const both = await getKpi({ ...params, scopeWarehouseIds: [a, b] })
    log.assert('KPI 多仓头仓归属与总额、回款闭合', both.byWarehouse.length === 2 && near(metric(both, 'gmv').current, 630) && near(metric(both, 'received').current, 101) && near(both.byWarehouse.reduce((sum, r) => sum + r.gmv, 0), 630))
    await pool.query('UPDATE inventory_warehouses SET deleted_at=NOW() WHERE id=?', [b])
    const full = await getKpi({ ...params, scopeWarehouseIds: warehouses })
    log.assert('KPI 授权全部行仓后计入跨仓整单及回款', near(metric(full, 'gmv').current, 1130) && near(metric(full, 'received').current, 288))
    log.assert('KPI 软删除仓库不抹去历史销售与到账事实', full.byWarehouse.some(r => r.warehouseId === b && near(r.gmv, 90)))
    const unrestricted = await getKpi({ ...params, scopeWarehouseIds: null })
    log.assert('KPI 无仓库限制保留全部type2到账含手工/来源缺失/删除', near(metric(unrestricted, 'received').current, Number(baseline.amount) + (30 + 40 + 20 + 99 + 88 + 55 + 11 + 77 + 66)))
    const empty = await getKpi({ ...params, scopeWarehouseIds: [] })
    log.assert('KPI 空scope卡片、趋势、分仓不泄漏销售或回款', empty.metrics.every(r => r.current === 0 && r.previous === 0) && empty.trend.every(r => r.gmv === 0 && r.received === 0) && empty.byWarehouse.length === 0)
    const ordinary = await getKpi({ ...params, period: '2039-02' })
    log.assert('KPI 普通年份2月28日有效并排除下一月', near(metric(ordinary, 'gmv').current, 90))
    const self = await getKpi({ ...params, offsetPeriods: 0 })
    log.assert('KPI offset=0保留本期自比，不被默认值吞掉', self.prevPeriod === '2040-02' && self.metrics.every(r => r.current === r.previous && r.changePct === 0))
    const future = await getKpi({ ...params, offsetPeriods: 1 })
    log.assert('KPI 支持有界正向对比月份', future.prevPeriod === '2040-03' && near(metric(future, 'gmv').previous, 1000))
    const improved = await getKpi({ ...params, period: '2040-05' })
    const worsened = await getKpi({ ...params, period: '2040-06' })
    log.assert('KPI 负毛利改善/恶化按上期绝对值计算环比', metric(improved, 'grossProfit').changePct === 50 && metric(worsened, 'grossProfit').changePct === -200)
    log.assert('KPI 上期为零的变化率保持null或零', metric(ordinary, 'gmv').changePct === null && metric(empty, 'gmv').changePct === 0)
    for (const invalid of [{period:'2040-00'}, {period:'2040-13'}, {period:'bad'}, {period:'0999-12'}, {period:'9999-12'}, {period:'1000-01'}, {months:0}, {months:1.5}, {months:37}, {offsetPeriods:0.5}, {offsetPeriods:37}, {offsetPeriods:-37}]) {
      let error
      try { await reportsSvc.kpiMetrics({ ...params, ...invalid }) } catch (e) { error = e }
      log.assert(`KPI 非法期间参数返回400 ${JSON.stringify(invalid)}`, error?.statusCode === 400)
    }
    // Controller 映射走真实 service/SQL，只替换 Express 的响应接收对象。
    const controller = require('../backend/src/modules/reports/reports.controller')
    const callController = async (query) => {
      const result = {}
      const res = { status(code) { result.status = code; return this }, json(body) { result.body = body; return this } }
      await controller.kpi({ query: { period: '2040-02', ...query }, user: { warehouseIds: [a] } }, res, error => { result.error = error })
      return result
    }
    const oneMonth = await callController({ months: '1' })
    log.assert('KPI controller 转发 months=1 到真实service', oneMonth.status === 200 && oneMonth.body?.data?.trend.length === 1 && near(oneMonth.body?.data?.trend[0]?.gmv, 540))
    const defaultMonths = await callController({})
    log.assert('KPI controller 不传months时默认12个月', defaultMonths.status === 200 && defaultMonths.body?.data?.trend.length === 12)
    for (const months of ['0', '37', '1.5']) {
      const rejected = await callController({ months })
      log.assert(`KPI controller 非法months=${months}传递400业务错误`, rejected.error?.statusCode === 400 && !rejected.body)
    }
    // 趋势SQL上下界是查询性能契约，结果填零会掩盖“查了未来月份再丢弃”的错误。
    const sqlCalls = []
    const reportPool = require('../backend/src/config/db').pool
    const originalQuery = reportPool.query
    reportPool.query = function(sql, args) { sqlCalls.push({ sql, args }); return originalQuery.call(this, sql, args) }
    try { await queries.fetchKpiTrendRows(params) } finally { reportPool.query = originalQuery }
    log.assert('KPI 趋势销售/回款SQL均在数据库按下月首日截断', sqlCalls.length === 2 && sqlCalls.every(({sql,args}) => /(?:sale_date|payment_date)\s*<\s*\?/.test(sql) && args.includes('2040-03-01')))
  } finally {
    if (records.length) { await pool.query('DELETE FROM payment_entries WHERE record_id IN (?)', [records]); await pool.query('DELETE FROM payment_records WHERE id IN (?)', [records]) }
    if (orders.length) { await pool.query('DELETE FROM sale_order_items WHERE order_id IN (?)', [orders]); await pool.query('DELETE FROM sale_orders WHERE id IN (?)', [orders]) }
    if (products.length) await pool.query('DELETE FROM product_items WHERE id IN (?)', [products])
    if (warehouses.length) await pool.query('DELETE FROM inventory_warehouses WHERE id IN (?)', [warehouses])
  }
}

async function main() {
  const log = createLogger()
  const ctx = await prepareSmokeContext()
  const { pool, supplier, customer } = ctx

  // 独立随机商品与仓库，避免污染既有数据
  const [rProd] = await pool.query(
    "INSERT INTO product_items (code, name, unit, cost_price, sale_price) VALUES (?, ?, '个', 5, 10)",
    [`REP-${randomRef('V').slice(0, 12)}`, '报表测试商品'],
  )
  const productId = rProd.insertId
  const [rWh] = await pool.query(
    "INSERT INTO inventory_warehouses (name, code) VALUES (?, ?)",
    ['报表测试仓', `REPWH-${randomRef('').slice(0, 8)}`],
  )
  const whId = rWh.insertId

  // ── 造 3 张已知金额的采购单（100 / 200 / 300），created_at 落在未来窗口 ──
  // futureYmd 必须按 mysql2 连接 timezone=+08:00 的序列化结果计算（cnYmd）：
  // mysql2 把 JS Date 转成 +08:00 表示写入，报表 DATE(created_at) 取的是这个日期。
  // 若用 toISOString()（纯 UTC）或进程本地时区（CI runner 是 UTC），日期会错位一天，
  // created_at 落在筛选窗口外 → rangeTotal=undefined（CI 曾在此 flaky 失败）。
  const futureDate = new Date(Date.now() + 7 * 86400000)
  const futureYmd = cnYmd(futureDate)
  const PO_TOTALS = [100, 200, 300]
  const poIds = []
  for (const amt of PO_TOTALS) {
    const [r] = await pool.query(
      `INSERT INTO purchase_orders (order_no, supplier_id, supplier_name, warehouse_id, warehouse_name, total_amount, status, operator_id, operator_name, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 2, 1, '报表测试员', ?)`,
      [randomRef('REPPO').slice(0, 20), supplier.id, supplier.name, whId, '报表测试仓', amt, futureDate],
    )
    poIds.push(r.insertId)
  }

  // ── 造 2 张已知金额的销售单（500 / 800）──────────────────────────────────
  // 显式传 created_at（= 当前时刻）：报表按 DATE_FORMAT(created_at,'%Y-%m') 统计"本月"，
  // 测试用 cnYmd(new Date()) 算北京本月核对。若不显式传，走 MySQL CURRENT_TIMESTAMP，
  // 其值取决于服务器时区——CI 临时库是 UTC（北京凌晨 = UTC 上月末，跨月）时 DATE_FORMAT
  // 落到上月，byMonthS 查不到本月 → orderCount=undefined（测试自身缺陷，注释第 61 行已承认）。
  // 显式传 Date 走 mysql2 连接池 timezone=+08:00 序列化，与 cnYmd 口径一致，与服务器时区无关。
  const thisDate = new Date()
  const SO_TOTALS = [500, 800]
  const soIds = []
  for (const amt of SO_TOTALS) {
    const [r] = await pool.query(
      `INSERT INTO sale_orders (order_no, customer_id, customer_name, warehouse_id, warehouse_name, total_amount, status, operator_id, operator_name, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 2, 1, '报表测试员', ?)`,
      [randomRef('REPSO').slice(0, 20), customer.id, customer.name, whId, '报表测试仓', amt, thisDate],
    )
    soIds.push(r.insertId)
  }

  // ── 报表对全库统计，测「新增量 ≥ 造入量」────────────────────────────────
  // 造的采购单落在未来月份（futureYmd），故在全库报表里查未来月份核对。
  const futureMonth = futureYmd.slice(0, 7)
  const purchase = await reportsSvc.purchaseStats({})
  const byMonthP = purchase.byMonth.find((m) => m.month === futureMonth)
  log.assert('采购报表未来月订单数 ≥ 造入 3 单', Number(byMonthP?.orderCount ?? 0) >= 3,
    `orderCount=${byMonthP?.orderCount}`)
  log.assert('采购报表未来月金额 ≥ 造入 600', Number(byMonthP?.totalAmount ?? 0) >= 600,
    `totalAmount=${byMonthP?.totalAmount}`)

  const sale = await reportsSvc.saleStats({})
  const byMonthS = sale.byMonth.find((m) => m.month === cnYmd(new Date()).slice(0, 7))
  log.assert('销售报表本月订单数 ≥ 造入 2 单', Number(byMonthS?.orderCount ?? 0) >= 2,
    `orderCount=${byMonthS?.orderCount}`)
  log.assert('销售报表本月金额 ≥ 造入 1300', Number(byMonthS?.totalAmount ?? 0) >= 1300,
    `totalAmount=${byMonthS?.totalAmount}`)

  // ── 范围筛选生效：用「未来窗口」精确验证只统计窗口内的单 ─────────────────
  // 造的单显式落在未来 created_at（futureDate），未来窗口内必然只有这 3 单
  // （其他历史数据都在过去），因此可精确断言 = 600 —— 若报表忽略日期筛选
  // 会把历史单也算进来导致 >600。
  const purchaseRange = await reportsSvc.purchaseStats({ startDate: futureYmd, endDate: futureYmd })
  const rangeP = purchaseRange.byMonth.find((m) => m.month === futureYmd.slice(0, 7))
  log.assert('范围筛选采购金额 = 未来窗口造入 600（筛选精确生效）',
    Number(rangeP?.totalAmount ?? 0) === 600,
    `rangeTotal=${rangeP?.totalAmount}`)

  // ── inventoryStats：新仓的 byWarehouse 应有量（造库存缓存）────────────────
  await pool.query(
    'INSERT INTO inventory_stock (product_id, warehouse_id, quantity, reserved) VALUES (?, ?, 42, 0) ON DUPLICATE KEY UPDATE quantity=VALUES(quantity)',
    [productId, whId],
  )
  const inv = await reportsSvc.inventoryStats({})
  const whRow = inv.byWarehouse.find((r) => r.warehouseName === '报表测试仓')
  log.assert('库存报表含新仓且数量 = 42', Number(whRow?.totalQty ?? 0) === 42,
    `totalQty=${whRow?.totalQty}`)

  // ── 清理造数（报表无副作用，只清测试插入的数据）──────────────────────────
  await pool.query('DELETE FROM purchase_orders WHERE id IN (?)', [poIds])
  await pool.query('DELETE FROM sale_orders WHERE id IN (?)', [soIds])
  await pool.query('DELETE FROM inventory_stock WHERE product_id=? AND warehouse_id=?', [productId, whId])
  await pool.query('DELETE FROM inventory_warehouses WHERE id=?', [whId])
  await pool.query('DELETE FROM product_items WHERE id=?', [productId])

  try {
    await verifyProfitAnalysis(ctx, log)
    await verifyKpiMetrics(ctx, log)
  } finally {
    await ctx.close()
  }
  const counts = log.summary()
  process.exit(counts.failed > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error('[REPORTS-VALUES] 未捕获异常：', e)
  process.exit(1)
})
