#!/usr/bin/env node
'use strict'

/**
 * 复现脚本（2026-09-26 一致性审查 · 证据）——**不是回归测试，请勿当作断言套件使用**
 *
 * 命题：销售退货单在「部分明细已上架、部分未上架」的中间态被取消后，
 *       库存已实际增加、而应收不冲减，且系统内无任何操作可恢复。
 *
 * ⚠ 本脚本断言的是「修复前的错误行为」，故在任务 1 守卫上线后**必然失败**——
 *    这是修复生效的反向证据，不是脚本坏了。要保持通过的回归套件见
 *    tests/sale-return-cancel-guard.smoke.test.js（守卫上线后 15/15 通过）。
 *
 * 本脚本不改业务代码，只在独立测试库上走真实 HTTP 链路并打印事实。
 * 运行：
 *   set -a; source ~/.config/flowcube/operations20260912-test.env; set +a
 *   node tests/repro-20260926-return-cancel.js
 */

const {
  createLogger, prepareSmokeContext, dbQuery, login, randomRef,
} = require('./helpers/smokeTestKit')
const {
  createContainer, syncStockFromContainers, SOURCE_TYPE, CONTAINER_STATUS,
} = require('../backend/src/engine/containerEngine')

const SALE_QTY = 10
const UNIT_PRICE = 15
const RETURN_QTY = 10

async function seedActiveContainer(pool, { product, warehouse, qty, locationId = null }) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const { containerId, barcode } = await createContainer(conn, {
      productId: Number(product.id),
      warehouseId: Number(warehouse.id),
      initialQty: Number(qty),
      unit: product.unit,
      sourceType: SOURCE_TYPE.TRANSFER,
      sourceRefId: Math.floor(Date.now() / 1000) + Math.floor(Math.random() * 100000),
      sourceRefType: 'test_seed',
      sourceRefNo: randomRef('SEED'),
      remark: 'repro-20260926 seed',
      containerStatus: CONTAINER_STATUS.ACTIVE,
      locationId: locationId != null ? Number(locationId) : null,
    })
    await syncStockFromContainers(conn, Number(product.id), Number(warehouse.id))
    await conn.commit()
    return { containerId: Number(containerId), barcode }
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }
}

const stockQty = async (pool, productId, warehouseId) => {
  const [rows] = await pool.query(
    'SELECT quantity, reserved FROM inventory_stock WHERE product_id=? AND warehouse_id=?',
    [productId, warehouseId],
  )
  return rows[0] || { quantity: 0, reserved: 0 }
}

const receivableOf = async (pool, saleOrderId) => {
  const [rows] = await pool.query(
    'SELECT id, total_amount, paid_amount, confirm_status, status FROM payment_records WHERE type=2 AND order_id=?',
    [saleOrderId],
  )
  return rows[0] || null
}

const saleReturnStatus = async (pool, id) => {
  const [rows] = await pool.query('SELECT status FROM sale_returns WHERE id=?', [id])
  return rows[0] ? Number(rows[0].status) : null
}

const containersOfReturnTask = async (pool, taskId) => {
  const [rows] = await pool.query(
    `SELECT id, barcode, status, remaining_qty FROM inventory_containers
      WHERE source_ref_type='sale_return' AND source_ref_id=? AND deleted_at IS NULL ORDER BY id`,
    [taskId],
  )
  return rows.map((r) => ({ id: Number(r.id), barcode: r.barcode, status: Number(r.status), qty: Number(r.remaining_qty) }))
}

const pendingPutawayQty = async (pool, taskId) => {
  const [rows] = await pool.query(
    'SELECT COALESCE(SUM(checked_qty - rejected_qty - putaway_qty), 0) AS remaining FROM return_task_items WHERE task_id=?',
    [taskId],
  )
  return Number(rows[0].remaining)
}

