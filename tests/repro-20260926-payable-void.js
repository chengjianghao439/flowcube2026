#!/usr/bin/env node
'use strict'

/**
 * 复现脚本（2026-09-26 一致性审查 · 证据）——**不是回归测试，请勿当作断言套件使用**
 *
 * 命题：收货订单上架后自动结算生成的「应付账款」，可以在**已登记付款之后**
 *       被「撤回收货」整单抹平：total_amount 归零、balance 归零、status 变「已付清(3)」，
 *       而 paid_amount（真金白银付出去的钱）原样保留，付款明细与资金流水也不回滚。
 *       结果是一张「付了 5000、应付 0、余额 0、已付清」的自相矛盾账款记录。
 *
 * 三段验证：
 *   §A 主链：结算(5000) → 财务确认 → 全额付款(5000) → 撤回收货 → 观测账款记录
 *   §B 危害放大：撤回后按短装重新收货上架，只收到 2000 的货
 *                → 多付的 3000 在 balance/status 上完全不可见（账面显示「已付清」）
 *   §C 触发面：从未付过一分钱的收货单，撤回收货后同样被标成「已付清(3)」
 *
 * ⚠ 本脚本断言的是「修复前的错误行为」，故在任务 2 守卫（层 2）与数值修复（层 1）
 *    上线后**必然失败**——这是修复生效的反向证据，不是脚本坏了。注意 §B 的前提
 *    （先撤回再短装重收）在守卫上线后已不可达，该段会在 §A 处即中止。
 *    要保持通过的回归套件见 tests/payable-void-guard.smoke.test.js（21/21 通过）。
 *
 * 本脚本不改业务代码，只在独立测试库上走真实 HTTP 链路并打印事实。
 * 运行：
 *   set -a; source ~/.config/flowcube/operations20260912-test.env; set +a
 *   node tests/repro-20260926-payable-void.js
 */

const {
  createLogger, prepareSmokeContext, dbQuery, login, randomRef,
} = require('./helpers/smokeTestKit')

const QTY = 10
const PRICE = 500          // 10 × 500 = 5000
const PAY_AMOUNT = 5000
const SHORT_QTY = 4        // §B 短装重收量 → 4 × 500 = 2000

async function createProduct(pool, label) {
  const code = randomRef(`REPRO-PV-${label}`).slice(0, 40)
  const [r] = await pool.query(
    "INSERT INTO product_items (code, name, unit, sale_price_a, cost_price) VALUES (?, ?, '个', 600, 500)",
    [code, `PV复现商品-${label}`],
  )
  return { id: r.insertId, code, name: `PV复现商品-${label}`, unit: '个' }
}

async function seedPurchase(http, token, { supplier, warehouse, product, quantity, unitPrice }) {
  const resp = await http.post('/api/purchase', {
    token,
    json: {
      supplierId: supplier.id,
      supplierName: supplier.name,
      warehouseId: warehouse.id,
      warehouseName: warehouse.name,
      items: [{
        productId: product.id,
        productCode: product.code,
        productName: product.name,
        unit: product.unit,
        quantity,
        unitPrice,
      }],
    },
  })
  const poId = Number(resp.data?.data?.id)
  if (!Number.isFinite(poId) || poId <= 0) throw new Error(`建采购单失败: ${JSON.stringify(resp.data)}`)
  await http.post(`/api/purchase/${poId}/confirm`, { token })
  return poId
}

const money = v => `¥${Number(v ?? 0).toFixed(2)}`
const STATUS_TEXT = { 1: '待付款', 2: '部分付款', 3: '已付清' }
const fmtRecord = (r) => r
  ? `总额=${money(r.total_amount)} 已付=${money(r.paid_amount)} 余额=${money(r.balance)} `
    + `状态=${Number(r.status)}(${STATUS_TEXT[Number(r.status)] || '?'}) 财务确认=${Number(r.confirm_status)}`
  : '(无应付记录)'

const payableOf = async (pool, poId) => {
  const [row] = await dbQuery(
    pool,
    'SELECT id, total_amount, paid_amount, balance, status, confirm_status FROM payment_records WHERE type=1 AND order_id=?',
    [poId],
  )
  return row || null
}

const openTaskOf = async (pool, poId) => {
  const [row] = await dbQuery(
    pool,
    `SELECT id, task_no, status, audit_status FROM inbound_tasks
      WHERE purchase_order_id=? AND deleted_at IS NULL ORDER BY id DESC LIMIT 1`,
    [poId],
  )
  return row || null
}

