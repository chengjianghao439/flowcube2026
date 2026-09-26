#!/usr/bin/env node
'use strict'

/**
 * 写操作幂等请求键回归（2026-09-26 一致性审查 · 任务 4）——16 条断言
 *
 * 病灶：前端已开始发稳定 `X-Request-Key`（`frontend/src/lib/requestKey.ts`），后端也已接
 *   `beginOperationRequest` / `beginCreationOperationRequest` / `beginResourceOperationRequest`，
 *   但**没有任何测试验证「重放真的返回原回执、且不重复执行」**。
 *
 *   既有的 `refund-orders.smoke.test.js` 里那条「幂等」断言测的是**状态机保护**
 *   （单据已完成后重复执行被 400/409 拒绝）——它连 `X-Request-Key` 都没带。
 *   两者不是一回事：
 *     · 状态机保护 = 不带键重复提交 → 被拒绝；
 *     · 幂等回放   = 带**同一个键**重放 → **200 + 原回执**，且不重复扣库存/扣钱。
 *   若幂等键实际没生效，危险在于「网络重试」会走成第二次真实出库/退款，
 *   而调用方看到的是成功——钱和货都动了两次却无人察觉。
 *
 * 覆盖两条路径（两种不同的幂等实现，故意都测）：
 *   §A 手动出库   —— **创建类** + 载荷指纹（action `inventory.manual-out.v2.<hash>`）
 *   §B 退款执行   —— **资源级** + 单据 ID（action `refund.execute.<id>`）
 *
 * 隔离与自洁：§A 用**专属商品**（容器/流水/缓存都挂它名下），§B 用**专属销售单 + 账款 + 账户**；
 *   两者产生的 `operation_requests` 回执行按本次用过的请求键精确删除。
 *   **资源一创建就写进 `cleanup`**，不在 scenario 返回时才登记——否则 scenario 半途抛错
 *   （断言失败、夹具缺失、接口 4xx）时这些 id 根本没进 cleanup，finally 会漏清。
 *
 * 退出：显式 `process.exit()`，与 `refund-orders.smoke.test.js` 一致。
 *   不要用 `process.exitCode = N`——那样事件循环不会主动结束（连接池/keep-alive socket 仍在），
 *   进程会挂住；挂住后被外部看门狗 kill 掉，会让人误以为「测试正常跑完了」。
 *   退出码把**中止**也算作失败：`log.summary()` 只统计已执行的断言，scenario 抛错中止时
 *   可能一条 failed 都没有，若只看 `counts.failed` 就会以 0 退出、CI 误判全绿。
 *
 * 运行：
 *   set -a; source ~/.config/flowcube/operations20260912-test.env; set +a
 *   APP_UPDATE_DOWNLOADS_DIR=/tmp/flowcube-repro-downloads node tests/idempotency-request-key.smoke.test.js
 */

const { createLogger, prepareSmokeContext, dbQuery, login, randomRef } = require('./helpers/smokeTestKit')

const money = n => Number(Number(n).toFixed(2))

/** 造一个专属商品：本测试的容器/流水/库存缓存都按 product_id 精确隔离 */
async function seedProduct(pool) {
  const [r] = await pool.query(
    "INSERT INTO product_items (code, name, unit, sale_price_a, allow_decimal_qty) VALUES (?, '幂等测试商品', '个', 10, 0)",
    [randomRef('IDEMP-P').slice(0, 30)],
  )
  return Number(r.insertId)
}

/** 造一个有量的 ACTIVE 数量容器（status=1, container_type=0） */
async function seedContainer(pool, { productId, warehouseId, locationId, qty }) {
  const [r] = await pool.query(
    `INSERT INTO inventory_containers
       (barcode, product_id, warehouse_id, remaining_qty, initial_qty, container_type, status, location_id)
     VALUES (?, ?, ?, ?, ?, 0, 1, ?)`,
    [randomRef('C-IDEMP').slice(0, 40), productId, warehouseId, qty, qty, locationId],
  )
  return Number(r.insertId)
}

