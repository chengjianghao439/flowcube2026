#!/usr/bin/env node
'use strict'

/**
 * 销售退货单「中间态取消」守卫 —— 回归测试
 * （2026-09-26 一致性审查 · 任务卡 任务 1 第一期 → 第二期返货出库）
 *
 * 被守卫的行为：销售退货单已有合格品上架入库（存在 ACTIVE 容器）时，
 *   不允许直接取消，也不得产生
 *   「库存已增加 + 应收未冲减 + 单据已取消」这一自相矛盾且无法追溯的状态。
 *
 * 处置沿革（第二期返货出库取代了第一期的直接拒绝）：
 *   第一期：取消直接返回 409 SALE_RETURN_HAS_INBOUND_CONTAINERS，把问题挡回去。
 *   第二期：取消受理为「先返货出库」（202）——自动生成返货出库单，把已入库的那批货
 *     按原批次逐个容器出库退回客户，出库完成后退货单自动转为已取消(4)。
 *   会计不变式两期相同：可取消的状态只有 2（已确认），此时应收从未冲减、退货凭证
 *   从未生成（凭证引擎取数条件是 sr.status = 3）——所以返货出库在会计上必须
 *   「什么都不做」：不碰 payment_records、不生成收入/成本。
 *
 * 三段场景（真实 HTTP 链路 + 独立测试库）：
 *   §A 部分明细已上架 → 取消 → 受理为 202：生成返货出库单、退货任务冻结为 REVERSING(7)、
 *      未上架容器作废，且库存/应收/单据状态一律不变
 *   §B 返货出库闭环：拣货扫码 → 待出库(6) → 出库 → 库存实减、应收与凭证零变化、
 *      同商品另一批分毫未动 → 退货单自动取消(4)、退货任务收口为已取消(6)
 *   §C 一条完全未收货的退货单 → 取消 → 必须成功（不能把正常取消一起堵掉）
 *
 * 运行：
 *   set -a; source ~/.config/flowcube/operations20260912-test.env; set +a
 *   node tests/sale-return-cancel-guard.smoke.test.js
 */

const {
  createLogger, prepareSmokeContext, dbQuery, login, randomRef,
} = require('./helpers/smokeTestKit')
const {
  createContainer, syncStockFromContainers, SOURCE_TYPE, CONTAINER_STATUS,
} = require('../backend/src/engine/containerEngine')
const { RT_STATUS } = require('../backend/src/modules/return-tasks/return-tasks.service')

const SEED_QTY = 100
const SALE_QTY = 10
const UNIT_PRICE = 15

const money = v => `¥${Number(v ?? 0).toFixed(2)}`

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
      remark: 'sale-return-cancel-guard seed',
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

/** 取出挂在该退货任务下的全部容器；并单独给出"仍指向本单的 ACTIVE 容器" */
const containersOfReturnTask = async (pool, taskId) => {
  const [rows] = await pool.query(
    `SELECT id, barcode, status, remaining_qty FROM inventory_containers
      WHERE source_ref_type='sale_return' AND source_ref_id=? AND deleted_at IS NULL ORDER BY id`,
    [taskId],
  )
  return rows.map(r => ({
    id: Number(r.id), barcode: r.barcode, status: Number(r.status), qty: Number(r.remaining_qty),
  }))
}

const activeOnReturn = list => list.filter(c => c.status === CONTAINER_STATUS.ACTIVE)

/** 该销售退货单当前的返货出库任务（第二期：取消退货单时自动生成） */
const reverseTaskOf = async (pool, srId) => {
  const [rows] = await pool.query(
    `SELECT id, task_no, task_type, status FROM warehouse_tasks
      WHERE task_type='sale_return_out' AND return_id=? AND deleted_at IS NULL
      ORDER BY id DESC LIMIT 1`, [srId])
  return rows[0]
    ? { id: Number(rows[0].id), task_no: rows[0].task_no, task_type: rows[0].task_type, status: Number(rows[0].status) }
    : null
}

const returnTaskStatus = async (pool, taskId) => {
  const [rows] = await pool.query('SELECT status FROM return_tasks WHERE id=?', [taskId])
  return rows[0] ? Number(rows[0].status) : null
}

const taskItemOf = async (pool, taskId) => {
  const [rows] = await pool.query(
    'SELECT id, product_id, required_qty FROM warehouse_task_items WHERE task_id=? ORDER BY id LIMIT 1', [taskId])
  return rows[0]
    ? { id: Number(rows[0].id), productId: Number(rows[0].product_id), requiredQty: Number(rows[0].required_qty) }
    : null
}

