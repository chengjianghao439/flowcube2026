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