async function main() {
  const log = createLogger()
  const ctx = await prepareSmokeContext()
  const { pool, http, warehouse, location, customer, pdaHeaders } = ctx
  const cleanup = { productId: null, saleId: null, srId: null, srTaskId: null, taskId: null }
  let step = 'init'

  try {
    const adminLogin = await login(http, 'smoke_admin', 'SmokeAdmin123!')
    const token = adminLogin.token
    if (!token) throw new Error('smoke_admin 登录失败')
    const H = pdaHeaders()

    // ── 0. 独立商品 + 独立库存，避免污染共享夹具 ──────────────────
    step = 'seed'
    const code = `REPRO-SR-${randomRef('P')}`
    const [pr] = await pool.query(
      "INSERT INTO product_items (code, name, unit, sale_price_a) VALUES (?, '复现测试商品', '个', 15)",
      [code],
    )
    const product = { id: pr.insertId, code, name: '复现测试商品', unit: '个' }
    cleanup.productId = product.id
    const seeded = await seedActiveContainer(pool, {
      product, warehouse, qty: 100, locationId: location.id,
    })
    const qty0 = (await stockQty(pool, product.id, warehouse.id)).quantity
    console.log(`\n[基准] 播种 ${qty0} 件，容器 ${seeded.barcode}(${seeded.containerId})`)

    // ── 1. 销售出库（真实 PDA 全链路 → 任务 status=7）────────────
    step = 'sale-create'
    const saleResp = await http.post('/api/sale', {
      token,
      json: {
        customerId: Number(customer.id), customerName: customer.name,
        warehouseId: Number(warehouse.id), warehouseName: warehouse.name,
        remark: randomRef('repro-sale'),
        items: [{
          productId: Number(product.id), productCode: product.code, productName: product.name,
          unit: product.unit, quantity: SALE_QTY, unitPrice: UNIT_PRICE,
        }],
      },
    })
    if (!saleResp.ok) throw new Error(`建销售单失败: ${JSON.stringify(saleResp.data)}`)
    const saleId = Number(saleResp.data.data.id)
    cleanup.saleId = saleId

    step = 'sale-reserve'
    await http.post(`/api/sale/${saleId}/reserve`, { token })
    step = 'sale-ship-dispatch'
    const shipDispatch = await http.post(`/api/sale/${saleId}/ship`, { token })
    if (!shipDispatch.ok) throw new Error(`发起出库失败: ${JSON.stringify(shipDispatch.data)}`)

    const [saleRow] = await dbQuery(pool, 'SELECT task_id, order_no FROM sale_orders WHERE id=?', [saleId])
    const taskId = Number(saleRow.task_id)
    cleanup.taskId = taskId
    const [itemRow] = await dbQuery(pool, 'SELECT id FROM warehouse_task_items WHERE task_id=? ORDER BY id LIMIT 1', [taskId])

    step = 'pick-scan'
    const pick = await http.post('/api/scan-logs', {
      token, headers: H,
      json: {
        taskId, itemId: Number(itemRow.id), containerId: seeded.containerId, barcode: seeded.barcode,
        productId: Number(product.id), qty: SALE_QTY, scanMode: '整件',
      },
    })
    if (!pick.ok) throw new Error(`拣货扫码失败: ${JSON.stringify(pick.data)}`)

    step = 'ready'
    const ready = await http.put(`/api/warehouse-tasks/${taskId}/ready`, { token, headers: H })
    if (!ready.ok) throw new Error(`ready 失败: ${JSON.stringify(ready.data)}`)

    step = 'sorting-bin'
    const [taskInfo] = await dbQuery(pool, 'SELECT warehouse_id, sorting_bin_id FROM warehouse_tasks WHERE id=?', [taskId])
    if (!taskInfo.sorting_bin_id) {
      await pool.query('INSERT INTO sorting_bins (code, warehouse_id) VALUES (?,?)', [randomRef('REPRO-BIN').slice(0, 40), taskInfo.warehouse_id])
      const assigned = await http.post(`/api/warehouse-tasks/${taskId}/assign-sorting-bin`, {
        token, headers: { 'X-Request-Key': randomRef('repro-assign') }, json: {},
      })
      if (!assigned.ok) throw new Error(`assign-sorting-bin 失败: ${JSON.stringify(assigned.data)}`)
    }

    step = 'sort-done'
    const sortDone = await http.put(`/api/warehouse-tasks/${taskId}/sort-done`, { token, headers: H, json: {} })
    if (!sortDone.ok) throw new Error(`sort-done 失败: ${JSON.stringify(sortDone.data)}`)

    step = 'check-scan'
    const checkScan = await http.post('/api/scan-logs/check', { token, headers: H, json: { taskId, barcode: seeded.barcode } })
    if (!checkScan.ok) throw new Error(`复核扫码失败: ${JSON.stringify(checkScan.data)}`)

    step = 'package'
    const pkg = await http.post('/api/packages', { token, headers: H, json: { warehouseTaskId: taskId } })
    const pkgId = Number(pkg.data?.data?.id)
    if (!pkgId) throw new Error(`创建装箱失败: ${JSON.stringify(pkg.data)}`)
    await http.post(`/api/packages/${pkgId}/add-item`, { token, headers: H, json: { productCode: product.code, qty: SALE_QTY } })
    await http.put(`/api/packages/${pkgId}/finish`, { token, headers: H })
    // 测试环境无真实打印客户端回执，直接置箱贴打印任务完成，跨过打印闭合
    await pool.query("UPDATE print_jobs SET status=2 WHERE ref_type='package' AND ref_id=?", [pkgId])

    step = 'pack-done'
    const packDone = await http.put(`/api/warehouse-tasks/${taskId}/pack-done`, { token, headers: H })
    if (!packDone.ok) throw new Error(`pack-done 失败: ${JSON.stringify(packDone.data)}`)

    step = 'ship'
    const shipDone = await http.put(`/api/warehouse-tasks/${taskId}/ship`, { token, headers: H })
    if (!shipDone.ok) throw new Error(`出库失败: ${JSON.stringify(shipDone.data)}`)

    const [taskAfter] = await dbQuery(pool, 'SELECT status FROM warehouse_tasks WHERE id=?', [taskId])
    const recv0 = await receivableOf(pool, saleId)
    const qtyAfterShip = (await stockQty(pool, product.id, warehouse.id)).quantity
    console.log(`[出库后] 任务状态=${taskAfter.status}(期望7)，库存=${qtyAfterShip}，应收=${recv0 ? recv0.total_amount : '无'}`)
    if (Number(taskAfter.status) !== 7) throw new Error('销售出库未到 status=7，前置条件不成立，中止')
    if (!recv0) throw new Error('出库后未生成应收，前置条件不成立，中止')

    // ── 2. 建销售退货单（关联该销售单）→ 确认 ─────────────────────
    step = 'return-create'
    const [soi] = await dbQuery(pool, 'SELECT id, unit_price FROM sale_order_items WHERE order_id=? LIMIT 1', [saleId])
    const srCreate = await http.post('/api/returns/sale', {
      token,
      json: {
        customerId: Number(customer.id), customerName: customer.name,
        warehouseId: Number(warehouse.id), warehouseName: warehouse.name,
        saleOrderId: saleId, saleOrderNo: saleRow.order_no,
        remark: randomRef('repro-sr'),
        items: [{
          sourceItemId: Number(soi.id), productId: Number(product.id), productCode: product.code,
          productName: product.name, unit: product.unit, quantity: RETURN_QTY, unitPrice: Number(soi.unit_price),
        }],
      },
    })
    if (!srCreate.ok) throw new Error(`建销售退货单失败: ${JSON.stringify(srCreate.data)}`)
    const srId = Number(srCreate.data.data.id)
    cleanup.srId = srId
    await http.post(`/api/returns/sale/${srId}/confirm`, { token })

    const [srTask] = await dbQuery(pool, "SELECT id FROM return_tasks WHERE return_id=? AND return_type='sale' ORDER BY id DESC LIMIT 1", [srId])
    const srTaskId = Number(srTask.id)
    cleanup.srTaskId = srTaskId

    // ── 3. PDA 收货（分 2 包）→ 质检全部通过 → 只上架其中 1 包 ────
    step = 'return-receive'
    const recvResp = await http.post(`/api/return-tasks/${srTaskId}/receive`, {
      token, headers: H,
      json: { productId: Number(product.id), packages: [{ qty: 5 }, { qty: 5 }] },
    })
    if (!recvResp.ok) throw new Error(`退货收货失败: ${JSON.stringify(recvResp.data)}`)

    step = 'return-check'
    const checkResp = await http.post(`/api/return-tasks/${srTaskId}/check`, {
      token, headers: H,
      json: { productId: Number(product.id), passedQty: RETURN_QTY },
    })
    if (!checkResp.ok) throw new Error(`退货质检失败: ${JSON.stringify(checkResp.data)}`)

    const qaContainers = (checkResp.data?.data?.containers || []).filter(
      (c) => Number(c.status) === CONTAINER_STATUS.PENDING_PUTAWAY,
    )
    console.log(`[质检后] 待上架容器 ${qaContainers.length} 个: ${JSON.stringify(qaContainers.map((c) => ({ id: c.containerId, qty: c.qty })))}`)
    if (qaContainers.length < 2) throw new Error(`期望至少 2 个待上架容器才能构造"部分上架"，实际 ${qaContainers.length}`)

    step = 'return-putaway-partial'
    const putaway = await http.post(`/api/return-tasks/${srTaskId}/putaway`, {
      token, headers: H,
      json: { containerId: Number(qaContainers[0].containerId), locationId: Number(location.id) },
    })
    if (!putaway.ok) throw new Error(`退货上架失败: ${JSON.stringify(putaway.data)}`)

    // ── 4. 观测中间态 ────────────────────────────────────────────
    step = 'observe-mid'
    const midStatus = await saleReturnStatus(pool, srId)
    const midPending = await pendingPutawayQty(pool, srTaskId)
    const midQty = (await stockQty(pool, product.id, warehouse.id)).quantity
    const midRecv = await receivableOf(pool, saleId)
    const midContainers = await containersOfReturnTask(pool, srTaskId)
    console.log('\n──── 中间态（部分上架、未取消）────')
    console.log(`  退货单状态 = ${midStatus}（2=已确认，3=已执行）`)
    console.log(`  待上架量   = ${midPending}`)
    console.log(`  库存       = ${midQty}（出库后为 ${qtyAfterShip}，已上架 5 件）`)
    console.log(`  应收       = ${midRecv ? midRecv.total_amount : '无'}`)
    console.log(`  退货容器   = ${JSON.stringify(midContainers)}`)

    // ── 5. 取消退货单 ────────────────────────────────────────────
    step = 'return-cancel'
    const cancelResp = await http.post(`/api/returns/sale/${srId}/cancel`, { token })
    console.log(`\n──── 取消退货单 ────`)
    console.log(`  HTTP ${cancelResp.status}，body=${JSON.stringify(cancelResp.data).slice(0, 200)}`)

    // ── 6. 观测取消后 ────────────────────────────────────────────
    step = 'observe-after'
    const afterStatus = await saleReturnStatus(pool, srId)
    const afterQty = (await stockQty(pool, product.id, warehouse.id)).quantity
    const afterRecv = await receivableOf(pool, saleId)
    const afterContainers = await containersOfReturnTask(pool, srTaskId)
    const [events] = await pool.query(
      `SELECT event_type, title, description FROM return_order_events WHERE return_id=? AND return_type='sale' ORDER BY id DESC LIMIT 3`,
      [srId],
    )
    // 追溯链：已入库容器是否仍指向一张已取消的单
    const activeOnCancelled = afterContainers.filter((c) => c.status === CONTAINER_STATUS.ACTIVE)

    console.log('\n──── 取消后 ────')
    console.log(`  退货单状态 = ${afterStatus}（4=已取消）`)
    console.log(`  库存       = ${afterQty}（若等于中间态则"已入库的 5 件被保留"）`)
    console.log(`  应收       = ${afterRecv ? afterRecv.total_amount : '无'}（若与出库后相同则"未被冲减"）`)
    console.log(`  退货容器   = ${JSON.stringify(afterContainers)}`)
    console.log(`  仍为 ACTIVE 的容器 = ${activeOnCancelled.length} 个（指向已取消单据的追溯断点）`)
    console.log(`  最近事件   = ${JSON.stringify(events)}`)

    // ── 7. 结论判定 ──────────────────────────────────────────────
    console.log('\n════ 判定 ════')
    const cancelledOk = afterStatus === 4
    const stockKept = afterQty === midQty
    const receivableUnchanged = afterRecv && midRecv && Number(afterRecv.total_amount) === Number(midRecv.total_amount)
    log.assert('取消请求被接受（HTTP 2xx）', cancelResp.ok, `status=${cancelResp.status}`)
    log.assert('退货单已置为已取消(4)', cancelledOk, `实际=${afterStatus}`)
    log.assert('★ 已入库库存被保留（库存未回退）', stockKept, `中间态=${midQty} 取消后=${afterQty}`)
    log.assert('★ 应收未按已入库合格量冲减（客户仍欠全款）', receivableUnchanged,
      `中间态=${midRecv?.total_amount} 取消后=${afterRecv?.total_amount}`)
    log.assert('★ 存在 ACTIVE 容器挂在已取消退货单上（追溯链断裂）', activeOnCancelled.length > 0,
      JSON.stringify(activeOnCancelled))
    const cancelEvent = events.find((e) => String(e.title).includes('取消'))
    log.assert('事件文案与实际不符（声称"未执行退货入库"）',
      !!cancelEvent && String(cancelEvent.description).includes('未执行退货入库'),
      cancelEvent ? cancelEvent.description : '未找到取消事件')

    const summary = log.summary()
    console.log(summary.failed === 0
      ? '→ 全部判定通过：缺陷已被真实行为复现（不是仅代码推断）。'
      : '→ 存在未通过的判定，请结合上面观测值判断（可能是复现路径与实现有偏差）。')
  } catch (e) {
    console.error(`\n[中止于 step=${step}] ${e.message}`)
    console.error(e.stack)
  } finally {
    // 清理：只按本脚本自己记录的 ID 精确删除，绝不按名字/模糊条件删（污染共享夹具会让多个套件集体变红）
    const safe = async (label, sql, params) => {
      try { await pool.query(sql, params) } catch (e) { console.error(`[清理告警] ${label}: ${e.message}`) }
    }
    if (cleanup.productId) {
      if (cleanup.srTaskId) {
        await safe('return_events', "DELETE FROM return_order_events WHERE return_id=? AND return_type='sale'", [cleanup.srId])
        await safe('return_task_items', 'DELETE FROM return_task_items WHERE task_id=?', [cleanup.srTaskId])
        await safe('return_tasks', 'DELETE FROM return_tasks WHERE id=?', [cleanup.srTaskId])
      }
      if (cleanup.srId) {
        await safe('sale_return_items', 'DELETE FROM sale_return_items WHERE return_id=?', [cleanup.srId])
        await safe('sale_returns', 'DELETE FROM sale_returns WHERE id=?', [cleanup.srId])
      }
      if (cleanup.taskId) {
        await safe('print_jobs', "DELETE FROM print_jobs WHERE ref_type='package' AND ref_id IN (SELECT id FROM packages WHERE warehouse_task_id=?)", [cleanup.taskId])
        await safe('package_items', 'DELETE FROM package_items WHERE package_id IN (SELECT id FROM packages WHERE warehouse_task_id=?)', [cleanup.taskId])
        await safe('packages', 'DELETE FROM packages WHERE warehouse_task_id=?', [cleanup.taskId])
        await safe('warehouse_task_items', 'DELETE FROM warehouse_task_items WHERE task_id=?', [cleanup.taskId])
        await safe('warehouse_tasks', 'DELETE FROM warehouse_tasks WHERE id=?', [cleanup.taskId])
      }
      if (cleanup.saleId) {
        await safe('stock_reservations', "DELETE FROM stock_reservations WHERE ref_type='sale_order' AND ref_id=?", [cleanup.saleId])
        await safe('payment_records', 'DELETE FROM payment_records WHERE type=2 AND order_id=?', [cleanup.saleId])
        await safe('sale_order_items', 'DELETE FROM sale_order_items WHERE order_id=?', [cleanup.saleId])
        await safe('sale_orders', 'DELETE FROM sale_orders WHERE id=?', [cleanup.saleId])
      }
      await safe('inventory_containers', 'DELETE FROM inventory_containers WHERE product_id=?', [cleanup.productId])
      await safe('inventory_stock', 'DELETE FROM inventory_stock WHERE product_id=?', [cleanup.productId])
      await safe('product_items', 'DELETE FROM product_items WHERE id=?', [cleanup.productId])
    }
    await ctx.close()
  }
}

main()