/** 当前被某任务锁定的容器（返货出库前 = 建单时预锁的原批次；出库后应为空） */
const containersOfTask = async (pool, taskId) => {
  const [rows] = await pool.query(
    `SELECT id, barcode, status, remaining_qty FROM inventory_containers
      WHERE locked_by_task_id=? AND deleted_at IS NULL ORDER BY id`, [taskId])
  return rows.map(r => ({
    id: Number(r.id), barcode: r.barcode, status: Number(r.status), qty: Number(r.remaining_qty),
  }))
}

const lockedCount = async (pool, taskId) => {
  const [rows] = await pool.query(
    'SELECT COUNT(*) AS c FROM inventory_containers WHERE locked_by_task_id=? AND deleted_at IS NULL', [taskId])
  return Number(rows[0].c)
}

const containerOf = async (pool, id) => {
  const [rows] = await pool.query(
    'SELECT id, status, remaining_qty, locked_by_task_id FROM inventory_containers WHERE id=?', [id])
  return rows[0]
    ? { id: Number(rows[0].id), status: Number(rows[0].status), remaining_qty: Number(rows[0].remaining_qty), locked_by_task_id: rows[0].locked_by_task_id }
    : null
}

/** 全库凭证条数：返货出库在任何情况下都不该新增凭证（可取消状态 2 从未生成退货凭证） */
const voucherCount = async (pool) => {
  const [rows] = await pool.query('SELECT COUNT(*) AS c FROM acct_vouchers')
  return Number(rows[0].c)
}

const pendingPutawayQty = async (pool, taskId) => {
  const [rows] = await pool.query(
    'SELECT COALESCE(SUM(checked_qty - rejected_qty - putaway_qty), 0) AS remaining FROM return_task_items WHERE task_id=?',
    [taskId],
  )
  return Number(rows[0].remaining)
}

/** 建销售单 → 占库 → 拣货 → 复核 → 装箱 → 出库（走完整 PDA 链路，返回已出库的销售单） */
async function shipSale(ctx, token, { product, seed, qty }) {
  const { pool, http, warehouse, location, customer, pdaHeaders } = ctx
  const H = pdaHeaders()

  const saleResp = await http.post('/api/sale', {
    token,
    json: {
      customerId: Number(customer.id), customerName: customer.name,
      warehouseId: Number(warehouse.id), warehouseName: warehouse.name,
      remark: randomRef('guard-sale'),
      items: [{
        productId: Number(product.id), productCode: product.code, productName: product.name,
        unit: product.unit, quantity: qty, unitPrice: UNIT_PRICE,
      }],
    },
  })
  if (!saleResp.ok) throw new Error(`建销售单失败: ${JSON.stringify(saleResp.data)}`)
  const saleId = Number(saleResp.data.data.id)

  await http.post(`/api/sale/${saleId}/reserve`, { token })
  const shipDispatch = await http.post(`/api/sale/${saleId}/ship`, { token })
  if (!shipDispatch.ok) throw new Error(`发起出库失败: ${JSON.stringify(shipDispatch.data)}`)

  const [saleRow] = await dbQuery(pool, 'SELECT task_id, order_no FROM sale_orders WHERE id=?', [saleId])
  const taskId = Number(saleRow.task_id)
  const [itemRow] = await dbQuery(pool, 'SELECT id FROM warehouse_task_items WHERE task_id=? ORDER BY id LIMIT 1', [taskId])

  const pick = await http.post('/api/scan-logs', {
    token, headers: H,
    json: {
      taskId, itemId: Number(itemRow.id), containerId: seed.containerId, barcode: seed.barcode,
      productId: Number(product.id), qty, scanMode: '整件',
    },
  })
  if (!pick.ok) throw new Error(`拣货扫码失败: ${JSON.stringify(pick.data)}`)

  const ready = await http.put(`/api/warehouse-tasks/${taskId}/ready`, { token, headers: H })
  if (!ready.ok) throw new Error(`ready 失败: ${JSON.stringify(ready.data)}`)

  const [taskInfo] = await dbQuery(pool, 'SELECT warehouse_id, sorting_bin_id FROM warehouse_tasks WHERE id=?', [taskId])
  if (!taskInfo.sorting_bin_id) {
    await pool.query('INSERT INTO sorting_bins (code, warehouse_id) VALUES (?,?)',
      [randomRef('GUARD-BIN').slice(0, 40), taskInfo.warehouse_id])
    const assigned = await http.post(`/api/warehouse-tasks/${taskId}/assign-sorting-bin`, {
      token, headers: { 'X-Request-Key': randomRef('guard-assign') }, json: {},
    })
    if (!assigned.ok) throw new Error(`assign-sorting-bin 失败: ${JSON.stringify(assigned.data)}`)
  }

  const sortDone = await http.put(`/api/warehouse-tasks/${taskId}/sort-done`, { token, headers: H, json: {} })
  if (!sortDone.ok) throw new Error(`sort-done 失败: ${JSON.stringify(sortDone.data)}`)

  const checkScan = await http.post('/api/scan-logs/check', { token, headers: H, json: { taskId, barcode: seed.barcode } })
  if (!checkScan.ok) throw new Error(`复核扫码失败: ${JSON.stringify(checkScan.data)}`)

  const pkg = await http.post('/api/packages', { token, headers: H, json: { warehouseTaskId: taskId } })
  const pkgId = Number(pkg.data?.data?.id)
  if (!pkgId) throw new Error(`创建装箱失败: ${JSON.stringify(pkg.data)}`)
  await http.post(`/api/packages/${pkgId}/add-item`, { token, headers: H, json: { productCode: product.code, qty } })
  await http.put(`/api/packages/${pkgId}/finish`, { token, headers: H })
  // 测试环境无真实打印客户端回执，直接置箱贴打印任务完成，跨过打印闭合
  await pool.query("UPDATE print_jobs SET status=2 WHERE ref_type='package' AND ref_id=?", [pkgId])

  const packDone = await http.put(`/api/warehouse-tasks/${taskId}/pack-done`, { token, headers: H })
  if (!packDone.ok) throw new Error(`pack-done 失败: ${JSON.stringify(packDone.data)}`)

  const shipDone = await http.put(`/api/warehouse-tasks/${taskId}/ship`, { token, headers: H })
  if (!shipDone.ok) throw new Error(`出库失败: ${JSON.stringify(shipDone.data)}`)

  const [taskAfter] = await dbQuery(pool, 'SELECT status FROM warehouse_tasks WHERE id=?', [taskId])
  if (Number(taskAfter.status) !== 7) throw new Error(`销售出库未到 status=7（实际 ${taskAfter.status}），前置条件不成立`)
  const recv = await receivableOf(pool, saleId)
  if (!recv) throw new Error('出库后未生成应收，前置条件不成立')

  return { saleId, taskId, orderNo: saleRow.order_no, receivable: recv }
}

