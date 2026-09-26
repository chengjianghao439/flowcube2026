#!/usr/bin/env node
'use strict'

/**
 * P2 修复回归：利润分析 / 经营 KPI 的**成本**口径不再拿售价当成本，并区分「按当前进价估算」与「成本缺失」。
 *
 * 背景（2026-09-27 只读深查）：报表侧成本表达式原为
 *   COALESCE(soi.cost_snapshot, NULLIF(p.cost_price,0), p.sale_price, 0)
 * 当出库快照为空且商品进价为 0 时会退到 **售价**——不是"另一种估算口径"，是失真。
 * 本次只改**报表成本**这一侧：去掉 `p.sale_price` 回退、保留迁移 119 已定的「非零现价进价」估算，
 * 并把「估算」与「缺失」两个量暴露给前端/导出做提示。不动凭证、历史快照、库存事实与生产数据。
 *
 * **隔离方式**：全部夹具落在远期专属月份 `2031-03`（`created_at` 与 `sale_date` 都显式指定），
 * 查询也用该范围——因此**不依赖"共享库当前恰好是空库"**，与库中其它合成单不会相互混入。
 * 每个 INSERT 成功后**立即登记**待清理 ID（helper 中途抛错也清得掉）。
 *
 * 必须跑在显式回环独立测试库：`NODE_ENV=test` + `flowcube_<用途>_test`
 * 运行：
 *   set -a; source ~/.config/flowcube/operations20260912-test.env; set +a
 *   APP_UPDATE_DOWNLOADS_DIR=/tmp/flowcube-reports-downloads node tests/report-cost-basis.smoke.test.js
 */

const path = require('path')
const { test } = require('node:test')
const assert = require('node:assert/strict')

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-secret-not-used-for-auth-0123456789'

const ROOT = path.resolve(__dirname, '..')
const reports = require(path.join(ROOT, 'backend/src/modules/reports/reports.query'))

const TAG = `P2CB-${String(Date.now()).slice(-6)}`
// 远期专属范围：只含本套件夹具，避免与共享库任何既有合成单重叠
const START_DATE = '2031-03-01'
const END_DATE = '2031-04-01'
const PERIOD = '2031-03'
const BIZ_STAMP = '2031-03-15 10:00:00'

/**
 * 建商品。created 传入后**创建成功即登记**——即便后续步骤抛错，finally 也能清掉它。
 */
async function mkProduct(pool, created, label, { costPrice, salePrice }) {
  const [r] = await pool.query(
    `INSERT INTO product_items (code,name,unit,cost_price,avg_cost,sale_price,sale_price_a,created_at)
     VALUES (?,?,?,?,NULL,?,?,?)`,
    [`${TAG}-${label}`, `P2成本基准${label}${TAG}`, '件', costPrice, salePrice, salePrice, BIZ_STAMP],
  )
  const product = { id: r.insertId, code: `${TAG}-${label}` }
  created.products.push(product)
  return product
}

/** 建销售单 + 一行明细；日期显式落在远期专属月份。 */
async function mkSaleLine(pool, created, { product, qty, unitPrice, snapshot }) {
  const [so] = await pool.query(
    `INSERT INTO sale_orders (order_no,customer_id,customer_name,warehouse_id,warehouse_name,
                              operator_id,operator_name,total_amount,discount_amount,status,created_at,sale_date)
     VALUES (?,?,?,?,?,?,?,?,0,4,?,?)`,
    [`${TAG}-SO-${product.code}`, 999801, `P2成本基准客户${TAG}`, 1, 'P2成本基准仓', 1, 'probe',
      qty * unitPrice, BIZ_STAMP, PERIOD + '-15'],
  )
  created.orders.push(so.insertId)
  await pool.query(
    `INSERT INTO sale_order_items
       (order_id,product_id,product_code,product_name,unit,quantity,shipped_qty,unit_price,amount,cost_snapshot,warehouse_id,created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,1,?)`,
    [so.insertId, product.id, product.code, `P2成本基准${TAG}`, '件', qty, qty, unitPrice, qty * unitPrice, snapshot, BIZ_STAMP],
  )
  return so.insertId
}

