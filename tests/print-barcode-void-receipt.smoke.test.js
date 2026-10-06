#!/usr/bin/env node
'use strict'

/**
 * 真实业务路径回归：撤回收货必须一并终结「未领取」的打印任务。
 *
 * 与 `print-barcode-void.smoke.test.js` 的分工：那一份直接造容器/打印任务夹具、验证补打入口与
 * 锁序；本份从**采购单 → 收货 → 上架 → 排打印任务**造出真实收货单，再走真正的 `voidReceipt`
 * service，验证撤回事务的完整副作用。
 *
 * §A 可撤回收货：容器置 VOID、单据回退「待收货(1)」、该单未领取的 PENDING 打印任务被终结且
 *    不再能被 `claimClientJobs` 领取（领取端不校验业务对象，只堵补打入口挡不住已入队的任务）。
 * §B 撤回被拒（容器已被后续动作改动 → `remaining_qty ≠ initial_qty`，void.js 的 touched 校验 409）：
 *    **不得误终结**打印任务，容器/单据/任务一律不变，该任务仍可被正常领取。
 *
 * 必须跑在显式回环独立测试库（`NODE_ENV=test` + `flowcube_<用途>_test`）。
 * 运行：
 *   set -a; source ~/.config/flowcube/operations20260912-test.env; set +a
 *   APP_UPDATE_DOWNLOADS_DIR=/tmp/flowcube-printvoid-downloads node tests/print-barcode-void-receipt.smoke.test.js
 */

const assert = require('node:assert/strict')
const {
  createLogger, prepareSmokeContext, dbQuery, login, randomRef,
} = require('./helpers/smokeTestKit')
const dispatch = require('../backend/src/modules/print-jobs/print-jobs.dispatch')

const QTY = 5
const UNIT_PRICE = 1000

const JOB_STATUS = { PENDING: 0, PRINTING: 1, DONE: 2, FAILED: 3 }
const CONTAINER_STATUS = { ACTIVE: 1, VOID: 3, PENDING_PUTAWAY: 4 }
const INBOUND_STATUS = { PENDING: 1, DONE: 4 }

