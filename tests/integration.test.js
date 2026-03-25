#!/usr/bin/env node
/**
 * FlowCube 业务集成测试脚本
 *
 * 测试流程：
 *   Step 1  登录，获取 Token
 *   Step 2  采购单：创建 → 确认 → 收货（入库）
 *   Step 3  校验入库后容器 / 库存缓存
 *   Step 4  销售单：创建 → 确认（预占）
 *   Step 5  校验预占后 reserved / stock_reservations
 *   Step 6  仓库任务出库
 *   Step 7  校验出库后容器 FIFO / reserved 清零 / 缓存
 *   Step 8  调拨：创建 → 确认 → 执行
 *   Step 9  校验调拨后源仓库 / 目标仓库容器
 *   Step 10 盘点：创建 → 填实盘 → 提交
 *   Step 11 校验盘点后容器 / 缓存
 *   Step 12 采购退货：创建 → 确认 → 执行
 *   Step 13 校验采购退货后容器减少
 *   Step 14 销售退货：创建 → 确认 → 执行
 *   Step 15 校验销售退货后容器增加
 *   Step 16 汇总报告
 *
 * 运行方式：
 *   cd /Users/chengjianghao/flowcube
 *   node tests/integration.test.js
 */

'use strict'

const http = require('http')

// ─── 配置 ───────────────────────────────────────────────────────────────────

const BASE    = 'http://localhost:3000'
const DB_CFG  = { host: '127.0.0.1', user: 'root', password: '1513cheng', database: 'flowcube' }
const TEST_PURCHASE_QTY = 50    // 采购入库数量
const TEST_SALE_QTY     = 20    // 销售出库数量
const TEST_TRANSFER_QTY = 10    // 调拨数量
const TEST_CHECK_QTY    = 3     // 盘点正差异（盘盈）
const TEST_PR_QTY       = 5     // 采购退货数量
const TEST_SR_QTY       = 4     // 销售退货数量

// ─── 工具函数 ─────────────────────────────────────────────────────────────────

let passed = 0
let failed = 0
let token  = ''
let db     = null

function log(msg)  { process.stdout.write(msg + '\n') }
function ok(label) { passed++; log(`  ✅ PASS  ${label}`) }
function fail(label, detail) {
  failed++
  log(`  ❌ FAIL  ${label}`)
  if (detail) log(`         → ${detail}`)
}

function assert(label, condition, detail = '') {
  condition ? ok(label) : fail(label, detail)
}

async function req(method, path, body, authToken) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null
    const options = {
      hostname: 'localhost',
      port: 3000,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      },
    }
    const r = http.request(options, res => {
      let data = ''
      res.on('data', c => { data += c })
      res.on('end', () => {
        try {
          const normalized = String(data).replace(/^\uFEFF/, '').trim()
          if (process.env.FLOWCUBE_DEBUG_JSON === '1') {
            console.warn('[integration] 响应 JSON 解析前 length=', normalized.length, 'preview=', normalized.slice(0, 400))
          }
          resolve({ status: res.statusCode, body: JSON.parse(normalized) })
        } catch (e) {
          console.error('[integration] JSON.parse 失败:', e && e.message, 'length=', data.length)
          console.error('[integration] 原始 data:', data.length > 4000 ? data.slice(0, 4000) + '…' : data)
          resolve({ status: res.statusCode, body: data })
        }
      })
    })
    r.on('error', reject)
    if (payload) r.write(payload)
    r.end()
  })
}

const GET    = (path)       => req('GET',    path, null, token)
const POST   = (path, body) => req('POST',   path, body, token)
const PUT    = (path, body) => req('PUT',    path, body, token)

async function dbQuery(sql, params = []) {
  const [rows] = await db.query(sql, params)
  return rows
}

// ─── 主测试流程 ───────────────────────────────────────────────────────────────