test('多 sheet 渲染：汇总行不得残留「幽灵表头」，无汇总时表头仍在首行', async () => {
  // 2026-09-27 用 3 列 + 2 行汇总读回真实工作簿时发现：`ws.columns.header` 会把**所有列**的
  // 表头写进第 1 行，而汇总块只占 A/B 两列 → C1 起残留"幽灵表头"（C1 竟是「仓库」）。
  const ExcelJS = require(path.join(ROOT, 'backend/node_modules/exceljs'))
  const { PassThrough } = require('stream')
  const { exportMultiSheetXlsx } = require(path.join(ROOT, 'backend/src/utils/excelExport'))

  const render = async (sheets) => {
    const res = new PassThrough()
    res.setHeader = () => {}
    const chunks = []
    res.on('data', (c) => chunks.push(c))
    await exportMultiSheetXlsx(res, 'probe.xlsx', sheets)
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(Buffer.concat(chunks))
    return wb
  }
  const cols = [
    { header: '销售单号', key: 'orderNo', width: 22 },
    { header: '客户', key: 'customerName', width: 20 },
    { header: '仓库', key: 'warehouseName', width: 16 },
  ]

  // ① 有汇总 + 多列：汇总行 C..末列必须为空，真表头落在汇总块下方
  const wb1 = await render([{
    sheetName: 'S', columns: cols,
    rows: [{ orderNo: 'A1', customerName: '甲', warehouseName: '主仓' }],
    summaryRows: [['销售额', 10], ['销售成本', 6]],
  }])
  const ws1 = wb1.worksheets[0]
  assert.equal(ws1.getCell('A1').value, '销售额')
  assert.equal(ws1.getCell('B1').value, 10)
  for (let r = 1; r <= 2; r++) {
    for (let c = 3; c <= 4; c++) {
      assert.equal(
        ws1.getRow(r).getCell(c).value, null,
        `汇总第 ${r} 行的第 ${c} 列应为空（幽灵表头残留），实际 ${JSON.stringify(ws1.getRow(r).getCell(c).value)}`,
      )
    }
  }
  assert.equal(ws1.getCell('A4').value, '销售单号', '真表头应在汇总块下方的第 4 行')
  assert.equal(ws1.getCell('C4').value, '仓库', '真表头第三列必须在第 4 行')
  assert.equal(ws1.getCell('A5').value, 'A1', '数据应紧接表头下一行')

  // ② 无汇总：表头仍在首行（回归——不能为了修①把普通导出弄坏）
  const wb2 = await render([{
    sheetName: 'T', columns: cols,
    rows: [{ orderNo: 'B1', customerName: '乙', warehouseName: '分仓' }],
  }])
  const ws2 = wb2.worksheets[0]
  assert.equal(ws2.getCell('A1').value, '销售单号', '无汇总时表头必须在首行')
  assert.equal(ws2.getCell('C1').value, '仓库')
  assert.equal(ws2.getCell('A2').value, 'B1', '无汇总时数据紧接表头')
})