/** 建销售退货单并确认，返回 { srId, srTaskId } */
async function createReturnOrder(ctx, token, { product, saleId, saleOrderNo, qty }) {
  const { pool, http, warehouse, customer } = ctx
  const [soi] = await dbQuery(pool, 'SELECT id, unit_price FROM sale_order_items WHERE order_id=? LIMIT 1', [saleId])
  const srCreate = await http.post('/api/returns/sale', {
    token,
    json: {
      customerId: Number(customer.id), customerName: customer.name,
      warehouseId: Number(warehouse.id), warehouseName: warehouse.name,
      saleOrderId: saleId, saleOrderNo,
      remark: randomRef('guard-sr'),
      items: [{
        sourceItemId: Number(soi.id), productId: Number(product.id), productCode: product.code,
        productName: product.name, unit: product.unit, quantity: qty, unitPrice: Number(soi.unit_price),
      }],
    },
  })
  if (!srCreate.ok) throw new Error(`建销售退货单失败: ${JSON.stringify(srCreate.data)}`)
  const srId = Number(srCreate.data.data.id)
  const confirm = await http.post(`/api/returns/sale/${srId}/confirm`, { token })
  if (!confirm.ok) throw new Error(`确认退货单失败: ${JSON.stringify(confirm.data)}`)

  const [srTask] = await dbQuery(pool,
    "SELECT id FROM return_tasks WHERE return_id=? AND return_type='sale' ORDER BY id DESC LIMIT 1", [srId])
  if (!srTask) throw new Error('退货单确认后未生成退货任务')
  return { srId, srTaskId: Number(srTask.id) }
}

