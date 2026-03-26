#!/usr/bin/env node
/**
 * FlowCube 高强度并发压力测试
 *
 * 场景1  双销售抢库存         — 50轮
 * 场景2  销售确认 vs 盘点扣减  — 50轮
 * 场景3  取消销售 vs 任务出库  — 50轮
 *
 * 每轮结束后全局一致性校验（容器/库存/预占三不变量）
 *
 * export TEST_DB_PASSWORD='你的MySQL密码'
 * node tests/concurrency.stress.test.js
 *
 * 可选：TEST_DB_HOST、TEST_DB_USER、TEST_DB_NAME；API：TEST_API_HOST、TEST_API_PORT
 */

'use strict'

const path = require('path')

// ─── 依赖 ────────────────────────────────────────────────────────────────────

const mysql2 = require(path.join(__dirname, '..', 'backend', 'node_modules', 'mysql2', 'promise'))

// ─── 配置 ────────────────────────────────────────────────────────────────────

const TEST_DB_PASSWORD = process.env.TEST_DB_PASSWORD
if (!TEST_DB_PASSWORD) {
  process.stderr.write(
    '❌ 未设置 TEST_DB_PASSWORD。示例：export TEST_DB_PASSWORD=你的本地MySQL密码\n',
  )
  process.exit(1)
}

const API_HOST = process.env.TEST_API_HOST || 'localhost'
const API_PORT = Number(process.env.TEST_API_PORT || '3000')
const BASE = `http://${API_HOST}:${API_PORT}`

const DB_CFG = {
  host: process.env.TEST_DB_HOST || '127.0.0.1',
  user: process.env.TEST_DB_USER || 'root',
  password: TEST_DB_PASSWORD,
  database: process.env.TEST_DB_NAME || 'flowcube',
}
const ROUNDS  = 50       // 每个场景循环次数
const DELAY_MIN = 10     // 最小延迟 ms
const DELAY_MAX = 100    // 最大延迟 ms

// ─── 工具 ────────────────────────────────────────────────────────────────────

let TOKEN = ''
let db    = null

// 颜色输出
const C = {
  pass:  s => `\x1b[32m${s}\x1b[0m`,
  fail:  s => `\x1b[31m${s}\x1b[0m`,
  warn:  s => `\x1b[33m${s}\x1b[0m`,
  dim:   s => `\x1b[2m${s}\x1b[0m`,
  bold:  s => `\x1b[1m${s}\x1b[0m`,
  cyan:  s => `\x1b[36m${s}\x1b[0m`,
}

const sleep = ms => new Promise(r => setTimeout(r, ms))
const jitter = () => sleep(DELAY_MIN + Math.floor(Math.random() * (DELAY_MAX - DELAY_MIN)))

async function api(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${TOKEN}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const json = await res.json()
  return { status: res.status, ok: res.ok, data: json }
}

const GET    = path       => api('GET',    path)
const POST   = (p, b)     => api('POST',   p, b)
const PUT    = (p, b={})  => api('PUT',    p, b)

async function dbq(sql, params = []) {
  const [rows] = await db.query(sql, params)
  return rows
}

// ─── 全局统计 ─────────────────────────────────────────────────────────────────

const stats = {
  s1: { pass: 0, fail: 0, times: [] },
  s2: { pass: 0, fail: 0, times: [] },
  s3: { pass: 0, fail: 0, times: [] },
  consistency: { pass: 0, fail: 0 },
}

// ─── 清理函数 ─────────────────────────────────────────────────────────────────

const CLEAN_TABLES = [
  'inventory_containers', 'inventory_stock', 'stock_reservations', 'inventory_logs',
  'sale_order_items', 'sale_orders', 'warehouse_task_items', 'warehouse_tasks',
  'transfer_order_items', 'transfer_orders',
  'inventory_check_items', 'inventory_checks',
  'purchase_return_items', 'purchase_returns',
  'sale_return_items', 'sale_returns',
  'payment_records', 'payment_entries',
]

async function cleanAll() {
  await db.query('SET FOREIGN_KEY_CHECKS=0')
  for (const t of CLEAN_TABLES) await db.query(`TRUNCATE TABLE ${t}`)
  await db.query('SET FOREIGN_KEY_CHECKS=1')
}

// ─── 库存初始化（直接写 DB，跳过 API 提速）───────────────────────────────────

