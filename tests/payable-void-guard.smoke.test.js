#!/usr/bin/env node
'use strict'

/**
 * 回归测试：已登记付款的收货单不得被「撤回收货」反冲应付
 * （2026-09-26 一致性审查 · 任务 2 层 2 + 层 1）
 *
 * 修复前的行为（由 tests/repro-20260926-payable-void.js 记录，已固化为本测试）：
 *   收货上架 → 自动结算 5000 → 财务确认 → 全额付款 5000 → 撤回收货
 *   ⇒ 应付 total_amount 被抹平为 0，而已付的 5000 原样保留、付款明细不回滚，
 *     记录变成「总额 0、已付 5000、余额 0、已付清(3)」——一笔付出去了的钱在账面上
 *     失去对应的应付，且系统没有任何撤销付款登记的入口，出了口子就再也对不平。
 *
 * 三段：
 *   §A 已付款 → 撤回收货必须 409，账款/库存/单据一律不变
 *   §B 仅财务确认未付款 → 放行，且重算后不得被标成「已付清(3)」（层 1 数值 bug）
 *   §C 未付款未确认 → 放行，同样不得被标成「已付清(3)」
 *
 * 运行：
 *   set -a; source ~/.config/flowcube/operations20260912-test.env; set +a
 *   APP_UPDATE_DOWNLOADS_DIR=/tmp/flowcube-repro-downloads node tests/payable-void-guard.smoke.test.js
 */

const {
  createLogger, prepareSmokeContext, dbQuery, login, randomRef,
} = require('./helpers/smokeTestKit')

const QTY = 10
const PRICE = 500          // 10 × 500 = 5000
const PAY_AMOUNT = 5000