async function main() {
  log('\n════════════════════════════════════════════════════')
  log(' FlowCube 业务集成测试')
  log('════════════════════════════════════════════════════\n')

  // ── 初始化数据库连接 ────────────────────────────────────────────────────────
  try {
    // 动态加载 mysql2（使用 backend 目录下的依赖）
    const mysql2 = require('/Users/chengjianghao/flowcube/backend/node_modules/mysql2/promise')
    db = await mysql2.createConnection(DB_CFG)
    log('📦 数据库连接成功\n')
  } catch (e) {
    log(`❌ 数据库连接失败：${e.message}`)
    process.exit(1)
  }

  // ── 测试前清空所有交易数据（保留主数据）──────────────────────────────────
  log('─── 测试前清理 ─────────────────────────────────────')
  await db.query('SET FOREIGN_KEY_CHECKS=0')
  const CLEAN_TABLES = [
    'inventory_containers',
    'purchase_order_items','purchase_orders',
    'purchase_return_items','purchase_returns',
    'sale_order_items','sale_orders',
    'sale_return_items','sale_returns',
    'transfer_order_items','transfer_orders',
    'inventory_check_items','inventory_checks',
    'inventory_stock','inventory_logs','stock_reservations',
    'warehouse_task_items','warehouse_tasks',
    'payment_records','payment_entries','operation_logs',
    'system_health_logs','system_health_runs',
  ]
  for (const t of CLEAN_TABLES) await db.query(`TRUNCATE TABLE ${t}`)
  await db.query('SET FOREIGN_KEY_CHECKS=1')
  log('  ✅ 交易数据已清空，开始全新测试\n')

  // ──────────────────────────────────────────────────────────────────────────
  // STEP 1：登录
  // ──────────────────────────────────────────────────────────────────────────
  log('─── Step 1  登录 ───────────────────────────────────')
  try {
    const res = await req('POST', '/api/auth/login', { username: 'admin', password: 'admin123' })
    token = res.body?.data?.token
    assert('登录成功，获得 Token', !!token, `status=${res.status} body=${JSON.stringify(res.body).slice(0,100)}`)
  } catch (e) {
    fail('登录请求异常', e.message)
    await db.end(); process.exit(1)
  }

  // ──────────────────────────────────────────────────────────────────────────
  // STEP 2：获取主数据 IDs
  // ──────────────────────────────────────────────────────────────────────────
  log('\n─── Step 2  获取主数据 ─────────────────────────────')

  const [product]   = await dbQuery('SELECT id, code, name, unit FROM product_items WHERE deleted_at IS NULL LIMIT 1')
  const warehouses  = await dbQuery('SELECT id, name FROM inventory_warehouses WHERE deleted_at IS NULL AND is_active=1 LIMIT 2')
  const [supplier]  = await dbQuery('SELECT id, name FROM supply_suppliers WHERE deleted_at IS NULL LIMIT 1')
  const [customer]  = await dbQuery('SELECT id, name FROM sale_customers WHERE deleted_at IS NULL LIMIT 1')

  assert('存在可用商品',   !!product,         '请先创建商品')
  assert('存在至少2个仓库', warehouses.length >= 2, `当前仓库数：${warehouses.length}`)
  assert('存在可用供应商', !!supplier,        '请先创建供应商')
  assert('存在可用客户',   !!customer,        '请先创建客户')

  if (!product || warehouses.length < 2 || !supplier || !customer) {
    log('\n⚠️  主数据不足，终止测试')
    await db.end(); return summary()
  }

  const wh1 = warehouses[0]  // 主仓库（采购/销售/盘点/退货）
  const wh2 = warehouses[1]  // 目标仓库（调拨）

  log(`   商品: [${product.id}] ${product.name}（${product.unit}）`)
  log(`   源仓库: [${wh1.id}] ${wh1.name}`)
  log(`   目标仓库: [${wh2.id}] ${wh2.name}`)
  log(`   供应商: [${supplier.id}] ${supplier.name}`)
  log(`   客户: [${customer.id}] ${customer.name}`)

  // ──────────────────────────────────────────────────────────────────────────
  // STEP 3：采购 - 创建 → 确认 → 收货（入库）
  // ──────────────────────────────────────────────────────────────────────────
  log('\n─── Step 3  采购入库 ───────────────────────────────')

  // 记录入库前状态（以容器 sum 为基准，不依赖可能 stale 的 inventory_stock 缓存）
  const containersBefore = await dbQuery(
    'SELECT COUNT(*) AS cnt, COALESCE(SUM(remaining_qty),0) AS total FROM inventory_containers WHERE product_id=? AND warehouse_id=? AND status=1',
    [product.id, wh1.id]
  )
  const stockBefore = Number(containersBefore[0].total)   // 容器 sum = 真实基准
  log(`   入库前：容器sum=${stockBefore}, 活跃容器数=${containersBefore[0].cnt}`)

  // 创建采购单
  let poId, poNo
  try {
    const res = await POST('/api/purchase', {
      supplierId: supplier.id, supplierName: supplier.name,
      warehouseId: wh1.id, warehouseName: wh1.name,
      expectedDate: new Date(Date.now() + 7*86400000).toISOString().slice(0,10),
      remark: '集成测试采购单',
      items: [{ productId: product.id, productCode: product.code, productName: product.name, unit: product.unit, quantity: TEST_PURCHASE_QTY, unitPrice: 10 }]
    })
    poId = res.body?.data?.id
    poNo = res.body?.data?.orderNo
    assert(`创建采购单 ${poNo}`, res.status === 201 && !!poId)
  } catch(e) { fail('创建采购单异常', e.message) }

  // 确认采购单
  if (poId) {
    const res = await POST(`/api/purchase/${poId}/confirm`)
    assert('确认采购单', res.body?.success === true)
  }

  // 收货（触发 createContainer + syncStockFromContainers）
  if (poId) {
    const res = await POST(`/api/purchase/${poId}/receive`)
    assert('采购收货成功', res.body?.success === true, JSON.stringify(res.body).slice(0,150))
  }

  // ── 校验入库后容器 ──
  const containersAfter = await dbQuery(
    `SELECT id, barcode, initial_qty, remaining_qty, status, source_ref_no
     FROM inventory_containers
     WHERE product_id=? AND warehouse_id=? AND source_ref_no=?`,
    [product.id, wh1.id, poNo]
  )
  assert(
    `入库后生成容器记录（source_ref_no=${poNo}）`,
    containersAfter.length > 0,
    `找到 ${containersAfter.length} 条`
  )
  const newContainer = containersAfter[0]
  if (newContainer) {
    assert(
      `容器 initial_qty = ${TEST_PURCHASE_QTY}`,
      Number(newContainer.initial_qty) === TEST_PURCHASE_QTY,
      `实际 initial_qty=${newContainer.initial_qty}`
    )
    assert(
      `容器 remaining_qty = ${TEST_PURCHASE_QTY}`,
      Number(newContainer.remaining_qty) === TEST_PURCHASE_QTY,
      `实际 remaining_qty=${newContainer.remaining_qty}`
    )
    assert('容器 status = 1 (ACTIVE)', Number(newContainer.status) === 1)
    log(`   新容器 barcode: ${newContainer.barcode}`)
  }

  // 校验 inventory_stock 缓存
  const [stockAfterPO] = await dbQuery(
    'SELECT quantity FROM inventory_stock WHERE product_id=? AND warehouse_id=?',
    [product.id, wh1.id]
  )
  const expectedStockAfterPO = stockBefore + TEST_PURCHASE_QTY
  assert(
    `inventory_stock.quantity = ${stockBefore} + ${TEST_PURCHASE_QTY} = ${expectedStockAfterPO}`,
    stockAfterPO && Number(stockAfterPO.quantity) === expectedStockAfterPO,
    `实际 quantity=${stockAfterPO?.quantity}`
  )

  // 校验 inventory_logs
  const [logPO] = await dbQuery(
    'SELECT * FROM inventory_logs WHERE ref_type=? AND ref_no=? AND move_type=1 ORDER BY id DESC LIMIT 1',
    ['purchase_order', poNo]
  )
  assert('inventory_logs 有采购入库记录（move_type=1）', !!logPO)
  if (logPO) {
    assert(`日志 quantity = ${TEST_PURCHASE_QTY}`, Number(logPO.quantity) === TEST_PURCHASE_QTY)
    assert(`日志 after_qty = ${expectedStockAfterPO}`, Number(logPO.after_qty) === expectedStockAfterPO)
  }

  // ──────────────────────────────────────────────────────────────────────────
  // STEP 4：销售单 - 创建 → 确认（库存预占）
  // ──────────────────────────────────────────────────────────────────────────
  log('\n─── Step 4  销售确认（库存预占）───────────────────')

  const [stockBeforeSale] = await dbQuery(
    'SELECT quantity, COALESCE(reserved,0) AS reserved FROM inventory_stock WHERE product_id=? AND warehouse_id=?',
    [product.id, wh1.id]
  )
  const reservedBefore = stockBeforeSale ? Number(stockBeforeSale.reserved) : 0
  log(`   确认前：quantity=${stockBeforeSale?.quantity}, reserved=${reservedBefore}`)

  let soId, soNo
  try {
    const res = await POST('/api/sale', {
      customerId: customer.id, customerName: customer.name,
      warehouseId: wh1.id, warehouseName: wh1.name,
      remark: '集成测试销售单',
      items: [{ productId: product.id, productCode: product.code, productName: product.name, unit: product.unit, quantity: TEST_SALE_QTY, unitPrice: 15 }]
    })
    soId = res.body?.data?.id
    soNo = res.body?.data?.orderNo
    assert(`创建销售单 ${soNo}`, res.status === 201 && !!soId)
  } catch(e) { fail('创建销售单异常', e.message) }

  if (soId) {
    const res = await POST(`/api/sale/${soId}/confirm`)
    assert('确认销售单成功', res.body?.success === true, JSON.stringify(res.body).slice(0,150))
  }

  // 校验 reserved 增加
  const [stockAfterConfirm] = await dbQuery(
    'SELECT quantity, COALESCE(reserved,0) AS reserved FROM inventory_stock WHERE product_id=? AND warehouse_id=?',
    [product.id, wh1.id]
  )
  const reservedAfterConfirm = stockAfterConfirm ? Number(stockAfterConfirm.reserved) : 0
  assert(
    `reserved 增加 ${TEST_SALE_QTY}（${reservedBefore} → ${reservedBefore + TEST_SALE_QTY}）`,
    reservedAfterConfirm === reservedBefore + TEST_SALE_QTY,
    `实际 reserved=${reservedAfterConfirm}`
  )

  // 校验 stock_reservations
  const [reservation] = await dbQuery(
    'SELECT * FROM stock_reservations WHERE ref_type=? AND ref_id=? AND product_id=? AND status=1',
    ['sale_order', soId, product.id]
  )
  assert('stock_reservations 有预占记录（status=1）', !!reservation)
  if (reservation) {
    assert(
      `预占 qty = ${TEST_SALE_QTY}`,
      Number(reservation.qty) === TEST_SALE_QTY,
      `实际 qty=${reservation.qty}`
    )
  }

  // ──────────────────────────────────────────────────────────────────────────
  // STEP 5：仓库任务出库
  // ──────────────────────────────────────────────────────────────────────────
  log('\n─── Step 5  仓库任务出库 ───────────────────────────')

  // 销售确认后自动生成仓库任务，查找
  let taskId
  if (soId) {
    const [saleOrder] = await dbQuery('SELECT task_id FROM sale_orders WHERE id=?', [soId])
    taskId = saleOrder?.task_id
    assert(`销售确认后自动生成仓库任务（task_id=${taskId}）`, !!taskId)
  }

  // 执行任务出库流程：待分配→备货中→待出库→已出库
  if (taskId) {
    await PUT(`/api/warehouse-tasks/${taskId}/start-picking`)
    await PUT(`/api/warehouse-tasks/${taskId}/ready`)
    const res = await PUT(`/api/warehouse-tasks/${taskId}/ship`)
    assert('仓库任务出库成功', res.body?.success === true, JSON.stringify(res.body).slice(0,150))
  }

  // 校验容器 FIFO 扣减
  const containersAfterShip = await dbQuery(
    `SELECT id, remaining_qty, status FROM inventory_containers
     WHERE product_id=? AND warehouse_id=? AND source_ref_no=?`,
    [product.id, wh1.id, poNo]
  )
  if (containersAfterShip.length > 0) {
    const c = containersAfterShip[0]
    const expectedRemaining = TEST_PURCHASE_QTY - TEST_SALE_QTY
    assert(
      `出库后容器 remaining_qty = ${TEST_PURCHASE_QTY} - ${TEST_SALE_QTY} = ${expectedRemaining}`,
      Number(c.remaining_qty) === expectedRemaining,
      `实际 remaining_qty=${c.remaining_qty}`
    )
    assert(
      `出库后容器 status = ${expectedRemaining > 0 ? '1(ACTIVE)' : '2(EMPTY)'}`,
      Number(c.status) === (expectedRemaining > 0 ? 1 : 2)
    )
  }

  // 校验 inventory_stock 缓存已更新
  const [stockAfterShip] = await dbQuery(
    'SELECT quantity, COALESCE(reserved,0) AS reserved FROM inventory_stock WHERE product_id=? AND warehouse_id=?',
    [product.id, wh1.id]
  )
  const expectedQtyAfterShip = expectedStockAfterPO - TEST_SALE_QTY
  assert(
    `出库后 inventory_stock.quantity = ${expectedQtyAfterShip}`,
    stockAfterShip && Number(stockAfterShip.quantity) === expectedQtyAfterShip,
    `实际 quantity=${stockAfterShip?.quantity}`
  )
  assert(
    `出库后 reserved = ${reservedBefore}（预占已释放）`,
    stockAfterShip && Number(stockAfterShip.reserved) === reservedBefore,
    `实际 reserved=${stockAfterShip?.reserved}`
  )

  // 校验 stock_reservations 变为 fulfilled
  const [resAfterShip] = await dbQuery(
    'SELECT status FROM stock_reservations WHERE ref_type=? AND ref_id=? AND product_id=?',
    ['sale_order', soId, product.id]
  )
  assert('stock_reservations status=2（已履行）', resAfterShip && Number(resAfterShip.status) === 2, `实际 status=${resAfterShip?.status}`)

  // 校验 inventory_logs 出库记录
  const [logShip] = await dbQuery(
    'SELECT * FROM inventory_logs WHERE ref_type=? AND ref_id=? AND move_type=8 ORDER BY id DESC LIMIT 1',
    ['warehouse_task', taskId]
  )
  assert('inventory_logs 有任务出库记录（move_type=8）', !!logShip)

  // ──────────────────────────────────────────────────────────────────────────
  // STEP 6：调拨 - 创建 → 确认 → 执行
  // ──────────────────────────────────────────────────────────────────────────
  log('\n─── Step 6  调拨 ───────────────────────────────────')

  const [wh1StockBeforeTransfer] = await dbQuery(
    'SELECT quantity FROM inventory_stock WHERE product_id=? AND warehouse_id=?',
    [product.id, wh1.id]
  )
  const [wh2StockBeforeTransfer] = await dbQuery(
    'SELECT COALESCE(quantity,0) AS quantity FROM inventory_stock WHERE product_id=? AND warehouse_id=?',
    [product.id, wh2.id]
  )
  const wh1BeforeTr = wh1StockBeforeTransfer ? Number(wh1StockBeforeTransfer.quantity) : 0
  const wh2BeforeTr = wh2StockBeforeTransfer ? Number(wh2StockBeforeTransfer.quantity) : 0
  log(`   调拨前：wh1.quantity=${wh1BeforeTr}, wh2.quantity=${wh2BeforeTr}`)

  let trId, trNo
  try {
    const res = await POST('/api/transfer', {
      fromWarehouseId: wh1.id, fromWarehouseName: wh1.name,
      toWarehouseId: wh2.id, toWarehouseName: wh2.name,
      remark: '集成测试调拨单',
      items: [{ productId: product.id, productCode: product.code, productName: product.name, unit: product.unit, quantity: TEST_TRANSFER_QTY }]
    })
    trId = res.body?.data?.id
    trNo = res.body?.data?.orderNo
    assert(`创建调拨单 ${trNo}`, res.status === 201 && !!trId)
  } catch(e) { fail('创建调拨单异常', e.message) }

  if (trId) {
    await POST(`/api/transfer/${trId}/confirm`)
    const res = await POST(`/api/transfer/${trId}/execute`)
    assert('调拨执行成功', res.body?.success === true, JSON.stringify(res.body).slice(0,150))
  }

  // 校验源仓库库存减少
  const [wh1AfterTr] = await dbQuery(
    'SELECT quantity FROM inventory_stock WHERE product_id=? AND warehouse_id=?',
    [product.id, wh1.id]
  )
  assert(
    `源仓库 quantity = ${wh1BeforeTr} - ${TEST_TRANSFER_QTY} = ${wh1BeforeTr - TEST_TRANSFER_QTY}`,
    wh1AfterTr && Number(wh1AfterTr.quantity) === wh1BeforeTr - TEST_TRANSFER_QTY,
    `实际=${wh1AfterTr?.quantity}`
  )

  // 校验目标仓库库存增加
  const [wh2AfterTr] = await dbQuery(
    'SELECT quantity FROM inventory_stock WHERE product_id=? AND warehouse_id=?',
    [product.id, wh2.id]
  )
  assert(
    `目标仓库 quantity = ${wh2BeforeTr} + ${TEST_TRANSFER_QTY} = ${wh2BeforeTr + TEST_TRANSFER_QTY}`,
    wh2AfterTr && Number(wh2AfterTr.quantity) === wh2BeforeTr + TEST_TRANSFER_QTY,
    `实际=${wh2AfterTr?.quantity}`
  )

  // 校验目标仓库新容器（保留批次）
  const wh2Containers = await dbQuery(
    'SELECT id, remaining_qty, batch_no, source_ref_no FROM inventory_containers WHERE product_id=? AND warehouse_id=? AND source_ref_no=?',
    [product.id, wh2.id, trNo]
  )
  assert(`目标仓库生成容器（source_ref_no=${trNo}）`, wh2Containers.length > 0)

  // 校验调拨日志：TRANSFER_OUT(4) 和 TRANSFER_IN(5)
  const [logTrOut] = await dbQuery(
    'SELECT id FROM inventory_logs WHERE ref_no=? AND move_type=4',
    [trNo]
  )
  const [logTrIn] = await dbQuery(
    'SELECT id FROM inventory_logs WHERE ref_no=? AND move_type=5',
    [trNo]
  )
  assert('inventory_logs 有调拨出记录（move_type=4）', !!logTrOut)
  assert('inventory_logs 有调拨入记录（move_type=5）', !!logTrIn)

  // ──────────────────────────────────────────────────────────────────────────
  // STEP 7：盘点 - 创建 → 填实盘 → 提交（盘盈 +TEST_CHECK_QTY）
  // ──────────────────────────────────────────────────────────────────────────
  log('\n─── Step 7  盘点（盘盈）────────────────────────────')

  const [stockBeforeCheck] = await dbQuery(
    'SELECT quantity FROM inventory_stock WHERE product_id=? AND warehouse_id=?',
    [product.id, wh1.id]
  )
  const qtyBeforeCheck = stockBeforeCheck ? Number(stockBeforeCheck.quantity) : 0
  log(`   盘点前：wh1.quantity=${qtyBeforeCheck}`)

  let checkId
  try {
    const res = await POST('/api/stockcheck', {
      warehouseId: wh1.id, warehouseName: wh1.name,
      remark: '集成测试盘点单',
    })
    checkId = res.body?.data?.id
    assert(`创建盘点单`, res.status === 201 && !!checkId)
  } catch(e) { fail('创建盘点单异常', e.message) }

  if (checkId) {
    // 查询盘点明细
    const checkDetail = await GET(`/api/stockcheck/${checkId}`)
    const items = checkDetail.body?.data?.items || []
    const targetItem = items.find(i => i.productId === product.id)
    assert(`盘点单含目标商品 [${product.id}]`, !!targetItem)

    if (targetItem) {
      // 填写实盘（盘盈：实盘 = 账面 + TEST_CHECK_QTY）
      const actualQty = Number(targetItem.bookQty) + TEST_CHECK_QTY
      const res = await PUT(`/api/stockcheck/${checkId}/items`, {
        items: [{ id: targetItem.id, actualQty }]
      })
      assert(`填写实盘数量（bookQty=${targetItem.bookQty}, actualQty=${actualQty}）`, res.body?.success === true)

      // 提交盘点
      const submitRes = await POST(`/api/stockcheck/${checkId}/submit`)
      assert('盘点提交成功', submitRes.body?.success === true, JSON.stringify(submitRes.body).slice(0,150))
    }
  }

  // 校验盘点后库存 +TEST_CHECK_QTY
  const [stockAfterCheck] = await dbQuery(
    'SELECT quantity FROM inventory_stock WHERE product_id=? AND warehouse_id=?',
    [product.id, wh1.id]
  )
  assert(
    `盘点后 inventory_stock.quantity = ${qtyBeforeCheck} + ${TEST_CHECK_QTY} = ${qtyBeforeCheck + TEST_CHECK_QTY}`,
    stockAfterCheck && Number(stockAfterCheck.quantity) === qtyBeforeCheck + TEST_CHECK_QTY,
    `实际=${stockAfterCheck?.quantity}`
  )

  // 校验盘盈容器（盘盈创建新容器）
  const checkContainers = await dbQuery(
    "SELECT remaining_qty FROM inventory_containers WHERE product_id=? AND warehouse_id=? AND source_ref_type='stockcheck' ORDER BY id DESC LIMIT 1",
    [product.id, wh1.id]
  )
  assert(
    `盘盈创建新容器 remaining_qty=${TEST_CHECK_QTY}`,
    checkContainers.length > 0 && Number(checkContainers[0].remaining_qty) === TEST_CHECK_QTY,
    `实际=${checkContainers[0]?.remaining_qty}`
  )

  // 校验盘点日志（move_type=3）
  const [logCheck] = await dbQuery(
    'SELECT id, quantity FROM inventory_logs WHERE move_type=3 ORDER BY id DESC LIMIT 1'
  )
  assert('inventory_logs 有盘点调整记录（move_type=3）', !!logCheck)

  // ──────────────────────────────────────────────────────────────────────────
  // STEP 8：采购退货 - 创建 → 确认 → 执行（库存出库）
  // ──────────────────────────────────────────────────────────────────────────
  log('\n─── Step 8  采购退货 ───────────────────────────────')

  const [stockBeforePR] = await dbQuery(
    'SELECT quantity FROM inventory_stock WHERE product_id=? AND warehouse_id=?',
    [product.id, wh1.id]
  )
  const qtyBeforePR = stockBeforePR ? Number(stockBeforePR.quantity) : 0
  log(`   采购退货前：wh1.quantity=${qtyBeforePR}`)

  let prId, prNo
  try {
    const res = await POST('/api/returns/purchase', {
      supplierId: supplier.id, supplierName: supplier.name,
      warehouseId: wh1.id, warehouseName: wh1.name,
      purchaseOrderNo: poNo,
      remark: '集成测试采购退货',
      items: [{ productId: product.id, productCode: product.code, productName: product.name, unit: product.unit, quantity: TEST_PR_QTY, unitPrice: 10 }]
    })
    prId = res.body?.data?.id
    prNo = res.body?.data?.returnNo
    assert(`创建采购退货单 ${prNo}`, res.status === 201 && !!prId)
  } catch(e) { fail('创建采购退货单异常', e.message) }

  if (prId) {
    await POST(`/api/returns/purchase/${prId}/confirm`)
    const res = await POST(`/api/returns/purchase/${prId}/execute`)
    assert('采购退货执行成功', res.body?.success === true, JSON.stringify(res.body).slice(0,150))
  }

  // 校验库存减少
  const [stockAfterPR] = await dbQuery(
    'SELECT quantity FROM inventory_stock WHERE product_id=? AND warehouse_id=?',
    [product.id, wh1.id]
  )
  assert(
    `采购退货后 quantity = ${qtyBeforePR} - ${TEST_PR_QTY} = ${qtyBeforePR - TEST_PR_QTY}`,
    stockAfterPR && Number(stockAfterPR.quantity) === qtyBeforePR - TEST_PR_QTY,
    `实际=${stockAfterPR?.quantity}`
  )

  // 校验容器总和与缓存一致
  const [containerSumPR] = await dbQuery(
    'SELECT COALESCE(SUM(remaining_qty),0) AS total FROM inventory_containers WHERE product_id=? AND warehouse_id=? AND status=1',
    [product.id, wh1.id]
  )
  assert(
    `容器总量 = inventory_stock.quantity（${stockAfterPR?.quantity}）`,
    Math.abs(Number(containerSumPR.total) - Number(stockAfterPR?.quantity ?? 0)) < 0.0001,
    `容器sum=${containerSumPR.total} vs stock=${stockAfterPR?.quantity}`
  )

  // 校验采购退货日志（move_type=6）
  const [logPR] = await dbQuery(
    'SELECT id FROM inventory_logs WHERE move_type=6 ORDER BY id DESC LIMIT 1'
  )
  assert('inventory_logs 有采购退货出库记录（move_type=6）', !!logPR)

  // ──────────────────────────────────────────────────────────────────────────
  // STEP 9：销售退货 - 创建 → 确认 → 执行（库存入库）
  // ──────────────────────────────────────────────────────────────────────────
  log('\n─── Step 9  销售退货 ───────────────────────────────')

  const [stockBeforeSR] = await dbQuery(
    'SELECT quantity FROM inventory_stock WHERE product_id=? AND warehouse_id=?',
    [product.id, wh1.id]
  )
  const qtyBeforeSR = stockBeforeSR ? Number(stockBeforeSR.quantity) : 0
  log(`   销售退货前：wh1.quantity=${qtyBeforeSR}`)

  let srId, srNo
  try {
    const res = await POST('/api/returns/sale', {
      customerId: customer.id, customerName: customer.name,
      warehouseId: wh1.id, warehouseName: wh1.name,
      saleOrderNo: soNo,
      remark: '集成测试销售退货',
      items: [{ productId: product.id, productCode: product.code, productName: product.name, unit: product.unit, quantity: TEST_SR_QTY, unitPrice: 15 }]
    })
    srId = res.body?.data?.id
    srNo = res.body?.data?.returnNo
    assert(`创建销售退货单 ${srNo}`, res.status === 201 && !!srId)
  } catch(e) { fail('创建销售退货单异常', e.message) }

  if (srId) {
    await POST(`/api/returns/sale/${srId}/confirm`)
    const res = await POST(`/api/returns/sale/${srId}/execute`)
    assert('销售退货执行成功', res.body?.success === true, JSON.stringify(res.body).slice(0,150))
  }

  // 校验库存增加（销售退货入库）
  const [stockAfterSR] = await dbQuery(
    'SELECT quantity FROM inventory_stock WHERE product_id=? AND warehouse_id=?',
    [product.id, wh1.id]
  )
  assert(
    `销售退货后 quantity = ${qtyBeforeSR} + ${TEST_SR_QTY} = ${qtyBeforeSR + TEST_SR_QTY}`,
    stockAfterSR && Number(stockAfterSR.quantity) === qtyBeforeSR + TEST_SR_QTY,
    `实际=${stockAfterSR?.quantity}`
  )

  // 校验销售退货新容器
  const srContainers = await dbQuery(
    "SELECT remaining_qty FROM inventory_containers WHERE product_id=? AND warehouse_id=? AND source_ref_type='sale_return' ORDER BY id DESC LIMIT 1",
    [product.id, wh1.id]
  )
  assert(
    `销售退货创建新容器 remaining_qty=${TEST_SR_QTY}`,
    srContainers.length > 0 && Number(srContainers[0].remaining_qty) === TEST_SR_QTY,
    `实际=${srContainers[0]?.remaining_qty}`
  )

  // 容器总量 = 缓存最终一致性校验
  const [containerSumFinal] = await dbQuery(
    'SELECT COALESCE(SUM(remaining_qty),0) AS total FROM inventory_containers WHERE product_id=? AND warehouse_id=? AND status=1',
    [product.id, wh1.id]
  )
  assert(
    `最终容器总量 = inventory_stock.quantity（${stockAfterSR?.quantity}）`,
    Math.abs(Number(containerSumFinal.total) - Number(stockAfterSR?.quantity ?? 0)) < 0.0001,
    `容器sum=${containerSumFinal.total} vs stock=${stockAfterSR?.quantity}`
  )

  // 校验销售退货日志（move_type=7）
  const [logSR] = await dbQuery(
    'SELECT id FROM inventory_logs WHERE move_type=7 ORDER BY id DESC LIMIT 1'
  )
  assert('inventory_logs 有销售退货入库记录（move_type=7）', !!logSR)

  // ──────────────────────────────────────────────────────────────────────────
  // STEP 10：最终一致性全局校验
  // ──────────────────────────────────────────────────────────────────────────
  log('\n─── Step 10 全局一致性校验 ─────────────────────────')

  // 全仓库：验证 inventory_stock.quantity = SUM(container.remaining_qty)
  const inconsistencies = await dbQuery(`
    SELECT s.product_id, s.warehouse_id,
           s.quantity AS cached_qty,
           COALESCE(SUM(c.remaining_qty),0) AS container_sum
    FROM inventory_stock s
    LEFT JOIN inventory_containers c
      ON c.product_id=s.product_id AND c.warehouse_id=s.warehouse_id AND c.status=1 AND c.deleted_at IS NULL
    GROUP BY s.product_id, s.warehouse_id
    HAVING ABS(cached_qty - container_sum) > 0.0001
  `)
  assert(
    `全局：inventory_stock 与容器总量完全一致（不一致行数=0）`,
    inconsistencies.length === 0,
    `不一致行数=${inconsistencies.length}：${JSON.stringify(inconsistencies)}`
  )

  // 全局：没有 on_hand < 0
  const negativeStock = await dbQuery('SELECT COUNT(*) AS cnt FROM inventory_stock WHERE quantity < 0')
  assert('全局：无负库存（quantity >= 0）', Number(negativeStock[0].cnt) === 0)

  // 全局：没有 reserved > quantity
  const overReserved = await dbQuery('SELECT COUNT(*) AS cnt FROM inventory_stock WHERE reserved > quantity')
  assert('全局：无 reserved > quantity', Number(overReserved[0].cnt) === 0)

  // 全局：没有 remaining_qty < 0 的容器
  const negativeContainer = await dbQuery('SELECT COUNT(*) AS cnt FROM inventory_containers WHERE remaining_qty < 0')
  assert('全局：无 remaining_qty < 0 的容器', Number(negativeContainer[0].cnt) === 0)

  await db.end()
  summary()
}

function summary() {
  const total = passed + failed
  log('\n════════════════════════════════════════════════════')
  log(` 测试结果汇总`)
  log('────────────────────────────────────────────────────')
  log(` 总计：${total}  通过：${passed}  失败：${failed}`)
  log(` 通过率：${total > 0 ? ((passed / total) * 100).toFixed(1) : 0}%`)
  log('════════════════════════════════════════════════════\n')
  process.exit(failed > 0 ? 1 : 0)
}

main().catch(async e => {
  log(`\n💥 未捕获异常：${e.message}\n${e.stack}`)
  if (db) await db.end()
  process.exit(1)
})