/** 收货 → （必要时短装结案）→ 上架，返回上架后的任务行 */
async function receiveAndPutaway(ctx, token, { taskId, product, locationId, qty }) {
  const { http, pool, pdaHeaders } = ctx
  const recv = await http.post(`/api/inbound-tasks/${taskId}/receive`, {
    token, headers: pdaHeaders(), json: { productId: Number(product.id), packages: [{ qty }] },
  })
  if (!recv.ok) throw new Error(`收货失败: ${JSON.stringify(recv.data)}`)

  let [task] = await dbQuery(pool, 'SELECT status FROM inbound_tasks WHERE id=?', [taskId])
  // 短装时收不满，任务停在「收货中(2)」；规则收紧后必须先「短装结案」才允许上架
  if (Number(task.status) === 2) {
    const close = await http.post(`/api/inbound-tasks/${taskId}/close-receiving`, { token })
    if (!close.ok) throw new Error(`短装结案失败: ${JSON.stringify(close.data)}`)
  }

  const [box] = await dbQuery(
    pool,
    `SELECT id FROM inventory_containers
      WHERE inbound_task_id=? AND deleted_at IS NULL AND status=4 ORDER BY id`,
    [taskId],
  )
  if (!box) throw new Error('未找到待上架容器')
  const put = await http.post(`/api/inbound-tasks/${taskId}/putaway`, {
    token, headers: pdaHeaders(), json: { containerId: Number(box.id), locationId: Number(locationId) },
  })
  if (!put.ok) throw new Error(`上架失败: ${JSON.stringify(put.data)}`)
  const [after] = await dbQuery(pool, 'SELECT status, audit_status FROM inbound_tasks WHERE id=?', [taskId])
  return after
}