/** 收货（分 2 包）→ 质检全合格，返回待上架容器列表 */
async function receiveAndCheck(ctx, token, { product, srTaskId, qty }) {
  const { http, pdaHeaders } = ctx
  const H = pdaHeaders()
  const half = Math.floor(qty / 2)

  const recvResp = await http.post(`/api/return-tasks/${srTaskId}/receive`, {
    token, headers: H,
    json: { productId: Number(product.id), packages: [{ qty: half }, { qty: qty - half }] },
  })
  if (!recvResp.ok) throw new Error(`退货收货失败: ${JSON.stringify(recvResp.data)}`)

  const checkResp = await http.post(`/api/return-tasks/${srTaskId}/check`, {
    token, headers: H,
    json: { productId: Number(product.id), passedQty: qty },
  })
  if (!checkResp.ok) throw new Error(`退货质检失败: ${JSON.stringify(checkResp.data)}`)

  const containers = (checkResp.data?.data?.containers || [])
    .filter(c => Number(c.status) === CONTAINER_STATUS.PENDING_PUTAWAY)
    .map(c => ({ containerId: Number(c.containerId), qty: Number(c.qty) }))
  if (containers.length < 2) {
    throw new Error(`期望至少 2 个待上架容器才能构造"部分上架"，实际 ${containers.length}`)
  }
  return containers
}

