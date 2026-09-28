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
  // 导出表内也要能**逐行**定位成本来源：销售毛利 / 商品毛利两页都应有「成本来源」列。
  // （数据行的具体文案由行级用例覆盖 costBasis 判定；这里断言列真的进了工作簿。）
  for (const sheetName of ['销售毛利', '商品毛利']) {
    const sheet = wb.getWorksheet(sheetName)
    assert.ok(sheet, `应有工作表「${sheetName}」`)
    let found = false
    for (let r = 1; r <= sheet.rowCount && !found; r++) {
      for (let c = 1; c <= sheet.columnCount; c++) {
        if (String(sheet.getRow(r).getCell(c).value || '') === '成本来源') { found = true; break }
      }
    }
    assert.ok(found, `「${sheetName}」页应有「成本来源」列，用户要能在导出行上定位不可靠的毛利`)
  }

  const tip = String(cells.get('提示') || '')
  assert.match(tip, /经营估算/, '提示要写明这是经营估算口径')
  assert.match(tip, /凭证/, '提示要说明与凭证侧会计成本口径不同')
  // 注意：不要在这里 pool.end()——下一个用例还要用同一个单例池
})

test('利润榜行级成本来源：快照/估算/缺失/混合四种都能在该行定位', async () => {
  // 单独一个远期月 2031-05：与上面那个用例的 2031-03 完全隔离，
  // 这样混合单不会污染「汇总=1100」这类期望（否则会出现与行级实现无关的红）。
  const { pool } = require(path.join(ROOT, 'backend/src/config/db'))
  const created = { products: [], orders: [] }
  const START = '2031-05-01'
  const END = '2031-06-01'
  const STAMP = '2031-05-15 10:00:00'
  const mkProd = async (label, costPrice) => {
    const [r] = await pool.query(
      `INSERT INTO product_items (code,name,unit,cost_price,avg_cost,sale_price,sale_price_a,created_at)
       VALUES (?,?,?,?,NULL,100,100,?)`,
      [`${TAG}-M${label}`, `P2行级${label}${TAG}`, '件', costPrice, STAMP],
    )
    const p = { id: r.insertId, code: `${TAG}-M${label}` }
    created.products.push(p)
    return p
  }
  /** 建一张**自洽**的单：单头净额 = 明细金额合计 */
  const mkOrder = async (no, lines) => {
    const total = lines.reduce((s, l) => s + l.qty * l.unitPrice, 0)
    const [so] = await pool.query(
      `INSERT INTO sale_orders (order_no,customer_id,customer_name,warehouse_id,warehouse_name,
                                operator_id,operator_name,total_amount,discount_amount,status,created_at,sale_date)
       VALUES (?,?,?,?,?,?,?,?,0,4,?,?)`,
      [no, 999802, `P2行级客户${TAG}`, 1, 'P2行级仓', 1, 'probe', total, STAMP, '2031-05-15'],
    )
    created.orders.push(so.insertId)
    for (const l of lines) {
      await pool.query(
        `INSERT INTO sale_order_items
           (order_id,product_id,product_code,product_name,unit,quantity,shipped_qty,unit_price,amount,cost_snapshot,warehouse_id,created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,1,?)`,
        [so.insertId, l.product.id, l.product.code, `P2行级${TAG}`, '件',
          l.qty, l.qty, l.unitPrice, l.qty * l.unitPrice, l.snapshot, STAMP],
      )
    }
    return { id: so.insertId, no }
  }

  try {
    const pSnap = await mkProd('SNAP', 0)
    const pEst = await mkProd('EST', 60)
    const pMiss = await mkProd('MISS', 0)
    const pMixEst = await mkProd('MIXE', 60)
    const pMixMiss = await mkProd('MIXM', 0)

    const oSnap = await mkOrder(`${TAG}-O-SNAP`, [{ product: pSnap, qty: 10, unitPrice: 100, snapshot: 50 }])
    const oEst = await mkOrder(`${TAG}-O-EST`, [{ product: pEst, qty: 10, unitPrice: 100, snapshot: null }])
    const oMiss = await mkOrder(`${TAG}-O-MISS`, [{ product: pMiss, qty: 10, unitPrice: 100, snapshot: null }])
    // 混合单：单头 1000 = 明细 500 + 500（自洽）
    const oMix = await mkOrder(`${TAG}-O-MIX`, [
      { product: pMixEst, qty: 5, unitPrice: 100, snapshot: null },
      { product: pMixMiss, qty: 5, unitPrice: 100, snapshot: null },
    ])

    // 走 **metrics 层**：`saleOrders` / `products` / `costBasis` 是页面与导出真正消费的形状
    // （query 层的 `fetchProfitAnalysisRows` 返回的是 `saleRows`，且不含 costBasis 判定）。
    const metrics = require(path.join(ROOT, 'backend/src/modules/reports/reports.metrics'))
    const profit = await metrics.profitAnalysis({ startDate: START, endDate: END })
    const byNo = new Map(profit.saleOrders.map(r => [r.orderNo, r]))
    const expect = (no, basis, est, miss) => {
      const r = byNo.get(no)
      assert.ok(r, `榜单应含 ${no}`)
      assert.equal(r.costBasis, basis, `${no} 的成本来源应为 ${basis}，实际 ${r.costBasis}`)
      assert.equal(Number(r.estimatedCostAmount ?? 0), est, `${no} 估算额`)
      assert.equal(Number(r.missingCostLineCount ?? 0), miss, `${no} 缺失行数`)
    }
    expect(oSnap.no, 'snapshot', 0, 0)
    expect(oEst.no, 'estimated', 600, 0)
    expect(oMiss.no, 'missing', 0, 1)
    expect(oMix.no, 'mixed', 300, 1)

    // 商品榜同样逐行可定位
    const byCode = new Map(profit.products.map(r => [r.code, r]))
    assert.equal(byCode.get(pEst.code)?.costBasis, 'estimated', '商品榜估算来源')
    assert.equal(byCode.get(pMiss.code)?.costBasis, 'missing', '商品榜缺失来源')
    assert.equal(Number(byCode.get(pMixEst.code)?.estimatedCostAmount ?? 0), 300, '商品榜混合-估算额')
    assert.equal(Number(byCode.get(pMixMiss.code)?.missingCostLineCount ?? 0), 1, '商品榜混合-缺失行数')

    // 导出表内也要能**逐行定位**（不是只查表头）：趁 2031-05 夹具还在，生成真实利润 xlsx，
    // 按订单号 / 商品编码找到那一行，断言**同一行**的「成本来源」中文文案——
    // 这样单独删掉 export.service 的 costBasisText 映射会精准红。
    const ExcelJS = require(path.join(ROOT, 'backend/node_modules/exceljs'))
    const { PassThrough } = require('stream')
    const exportService = require(path.join(ROOT, 'backend/src/modules/export/export.service'))
    const { exportMultiSheetXlsx } = require(path.join(ROOT, 'backend/src/utils/excelExport'))
    const payload = await exportService.getProfitAnalysisExportPayload({ startDate: START, endDate: END })
    const res2 = new PassThrough()
    res2.setHeader = () => {}
    const chunks2 = []
    res2.on('data', (c) => chunks2.push(c))
    await exportMultiSheetXlsx(res2, 'rows.xlsx', payload.sheets)
    const wb2 = new ExcelJS.Workbook()
    await wb2.xlsx.load(Buffer.concat(chunks2))

    const grid = (sheetName) => {
      const ws = wb2.getWorksheet(sheetName)
      assert.ok(ws, `导出应有工作表「${sheetName}」`)
      // 用 actualColumnCount：fillSheet 现在只给 key/width（不再经 ws.columns 写表头），
      // ws.columnCount 可能为空，按它遍历会一个单元格都取不到。
      // actualRowCount/actualColumnCount 在「只给 key/width、不经 ws.columns 写表头」的 sheet 上
      // 会偏小（实测只覆盖汇总块），故与 rowCount/columnCount 取较大值。
      const lastCol = Math.max(ws.actualColumnCount || 0, ws.columnCount || 0)
      const lastRow = Math.max(ws.actualRowCount || 0, ws.rowCount || 0)
      const rows = []
      for (let r = 1; r <= lastRow; r++) {
        const cells = []
        for (let c = 1; c <= lastCol; c++) cells.push(ws.getRow(r).getCell(c).value)
        rows.push(cells)
      }
      return rows
    }
    /** 在指定 sheet 里按 keyHeader=keyValue 定位数据行，返回同行「成本来源」单元格文本 */
    const basisFor = (sheetName, keyHeader, keyValue) => {
      const rows = grid(sheetName)
      const headerIdx = rows.findIndex((r) => r.includes('成本来源'))
      assert.ok(headerIdx >= 0, `「${sheetName}」应有「成本来源」列`)
      const header = rows[headerIdx]
      const keyIdx = header.indexOf(keyHeader)
      assert.ok(keyIdx >= 0, `「${sheetName}」应有「${keyHeader}」列`)
      const hit = rows.slice(headerIdx + 1).find((r) => String(r[keyIdx] ?? '') === keyValue)
      assert.ok(hit, `「${sheetName}」应含 ${keyValue} 的数据行`)
      return String(hit[header.indexOf('成本来源')] ?? '')
    }

    assert.match(basisFor('销售毛利', '销售单号', oSnap.no), /出库时记录的成本/, '快照单的导出行应标「出库时记录的成本」')
    assert.match(basisFor('销售毛利', '销售单号', oEst.no), /按当前进价估算/, '估算单的导出行应标「按当前进价估算」')
    assert.match(basisFor('销售毛利', '销售单号', oMiss.no), /成本缺失/, '缺失单的导出行应标「成本缺失」')
    assert.match(basisFor('销售毛利', '销售单号', oMix.no), /混合/, '混合单的导出行应标「混合」')
    assert.match(basisFor('商品毛利', '商品编码', pEst.code), /按当前进价估算/, '商品页估算行')
    assert.match(basisFor('商品毛利', '商品编码', pMiss.code), /成本缺失/, '商品页缺失行')

    // 未知态语义与页面一致：**只有显式 snapshot 才写「出库时记录的成本」**。
    // 否则将来导出映射漏带该字段，会重新把"没查到来源"伪报成"全部可信"。
    const { costBasisText } = exportService
    assert.equal(costBasisText({ costBasis: 'snapshot' }), '出库时记录的成本')
    assert.equal(costBasisText({}), '成本来源待核实', '缺字段不得默认成快照')
    assert.equal(costBasisText({ costBasis: 'brand_new_value' }), '成本来源待核实', '未知取值不得默认成快照')
  } finally {
    for (const soId of created.orders) {
      await pool.query('DELETE FROM sale_order_items WHERE order_id=?', [soId])
      await pool.query('DELETE FROM sale_orders WHERE id=?', [soId])
    }
    for (const p of created.products) {
      await pool.query('DELETE FROM inventory_stock WHERE product_id=?', [p.id])
      await pool.query('DELETE FROM product_items WHERE id=?', [p.id])
    }
    const [[left]] = await pool.query('SELECT COUNT(*) n FROM product_items WHERE code LIKE ?', [`${TAG}-M%`])
    console.log(`行级用例自洁：残留 ${left.n}`)
    // 不在这里 pool.end()：后面还有用例复用同一个 db 单例池；
    // 池只在**整个文件的最后一个用例**收尾（见文件末尾）。
  }
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
    // 行级可定位性由上面那个独立用例覆盖（它走 metrics 层，含 saleOrders/costBasis）；
    // 本用例只验证**汇总与 KPI** 的成本口径，避免两层混用。

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