/** 用唯一合法入口把库存缓存对齐容器汇总，保证 FIFO 扣减的 before/after 从容器起算 */
async function syncCache(pool, productId, warehouseId) {
  const { syncStockFromContainers } = require('../backend/src/engine/containerEngine')
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    await syncStockFromContainers(conn, productId, warehouseId)
    await conn.commit()
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }
}

/** 造销售单 + 已收账款（与 refund-orders.smoke.test.js 同款，模拟已收款） */
async function seedSaleWithPaid(pool, totalAmount, paidAmount) {
  const orderNo = `SO-${randomRef('IDEMP').slice(0, 14)}`
  const [r] = await pool.query(
    `INSERT INTO sale_orders (order_no, customer_id, customer_name, warehouse_id, warehouse_name, status, total_amount, operator_id, operator_name)
     VALUES (?, 1, '幂等测试客户', 1, '测试仓', 3, ?, 1, '幂等测试')`,
    [orderNo, totalAmount],
  )
  const orderId = Number(r.insertId)
  await pool.query(
    `INSERT INTO payment_records (type, order_id, order_no, party_name, total_amount, paid_amount, balance, status, confirm_status)
     VALUES (2, ?, ?, '幂等测试客户', ?, ?, ?, ?, 1)`,
    [orderId, orderNo, totalAmount, paidAmount, totalAmount - paidAmount, paidAmount >= totalAmount ? 3 : 2],
  )
  const [recRows] = await pool.query('SELECT id FROM payment_records WHERE order_id=? AND type=2', [orderId])
  return { orderId, orderNo, paymentRecordId: Number(recRows[0].id) }
}

async function readPaid(pool, orderId) {
  const rows = await dbQuery(pool, 'SELECT paid_amount, balance, status FROM payment_records WHERE order_id=? AND type=2', [orderId])
  return rows[0] ? { paid: money(rows[0].paid_amount), balance: money(rows[0].balance), status: Number(rows[0].status) } : null
}

// ══════════════════════════════════════════════════════════════════════════
async function scenarioOutboundIdempotent(ctx, log, token, cleanup) {
  const { pool, http, warehouse, location } = ctx
  const productId = await seedProduct(pool)
  // 一创建就登记：此后任何一步抛错，finally 都能按 productId 精确清掉它的容器/流水/缓存
  cleanup.outbound = { productId, keys: [] }
  const containerId = await seedContainer(pool, {
    productId, warehouseId: Number(warehouse.id), locationId: Number(location.id), qty: 10,
  })
  cleanup.outbound.containerId = containerId
  await syncCache(pool, productId, Number(warehouse.id))

  const key = randomRef('K-OUT')
  cleanup.outbound.keys.push(key)
  const body = { productId, warehouseId: Number(warehouse.id), quantity: 4 }

  log.section('§A 手动出库：创建类幂等（载荷指纹，action=inventory.manual-out.v2.<hash>）')
  const first = await http.post('/api/inventory/outbound', {
    token, json: body, headers: { 'X-Request-Key': key },
  })
  log.assert('★ 首次出库成功（200）', first.status === 200, `HTTP ${first.status} ${JSON.stringify(first.data)}`)
  log.assert('★ 首次扣减 10→6',
    Number(first.data?.data?.beforeQty) === 10 && Number(first.data?.data?.afterQty) === 6,
    JSON.stringify(first.data?.data))

  const [cRow] = await dbQuery(pool, 'SELECT remaining_qty FROM inventory_containers WHERE id=?', [containerId])
  log.assert('★ 容器 remaining_qty 落到 6', money(cRow?.remaining_qty) === 6, `qty=${cRow?.remaining_qty}`)

  // ── 重放：同一个键 + 同一载荷（模拟断网重试 / 连点） ──
  const replay = await http.post('/api/inventory/outbound', {
    token, json: body, headers: { 'X-Request-Key': key },
  })
  log.assert('★ 重放同键返回 200（幂等回放，不是 409/400）', replay.status === 200,
    `HTTP ${replay.status} ${JSON.stringify(replay.data)}`)
  log.assert('★ 重放返回的是原回执（before=10 after=6）',
    Number(replay.data?.data?.beforeQty) === 10 && Number(replay.data?.data?.afterQty) === 6,
    JSON.stringify(replay.data?.data))

  const [cAfter] = await dbQuery(pool, 'SELECT remaining_qty FROM inventory_containers WHERE id=?', [containerId])
  log.assert('★ 重放没有再扣库存（仍是 6）', money(cAfter?.remaining_qty) === 6, `qty=${cAfter?.remaining_qty}`)
  const logs = await dbQuery(pool, 'SELECT id FROM inventory_logs WHERE product_id=? AND warehouse_id=?', [productId, Number(warehouse.id)])
  log.assert('★ 重放没有写第二条库存流水', logs.length === 1, `该商品流水条数=${logs.length}`)

  // ── 换新键：必须真实再扣一次（证明幂等没有把功能锁死） ──
  const freshKey = randomRef('K-OUT2')
  cleanup.outbound.keys.push(freshKey)
  const fresh = await http.post('/api/inventory/outbound', {
    token, json: body, headers: { 'X-Request-Key': freshKey },
  })
  log.assert('★ 换新键照常出库（200，6→2）',
    fresh.status === 200 && Number(fresh.data?.data?.beforeQty) === 6 && Number(fresh.data?.data?.afterQty) === 2,
    `HTTP ${fresh.status} ${JSON.stringify(fresh.data?.data)}`)
}

