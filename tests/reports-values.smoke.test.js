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
 * 用独立随机商品/仓库造数，避免污染既有测试数据；报表对当前库全量统计，
 * 断言用「新增量 ≥ 造入量」而非精确相等——因为库里还有别的历史数据。
 */

const {
  createLogger,
  prepareSmokeContext,
  randomRef,
} = require('./helpers/smokeTestKit')
const reportsSvc = require('../backend/src/modules/reports/reports.service')

/**
 * 本地时区 YYYY-MM-DD（与数据库连接 timezone=+08:00 及 DATE(created_at) 语义一致）。
 * 不能用 toISOString()（UTC），否则 UTC 日期与本地日期在部分时段错位一天。
 */
function localYmd(d) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

async function main() {
  const log = createLogger()
  const ctx = await prepareSmokeContext()
  const { pool, warehouse, supplier, customer } = ctx

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
  // 用本地时区生成 futureYmd：数据库连接 timezone=+08:00，报表 DATE(created_at) 取本地日期；
  // 若用 toISOString()（UTC）造日期，在 UTC 16:00 之后跑测试会导致 UTC 日期比本地日期晚一天，
  // created_at 落在窗口外 → rangeTotal=undefined（CI 曾在此 flaky 失败）。
  const futureDate = new Date(Date.now() + 7 * 86400000)
  const futureYmd = localYmd(futureDate)
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
  const SO_TOTALS = [500, 800]
  const soIds = []
  for (const amt of SO_TOTALS) {
    const [r] = await pool.query(
      `INSERT INTO sale_orders (order_no, customer_id, customer_name, warehouse_id, warehouse_name, total_amount, status, operator_id, operator_name)
       VALUES (?, ?, ?, ?, ?, ?, 2, 1, '报表测试员')`,
      [randomRef('REPSO').slice(0, 20), customer.id, customer.name, whId, '报表测试仓', amt],
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
  const byMonthS = sale.byMonth.find((m) => m.month === localYmd(new Date()).slice(0, 7))
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

  await ctx.close()
  const counts = log.summary()
  process.exit(counts.failed > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error('[REPORTS-VALUES] 未捕获异常：', e)
  process.exit(1)
})