async function main() {
  const log = createLogger()
  const ctx = await prepareSmokeContext()
  const { pool, http, warehouse, location, printer } = ctx
  const cleanup = { productIds: [], saleIds: [], srIds: [], srTaskIds: [], taskIds: [], printerBindings: [] }
  let step = 'init'

  try {
    // 夹具自备（2026-09-27 复核）：不依赖任何库的历史残留行。
    // 出库链路 PUT /api/packages/:id/finish 要按「仓库 + package_label」找打印绑定，
    // 找不到就直接 409 PRINT_BINDING_MISSING，随后 pack-done / ship 全线连锁失败。
    // 共享库恰好有早期手工建的三条绑定，独立库一条都没有——所以本套件自带，
    // 收尾只删自己新建的那几条（按本轮 INSERT 的 id 精确删）。
    step = 'fixture:printer-bindings'
    for (const printType of ['package_label', 'container_label', 'rack_label']) {
      const [has] = await pool.query(
        'SELECT id FROM printer_bindings WHERE warehouse_id = ? AND print_type = ?',
        [warehouse.id, printType])
      if (has.length > 0) continue
      const [ins] = await pool.query(
        'INSERT INTO printer_bindings (warehouse_id, print_type, printer_id, printer_code) VALUES (?,?,?,?)',
        [warehouse.id, printType, printer.id, printer.code])
      cleanup.printerBindings.push(ins.insertId)
    }

    const adminLogin = await login(http, 'smoke_admin', 'SmokeAdmin123!')
    const token = adminLogin.token
    if (!token) throw new Error('smoke_admin 登录失败')

    // ── 播种：独立商品 + 独立库存 ──────────────────────────────
    step = 'seed'
    const code = `GUARD-SR-${randomRef('P')}`
    const [pr] = await pool.query(
      "INSERT INTO product_items (code, name, unit, sale_price_a) VALUES (?, '退货取消守卫测试商品', '个', 15)",
      [code],
    )
    const product = { id: pr.insertId, code, name: '退货取消守卫测试商品', unit: '个' }
    cleanup.productIds.push(product.id)
    const seed = await seedActiveContainer(pool, { product, warehouse, qty: SEED_QTY, locationId: location.id })

    // ══════════════════════════════════════════════════════════
    // §A 部分明细已上架 → 取消必须被拒（本任务的核心守卫）
    // ══════════════════════════════════════════════════════════
    log.section('§A 部分上架后取消退货单 → 必须 409，且库存/应收/状态不变')
    step = 'A:ship'
    const saleA = await shipSale(ctx, token, { product, seed, qty: SALE_QTY })
    cleanup.saleIds.push(saleA.saleId)
    cleanup.taskIds.push(saleA.taskId)

    step = 'A:return-create'
    const retA = await createReturnOrder(ctx, token, {
      product, saleId: saleA.saleId, saleOrderNo: saleA.orderNo, qty: SALE_QTY,
    })
    cleanup.srIds.push(retA.srId)
    cleanup.srTaskIds.push(retA.srTaskId)

    step = 'A:receive-check'
    const boxesA = await receiveAndCheck(ctx, token, { product, srTaskId: retA.srTaskId, qty: SALE_QTY })

    step = 'A:putaway-first-box'
    const putawayA = await http.post(`/api/return-tasks/${retA.srTaskId}/putaway`, {
      token, headers: ctx.pdaHeaders(),
      json: { containerId: boxesA[0].containerId, locationId: Number(location.id) },
    })
    if (!putawayA.ok) throw new Error(`退货上架失败: ${JSON.stringify(putawayA.data)}`)

    // 中间态快照
    const midStatus = await saleReturnStatus(pool, retA.srId)
    const midPending = await pendingPutawayQty(pool, retA.srTaskId)
    const midStock = Number((await stockQty(pool, product.id, warehouse.id)).quantity)
    const midRecv = Number((await receivableOf(pool, saleA.saleId)).total_amount)
    const midContainers = await containersOfReturnTask(pool, retA.srTaskId)
    console.log(`\n[中间态] 退货单=${midStatus}(2=已确认) 待上架=${midPending} 库存=${midStock} 应收=${money(midRecv)}`)
    console.log(`[中间态] 容器=${JSON.stringify(midContainers)}`)
    log.assert('前置成立：退货单停在已确认(2)', midStatus === 2, `实际=${midStatus}`)
    log.assert('前置成立：仍有待上架量（部分上架）', midPending > 0, `待上架=${midPending}`)
    log.assert('前置成立：已上架容器为 ACTIVE 并计入库存',
      activeOnReturn(midContainers).length > 0 && midStock > SEED_QTY - SALE_QTY,
      `ACTIVE=${activeOnReturn(midContainers).length} 库存=${midStock}`)

    step = 'A:cancel'
    const cancelA = await http.post(`/api/returns/sale/${retA.srId}/cancel`, { token })
    console.log(`\n[取消请求] HTTP ${cancelA.status} ${JSON.stringify(cancelA.data).slice(0, 240)}`)
    // 第二期（返货出库）取代了第一期的「直接拒绝」：取消不再被挡回，而是受理为
    // 「先返货出库」——202 表示请求已受理但单据尚未终结，返货出库完成后退货单自动取消。
    log.assert('★ 取消被受理为「需先返货出库」（202）', cancelA.status === 202,
      `实际 HTTP ${cancelA.status}`)
    const reverseA = cancelA.data?.data || {}
    log.assert('★ 返回 pendingReverse 与返货出库单号',
      reverseA.pendingReverse === true && !!reverseA.taskNo,
      JSON.stringify(cancelA.data).slice(0, 240))

    const afterStatusA = await saleReturnStatus(pool, retA.srId)
    const afterStockA = Number((await stockQty(pool, product.id, warehouse.id)).quantity)
    const afterRecvA = Number((await receivableOf(pool, saleA.saleId)).total_amount)
    const afterContainersA = await containersOfReturnTask(pool, retA.srTaskId)
    console.log(`[取消后] 退货单=${afterStatusA} 库存=${afterStockA} 应收=${money(afterRecvA)}`)

    log.assert('★ 退货单未被直接取消（仍为 2，等返货出库收口）', afterStatusA === 2, `实际=${afterStatusA}`)
    log.assert('★ 库存未被改动', afterStockA === midStock, `中间态=${midStock} 取消后=${afterStockA}`)
    log.assert('★ 应收未被改动', afterRecvA === midRecv, `中间态=${money(midRecv)} 取消后=${money(afterRecvA)}`)
    log.assert('★ 已入库容器仍是 ACTIVE 且挂在未取消的退货单上（追溯链未断裂）',
      activeOnReturn(afterContainersA).length === activeOnReturn(midContainers).length && afterStatusA !== 4,
      JSON.stringify(afterContainersA))

    step = 'A:reverse-task'
    const revTask = await reverseTaskOf(pool, retA.srId)
    if (revTask) cleanup.taskIds.push(revTask.id)
    log.assert('★ 已生成返货出库任务（task_type=sale_return_out）',
      !!revTask && revTask.task_type === 'sale_return_out',
      JSON.stringify(revTask))
    log.assert('★ 返货任务号与响应一致', !!revTask && revTask.task_no === reverseA.taskNo,
      `响应=${reverseA.taskNo} 库内=${revTask?.task_no}`)
    log.assert('★ 返货任务以「拣货中(2)」创建（走拣货→出库，无分拣/复核/打包）',
      !!revTask && Number(revTask.status) === 2, `实际=${revTask?.status}`)

    const rtpA = await returnTaskStatus(pool, retA.srTaskId)
    log.assert('★ 退货任务被冻结为反向处理中(7)（不能再上架，防重复入账）',
      rtpA === RT_STATUS.REVERSING, `实际=${rtpA}`)

    const voidedA = afterContainersA.filter(c => c.status === CONTAINER_STATUS.VOID)
    log.assert('★ 未上架的待上架容器被作废为 VOID(3)（不会再被上架）',
      voidedA.length === midContainers.filter(c => c.status === CONTAINER_STATUS.PENDING_PUTAWAY).length &&
      voidedA.length > 0,
      `作废=${JSON.stringify(voidedA)} 中间态=${JSON.stringify(midContainers)}`)

    // ══════════════════════════════════════════════════════════
    // §B 返货出库闭环：拣货 → 待出库 → 出库 → 退货单自动取消
    //    （原 §B 假设「取消后还能继续 putaway」，与第二期返货流程冲突——
    //      取消已把退货任务置 REVERSING(7)，该状态没有回 4 的边，上架必然被拒。
    //      这里改为按真实新流程断言完整闭环。）
    // ══════════════════════════════════════════════════════════
    log.section('§B 返货出库闭环：拣货 → 出库 → 退货单自动取消')
    step = 'B:cancel-forbidden'
    if (!revTask) throw new Error('§B 前置不成立：未找到返货出库任务')
    const cancelRev = await http.put(`/api/warehouse-tasks/${revTask.id}/cancel`, { token })
    log.assert('★ 返货出库单不能单独取消（须随退货单流程走完）',
      cancelRev.status === 409 &&
      String(cancelRev.data?.code || cancelRev.data?.error?.code || '') === 'SALE_RETURN_REVERSE_CANCEL_FORBIDDEN',
      `HTTP ${cancelRev.status} ${JSON.stringify(cancelRev.data).slice(0, 200)}`)

    // 同商品「另一批」容器（不是这张退货单退回来的）：扫它必须被拒，且出库后它分毫不动
    step = 'B:seed-foreign-batch'
    const foreign = await seedActiveContainer(pool, {
      product, warehouse, qty: 50, locationId: location.id,
    })

    step = 'B:pick'
    const revItem = await taskItemOf(pool, revTask.id)
    if (!revItem) throw new Error('§B 前置不成立：返货任务无明细')
    const revContainers = (await containersOfTask(pool, revTask.id)).filter(c => c.status === CONTAINER_STATUS.ACTIVE)
    log.assert('★ 建单时已把原批次容器预锁给返货任务（出库只能扣这批）',
      revContainers.length === activeOnReturn(midContainers).length && revContainers.length > 0,
      `预锁=${JSON.stringify(revContainers)}`)

    const foreignStockBefore = await stockQty(pool, product.id, warehouse.id)
    const foreignScan = await http.post('/api/scan-logs', {
      token, headers: ctx.pdaHeaders(),
      json: {
        taskId: revTask.id, itemId: Number(revItem.id), containerId: foreign.containerId,
        barcode: foreign.barcode, productId: Number(product.id), qty: 5, scanMode: '整件',
      },
    })
    log.assert('★ 扫同商品另一批条码被拒（409，只能退原退货单那批）',
      foreignScan.status === 409 &&
      String(foreignScan.data?.code || foreignScan.data?.error?.code || '') === 'SALE_RETURN_REVERSE_CONTAINER_NOT_OWNED',
      `HTTP ${foreignScan.status} ${JSON.stringify(foreignScan.data).slice(0, 200)}`)

    let pickedTotal = 0
    for (const c of revContainers) {
      const pickOne = await http.post('/api/scan-logs', {
        token, headers: ctx.pdaHeaders(),
        json: {
          taskId: revTask.id, itemId: Number(revItem.id), containerId: c.id,
          barcode: c.barcode, productId: Number(product.id), qty: c.qty, scanMode: '整件',
        },
      })
      if (!pickOne.ok) throw new Error(`返货拣货扫码失败(${c.barcode}): ${JSON.stringify(pickOne.data)}`)
      pickedTotal += c.qty
    }
    log.assert('★ 预锁容器逐个扫码拣货成功（合计 = 预返数量）',
      pickedTotal === revContainers.reduce((s, c) => s + c.qty, 0) && pickedTotal > 0,
      `已拣=${pickedTotal}`)

    step = 'B:ready'
    const readyRev = await http.put(`/api/warehouse-tasks/${revTask.id}/ready`, {
      token, headers: ctx.pdaHeaders(),
    })
    log.assert('★ 返货任务拣货完成直接推进到待出库(6)（跳过分拣/复核/打包）',
      readyRev.ok && Number(readyRev.data?.data?.status) === 6,
      `HTTP ${readyRev.status} ${JSON.stringify(readyRev.data).slice(0, 200)}`)

    const stockBeforeShip = Number((await stockQty(pool, product.id, warehouse.id)).quantity)
    const recvBeforeShip = Number((await receivableOf(pool, saleA.saleId)).total_amount)
    const vouchersBefore = await voucherCount(pool)
    const foreignBeforeShip = await containerOf(pool, foreign.containerId)

    step = 'B:ship'
    const shipRev = await http.put(`/api/warehouse-tasks/${revTask.id}/ship`, {
      token, headers: ctx.pdaHeaders(),
    })
    log.assert('★ 返货出库成功', shipRev.ok,
      `HTTP ${shipRev.status} ${JSON.stringify(shipRev.data).slice(0, 200)}`)

    const stockAfterShip = Number((await stockQty(pool, product.id, warehouse.id)).quantity)
    const recvAfterShip = Number((await receivableOf(pool, saleA.saleId)).total_amount)
    const vouchersAfter = await voucherCount(pool)
    const foreignAfterShip = await containerOf(pool, foreign.containerId)
    const revTaskAfter = await reverseTaskOf(pool, retA.srId)
    const rtpAfter = await returnTaskStatus(pool, retA.srTaskId)
    const statusAfterShip = await saleReturnStatus(pool, retA.srId)
    console.log(`[出库后] 退货单=${statusAfterShip} 退货任务=${rtpAfter} 返货任务=${revTaskAfter?.status} 库存=${stockAfterShip} 应收=${money(recvAfterShip)}`)

    log.assert('★ 库存按预锁容器实减（返货确实出库）',
      stockAfterShip === stockBeforeShip - pickedTotal,
      `出库前=${stockBeforeShip} 出库后=${stockAfterShip} 预期减 ${pickedTotal}`)
    log.assert('★ 应收未被重复增加（客户不会被多收一次钱）',
      recvAfterShip === recvBeforeShip, `出库前=${money(recvBeforeShip)} 出库后=${money(recvAfterShip)}`)
    log.assert('★ 未新增任何凭证（可取消状态 2 从未冲减应收、从未生成退货凭证）',
      vouchersAfter === vouchersBefore, `出库前=${vouchersBefore} 出库后=${vouchersAfter}`)
    log.assert('★ 同商品另一批容器分毫未动（没把别批发出去）',
      !!foreignBeforeShip && !!foreignAfterShip &&
      Number(foreignAfterShip.remaining_qty) === Number(foreignBeforeShip.remaining_qty) &&
      Number(foreignAfterShip.status) === Number(foreignBeforeShip.status),
      `前=${JSON.stringify(foreignBeforeShip)} 后=${JSON.stringify(foreignAfterShip)}`)
    log.assert('★ 返货任务到已出库(7)', Number(revTaskAfter?.status) === 7, `实际=${revTaskAfter?.status}`)
    log.assert('★ 退货任务由反向处理中(7)收口为已取消(6)', rtpAfter === RT_STATUS.CANCELLED,
      `实际=${rtpAfter}`)
    log.assert('★ 退货单自动取消(4)（返货出库完成后收口）', statusAfterShip === 4, `实际=${statusAfterShip}`)

    const [eventsB] = await pool.query(
      `SELECT title, description FROM return_order_events
        WHERE return_id=? AND return_type='sale' AND title LIKE '%已取消%' ORDER BY id DESC LIMIT 1`,
      [retA.srId],
    )
    log.assert('★ 取消事件明确说明「未冲减应收」',
      !!eventsB[0] && String(eventsB[0].description).includes('未冲减应收'),
      eventsB[0] ? eventsB[0].description : '(无事件)')

    // 出库后库存条码不再被本任务锁定（锁已释放，可被后续业务正常使用）
    const releasedLocks = await lockedCount(pool, revTask.id)
    log.assert('★ 出库后容器锁已释放', releasedLocks === 0, `仍锁=${releasedLocks}`)

    // ══════════════════════════════════════════════════════════
    // §C 完全未收货的退货单 → 取消必须成功（不能误伤正常取消）
    // ══════════════════════════════════════════════════════════
    log.section('§C 完全未收货的退货单 → 取消必须成功')
    step = 'C:ship'
    const saleC = await shipSale(ctx, token, { product, seed, qty: 1 })
    cleanup.saleIds.push(saleC.saleId)
    cleanup.taskIds.push(saleC.taskId)

    step = 'C:return-create'
    const retC = await createReturnOrder(ctx, token, {
      product, saleId: saleC.saleId, saleOrderNo: saleC.orderNo, qty: 1,
    })
    cleanup.srIds.push(retC.srId)
    cleanup.srTaskIds.push(retC.srTaskId)

    step = 'C:cancel'
    const cancelC = await http.post(`/api/returns/sale/${retC.srId}/cancel`, { token })
    console.log(`\n[取消请求] HTTP ${cancelC.status} ${JSON.stringify(cancelC.data).slice(0, 160)}`)
    log.assert('★ 未入库的退货单可以正常取消', cancelC.ok,
      `HTTP ${cancelC.status} ${JSON.stringify(cancelC.data).slice(0, 160)}`)

    const statusC = await saleReturnStatus(pool, retC.srId)
    const containersC = await containersOfReturnTask(pool, retC.srTaskId)
    log.assert('★ 退货单已置为已取消(4)', statusC === 4, `实际=${statusC}`)
    log.assert('★ 取消后不存在指向该退货单的 ACTIVE 容器（追溯链完整）',
      activeOnReturn(containersC).length === 0,
      JSON.stringify(containersC))

    const [eventsC] = await pool.query(
      `SELECT title, description FROM return_order_events
        WHERE return_id=? AND return_type='sale' ORDER BY id DESC LIMIT 1`, [retC.srId],
    )
    log.assert('★ 事件文案与实际一致（明确"无合格品上架"）',
      !!eventsC[0] && String(eventsC[0].description).includes('无合格品上架'),
      eventsC[0] ? eventsC[0].description : '(无事件)')
  } catch (e) {
    console.error(`\n[中止于 step=${step}] ${e.message}`)
    console.error(e.stack)
  } finally {
    // 只按本脚本记录的 ID 精确删除，绝不按名字/模糊条件删（污染共享夹具会让多个套件集体变红）
    const safe = async (label, sql, params) => {
      try { await pool.query(sql, params) } catch (e) { console.error(`[清理告警] ${label}: ${e.message}`) }
    }
    // 只删本轮 INSERT 的行，按 id 精确删——不用 (warehouse_id, print_type) 条件删：
    // 共享库若有并发任务在此刻替换了同一 (warehouse, print_type) 绑定，按条件删会删到别人的行。
    for (const bindingId of cleanup.printerBindings) {
      await safe('printer_bindings', 'DELETE FROM printer_bindings WHERE id=?', [bindingId])
    }
    for (const srTaskId of cleanup.srTaskIds) {
      await safe('return_task_items', 'DELETE FROM return_task_items WHERE task_id=?', [srTaskId])
      await safe('return_tasks', 'DELETE FROM return_tasks WHERE id=?', [srTaskId])
    }
    for (const srId of cleanup.srIds) {
      await safe('return_events', "DELETE FROM return_order_events WHERE return_id=? AND return_type='sale'", [srId])
      await safe('sale_return_items', 'DELETE FROM sale_return_items WHERE return_id=?', [srId])
      await safe('sale_returns', 'DELETE FROM sale_returns WHERE id=?', [srId])
    }
    for (const taskId of cleanup.taskIds) {
      await safe('print_jobs', "DELETE FROM print_jobs WHERE ref_type='package' AND ref_id IN (SELECT id FROM packages WHERE warehouse_task_id=?)", [taskId])
      await safe('package_items', 'DELETE FROM package_items WHERE package_id IN (SELECT id FROM packages WHERE warehouse_task_id=?)', [taskId])
      await safe('packages', 'DELETE FROM packages WHERE warehouse_task_id=?', [taskId])
      await safe('warehouse_task_items', 'DELETE FROM warehouse_task_items WHERE task_id=?', [taskId])
      await safe('warehouse_tasks', 'DELETE FROM warehouse_tasks WHERE id=?', [taskId])
    }
    for (const saleId of cleanup.saleIds) {
      await safe('stock_reservations', "DELETE FROM stock_reservations WHERE ref_type='sale_order' AND ref_id=?", [saleId])
      await safe('payment_records', 'DELETE FROM payment_records WHERE type=2 AND order_id=?', [saleId])
      await safe('sale_order_items', 'DELETE FROM sale_order_items WHERE order_id=?', [saleId])
      await safe('sale_orders', 'DELETE FROM sale_orders WHERE id=?', [saleId])
    }
    for (const pid of cleanup.productIds) {
      await safe('inventory_containers', 'DELETE FROM inventory_containers WHERE product_id=?', [pid])
      await safe('inventory_stock', 'DELETE FROM inventory_stock WHERE product_id=?', [pid])
      await safe('product_items', 'DELETE FROM product_items WHERE id=?', [pid])
    }
    await ctx.close()
    // 全局单例池（backend/src/config/db）自己收尾：app/service 查询过一次就会留住事件循环
    // （mysql2 socket 不 unref），断言全绿、退出码已定，进程却吊着不退。
    // 2026-09-26 实测：本套件断言跑完后挂住，被人工终止。
    // smokeTestKit.close() 只管它自建的池；两个池分开关，谁都不会被关两次。
    await require('../backend/src/config/db').pool.end()
    const summary = log.summary()
    if (summary.failed > 0) process.exitCode = 1
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