async function initStock(productId, warehouseId, qty) {
  // 清除该商品+仓库的所有容器和库存缓存
  await db.query('DELETE FROM inventory_containers WHERE product_id=? AND warehouse_id=?', [productId, warehouseId])
  await db.query('DELETE FROM inventory_stock WHERE product_id=? AND warehouse_id=?', [productId, warehouseId])
  await db.query('DELETE FROM stock_reservations WHERE product_id=? AND warehouse_id=?', [productId, warehouseId])

  if (qty > 0) {
    // 直接写入容器 + 缓存（绕过业务逻辑，仅用于测试初始化）
    await db.query(
      `INSERT INTO inventory_containers
         (barcode, container_type, product_id, warehouse_id,
          initial_qty, remaining_qty, status, source_ref_type, source_ref_no)
       VALUES (?, 1, ?, ?, ?, ?, 1, 'test_init', 'INIT')`,
      [`TEST-INIT-${productId}-${warehouseId}-${Date.now()}`, productId, warehouseId, qty, qty]
    )
    await db.query(
      `INSERT INTO inventory_stock (product_id, warehouse_id, quantity, reserved)
       VALUES (?,?,?,0)
       ON DUPLICATE KEY UPDATE quantity=?, reserved=0`,
      [productId, warehouseId, qty, qty]
    )
  }
}

// ─── 全局一致性校验 ───────────────────────────────────────────────────────────

async function checkConsistency(label = '') {
  const issues = []

  // 1. 容器总量 != inventory_stock.quantity
  const drift = await dbq(`
    SELECT s.product_id, s.warehouse_id,
           s.quantity AS cached,
           COALESCE(SUM(c.remaining_qty),0) AS container_sum
    FROM inventory_stock s
    LEFT JOIN inventory_containers c
      ON c.product_id=s.product_id AND c.warehouse_id=s.warehouse_id
         AND c.status=1 AND c.deleted_at IS NULL
    GROUP BY s.product_id, s.warehouse_id
    HAVING ABS(cached - container_sum) > 0.001
  `)
  if (drift.length > 0) {
    issues.push(`容器总量与inventory_stock不一致: ${JSON.stringify(drift)}`)
  }

  // 2. remaining_qty < 0
  const negContainer = await dbq('SELECT COUNT(*) AS n FROM inventory_containers WHERE remaining_qty < 0')
  if (Number(negContainer[0].n) > 0) {
    issues.push(`存在 remaining_qty < 0 的容器（count=${negContainer[0].n}）`)
  }

  // 3. reserved < 0
  const negReserved = await dbq('SELECT COUNT(*) AS n FROM inventory_stock WHERE reserved < 0')
  if (Number(negReserved[0].n) > 0) {
    issues.push(`存在 reserved < 0（count=${negReserved[0].n}）`)
  }

  // 4. reserved > quantity
  const overReserved = await dbq('SELECT COUNT(*) AS n FROM inventory_stock WHERE reserved > quantity + 0.001')
  if (Number(overReserved[0].n) > 0) {
    const rows = await dbq('SELECT * FROM inventory_stock WHERE reserved > quantity + 0.001')
    issues.push(`存在 reserved > quantity: ${JSON.stringify(rows)}`)
  }

  if (issues.length > 0) {
    stats.consistency.fail++
    console.log(C.fail(`  [一致性] FAIL ${label}`))
    issues.forEach(i => console.log(C.fail(`    → ${i}`)))
    // 打印当前库存状态
    const stocks = await dbq('SELECT * FROM inventory_stock LIMIT 5')
    const containers = await dbq('SELECT id, barcode, remaining_qty, status FROM inventory_containers WHERE status=1 LIMIT 10')
    console.log(C.warn(`    库存：${JSON.stringify(stocks)}`))
    console.log(C.warn(`    容器：${JSON.stringify(containers)}`))
    return false
  }

  stats.consistency.pass++
  return true
}

// ─── 销售单工具 ───────────────────────────────────────────────────────────────

async function createSaleAndConfirm(product, warehouse, customer, qty) {
  const createRes = await POST('/api/sale', {
    customerId: customer.id, customerName: customer.name,
    warehouseId: warehouse.id, warehouseName: warehouse.name,
    remark: 'stress-test',
    items: [{ productId: product.id, productCode: product.code, productName: product.name, unit: product.unit, quantity: qty, unitPrice: 10 }]
  })
  if (!createRes.ok) return { ok: false, reason: 'create_fail', data: createRes.data }
  const soId = createRes.data?.data?.id
  const confirmRes = await POST(`/api/sale/${soId}/confirm`)
  return { ok: confirmRes.ok, soId, reason: confirmRes.ok ? 'ok' : confirmRes.data?.message }
}