test('利润导出：汇总值与成本口径提示确实写进 xlsx 单元格（读回验证）', async () => {
  // 刻意**读回真实生成的工作簿**，而不是断言 payload 对象：
  // controller 只把 payload.sheets 交给 exportMultiSheetXlsx，写在 payload 顶层的 summaryRows
  // 是**死字段**（曾经就是这样，注释写着"第一页顶部附加合计行"却从未生效）。
  const ExcelJS = require(path.join(ROOT, 'backend/node_modules/exceljs'))
  const { PassThrough } = require('stream')
  const exportService = require(path.join(ROOT, 'backend/src/modules/export/export.service'))
  const { exportMultiSheetXlsx } = require(path.join(ROOT, 'backend/src/utils/excelExport'))

  const payload = await exportService.getProfitAnalysisExportPayload({})
  assert.ok(Array.isArray(payload.sheets) && payload.sheets.length > 0, '导出应有 sheets')
  assert.ok(
    !('summaryRows' in payload),
    'payload 顶层不应再有 summaryRows（它不会进工作簿，是死字段）',
  )
  const first = payload.sheets[0]
  assert.ok(Array.isArray(first.summaryRows) && first.summaryRows.length >= 9,
    `首个 sheet 应带汇总角标 + 口径提示，实际 ${first.summaryRows?.length} 条`)

  // 真正渲染成 xlsx，再从单元格读回
  const res = new PassThrough()
  res.setHeader = () => {}
  const chunks = []
  res.on('data', (c) => chunks.push(c))
  await exportMultiSheetXlsx(res, 'probe.xlsx', payload.sheets)
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(Buffer.concat(chunks))
  const ws = wb.worksheets[0]
  assert.equal(ws.name, '销售毛利', `首个工作表应为「销售毛利」，实际 ${ws.name}`)

  // A 列是标签、B 列是值；把前若干行读成 label→value 映射
  const cells = new Map()
  for (let r = 1; r <= ws.rowCount; r++) {
    const label = ws.getCell(`A${r}`).value
    if (label) cells.set(String(label), ws.getCell(`B${r}`).value)
  }
  for (const label of ['销售额', '销售成本', '销售毛利', '库存金额', '滞销库存金额']) {
    assert.ok(cells.has(label), `汇总角标「${label}」必须在单元格里（此前从未进过工作簿）`)
  }
  assert.ok(cells.has('成本口径'), '「成本口径」说明必须在单元格里')
  assert.ok(cells.has('无成本明细行数'), '「无成本明细行数」必须在单元格里')
  assert.ok(cells.has('按当前进价估算的金额'), '「按当前进价估算的金额」必须在单元格里')
  const tip = String(cells.get('提示') || '')
  assert.match(tip, /经营估算/, '提示要写明这是经营估算口径')
  assert.match(tip, /凭证/, '提示要说明与凭证侧会计成本口径不同')
  // 注意：不要在这里 pool.end()——下一个用例还要用同一个单例池
})