async function main() {
  const log = createLogger()
  const ctx = await prepareSmokeContext()
  const { pool, http, warehouse, location, supplier } = ctx
  const cleanup = { productIds: [], poIds: [] }
  let step = 'init'

  try {
    const adminLogin = await login(http, 'smoke_admin', 'SmokeAdmin123!')
    const token = adminLogin.token
    if (!token) throw new Error('smoke_admin 登录失败')

    // ══════════════════════════════════════════════════════════════════
    // §A 主链：结算 → 确认 → 全额付款 → 撤回收货
    // ══════════════════════════════════════════════════════════════════
    log.section('§A 已付款的收货单被撤回收货')
    step = 'A:seed'
    const productA = await createProduct(pool, 'A')
    cleanup.productIds.push(productA.id)
    const poA = await seedPurchase(http, token, {
      supplier, warehouse, product: productA, quantity: QTY, unitPrice: PRICE,
    })
    cleanup.poIds.push(poA)

    step = 'A:create-task'
    const taskResp = await http.post('/api/inbound-tasks', { token, json: { poId: poA } })
    const taskA = Number(taskResp.data?.data?.taskId)
    if (!Number.isFinite(taskA) || taskA <= 0) throw new Error(`建收货单失败: ${JSON.stringify(taskResp.data)}`)
    await http.post(`/api/inbound-tasks/${taskA}/submit`, { token })

    step = 'A:receive-putaway'
    const afterPut = await receiveAndPutaway(ctx, token, {
      taskId: taskA, product: productA, locationId: location.id, qty: QTY,
    })
    console.log(`\n[收货上架后] 任务 status=${afterPut.status}（4=已完成） audit_status=${afterPut.audit_status}（1=已结算）`)

    step = 'A:payable-after-settle'
    const recSettled = await payableOf(pool, poA)
    console.log(`[自动结算后] 应付：${fmtRecord(recSettled)}`)
    log.assert(
      '上架后自动结算生成应付 5000',
      recSettled && Math.abs(Number(recSettled.total_amount) - QTY * PRICE) < 0.01,
      fmtRecord(recSettled),
    )

    step = 'A:confirm'
    if (!recSettled) throw new Error('未生成应付记录，无法继续')
    const confirmResp = await http.post(`/api/payments/${recSettled.id}/confirm`, { token })
    log.assert('财务确认成功', confirmResp.ok, JSON.stringify(confirmResp.data).slice(0, 160))

    step = 'A:pay'
    const payResp = await http.post(`/api/payments/${recSettled.id}/pay`, {
      token,
      json: { amount: PAY_AMOUNT, paymentDate: '2026-09-26', method: '转账', remark: '复现脚本付款' },
    })
    log.assert('登记付款成功', payResp.ok, JSON.stringify(payResp.data).slice(0, 200))

    step = 'A:read-after-pay'
    const recPaid = await payableOf(pool, poA)
    const entries = await dbQuery(
      pool, 'SELECT amount FROM payment_entries WHERE record_id=? ORDER BY id', [recSettled.id],
    )
    console.log(`[付款后] 应付：${fmtRecord(recPaid)}`)
    console.log(`[付款后] 付款明细 ${entries.length} 笔，合计 ${money(entries.reduce((s, e) => s + Number(e.amount), 0))}`)
    log.assert(
      '付款后账款显示「已付清」',
      recPaid && Number(recPaid.status) === 3 && Math.abs(Number(recPaid.paid_amount) - PAY_AMOUNT) < 0.01,
      fmtRecord(recPaid),
    )

    // ── 撤回收货 ──────────────────────────────────────────────────────
    step = 'A:void'
    const voidResp = await http.post(`/api/inbound-tasks/${taskA}/void-receipt`, { token })
    console.log(`\n[撤回收货] HTTP ${voidResp.status} ${JSON.stringify(voidResp.data).slice(0, 200)}`)
    log.assert('撤回收货请求被接受（无任何「已付款」拦截）', voidResp.ok, JSON.stringify(voidResp.data).slice(0, 200))

    step = 'A:read-after-void'
    const recVoided = await payableOf(pool, poA)
    const entriesAfter = await dbQuery(
      pool, 'SELECT amount FROM payment_entries WHERE record_id=? ORDER BY id', [recSettled.id],
    )
    console.log(`[撤回后] 应付：${fmtRecord(recVoided)}`)
    console.log(`[撤回后] 付款明细仍为 ${entriesAfter.length} 笔，合计 ${money(entriesAfter.reduce((s, e) => s + Number(e.amount), 0))}`)

    log.assert(
      '★ 应付款被整单抹平（total_amount → 0）',
      recVoided && Math.abs(Number(recVoided.total_amount)) < 0.01,
      fmtRecord(recVoided),
    )
    log.assert(
      '★ 已付出的 5000 元被标成「已付清(3)」而非需要处理的异常',
      recVoided && Number(recVoided.status) === 3,
      fmtRecord(recVoided),
    )
    log.assert(
      '★ 账面自相矛盾：paid_amount=5000 挂在 total_amount=0 的记录上',
      recVoided && Math.abs(Number(recVoided.paid_amount) - PAY_AMOUNT) < 0.01
        && Math.abs(Number(recVoided.total_amount)) < 0.01,
      fmtRecord(recVoided),
    )
    log.assert(
      '★ 付款明细不随撤回回滚（钱已出账，只有主记录被抹平）',
      entriesAfter.length === 1 && Math.abs(Number(entriesAfter[0].amount) - PAY_AMOUNT) < 0.01,
      `明细 ${entriesAfter.length} 笔`,
    )

    // ══════════════════════════════════════════════════════════════════
    // §B 危害放大：撤回后短装重收，多付的 3000 消失
    // ══════════════════════════════════════════════════════════════════
    log.section('§B 撤回收货后按短装重新收货（实收 2000，已付 5000）')
    step = 'B:re-receive'
    const taskRowB = await openTaskOf(pool, poA)
    const afterRePut = await receiveAndPutaway(ctx, token, {
      taskId: Number(taskRowB.id), product: productA, locationId: location.id, qty: SHORT_QTY,
    })
    console.log(`\n[重收上架后] 任务 status=${afterRePut.status} audit_status=${afterRePut.audit_status}`)

    step = 'B:read'
    const recShort = await payableOf(pool, poA)
    console.log(`[短装重收后] 应付：${fmtRecord(recShort)}`)
    const overpay = recShort ? Number(recShort.paid_amount) - Number(recShort.total_amount) : 0
    console.log(`[短装重收后] 多付金额 = 已付 ${money(recShort?.paid_amount)} − 应付 ${money(recShort?.total_amount)} = ${money(overpay)}`)
    log.assert(
      '★ 应付按短装重算为 2000（正确反映只收到 4 件）',
      recShort && Math.abs(Number(recShort.total_amount) - SHORT_QTY * PRICE) < 0.01,
      fmtRecord(recShort),
    )
    log.assert(
      '★ 但仍然显示「已付清(3)、余额 0」——多付的 3000 在账款上完全不可见',
      recShort && Number(recShort.status) === 3 && Math.abs(Number(recShort.balance)) < 0.01
        && overpay > 0,
      `多付 ${money(overpay)}，${fmtRecord(recShort)}`,
    )

    // ══════════════════════════════════════════════════════════════════
    // §C 触发面：一分钱没付过的收货单，撤回收货后同样变「已付清」
    // ══════════════════════════════════════════════════════════════════
    log.section('§C 从未付款的收货单撤回收货')
    step = 'C:seed'
    const productC = await createProduct(pool, 'C')
    cleanup.productIds.push(productC.id)
    const poC = await seedPurchase(http, token, {
      supplier, warehouse, product: productC, quantity: QTY, unitPrice: PRICE,
    })
    cleanup.poIds.push(poC)

    const taskRespC = await http.post('/api/inbound-tasks', { token, json: { poId: poC } })
    const taskC = Number(taskRespC.data?.data?.taskId)
    await http.post(`/api/inbound-tasks/${taskC}/submit`, { token })
    await receiveAndPutaway(ctx, token, {
      taskId: taskC, product: productC, locationId: location.id, qty: QTY,
    })
    const recCBefore = await payableOf(pool, poC)
    console.log(`\n[结算后] 应付：${fmtRecord(recCBefore)}（一分钱未付）`)

    step = 'C:void'
    const voidRespC = await http.post(`/api/inbound-tasks/${taskC}/void-receipt`, { token })
    log.assert('未付款的收货单同样可被撤回', voidRespC.ok, JSON.stringify(voidRespC.data).slice(0, 160))

    const recCAfter = await payableOf(pool, poC)
    console.log(`[撤回后] 应付：${fmtRecord(recCAfter)}`)
    log.assert(
      '★ 从未付过款的应付记录被标成「已付清(3)」（paid 0 >= total 0 恒真）',
      recCAfter && Number(recCAfter.status) === 3 && Math.abs(Number(recCAfter.paid_amount)) < 0.01,
      fmtRecord(recCAfter),
    )
  } catch (e) {
    console.error(`\n[中止于 step=${step}] ${e.message}`)
    console.error(e.stack)
  } finally {
    // 按精确 ID 清理，绝不按名字/编码前缀批量删除（共享夹具自洁原则）
    const safe = async (label, sql, params) => {
      try { await pool.query(sql, params) } catch (e) { console.error(`[清理告警] ${label}: ${e.message}`) }
    }
    for (const poId of cleanup.poIds) {
      const tasks = await dbQuery(pool, 'SELECT id FROM inbound_tasks WHERE purchase_order_id=?', [poId])
      for (const t of tasks) {
        await safe('inbound_task_events', 'DELETE FROM inbound_task_events WHERE task_id=?', [t.id])
        await safe('inventory_logs',
          "DELETE FROM inventory_logs WHERE ref_type='inbound_task' AND ref_id=?", [t.id])
        await safe('inventory_containers', 'DELETE FROM inventory_containers WHERE inbound_task_id=?', [t.id])
        await safe('inbound_task_items', 'DELETE FROM inbound_task_items WHERE task_id=?', [t.id])
        await safe('inbound_tasks', 'DELETE FROM inbound_tasks WHERE id=?', [t.id])
      }
      const recs = await dbQuery(pool, 'SELECT id FROM payment_records WHERE type=1 AND order_id=?', [poId])
      for (const r of recs) {
        await safe('payment_entries', 'DELETE FROM payment_entries WHERE record_id=?', [r.id])
        await safe('payment_records', 'DELETE FROM payment_records WHERE id=?', [r.id])
      }
      await safe('purchase_order_items', 'DELETE FROM purchase_order_items WHERE order_id=?', [poId])
      await safe('purchase_orders', 'DELETE FROM purchase_orders WHERE id=?', [poId])
    }
    for (const pid of cleanup.productIds) {
      await safe('inventory_stock', 'DELETE FROM inventory_stock WHERE product_id=?', [pid])
      await safe('product_items', 'DELETE FROM product_items WHERE id=?', [pid])
    }
    await ctx.close()
    log.summary()
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