async function createProduct(pool, label) {
  const code = randomRef(`PVG-${label}`).slice(0, 40)
  const [r] = await pool.query(
    "INSERT INTO product_items (code, name, unit, sale_price_a, cost_price) VALUES (?, ?, '个', 600, 500)",
    [code, `PVG测试商品-${label}`],
  )
  return { id: r.insertId, code, name: `PVG测试商品-${label}`, unit: '个' }
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
const fmtRecord = r => (r
  ? `总额=${money(r.total_amount)} 已付=${money(r.paid_amount)} 余额=${money(r.balance)} `
    + `状态=${Number(r.status)}(${STATUS_TEXT[Number(r.status)] || '?'}) 财务确认=${Number(r.confirm_status)}`
  : '(无应付记录)')

const payableOf = async (pool, poId) => {
  const [row] = await dbQuery(
    pool,
    'SELECT id, total_amount, paid_amount, balance, status, confirm_status FROM payment_records WHERE type=1 AND order_id=?',
    [poId],
  )
  return row || null
}

const activeQtyOf = async (pool, poId) => {
  const [row] = await dbQuery(
    pool,
    `SELECT COALESCE(SUM(c.remaining_qty), 0) AS qty, COUNT(*) AS cnt
       FROM inventory_containers c
       JOIN inbound_tasks it ON it.id = c.inbound_task_id
      WHERE it.purchase_order_id = ? AND c.deleted_at IS NULL AND c.status = 1`,
    [poId],
  )
  return { qty: Number(row?.qty || 0), cnt: Number(row?.cnt || 0) }
}

const taskStatusOf = async (pool, taskId) => {
  const [row] = await dbQuery(
    pool, 'SELECT status, audit_status FROM inbound_tasks WHERE id=?', [taskId],
  )
  return row || null
}

/** 收货 → （短装时结案）→ 上架，返回上架后的任务行 */
async function receiveAndPutaway(ctx, token, { taskId, product, locationId, qty }) {
  const { http, pool, pdaHeaders } = ctx
  const recv = await http.post(`/api/inbound-tasks/${taskId}/receive`, {
    token, headers: pdaHeaders(), json: { productId: Number(product.id), packages: [{ qty }] },
  })
  if (!recv.ok) throw new Error(`收货失败: ${JSON.stringify(recv.data)}`)

  const [task] = await dbQuery(pool, 'SELECT status FROM inbound_tasks WHERE id=?', [taskId])
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

/** 建采购单 → 建收货单 → 提交 → 收货上架 → 返回 { poId, taskId, payable } */
async function seedReceivedTask(ctx, token, { supplier, warehouse, location, label, qty }) {
  const { pool } = ctx
  const product = await createProduct(pool, label)
  const poId = await seedPurchase(ctx.http, token, {
    supplier, warehouse, product, quantity: qty, unitPrice: PRICE,
  })
  const taskResp = await ctx.http.post('/api/inbound-tasks', { token, json: { poId } })
  const taskId = Number(taskResp.data?.data?.taskId)
  if (!Number.isFinite(taskId) || taskId <= 0) {
    throw new Error(`建收货单失败: ${JSON.stringify(taskResp.data)}`)
  }
  await ctx.http.post(`/api/inbound-tasks/${taskId}/submit`, { token })
  await receiveAndPutaway(ctx, token, { taskId, product, locationId: location.id, qty })
  return { product, poId, taskId, payable: await payableOf(pool, poId) }
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
    // §A 已登记付款 → 撤回收货必须被拒绝，且不产生任何副作用
    // ══════════════════════════════════════════════════════════════════
    log.section('§A 已付款的收货单 → 撤回收货必须 409')
    step = 'A:seed'
    const A = await seedReceivedTask(ctx, token, {
      supplier, warehouse, location, label: 'A', qty: QTY,
    })
    cleanup.productIds.push(A.product.id)
    cleanup.poIds.push(A.poId)
    console.log(`\n[自动结算后] 应付：${fmtRecord(A.payable)}`)
    log.assert(
      '前置成立：上架后自动结算生成应付 5000',
      A.payable && Math.abs(Number(A.payable.total_amount) - QTY * PRICE) < 0.01,
      fmtRecord(A.payable),
    )
    if (!A.payable) throw new Error('未生成应付记录，无法继续')

    step = 'A:confirm-and-pay'
    const confirmResp = await http.post(`/api/payments/${A.payable.id}/confirm`, { token })
    log.assert('前置成立：财务确认成功', confirmResp.ok, JSON.stringify(confirmResp.data).slice(0, 160))
    const payResp = await http.post(`/api/payments/${A.payable.id}/pay`, {
      token,
      json: { amount: PAY_AMOUNT, paymentDate: '2026-09-26', method: '转账', remark: '回归测试付款' },
    })
    log.assert('前置成立：登记付款成功', payResp.ok, JSON.stringify(payResp.data).slice(0, 200))

    const recPaid = await payableOf(pool, A.poId)
    const stockBefore = await activeQtyOf(pool, A.poId)
    const taskBefore = await taskStatusOf(pool, A.taskId)
    console.log(`[撤回前] 应付：${fmtRecord(recPaid)}`)
    console.log(`[撤回前] 在库容器 ${stockBefore.cnt} 个 / ${stockBefore.qty} 件；任务 status=${taskBefore.status} audit=${taskBefore.audit_status}`)
    log.assert(
      '前置成立：付款后账款为「已付清(3)、已付 5000」',
      recPaid && Number(recPaid.status) === 3 && Math.abs(Number(recPaid.paid_amount) - PAY_AMOUNT) < 0.01,
      fmtRecord(recPaid),
    )

    step = 'A:void'
    const voidResp = await http.post(`/api/inbound-tasks/${A.taskId}/void-receipt`, { token })
    console.log(`\n[撤回收货] HTTP ${voidResp.status} ${JSON.stringify(voidResp.data).slice(0, 240)}`)
    log.assert(
      '★ 撤回收货被拒绝（409）',
      voidResp.status === 409,
      `实际 HTTP ${voidResp.status}：${JSON.stringify(voidResp.data).slice(0, 160)}`,
    )
    log.assert(
      '★ 错误码为 INBOUND_TASK_PAYABLE_PAID',
      voidResp.data?.code === 'INBOUND_TASK_PAYABLE_PAID',
      JSON.stringify(voidResp.data).slice(0, 200),
    )
    log.assert(
      '★ 拒绝消息点明已付金额与替代路径（采购退货单）',
      String(voidResp.data?.message || '').includes(money(PAY_AMOUNT))
        && String(voidResp.data?.message || '').includes('采购退货单'),
      String(voidResp.data?.message || '').slice(0, 200),
    )

    step = 'A:read-after-void'
    const recAfter = await payableOf(pool, A.poId)
    const entriesAfter = await dbQuery(
      pool, 'SELECT amount FROM payment_entries WHERE record_id=? ORDER BY id', [A.payable.id],
    )
    const stockAfter = await activeQtyOf(pool, A.poId)
    const taskAfter = await taskStatusOf(pool, A.taskId)
    console.log(`[撤回后] 应付：${fmtRecord(recAfter)}`)
    console.log(`[撤回后] 在库容器 ${stockAfter.cnt} 个 / ${stockAfter.qty} 件；任务 status=${taskAfter.status} audit=${taskAfter.audit_status}`)

    log.assert(
      '★ 应付金额未被反冲（total_amount 仍为 5000）',
      recAfter && Math.abs(Number(recAfter.total_amount) - PAY_AMOUNT) < 0.01,
      fmtRecord(recAfter),
    )
    log.assert(
      '★ 账款未被标成矛盾态（paid=total=5000、余额 0、已付清）',
      recAfter && Number(recAfter.status) === 3
        && Math.abs(Number(recAfter.paid_amount) - PAY_AMOUNT) < 0.01
        && Math.abs(Number(recAfter.balance)) < 0.01,
      fmtRecord(recAfter),
    )
    log.assert(
      '★ 付款明细未被回滚（仍 1 笔 5000）',
      entriesAfter.length === 1 && Math.abs(Number(entriesAfter[0].amount) - PAY_AMOUNT) < 0.01,
      `明细 ${entriesAfter.length} 笔`,
    )
    log.assert(
      '★ 库存未被改动（被拒的撤回不得留下半截副作用）',
      stockAfter.cnt === stockBefore.cnt && Math.abs(stockAfter.qty - stockBefore.qty) < 0.01,
      `${stockBefore.cnt} 个/${stockBefore.qty} 件 → ${stockAfter.cnt} 个/${stockAfter.qty} 件`,
    )
    log.assert(
      '★ 收货单仍停在已完成(4)/已结算(1)',
      taskAfter && Number(taskAfter.status) === 4 && Number(taskAfter.audit_status) === 1,
      `status=${taskAfter?.status} audit=${taskAfter?.audit_status}`,
    )

    // ══════════════════════════════════════════════════════════════════
    // §B 仅财务确认、尚未付款 → 撤回放行，但应付不得被标成「已付清」
    // ══════════════════════════════════════════════════════════════════
    log.section('§B 仅财务确认未付款 → 撤回放行，且不得标成「已付清」')
    step = 'B:seed'
    const B = await seedReceivedTask(ctx, token, {
      supplier, warehouse, location, label: 'B', qty: QTY,
    })
    cleanup.productIds.push(B.product.id)
    cleanup.poIds.push(B.poId)
    if (!B.payable) throw new Error('B: 未生成应付记录')

    step = 'B:confirm'
    const confirmB = await http.post(`/api/payments/${B.payable.id}/confirm`, { token })
    log.assert('前置成立：财务确认成功（未付款）', confirmB.ok, JSON.stringify(confirmB.data).slice(0, 160))
    const recBConfirmed = await payableOf(pool, B.poId)
    log.assert(
      '前置成立：confirm_status=1 且 paid_amount=0',
      recBConfirmed && Number(recBConfirmed.confirm_status) === 1
        && Math.abs(Number(recBConfirmed.paid_amount)) < 0.01,
      fmtRecord(recBConfirmed),
    )

    step = 'B:void'
    const voidB = await http.post(`/api/inbound-tasks/${B.taskId}/void-receipt`, { token })
    console.log(`\n[撤回收货] HTTP ${voidB.status} ${JSON.stringify(voidB.data).slice(0, 200)}`)
    log.assert(
      '★ 未付款的收货单仍可撤回（守卫不误伤）',
      voidB.ok,
      JSON.stringify(voidB.data).slice(0, 160),
    )

    step = 'B:read'
    const recBAfter = await payableOf(pool, B.poId)
    console.log(`[撤回后] 应付：${fmtRecord(recBAfter)}`)
    log.assert(
      '★ 应付按剩余收货重算为 0',
      recBAfter && Math.abs(Number(recBAfter.total_amount)) < 0.01,
      fmtRecord(recBAfter),
    )
    log.assert(
      '★ 不能被标成「已付清(3)」——未付的 0 >= 0 不该算付清（层 1）',
      recBAfter && Number(recBAfter.status) === 1,
      `实际状态=${recBAfter?.status}(${STATUS_TEXT[Number(recBAfter?.status)] || '?'})，${fmtRecord(recBAfter)}`,
    )
    log.assert(
      '★ 金额重算后打回「待财务确认(0)」（既有设计未被破坏）',
      recBAfter && Number(recBAfter.confirm_status) === 0,
      fmtRecord(recBAfter),
    )

    // ══════════════════════════════════════════════════════════════════
    // §C 未付款、未确认 → 撤回放行，同样不得被标成「已付清」
    // ══════════════════════════════════════════════════════════════════
    log.section('§C 未付款未确认 → 撤回放行，且不得标成「已付清」')
    step = 'C:seed'
    const C = await seedReceivedTask(ctx, token, {
      supplier, warehouse, location, label: 'C', qty: QTY,
    })
    cleanup.productIds.push(C.product.id)
    cleanup.poIds.push(C.poId)
    if (!C.payable) throw new Error('C: 未生成应付记录')

    step = 'C:void'
    const voidC = await http.post(`/api/inbound-tasks/${C.taskId}/void-receipt`, { token })
    console.log(`\n[撤回收货] HTTP ${voidC.status} ${JSON.stringify(voidC.data).slice(0, 200)}`)
    log.assert('★ 一分钱未付的收货单可正常撤回', voidC.ok, JSON.stringify(voidC.data).slice(0, 160))

    step = 'C:read'
    const recCAfter = await payableOf(pool, C.poId)
    console.log(`[撤回后] 应付：${fmtRecord(recCAfter)}`)
    log.assert(
      '★ 应付重算为 0 且状态为「待付款(1)」而非「已付清(3)」',
      recCAfter && Math.abs(Number(recCAfter.total_amount)) < 0.01
        && Number(recCAfter.status) === 1,
      fmtRecord(recCAfter),
    )
    const stockC = await activeQtyOf(pool, C.poId)
    log.assert(
      '★ 撤回后已上架容器全部作废，库存归零',
      stockC.cnt === 0 && Math.abs(stockC.qty) < 0.01,
      `容器 ${stockC.cnt} 个 / ${stockC.qty} 件`,
    )
  } catch (e) {
    console.error(`\n[中止于 step=${step}] ${e.message}`)
    console.error(e.stack)
    process.exitCode = 1
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
    // 全局单例池（backend/src/config/db）自己收尾：它也是 mysql2 连接，socket 不 unref，
    // app/service 查询过一次就会留住事件循环——断言全绿、退出码已定，进程却吊着不退
    // （2026-09-26 实测：21 passed/0 failed 后吊住 20 分钟，只有 3 条到 3307 的 ESTABLISHED）。
    // smokeTestKit.close() 只管它自建的池；两个池分开关，谁都不会被关两次。
    await require('../backend/src/config/db').pool.end()
    const counts = log.summary()
    if (counts.failed > 0) process.exitCode = 1
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