test('利润分析与 KPI 的成本不再拿售价当成本，并区分估算与缺失', async () => {
  const { pool } = require(path.join(ROOT, 'backend/src/config/db'))
  const created = { products: [], orders: [] }
  try {
    // A：进价 0、无均价 → 快照为空 → **成本缺失**（记 0）
    const A = await mkProduct(pool, created, 'A', { costPrice: 0, salePrice: 100 })
    // B：进价 60、无均价 → 快照为空 → **按当前进价估算**（60）
    const B = await mkProduct(pool, created, 'B', { costPrice: 60, salePrice: 100 })
    // C：快照有值 50 → 精确（快照优先）
    const C = await mkProduct(pool, created, 'C', { costPrice: 0, salePrice: 100 })

    await mkSaleLine(pool, created, { product: A, qty: 10, unitPrice: 100, snapshot: null })
    await mkSaleLine(pool, created, { product: B, qty: 10, unitPrice: 100, snapshot: null })
    await mkSaleLine(pool, created, { product: C, qty: 10, unitPrice: 100, snapshot: 50 })

    // 只取远期专属范围 ⇒ 与共享库其它合成单不会混入
    const profit = await reports.fetchProfitAnalysisRows({ startDate: START_DATE, endDate: END_DATE })
    const summary = profit.summaryRow || {}
    const costAmount = Number(summary.costAmount ?? 0)

    // 期望成本：A 缺失=0；B 估算=10×60=600；C 快照=10×50=500 ⇒ 合计 1100
    // 修复前会拿售价：A 10×100=1000、B 600、C 500 ⇒ 2100（A 那 1000 即售价当成本）
    assert.equal(costAmount, 1100, `成本应为 0+600+500=1100（不得用售价），实际 ${costAmount}`)
    assert.equal(
      Number(summary.estimatedCostAmount ?? 0), 600,
      `按当前进价估算的部分应为 10×60=600，实际 ${summary.estimatedCostAmount}`,
    )
    assert.equal(
      Number(summary.missingCostLineCount ?? 0), 1,
      `成本缺失的行应为 1（商品 A），实际 ${summary.missingCostLineCount}`,
    )

    // 经营 KPI：成本必须与利润分析同口径。
    // 注意 fetchKpiRows.current 的既有形状里**没有 cost 字段**（只有 gmv / grossProfit / …），
    // 所以用 gmv - grossProfit 反推，**不要为此新增字段**。
    const kpi = await reports.fetchKpiRows({ period: PERIOD })
    const kpiCurrent = kpi.current || {}
    assert.ok('gmv' in kpiCurrent && 'grossProfit' in kpiCurrent,
      `KPI 形状变了，请重新核对：${Object.keys(kpiCurrent).join(',')}`)
    const kpiCost = Number(kpiCurrent.gmv || 0) - Number(kpiCurrent.grossProfit || 0)
    assert.equal(kpiCost, 1100, `KPI 成本应与利润分析同口径（1100），实际 ${kpiCost}`)
    assert.ok(
      'estimatedCostAmount' in kpiCurrent && 'missingCostLineCount' in kpiCurrent,
      `KPI 也应暴露估算/缺失两个量以便页面提示，实际键：${Object.keys(kpiCurrent).join(',')}`,
    )

    // 接口一致性（2026-09-27 复核）：trend / byWarehouse 与 current **共用** mapKpiValues，
    // 但它们的外层 SQL 没有聚合这两列。此时必须**不出现**该键——不能伪报 0，
    // 否则页面会显示"0 元估算 / 0 行缺失"，把"没查过"说成"没问题"。
    // 用**真实返回**测这两条公开路径（而不是直接调内部 mapKpiValues）。
    const trend = await reports.fetchKpiTrendRows({ period: PERIOD, months: 2 })
    assert.ok(Array.isArray(trend) && trend.length === 2, `trend 应为按月数组，实际 ${JSON.stringify(trend).slice(0, 120)}`)
    for (const item of trend) {
      assert.ok(!('estimatedCostAmount' in item) && !('missingCostLineCount' in item),
        `trend 的外层未聚合该列，不得伪报估算/缺失：${JSON.stringify(item)}`)
      assert.ok('gmv' in item && 'grossProfit' in item, 'trend 原有字段应保持')
    }

    const byWarehouse = await reports.fetchKpiByWarehouseRows({ period: PERIOD })
    assert.ok(Array.isArray(byWarehouse) && byWarehouse.length > 0,
      `byWarehouse 应返回本期有销售的仓（本套件夹具所在仓），实际 ${JSON.stringify(byWarehouse).slice(0, 120)}`)
    for (const item of byWarehouse) {
      assert.ok(!('estimatedCostAmount' in item) && !('missingCostLineCount' in item),
        `byWarehouse 的外层未聚合该列，不得伪报估算/缺失：${JSON.stringify(item)}`)
    }
  } finally {
    for (const soId of created.orders) {
      await pool.query('DELETE FROM sale_order_items WHERE order_id=?', [soId])
      await pool.query('DELETE FROM sale_orders WHERE id=?', [soId])
    }
    for (const p of created.products) {
      await pool.query('DELETE FROM inventory_stock WHERE product_id=?', [p.id])
      await pool.query('DELETE FROM product_items WHERE id=?', [p.id])
    }
    const [[left]] = await pool.query('SELECT COUNT(*) n FROM product_items WHERE code LIKE ?', [`${TAG}%`])
    console.log(`自洁核对：夹具残留 ${left.n}`)
    await pool.end()
  }
})