// ══════════════════════════════════════════════════════════════════════════
async function scenarioRefundIdempotent(ctx, log, token, cleanup) {
  const { pool, http } = ctx
  const { orderId, paymentRecordId } = await seedSaleWithPaid(pool, 1000, 800)
  cleanup.refund = { orderId, paymentRecordId, accountId: null, refundId: null, key: null }

  const acc = await http.post('/api/finance/accounts', {
    token, json: { name: randomRef('幂等账户').slice(0, 30), type: 2, openingBalance: 500 },
  })
  const accountId = Number(acc.data?.data?.id)
  cleanup.refund.accountId = Number.isInteger(accountId) ? accountId : null
  const create = await http.post('/api/refunds', {
    token, json: { saleOrderId: orderId, amount: 300, accountId, refundDate: '2026-08-09', remark: '幂等测试' },
  })
  const refundId = Number(create.data?.data?.id)
  cleanup.refund.refundId = Number.isInteger(refundId) ? refundId : null
  await http.post(`/api/refunds/${refundId}/submit`, { token })

  const key = randomRef('K-REF')
  cleanup.refund.key = key
  log.section('§B 退款执行：资源级幂等（action=refund.execute.<退款单ID>）')

  const exec = await http.post(`/api/refunds/${refundId}/execute`, {
    token, headers: { 'X-Request-Key': key },
  })
  log.assert('★ 首次执行退款成功（200）', exec.status === 200, `HTTP ${exec.status} ${JSON.stringify(exec.data)}`)
  const afterExec = await readPaid(pool, orderId)
  log.assert('★ 已收 800→500', afterExec.paid === 500, `paid=${afterExec.paid}`)
  const entries1 = await dbQuery(pool, 'SELECT id, amount FROM payment_entries WHERE record_id=?', [paymentRecordId])
  log.assert('★ 落 1 条负向 payment_entries（-300）',
    entries1.length === 1 && money(entries1[0].amount) === -300, JSON.stringify(entries1.map(e => e.amount)))
  const acc1 = await dbQuery(pool, 'SELECT current_balance FROM finance_accounts WHERE id=?', [accountId])
  log.assert('★ 账户余额 500→200', money(acc1[0]?.current_balance) === 200, `balance=${acc1[0]?.current_balance}`)

  // ── 重放：同一个键（模拟断网重试）。这正是「重复退钱」最危险的场景 ──
  const replay = await http.post(`/api/refunds/${refundId}/execute`, {
    token, headers: { 'X-Request-Key': key },
  })
  log.assert('★ 重放同键返回 200（幂等回放，不是 409/400）', replay.status === 200,
    `HTTP ${replay.status} ${JSON.stringify(replay.data)}`)

  const afterReplay = await readPaid(pool, orderId)
  log.assert('★ 重放没有再次扣款（仍 500）', afterReplay.paid === 500, `paid=${afterReplay.paid}`)
  const entries2 = await dbQuery(pool, 'SELECT id FROM payment_entries WHERE record_id=?', [paymentRecordId])
  log.assert('★ 重放没有写第二条退款流水（仍 1 条）', entries2.length === 1, `条数=${entries2.length}`)
  const acc2 = await dbQuery(pool, 'SELECT current_balance FROM finance_accounts WHERE id=?', [accountId])
  log.assert('★ 重放没有二次出账（账户仍 200）', money(acc2[0]?.current_balance) === 200, `balance=${acc2[0]?.current_balance}`)
}