async function createProduct(pool, label) {
  const code = randomRef(`PVOIDR-${label}`).slice(0, 40)
  const [r] = await pool.query(
    "INSERT INTO product_items (code, name, unit, sale_price_a, cost_price) VALUES (?, ?, '个', 1200, 1000)",
    [code, `PVOIDR测试商品-${label}`],
  )
  return { id: r.insertId, code, name: `PVOIDR测试商品-${label}`, unit: '个' }
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

/** 收货 →（短装时结案）→ 上架 */
async function receiveAndPutaway(ctx, token, { taskId, product, locationId, qty }) {
  const { http, pool, pdaHeaders } = ctx
  const recv = await http.post(`/api/inbound-tasks/${taskId}/receive`, {
    token, headers: pdaHeaders(), json: { productId: Number(product.id), packages: [{ qty }] },
  })
  if (!recv.ok) throw new Error(`收货失败: ${JSON.stringify(recv.data)}`)

  const [task] = await dbQuery(pool, 'SELECT status FROM inbound_tasks WHERE id=?', [taskId])
  if (Number(task.status) === 2) {
    const close = await http.post(`/api/inbound-tasks/${taskId}/close-receiving`, { token })
    if (!close.ok) throw new Error(`短装结案失败: ${JSON.stringify(close.data)}`)
  }

  const [box] = await dbQuery(
    pool,
    'SELECT id FROM inventory_containers WHERE inbound_task_id=? AND deleted_at IS NULL AND status=? ORDER BY id',
    [taskId, CONTAINER_STATUS.PENDING_PUTAWAY],
  )
  if (!box) throw new Error('未找到待上架容器')
  const put = await http.post(`/api/inbound-tasks/${taskId}/putaway`, {
    token, headers: pdaHeaders(), json: { containerId: Number(box.id), locationId: Number(locationId) },
  })
  if (!put.ok) throw new Error(`上架失败: ${JSON.stringify(put.data)}`)
}

/**
 * 建采购单 → 建收货单 → 提交 → 收货上架；返回 { product, poId, taskId }。
 *
 * **资源一创建就登记进 `cleanup`**，而不是等整个 helper 返回后才由调用方登记：
 * 中途任何一步抛错（如收货失败）时，已经建出来的商品/采购单仍会被 finally 清掉。
 * 若等返回才登记，抛错那一刻这些记录就永久遗留在共享库上了。
 */
async function seedReceivedTask(ctx, token, { supplier, warehouse, location, label, qty, cleanup }) {
  const { pool } = ctx
  const product = await createProduct(pool, label)
  cleanup.productIds.push(product.id)
  const poId = await seedPurchase(ctx.http, token, {
    supplier, warehouse, product, quantity: qty, unitPrice: UNIT_PRICE,
  })
  cleanup.poIds.push(poId)
  const taskResp = await ctx.http.post('/api/inbound-tasks', { token, json: { poId } })
  const taskId = Number(taskResp.data?.data?.taskId)
  if (!Number.isFinite(taskId) || taskId <= 0) {
    throw new Error(`建收货单失败: ${JSON.stringify(taskResp.data)}`)
  }
  await ctx.http.post(`/api/inbound-tasks/${taskId}/submit`, { token })
  await receiveAndPutaway(ctx, token, { taskId, product, locationId: location.id, qty })
  return { product, poId, taskId }
}

async function main() {
  const log = createLogger()
  const ctx = await prepareSmokeContext()
  const { pool, http, warehouse, location, supplier } = ctx
  const cleanup = { poIds: [], productIds: [], jobIds: [], printerIds: [], clientIds: [] }

  try {
    const { token } = await login(http, 'smoke_admin', 'SmokeAdmin123!')
    if (!token) throw new Error('smoke_admin 登录失败')

    // 打印基础设施：一台虚拟打印机 + 一个客户端，用于真实调用 claimClientJobs 验证「能否被领取」
    const code = randomRef('PVOIDR')
    const clientId = `test-${code}`
    const printClient = await require('./helpers/printClientIdentity').provisionTestPrintClient(pool, { clientId, warehouseId: warehouse.id })
    const [printer] = await pool.query(
      'INSERT INTO printers (name,code,type,warehouse_id,client_id,status) VALUES (?,?,1,?,?,1)',
      ['虚拟标签机', code, warehouse.id, clientId],
    )
    cleanup.printerIds.push(printer.insertId)
    cleanup.clientIds.push(clientId)

    const seedPendingJob = async (containerId, barcode) => {
      const [r] = await pool.query(
        `INSERT INTO print_jobs (title, content, status, warehouse_id, printer_id, ref_type, ref_id, ref_code, job_type)
         VALUES ('待打印','^XA^XZ',?,?,?,?,?,?,'container_label')`,
        [JOB_STATUS.PENDING, warehouse.id, printer.insertId, 'inventory_container', containerId, barcode],
      )
      cleanup.jobIds.push(r.insertId)
      return r.insertId
    }
    const claimedIds = async () => {
      const jobs = await dispatch.claimClientJobs({ identity: printClient.identity, limit: 50 })
      return jobs.map(j => Number(j.id))
    }

    // ══════════════════════════════════════════════════════════════════
    // §A 可撤回收货 → 真实 voidReceipt 必须终结未领取的打印任务
    // ══════════════════════════════════════════════════════════════════
    log.section('§A 可撤回收货：容器 VOID、单据回退、未领取任务被终结')
    const A = await seedReceivedTask(ctx, token, { supplier, warehouse, location, label: 'A', qty: QTY, cleanup })

    const aContainers = await dbQuery(
      pool,
      'SELECT id, barcode, status, remaining_qty FROM inventory_containers WHERE inbound_task_id=? AND deleted_at IS NULL',
      [A.taskId],
    )
    assert.ok(aContainers.length > 0, '前置：收货上架后应有容器')
    const aJob = await seedPendingJob(aContainers[0].id, aContainers[0].barcode)

    const [preTask] = await dbQuery(pool, 'SELECT status FROM inbound_tasks WHERE id=?', [A.taskId])
    log.assert(
      '前置：收货上架后单据为「已完成(4)」',
      Number(preTask.status) === INBOUND_STATUS.DONE,
      `实际 ${preTask.status}`,
    )

    const voidA = await http.post(`/api/inbound-tasks/${A.taskId}/void-receipt`, { token })
    log.assert('★ 撤回收货成功', voidA.ok, `HTTP ${voidA.status} ${JSON.stringify(voidA.data).slice(0, 160)}`)

    const [afterTask] = await dbQuery(pool, 'SELECT status FROM inbound_tasks WHERE id=?', [A.taskId])
    log.assert(
      '★ 单据状态回退到「待收货(1)」',
      Number(afterTask.status) === INBOUND_STATUS.PENDING,
      `实际 ${afterTask.status}`,
    )

    const afterContainers = await dbQuery(
      pool,
      'SELECT id, status, remaining_qty FROM inventory_containers WHERE inbound_task_id=? AND deleted_at IS NULL',
      [A.taskId],
    )
    log.assert(
      '★ 该单全部容器置 VOID(3) 且剩余量归零',
      afterContainers.length > 0
        && afterContainers.every(c => Number(c.status) === CONTAINER_STATUS.VOID && Number(c.remaining_qty) === 0),
      JSON.stringify(afterContainers),
    )

    const [aJobRow] = await dbQuery(pool, 'SELECT status, error_message FROM print_jobs WHERE id=?', [aJob])
    log.assert(
      '★ 未领取的 PENDING 打印任务被终结为 FAILED',
      Number(aJobRow.status) === JOB_STATUS.FAILED,
      `实际 status=${aJobRow.status}`,
    )
    log.assert(
      '★ 终结原因可分辨（container voided）',
      aJobRow.error_message === 'container voided',
      String(aJobRow.error_message),
    )
    const claimedA = await claimedIds()
    log.assert(
      '★ 撤回后该任务不可再被领取（claimClientJobs 不返回它）',
      !claimedA.includes(aJob),
      `claim 返回 ${JSON.stringify(claimedA)}`,
    )

    // ══════════════════════════════════════════════════════════════════
    // §B 撤回被拒 → 不得误终结
    // ══════════════════════════════════════════════════════════════════
    log.section('§B 撤回被拒：不得误终结打印任务')
    const B = await seedReceivedTask(ctx, token, { supplier, warehouse, location, label: 'B', qty: QTY, cleanup })

    const [bContainer] = await dbQuery(
      pool,
      'SELECT id, barcode FROM inventory_containers WHERE inbound_task_id=? AND deleted_at IS NULL ORDER BY id',
      [B.taskId],
    )
    // 制造「已被后续动作动过」：remaining_qty ≠ initial_qty，触发 void.js 的 touched 校验（409）
    await pool.query('UPDATE inventory_containers SET remaining_qty = remaining_qty - 1 WHERE id=?', [bContainer.id])
    const bJob = await seedPendingJob(bContainer.id, bContainer.barcode)

    const voidB = await http.post(`/api/inbound-tasks/${B.taskId}/void-receipt`, { token })
    log.assert(
      '★ 撤回收货被拒绝（409）',
      voidB.status === 409,
      `HTTP ${voidB.status} ${JSON.stringify(voidB.data).slice(0, 200)}`,
    )

    const [bTaskAfter] = await dbQuery(pool, 'SELECT status FROM inbound_tasks WHERE id=?', [B.taskId])
    log.assert(
      '拒绝后单据状态未变（仍为已完成(4)）',
      Number(bTaskAfter.status) === INBOUND_STATUS.DONE,
      `实际 ${bTaskAfter.status}`,
    )
    const [bContainerAfter] = await dbQuery(pool, 'SELECT status FROM inventory_containers WHERE id=?', [bContainer.id])
    log.assert(
      '★ 拒绝后容器未被打成 VOID',
      Number(bContainerAfter.status) !== CONTAINER_STATUS.VOID,
      `实际 status=${bContainerAfter.status}`,
    )
    const [bJobAfter] = await dbQuery(pool, 'SELECT status, error_message FROM print_jobs WHERE id=?', [bJob])
    log.assert(
      '★ 拒绝后打印任务未被误终结，仍是 PENDING',
      Number(bJobAfter.status) === JOB_STATUS.PENDING,
      `实际 status=${bJobAfter.status} error=${bJobAfter.error_message}`,
    )
    const claimedB = await claimedIds()
    log.assert(
      '★ 该任务仍可被正常领取（证明未被误终结）',
      claimedB.includes(bJob),
      `claim 返回 ${JSON.stringify(claimedB)}`,
    )
  } finally {
    // 按精确 ID 清理，绝不按名字/编码前缀批量删除（共享夹具自洁原则）。
    // 清理失败要收集起来参与到退出码——**不能只打印一行告警然后照报全绿**。
    const cleanupErrors = []
    const safe = async (label, sql, params) => {
      try { await pool.query(sql, params) } catch (e) { cleanupErrors.push(`${label}: ${e.message}`) }
    }
    for (const poId of cleanup.poIds) {
      const tasks = await dbQuery(pool, 'SELECT id FROM inbound_tasks WHERE purchase_order_id=?', [poId])
      for (const t of tasks) {
        await safe('inbound_task_events', 'DELETE FROM inbound_task_events WHERE task_id=?', [t.id])
        await safe('inventory_logs', "DELETE FROM inventory_logs WHERE ref_type='inbound_task' AND ref_id=?", [t.id])
        const containers = await dbQuery(pool, 'SELECT id FROM inventory_containers WHERE inbound_task_id=?', [t.id])
        for (const c of containers) {
          await safe('print_jobs', "DELETE FROM print_jobs WHERE ref_type='inventory_container' AND ref_id=?", [c.id])
        }
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
    for (const jid of cleanup.jobIds) await safe('print_jobs', 'DELETE FROM print_jobs WHERE id=?', [jid])
    for (const pid of cleanup.printerIds) await safe('printers', 'DELETE FROM printers WHERE id=?', [pid])
    for (const cid of cleanup.clientIds) await safe('print_clients', 'DELETE FROM print_clients WHERE client_id=?', [cid])
    for (const pid of cleanup.productIds) {
      await safe('inventory_stock', 'DELETE FROM inventory_stock WHERE product_id=?', [pid])
      await safe('product_items', 'DELETE FROM product_items WHERE id=?', [pid])
    }
    // 自洁核对：夹具必须真的清干净（必须在 ctx.close() 之前查，之后池就关了）
    const residual = {}
    const countLeft = async (name, sql, ids) => {
      const [[row]] = await pool.query(sql, [ids.length ? ids : ['__none__']])
      residual[name] = Number(Object.values(row)[0])
    }
    try {
      await countLeft('purchase_orders', 'SELECT COUNT(*) AS n FROM purchase_orders WHERE id IN (?)', cleanup.poIds)
      await countLeft('product_items', 'SELECT COUNT(*) AS n FROM product_items WHERE id IN (?)', cleanup.productIds)
      await countLeft('printers', 'SELECT COUNT(*) AS n FROM printers WHERE id IN (?)', cleanup.printerIds)
      await countLeft('print_clients', 'SELECT COUNT(*) AS n FROM print_clients WHERE client_id IN (?)', cleanup.clientIds)
    } catch (e) {
      cleanupErrors.push(`残留核对: ${e.message}`)
    }
    const leftover = Object.entries(residual).filter(([, n]) => n > 0)

    await ctx.close()
    // 全局单例池自己收尾（socket 不 unref，不关会让进程吊住）
    await require('../backend/src/config/db').pool.end()
    const counts = log.summary()
    if (leftover.length) {
      console.error(`[自洁失败] 夹具残留：${leftover.map(([k, n]) => `${k}=${n}`).join('、')}`)
    } else {
      console.log(`自洁核对：夹具残留 0（${Object.keys(residual).join(' / ')}）`)
    }
    if (cleanupErrors.length) {
      console.error(`[清理失败 ${cleanupErrors.length} 项] 夹具可能残留：`)
      for (const e of cleanupErrors) console.error(`  · ${e}`)
    }
    if (counts.failed > 0 || cleanupErrors.length > 0 || leftover.length > 0) process.exitCode = 1
  }
}

main().catch(error => { console.error(error); process.exit(1) })