async function taskShip(soId) {
  const [row] = await dbq('SELECT task_id FROM sale_orders WHERE id=?', [soId])
  if (!row?.task_id) return { ok: false, reason: 'no_task' }
  const taskId = row.task_id
  // 不管状态直接推进（并发测试允许失败）
  await PUT(`/api/warehouse-tasks/${taskId}/start-picking`).catch(() => {})
  await PUT(`/api/warehouse-tasks/${taskId}/ready`).catch(() => {})
  const res = await PUT(`/api/warehouse-tasks/${taskId}/ship`)
  return { ok: res.ok, taskId, reason: res.ok ? 'ok' : res.data?.message }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 场景 1：双销售抢库存（各要 40，初始 50）
// 只允许一个成功；reserved=40；quantity=50
// ═══════════════════════════════════════════════════════════════════════════════

async function scene1(product, warehouse, customer, round) {
  const t0 = Date.now()

  // 初始化库存 50
  await initStock(product.id, warehouse.id, 50)

  // 创建两张销售单（未确认）
  const [c1, c2] = await Promise.all([
    POST('/api/sale', {
      customerId: customer.id, customerName: customer.name,
      warehouseId: warehouse.id, warehouseName: warehouse.name,
      remark: 'stress-s1-a',
      items: [{ productId: product.id, productCode: product.code, productName: product.name, unit: product.unit, quantity: 40, unitPrice: 10 }]
    }),
    POST('/api/sale', {
      customerId: customer.id, customerName: customer.name,
      warehouseId: warehouse.id, warehouseName: warehouse.name,
      remark: 'stress-s1-b',
      items: [{ productId: product.id, productCode: product.code, productName: product.name, unit: product.unit, quantity: 40, unitPrice: 10 }]
    }),
  ])
  const soId1 = c1.data?.data?.id
  const soId2 = c2.data?.data?.id

  // 并发 confirm（随机抖动模拟真实并发）
  await jitter()
  const [r1, r2] = await Promise.all([
    POST(`/api/sale/${soId1}/confirm`),
    POST(`/api/sale/${soId2}/confirm`),
  ])

  const ok1 = r1.ok, ok2 = r2.ok
  const successCount = [ok1, ok2].filter(Boolean).length

  // 查询数据库真实状态
  const [stock] = await dbq(
    'SELECT quantity, COALESCE(reserved,0) AS reserved FROM inventory_stock WHERE product_id=? AND warehouse_id=?',
    [product.id, warehouse.id]
  )
  const qty      = stock ? Number(stock.quantity) : 0
  const reserved = stock ? Number(stock.reserved)  : 0

  const consistent = await checkConsistency(`S1 Round${round}`)

  const issues = []
  if (successCount > 1)    issues.push(`两个确认均成功（reserved可能超库存）`)
  if (reserved > qty)      issues.push(`reserved(${reserved}) > quantity(${qty})`)
  if (qty !== 50)          issues.push(`quantity=${qty} 应为50`)
  if (successCount === 1 && reserved !== 40) issues.push(`仅1个成功但reserved=${reserved}≠40`)

  const elapsed = Date.now() - t0
  stats.s1.times.push(elapsed)

  if (issues.length === 0 && consistent) {
    stats.s1.pass++
    return { pass: true, elapsed }
  } else {
    stats.s1.fail++
    return { pass: false, elapsed, issues, debug: { ok1, ok2, qty, reserved, successCount } }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 场景 2：销售确认(30) 与 盘点减50 并发（初始 100）
// 不允许 remaining_qty < 0 / reserved > quantity
// ═══════════════════════════════════════════════════════════════════════════════

async function scene2(product, warehouse, customer, round) {
  const t0 = Date.now()
  await initStock(product.id, warehouse.id, 100)

  // 创建销售单（未确认）
  const createRes = await POST('/api/sale', {
    customerId: customer.id, customerName: customer.name,
    warehouseId: warehouse.id, warehouseName: warehouse.name,
    remark: 'stress-s2',
    items: [{ productId: product.id, productCode: product.code, productName: product.name, unit: product.unit, quantity: 30, unitPrice: 10 }]
  })
  const soId = createRes.data?.data?.id

  // 创建盘点单（拉取库存为明细）
  const checkRes = await POST('/api/stockcheck', {
    warehouseId: warehouse.id, warehouseName: warehouse.name,
    remark: 'stress-s2-check',
  })
  const checkId = checkRes.data?.data?.id

  // 查询盘点明细
  const checkDetail = await GET(`/api/stockcheck/${checkId}`)
  const items = checkDetail.data?.data?.items || []
  const targetItem = items.find(i => i.productId === product.id)

  // 填写实盘（减50）
  const actualQty = Math.max(0, Number(targetItem?.bookQty || 100) - 50)
  if (targetItem) {
    await PUT(`/api/stockcheck/${checkId}/items`, {
      items: [{ id: targetItem.id, actualQty }]
    })
  }

  // 并发：销售确认 + 盘点提交
  await jitter()
  const [confirmRes, submitRes] = await Promise.all([
    POST(`/api/sale/${soId}/confirm`),
    POST(`/api/stockcheck/${checkId}/submit`),
  ])

  // 数据库一致性校验
  const consistent = await checkConsistency(`S2 Round${round}`)

  const [stock] = await dbq(
    'SELECT quantity, COALESCE(reserved,0) AS reserved FROM inventory_stock WHERE product_id=? AND warehouse_id=?',
    [product.id, warehouse.id]
  )
  const qty       = stock ? Number(stock.quantity) : 0
  const reserved  = stock ? Number(stock.reserved)  : 0

  const issues = []
  if (qty < 0)          issues.push(`quantity=${qty} < 0`)
  if (reserved < 0)     issues.push(`reserved=${reserved} < 0`)
  if (reserved > qty)   issues.push(`reserved(${reserved}) > quantity(${qty})`)
  if (!consistent)      issues.push('全局一致性校验失败')

  const elapsed = Date.now() - t0
  stats.s2.times.push(elapsed)

  if (issues.length === 0) {
    stats.s2.pass++
    return { pass: true, elapsed, debug: { confirmOk: confirmRes.ok, submitOk: submitRes.ok, qty, reserved } }
  } else {
    stats.s2.fail++
    return { pass: false, elapsed, issues, debug: { confirmOk: confirmRes.ok, submitOk: submitRes.ok, qty, reserved } }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 场景 3：取消销售 vs 任务出库（初始 50，销售 20）
// 合法结果A：sale.status=4（已取消），quantity=50，reserved=0
// 合法结果B：sale.status=3（已出库），quantity=30，reserved=0
// ═══════════════════════════════════════════════════════════════════════════════

async function scene3(product, warehouse, customer, round) {
  const t0 = Date.now()
  await initStock(product.id, warehouse.id, 50)

  // 创建并确认销售单（产生预占 + 任务）
  const createRes = await POST('/api/sale', {
    customerId: customer.id, customerName: customer.name,
    warehouseId: warehouse.id, warehouseName: warehouse.name,
    remark: 'stress-s3',
    items: [{ productId: product.id, productCode: product.code, productName: product.name, unit: product.unit, quantity: 20, unitPrice: 10 }]
  })
  const soId = createRes.data?.data?.id
  const confirmRes = await POST(`/api/sale/${soId}/confirm`)
  if (!confirmRes.ok) {
    stats.s3.fail++
    return { pass: false, elapsed: Date.now() - t0, issues: ['销售确认失败：' + confirmRes.data?.message] }
  }

  // 获取任务 ID
  const [saleRow] = await dbq('SELECT task_id FROM sale_orders WHERE id=?', [soId])
  const taskId = saleRow?.task_id
  if (!taskId) {
    stats.s3.fail++
    return { pass: false, elapsed: Date.now() - t0, issues: ['未找到仓库任务'] }
  }

  // 推进任务到待出库（start-picking + ready）
  await PUT(`/api/warehouse-tasks/${taskId}/start-picking`)
  await PUT(`/api/warehouse-tasks/${taskId}/ready`)

  // 并发：取消销售 vs 任务出库
  await jitter()
  const [cancelRes, shipRes] = await Promise.all([
    POST(`/api/sale/${soId}/cancel`),
    PUT(`/api/warehouse-tasks/${taskId}/ship`),
  ])

  // 读取最终状态
  const [saleStatus] = await dbq('SELECT status FROM sale_orders WHERE id=?', [soId])
  const [taskStatus] = await dbq('SELECT status FROM warehouse_tasks WHERE id=?', [taskId])
  const [stock]      = await dbq(
    'SELECT quantity, COALESCE(reserved,0) AS reserved FROM inventory_stock WHERE product_id=? AND warehouse_id=?',
    [product.id, warehouse.id]
  )
  const qty      = stock ? Number(stock.quantity) : 0
  const reserved = stock ? Number(stock.reserved)  : 0
  const saleS    = saleStatus?.status
  const taskS    = taskStatus?.status

  const consistent = await checkConsistency(`S3 Round${round}`)

  const issues = []

  // 验证合法结果
  const resultA = (saleS === 4 && qty === 50 && reserved === 0)   // 取消成功
  const resultB = (saleS === 3 && qty === 30 && reserved === 0)   // 出库成功

  if (!resultA && !resultB) {
    issues.push(`非法状态：saleStatus=${saleS} qty=${qty} reserved=${reserved}（合法A:status=4,qty=50 / 合法B:status=3,qty=30）`)
  }
  if (reserved < 0) issues.push(`reserved=${reserved} < 0`)
  if (qty < 0)      issues.push(`quantity=${qty} < 0`)
  if (!consistent)  issues.push('全局一致性校验失败')

  const elapsed = Date.now() - t0
  stats.s3.times.push(elapsed)

  if (issues.length === 0) {
    stats.s3.pass++
    const result = resultA ? 'A(取消)' : 'B(出库)'
    return { pass: true, elapsed, result }
  } else {
    stats.s3.fail++
    return { pass: false, elapsed, issues, debug: { saleS, taskS, qty, reserved, cancelOk: cancelRes.ok, shipOk: shipRes.ok } }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 主流程
// ═══════════════════════════════════════════════════════════════════════════════

async function main() {
  console.log(C.bold('\n════════════════════════════════════════════════════'))
  console.log(C.bold(' FlowCube 并发压力测试'))
  console.log(C.bold(`════════════════════════════════════════════════════\n`))

  // 数据库连接
  try {
    db = await mysql2.createConnection(DB_CFG)
    console.log(C.dim('📦 数据库连接成功'))
  } catch (e) {
    console.error('数据库连接失败：' + e.message); process.exit(1)
  }

  // 登录
  const loginRes = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  })
  const loginData = await loginRes.json()
  TOKEN = loginData.data?.token
  if (!TOKEN) { console.error('登录失败'); process.exit(1) }
  console.log(C.dim('🔑 登录成功\n'))

  // 获取主数据
  const [product]  = await dbq('SELECT id, code, name, unit FROM product_items WHERE deleted_at IS NULL LIMIT 1')
  const [wh]       = await dbq('SELECT id, name FROM inventory_warehouses WHERE deleted_at IS NULL AND is_active=1 LIMIT 1')
  const [customer] = await dbq('SELECT id, name FROM sale_customers WHERE deleted_at IS NULL LIMIT 1')

  if (!product || !wh || !customer) {
    console.error('缺少主数据（商品/仓库/客户），请先创建')
    process.exit(1)
  }
  console.log(C.dim(`商品: [${product.id}] ${product.name}  仓库: [${wh.id}] ${wh.name}  客户: [${customer.id}] ${customer.name}\n`))

  // 全量清理
  await cleanAll()
  console.log(C.dim('🗑  交易数据已清空\n'))

  const globalStart = Date.now()

  // ────────────────────────────────────────────────────────────────────────────
  // 场景 1
  // ────────────────────────────────────────────────────────────────────────────
  console.log(C.cyan(C.bold(`─── 场景1：双销售抢库存（各需40，初始50） × ${ROUNDS}轮 ────`)))

  for (let i = 1; i <= ROUNDS; i++) {
    // 每轮只清理本商品+仓库数据（不影响其他数据）
    try {
      const res = await scene1(product, wh, customer, i)
      if (res.pass) {
        process.stdout.write(C.pass(`  [S1 Round${String(i).padStart(2,'0')}] PASS ${C.dim(`${res.elapsed}ms`)}\n`))
      } else {
        process.stdout.write(C.fail(`  [S1 Round${String(i).padStart(2,'0')}] FAIL ${JSON.stringify(res.issues)} ${JSON.stringify(res.debug)}\n`))
      }
    } catch (e) {
      stats.s1.fail++
      process.stdout.write(C.fail(`  [S1 Round${String(i).padStart(2,'0')}] ERROR ${e.message}\n`))
    }
    await jitter()
  }

  // ────────────────────────────────────────────────────────────────────────────
  // 场景 2
  // ────────────────────────────────────────────────────────────────────────────
  console.log(C.cyan(C.bold(`\n─── 场景2：销售确认 vs 盘点减50（初始100）× ${ROUNDS}轮 ───`)))

  for (let i = 1; i <= ROUNDS; i++) {
    try {
      const res = await scene2(product, wh, customer, i)
      if (res.pass) {
        const d = res.debug
        process.stdout.write(C.pass(`  [S2 Round${String(i).padStart(2,'0')}] PASS confirm=${d.confirmOk?'✓':'✗'} check=${d.submitOk?'✓':'✗'} qty=${d.qty} reserved=${d.reserved} ${C.dim(`${res.elapsed}ms`)}\n`))
      } else {
        process.stdout.write(C.fail(`  [S2 Round${String(i).padStart(2,'0')}] FAIL ${JSON.stringify(res.issues)} ${JSON.stringify(res.debug)}\n`))
      }
    } catch (e) {
      stats.s2.fail++
      process.stdout.write(C.fail(`  [S2 Round${String(i).padStart(2,'0')}] ERROR ${e.message}\n`))
    }
    await jitter()
  }

  // ────────────────────────────────────────────────────────────────────────────
  // 场景 3
  // ────────────────────────────────────────────────────────────────────────────
  console.log(C.cyan(C.bold(`\n─── 场景3：取消销售 vs 任务出库（初始50，确认20）× ${ROUNDS}轮 ──`)))

  for (let i = 1; i <= ROUNDS; i++) {
    try {
      const res = await scene3(product, wh, customer, i)
      if (res.pass) {
        process.stdout.write(C.pass(`  [S3 Round${String(i).padStart(2,'0')}] PASS 结果=${res.result} ${C.dim(`${res.elapsed}ms`)}\n`))
      } else {
        process.stdout.write(C.fail(`  [S3 Round${String(i).padStart(2,'0')}] FAIL ${JSON.stringify(res.issues)} ${JSON.stringify(res.debug)}\n`))
      }
    } catch (e) {
      stats.s3.fail++
      process.stdout.write(C.fail(`  [S3 Round${String(i).padStart(2,'0')}] ERROR ${e.message}\n`))
    }
    await jitter()
  }

  // ────────────────────────────────────────────────────────────────────────────
  // 汇总
  // ────────────────────────────────────────────────────────────────────────────
  const totalElapsed = Date.now() - globalStart

  const allTimes   = [...stats.s1.times, ...stats.s2.times, ...stats.s3.times]
  const avgTime    = allTimes.length ? Math.round(allTimes.reduce((a,b)=>a+b,0)/allTimes.length) : 0
  const maxTime    = allTimes.length ? Math.max(...allTimes) : 0

  const totalPass  = stats.s1.pass + stats.s2.pass + stats.s3.pass
  const totalFail  = stats.s1.fail + stats.s2.fail + stats.s3.fail
  const totalRound = totalPass + totalFail
  const passRate   = totalRound > 0 ? ((totalPass/totalRound)*100).toFixed(1) : '0.0'

  console.log(C.bold('\n════════════════════════════════════════════════════'))
  console.log(C.bold(' 压力测试汇总'))
  console.log('────────────────────────────────────────────────────')
  console.log(`  场景1 双销售抢库存    PASS ${stats.s1.pass.toString().padStart(3)}  FAIL ${stats.s1.fail.toString().padStart(3)}`)
  console.log(`  场景2 确认vs盘点      PASS ${stats.s2.pass.toString().padStart(3)}  FAIL ${stats.s2.fail.toString().padStart(3)}`)
  console.log(`  场景3 取消vs出库      PASS ${stats.s3.pass.toString().padStart(3)}  FAIL ${stats.s3.fail.toString().padStart(3)}`)
  console.log('────────────────────────────────────────────────────')
  console.log(`  一致性校验  PASS ${stats.consistency.pass.toString().padStart(3)}  FAIL ${stats.consistency.fail.toString().padStart(3)}`)
  console.log('────────────────────────────────────────────────────')

  const summaryLine = `  TOTAL  ${totalRound}轮  PASS ${totalPass}  FAIL ${totalFail}  通过率 ${passRate}%`
  console.log(totalFail === 0 ? C.pass(C.bold(summaryLine)) : C.fail(C.bold(summaryLine)))

  console.log(`  总耗时 ${(totalElapsed/1000).toFixed(2)}s  平均 ${avgTime}ms/轮  最大 ${maxTime}ms`)
  console.log(C.bold('════════════════════════════════════════════════════\n'))

  await db.end()
  process.exit(totalFail > 0 ? 1 : 0)
}

main().catch(async e => {
  console.error(`\n💥 未捕获异常: ${e.message}\n${e.stack}`)
  if (db) await db.end()
  process.exit(1)
})