// ══════════════════════════════════════════════════════════════════════════
async function main() {
  const log = createLogger('写操作幂等请求键')
  const ctx = await prepareSmokeContext()
  const { pool } = ctx
  const cleanup = { outbound: null, refund: null }
  // 中止（异常/夹具缺失/接口意外码）也必须算失败：否则 log.summary() 只统计已执行的断言，
  // 跑崩了却一个 failed 都没有 → process.exit(0) → CI 误判为全绿。
  let aborted = false

  try {
    const { token } = await login(ctx.http, 'smoke_admin', 'SmokeAdmin123!')
    if (!token) throw new Error('管理员登录失败')

    await scenarioOutboundIdempotent(ctx, log, token, cleanup)
    await scenarioRefundIdempotent(ctx, log, token, cleanup)
  } catch (e) {
    aborted = true
    console.error(`\n[中止] ${e.message}`)
    console.error(e.stack)
  } finally {
    const safe = async (label, sql, params) => {
      try { await pool.query(sql, params) } catch (e) { console.error(`[清理告警] ${label}: ${e.message}`) }
    }
    // §A：按专属商品精确清理（先子后父）
    if (cleanup.outbound) {
      const { productId } = cleanup.outbound
      await safe('inventory_logs', 'DELETE FROM inventory_logs WHERE product_id=?', [productId])
      await safe('inventory_containers', 'DELETE FROM inventory_containers WHERE product_id=?', [productId])
      await safe('inventory_stock', 'DELETE FROM inventory_stock WHERE product_id=?', [productId])
      await safe('product_items', 'DELETE FROM product_items WHERE id=?', [productId])
    }
    // §B：按专属销售单/账户精确清理
    if (cleanup.refund) {
      const { orderId, paymentRecordId, accountId } = cleanup.refund
      if (paymentRecordId) {
        await safe('payment_entries', 'DELETE FROM payment_entries WHERE record_id=?', [paymentRecordId])
        await safe('party_ledger_events', 'DELETE FROM party_ledger_events WHERE record_id=?', [paymentRecordId])
        await safe('payment_record_events', 'DELETE FROM payment_record_events WHERE payment_record_id=?', [paymentRecordId])
      }
      if (accountId) {
        await safe('finance_account_transactions', 'DELETE FROM finance_account_transactions WHERE account_id=?', [accountId])
      }
      await safe('refund_orders', 'DELETE FROM refund_orders WHERE sale_order_id=?', [orderId])
      await safe('payment_records', 'DELETE FROM payment_records WHERE order_id=?', [orderId])
      await safe('sale_orders', 'DELETE FROM sale_orders WHERE id=?', [orderId])
      if (accountId) await safe('finance_accounts', 'DELETE FROM finance_accounts WHERE id=?', [accountId])
    }
    // 幂等回执表：§A 与 §B 用过的**每一个**请求键都要清（此前漏了 §A 的两个键）
    const keys = [
      ...(cleanup.outbound?.keys || []),
      ...(cleanup.refund?.key ? [cleanup.refund.key] : []),
    ]
    if (keys.length) await safe('operation_requests', 'DELETE FROM operation_requests WHERE request_key IN (?)', [keys])

    await ctx.close()
  }

  const counts = log.summary()
  // 显式退出：不用 exitCode，否则事件循环不结束、进程挂住（详见文件头说明）
  process.exit(aborted || counts.failed > 0 ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(1) })
