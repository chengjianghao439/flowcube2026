#!/usr/bin/env node
'use strict'

/**
 * 回归测试：已整箱调拨离开的容器，不得被「撤回收货」连带作废
 * （2026-09-26 一致性审查 · 任务 1）
 *
 * 修复前的行为：
 *   收货上架（容器 ACTIVE 在 A 仓）→ 整箱调拨 A→B（scanOut + scanIn 全部完成）
 *   ⇒ scanIn 会把容器的 transfer_order_id 清空、warehouse_id 停在 B 仓，而
 *     remaining_qty 与 initial_qty 完全相等、locked_by_task_id 也为空——
 *     原三重守卫（任务锁 / 在途 / 数量不等）因此**全部放行**。
 *     撤回随即把 B 仓（调入仓）的容器置 VOID、remaining_qty 归零、B 仓库存缓存被清，
 *     并同时按「从未收货」反冲采购应付，而调拨单仍是已完成状态：
 *     货在 B 仓账面上凭空消失、源仓应付也没了，全程没有任何流水解释这次减少。
 *     跨仓越权也在同一处：持 A 仓范围的人可以作废 B 仓的库存。
 *
 * 四段：
 *   §A 已整箱调拨完成 → 撤回必须 409(INBOUND_TASK_CONTAINER_MOVED_AWAY)，
 *      且容器 / 两仓库存缓存 / 应付 / 任务状态 / 库存流水一律不变
 *   §B 容器仍在原仓 → 撤回照常放行（证明新守卫没有过度拦截、没有误伤正常撤回）
 *   §C 仅在途（只 scanOut）→ 仍走原有「在途」守卫，原错误语义不被新守卫吞掉
 *   §D 调出又调回（A→B→A 两张调拨单全部完成）→ 容器又回到任务仓，只看「当前仓库」的
 *      守卫会第二次放行；必须按「该容器是否出现过调拨流水」拦下，409
 *      (INBOUND_TASK_CONTAINER_TRANSFERRED)。2026-09-27 二轮独立审阅 · 任务 1 补修。
 *
 * 运行：
 *   set -a; source ~/.config/flowcube/operations20260912-test.env; set +a
 *   APP_UPDATE_DOWNLOADS_DIR=/tmp/flowcube-repro-downloads node tests/inbound-void-transferred-container.smoke.test.js
 */

const path = require('path')
const {
  createLogger, prepareSmokeContext, dbQuery, login, randomRef,
} = require('./helpers/smokeTestKit')
// 常量从引擎取，不要手写字面量：MOVE_TYPE.RECEIPT_VOID 是数字 11 而非字符串，
// 写错的话计数恒为 0、断言就变成「0 === 0」的空转假绿。
const { MOVE_TYPE } = require('../backend/src/engine/inventoryEngine')
const { CONTAINER_STATUS } = require('../backend/src/engine/containerEngine')

const QTY = 10
const PRICE = 500          // 10 × 500 = 5000
const TRANSFER_QTY = QTY   // 整箱：调拨量必须正好等于容器数量（否则走「整箱超量」拒绝分支）

async function createProduct(pool, label) {
  const code = randomRef(`IVTC-${label}`).slice(0, 40)
  const [r] = await pool.query(
    "INSERT INTO product_items (code, name, unit, sale_price_a, cost_price) VALUES (?, ?, '个', 600, 500)",
    [code, `IVTC测试商品-${label}`],
  )
  return { id: r.insertId, code, name: `IVTC测试商品-${label}`, unit: '个' }
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

/** 收货 → （短装时结案）→ 上架 */
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
    `SELECT id FROM inventory_containers
      WHERE inbound_task_id=? AND deleted_at IS NULL AND status=4 ORDER BY id`,
    [taskId],
  )
  if (!box) throw new Error('未找到待上架容器')
  const put = await http.post(`/api/inbound-tasks/${taskId}/putaway`, {
    token, headers: pdaHeaders(), json: { containerId: Number(box.id), locationId: Number(locationId) },
  })
  if (!put.ok) throw new Error(`上架失败: ${JSON.stringify(put.data)}`)
}

/** 建采购单 → 建收货单 → 提交 → 收货上架 → 返回 { product, poId, taskId } */
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
  return { product, poId, taskId }
}

/** 建第二个仓库 + 库位 + 绑定该仓的 PDA 设备会话（scanIn 校验会话仓库必须等于调入仓） */
async function createSecondWarehouse(ctx, suffix, userId) {
  const { pool } = ctx
  const [wh] = await pool.query(
    'INSERT INTO inventory_warehouses (name, code) VALUES (?, ?)',
    [`IVTC调入仓-${suffix}`, `IVTC-WH2-${suffix}`],
  )
  const warehouseId = wh.insertId
  // 库位 code 是「全表唯一」（uk_location_code(code, active_unique_guard)），不能用可见的 A-01
  const [loc] = await pool.query(
    'INSERT INTO warehouse_locations (warehouse_id, code, name) VALUES (?, ?, ?)',
    [warehouseId, `IVTC-L2-${suffix}`, `IVTC调入库位-${suffix}`],
  )
  const locationId = loc.insertId

  const bcrypt = require(path.resolve(__dirname, '../backend/node_modules/bcryptjs'))
  const deviceCode = `IVTC-PDA2-${suffix}`
  const deviceSecret = `ivtc-secret-${suffix}`
  await pool.query(
    `INSERT INTO pda_devices (device_code, device_name, warehouse_id, status, secret_hash)
       VALUES (?, ?, ?, 'active', ?)`,
    [deviceCode, `IVTC调入仓PDA-${suffix}`, warehouseId, bcrypt.hashSync(deviceSecret, 10)],
  )
  const { createSession } = require('../backend/src/modules/pda/pda.sessions.service')
  const pdaSession = await createSession({ deviceCode, deviceSecret, userId })
  return {
    warehouseId,
    locationId,
    deviceCode,
    headers: (extra = {}) => ({ 'X-Client': 'pda', 'X-PDA-Session': pdaSession.sessionToken, ...extra }),
  }
}

/** 建调拨单并确认（from → to），返回 transferId */
async function createTransfer(http, token, { fromWarehouse, toWarehouse, product, quantity }) {
  const resp = await http.post('/api/transfer', {
    token,
    json: {
      fromWarehouseId: fromWarehouse.id, fromWarehouseName: fromWarehouse.name,
      toWarehouseId: toWarehouse.id, toWarehouseName: toWarehouse.name,
      items: [{
        productId: product.id, productCode: product.code,
        productName: product.name, unit: product.unit, quantity,
      }],
    },
  })
  if (!resp.ok) throw new Error(`建调拨单失败: ${JSON.stringify(resp.data)}`)
  const id = Number(resp.data?.data?.id)
  const confirm = await http.post(`/api/transfer/${id}/confirm`, { token })
  if (!confirm.ok) throw new Error(`确认调拨单失败: ${JSON.stringify(confirm.data)}`)
  return id
}

const money = v => `¥${Number(v ?? 0).toFixed(2)}`

const payableOf = async (pool, poId) => {
  const [row] = await dbQuery(
    pool,
    'SELECT id, total_amount, paid_amount, balance, status, confirm_status FROM payment_records WHERE type=1 AND order_id=?',
    [poId],
  )
  return row || null
}

const taskStatusOf = async (pool, taskId) => {
  const [row] = await dbQuery(pool, 'SELECT status, audit_status FROM inbound_tasks WHERE id=?', [taskId])
  return row || null
}

const containerOf = async (pool, containerId) => {
  const [row] = await dbQuery(
    pool,
    'SELECT id, barcode, warehouse_id, status, remaining_qty, initial_qty, transfer_order_id FROM inventory_containers WHERE id=?',
    [containerId],
  )
  return row || null
}

const stockOf = async (pool, productId, warehouseId) => {
  const [row] = await dbQuery(
    pool,
    'SELECT quantity FROM inventory_stock WHERE product_id=? AND warehouse_id=?',
    [productId, warehouseId],
  )
  return Number(row?.quantity || 0)
}

const activeQtyOf = async (pool, taskId) => {
  const [row] = await dbQuery(
    pool,
    `SELECT COALESCE(SUM(remaining_qty), 0) AS qty, COUNT(*) AS cnt
       FROM inventory_containers
      WHERE inbound_task_id=? AND deleted_at IS NULL AND status=1`,
    [taskId],
  )
  return { qty: Number(row?.qty || 0), cnt: Number(row?.cnt || 0) }
}

const voidLogsOf = async (pool, taskId) => {
  const [row] = await dbQuery(
    pool,
    "SELECT COUNT(*) AS n FROM inventory_logs WHERE ref_type='inbound_task' AND ref_id=? AND move_type=?",
    [taskId, MOVE_TYPE.RECEIPT_VOID],
  )
  return Number(row?.n || 0)
}

async function main() {
  const log = createLogger()
  const ctx = await prepareSmokeContext()
  const { pool, http, warehouse, location, supplier } = ctx
  const cleanup = { productIds: [], poIds: [], transferIds: [], secondWarehouses: [], deviceCodes: [] }
  let step = 'init'
  let second = null

  try {
    const adminLogin = await login(http, 'smoke_admin', 'SmokeAdmin123!')
    const token = adminLogin.token
    if (!token) throw new Error('smoke_admin 登录失败')
    const [adminRow] = await dbQuery(pool, "SELECT id FROM sys_users WHERE username='smoke_admin' LIMIT 1")
    const adminUserId = Number(adminRow?.id) || 1

    const suffix = randomRef('IVTC').slice(-8)
    step = 'fixture:second-warehouse'
    second = await createSecondWarehouse(ctx, suffix, adminUserId)
    cleanup.secondWarehouses.push(second)
    cleanup.deviceCodes.push(second.deviceCode)
    const secondWarehouse = { id: second.warehouseId, name: `IVTC调入仓-${suffix}` }
    const sourceWarehouse = { id: Number(warehouse.id), name: warehouse.name }
    log.assert('前置：调入仓与绑定该仓的 PDA 会话就绪', !!second.warehouseId, `warehouseId=${second.warehouseId}`)

    // ══════════════════════════════════════════════════════════════════
    // §A 已整箱调拨完成 → 撤回必须被拒绝，且不产生任何副作用
    // ══════════════════════════════════════════════════════════════════
    log.section('§A 整箱调拨完成后的收货单 → 撤回收货必须 409')
    step = 'A:seed'
    const A = await seedReceivedTask(ctx, token, {
      supplier, warehouse: sourceWarehouse, location, label: 'A', qty: QTY,
    })
    cleanup.productIds.push(A.product.id)
    cleanup.poIds.push(A.poId)

    const boxes = await dbQuery(
      pool,
      `SELECT id, barcode FROM inventory_containers
        WHERE inbound_task_id=? AND deleted_at IS NULL AND status=1 ORDER BY id`,
      [A.taskId],
    )
    if (boxes.length !== 1) throw new Error(`§A 前置不成立：期望 1 个 ACTIVE 容器，实得 ${boxes.length}`)
    const boxId = Number(boxes[0].id)
    const barcode = boxes[0].barcode
    const payableBefore = await payableOf(pool, A.poId)
    const stockSourceBefore = await stockOf(pool, A.product.id, sourceWarehouse.id)
    log.assert(
      '前置：上架后自动结算生成应付 5000',
      payableBefore && Math.abs(Number(payableBefore.total_amount) - QTY * PRICE) < 0.01,
      `应付 ${money(payableBefore?.total_amount)}`,
    )

    step = 'A:transfer'
    const transferId = await createTransfer(http, token, {
      fromWarehouse: sourceWarehouse, toWarehouse: secondWarehouse,
      product: A.product, quantity: TRANSFER_QTY,
    })
    cleanup.transferIds.push(transferId)
    const outResp = await http.post(`/api/transfer/${transferId}/scan-out`, {
      token, headers: ctx.pdaHeaders(), json: { containerBarcode: barcode },
    })
    log.assert('前置：调拨出库扫码成功', outResp.ok, JSON.stringify(outResp.data).slice(0, 160))
    const inResp = await http.post(`/api/transfer/${transferId}/scan-in`, {
      token, headers: second.headers(), json: { containerBarcode: barcode, locationId: second.locationId },
    })
    log.assert('前置：调拨入库扫码成功', inResp.ok, JSON.stringify(inResp.data).slice(0, 160))

    // 关键前置：这一行的形态正是旧三重守卫全部放行的原因
    const moved = await containerOf(pool, boxId)
    console.log(`\n[调拨完成后] 容器#${boxId} 仓库=${moved.warehouse_id} 状态=${moved.status} `
      + `数量=${moved.remaining_qty}/${moved.initial_qty} 调拨单=${moved.transfer_order_id}`)
    log.assert(
      '★ 前置成立（旧守卫放行的形态）：容器已在调入仓、状态 ACTIVE、数量未变、transfer_order_id 已清空',
      Number(moved.warehouse_id) === Number(second.warehouseId)
        && Number(moved.status) === 1
        && Math.abs(Number(moved.remaining_qty) - QTY) < 1e-6
        && moved.transfer_order_id == null,
      `warehouse=${moved.warehouse_id} status=${moved.status} qty=${moved.remaining_qty}/${moved.initial_qty} transfer=${moved.transfer_order_id}`,
    )

    step = 'A:void'
    const stockDestBefore = await stockOf(pool, A.product.id, second.warehouseId)
    const stockSourceAfterTransfer = await stockOf(pool, A.product.id, sourceWarehouse.id)
    log.assert(
      '前置：调拨确实把货移出了源仓（10 → 0）',
      Math.abs(stockSourceBefore - QTY) < 1e-6 && Math.abs(stockSourceAfterTransfer) < 1e-6,
      `调拨前=${stockSourceBefore} → 调拨后=${stockSourceAfterTransfer}`,
    )
    const taskBefore = await taskStatusOf(pool, A.taskId)
    const voidLogsBefore = await voidLogsOf(pool, A.taskId)
    const voidResp = await http.post(`/api/inbound-tasks/${A.taskId}/void-receipt`, { token })
    console.log(`\n[撤回收货] HTTP ${voidResp.status} ${JSON.stringify(voidResp.data).slice(0, 300)}`)
    log.assert(
      '★ 撤回收货被拒绝（409）',
      voidResp.status === 409,
      `实际 HTTP ${voidResp.status}：${JSON.stringify(voidResp.data).slice(0, 200)}`,
    )
    log.assert(
      '★ 错误码为 INBOUND_TASK_CONTAINER_MOVED_AWAY',
      voidResp.data?.code === 'INBOUND_TASK_CONTAINER_MOVED_AWAY',
      JSON.stringify(voidResp.data).slice(0, 240),
    )
    log.assert(
      '★ 拒绝消息点明「已调拨离开本仓库」与替代路径（采购退货单）',
      String(voidResp.data?.message || '').includes('调拨离开本仓库')
        && String(voidResp.data?.message || '').includes('采购退货单'),
      String(voidResp.data?.message || '').slice(0, 240),
    )
    log.assert(
      '★ 拒绝消息给的是可执行处置，且不暗示「调回本仓或稍后重试就能撤回」',
      String(voidResp.data?.message || '').includes('不能再撤回')
        && !String(voidResp.data?.message || '').includes('再重试'),
      String(voidResp.data?.message || '').slice(0, 300),
    )

    step = 'A:read-after-void'
    const after = await containerOf(pool, boxId)
    const stockDestAfter = await stockOf(pool, A.product.id, second.warehouseId)
    const stockSourceAfter = await stockOf(pool, A.product.id, sourceWarehouse.id)
    const payableAfter = await payableOf(pool, A.poId)
    const taskAfter = await taskStatusOf(pool, A.taskId)
    const voidLogsAfter = await voidLogsOf(pool, A.taskId)
    console.log(`[撤回被拒后] 容器#${boxId} 仓库=${after.warehouse_id} 状态=${after.status} 数量=${after.remaining_qty}/${after.initial_qty}`)
    console.log(`[撤回被拒后] 调入仓库存=${stockDestAfter} 源仓库存=${stockSourceAfter} 应付=${money(payableAfter?.total_amount)} 任务 status=${taskAfter?.status}`)

    log.assert(
      '★ 调入仓容器未被作废（仍 ACTIVE、数量未变、仍在调入仓）',
      Number(after.status) === 1
        && Math.abs(Number(after.remaining_qty) - QTY) < 1e-6
        && Number(after.warehouse_id) === Number(second.warehouseId),
      `状态=${after.status} 数量=${after.remaining_qty} 仓库=${after.warehouse_id}`,
    )
    log.assert(
      '★ 调入仓库存缓存未被清（被拒的撤回不得留下半截副作用）',
      Math.abs(stockDestAfter - stockDestBefore) < 1e-6 && Math.abs(stockDestAfter - QTY) < 1e-6,
      `调拨后=${stockDestBefore} → 撤回被拒后=${stockDestAfter}`,
    )
    log.assert(
      '★ 源仓库存未被误改（撤回被拒后仍是调出后的 0）',
      Math.abs(stockSourceAfter - stockSourceAfterTransfer) < 1e-6 && Math.abs(stockSourceAfter) < 1e-6,
      `调拨后=${stockSourceAfterTransfer} → 撤回被拒后=${stockSourceAfter}`,
    )
    log.assert(
      '★ 采购应付未被反冲（total_amount 仍为 5000）',
      payableAfter && Math.abs(Number(payableAfter.total_amount) - QTY * PRICE) < 0.01,
      `应付 ${money(payableAfter?.total_amount)}`,
    )
    log.assert(
      '★ 收货单未被打回（状态与审核状态均未变）',
      taskAfter && Number(taskAfter.status) === Number(taskBefore.status)
        && Number(taskAfter.audit_status) === Number(taskBefore.audit_status),
      `前 status=${taskBefore?.status}/audit=${taskBefore?.audit_status} → 后 status=${taskAfter?.status}/audit=${taskAfter?.audit_status}`,
    )
    log.assert(
      '★ 未新增「撤回收货」库存流水（拒绝发生在动账之前）',
      voidLogsAfter === voidLogsBefore,
      `流水条数 ${voidLogsBefore} → ${voidLogsAfter}`,
    )

    // ══════════════════════════════════════════════════════════════════
    // §B 反向对照：容器仍在原仓 → 撤回照常放行（新守卫不得过度拦截）
    // ══════════════════════════════════════════════════════════════════
    log.section('§B 容器仍在原仓 → 撤回收货照常放行')
    step = 'B:seed'
    const B = await seedReceivedTask(ctx, token, {
      supplier, warehouse: sourceWarehouse, location, label: 'B', qty: QTY,
    })
    cleanup.productIds.push(B.product.id)
    cleanup.poIds.push(B.poId)

    step = 'B:void'
    const voidB = await http.post(`/api/inbound-tasks/${B.taskId}/void-receipt`, { token })
    console.log(`\n[撤回收货] HTTP ${voidB.status} ${JSON.stringify(voidB.data).slice(0, 200)}`)
    log.assert('★ 未跨仓的收货单仍可正常撤回', voidB.ok, JSON.stringify(voidB.data).slice(0, 200))

    step = 'B:read'
    const stockB = await activeQtyOf(pool, B.taskId)
    const taskB = await taskStatusOf(pool, B.taskId)
    const payableB = await payableOf(pool, B.poId)
    log.assert(
      '★ 撤回生效：容器全部作废、库存归零',
      stockB.cnt === 0 && Math.abs(stockB.qty) < 1e-6,
      `容器 ${stockB.cnt} 个 / ${stockB.qty} 件`,
    )
    log.assert(
      '★ 撤回生效：收货单回到「待收货(1)」、审核状态清零',
      taskB && Number(taskB.status) === 1 && Number(taskB.audit_status) === 0,
      `status=${taskB?.status} audit=${taskB?.audit_status}`,
    )
    log.assert(
      '★ 撤回生效：应付反冲为 0',
      payableB && Math.abs(Number(payableB.total_amount)) < 0.01,
      `应付 ${money(payableB?.total_amount)}`,
    )

    // ══════════════════════════════════════════════════════════════════
    // §C 在途保护回归：只 scanOut（未 scanIn）时仍走原有「在途」守卫
    // ══════════════════════════════════════════════════════════════════
    log.section('§C 仅在途（只调出未调入）→ 仍由原「在途」守卫拒绝')
    step = 'C:seed'
    const C = await seedReceivedTask(ctx, token, {
      supplier, warehouse: sourceWarehouse, location, label: 'C', qty: QTY,
    })
    cleanup.productIds.push(C.product.id)
    cleanup.poIds.push(C.poId)
    const cBoxes = await dbQuery(
      pool,
      `SELECT id, barcode FROM inventory_containers
        WHERE inbound_task_id=? AND deleted_at IS NULL AND status=1 ORDER BY id`,
      [C.taskId],
    )
    if (cBoxes.length !== 1) throw new Error(`§C 前置不成立：期望 1 个 ACTIVE 容器，实得 ${cBoxes.length}`)

    step = 'C:scan-out-only'
    const cTransferId = await createTransfer(http, token, {
      fromWarehouse: sourceWarehouse, toWarehouse: secondWarehouse,
      product: C.product, quantity: TRANSFER_QTY,
    })
    cleanup.transferIds.push(cTransferId)
    const cOut = await http.post(`/api/transfer/${cTransferId}/scan-out`, {
      token, headers: ctx.pdaHeaders(), json: { containerBarcode: cBoxes[0].barcode },
    })
    log.assert('前置：调拨出库扫码成功（容器进入在途）', cOut.ok, JSON.stringify(cOut.data).slice(0, 160))
    const inTransitRow = await containerOf(pool, Number(cBoxes[0].id))
    log.assert(
      '前置成立：容器 transfer_order_id 非空（在途）',
      inTransitRow.transfer_order_id != null,
      `transfer_order_id=${inTransitRow.transfer_order_id}`,
    )

    step = 'C:void'
    const voidC = await http.post(`/api/inbound-tasks/${C.taskId}/void-receipt`, { token })
    console.log(`\n[撤回收货] HTTP ${voidC.status} ${JSON.stringify(voidC.data).slice(0, 240)}`)
    log.assert('★ 在途容器仍被拒绝（409）', voidC.status === 409, `实际 HTTP ${voidC.status}`)
    log.assert(
      '★ 命中原有的「调拨在途」守卫（新守卫未抢先吞掉原错误语义）',
      String(voidC.data?.message || '').includes('调拨在途'),
      String(voidC.data?.message || '').slice(0, 240),
    )
    const inTransitAfter = await containerOf(pool, Number(cBoxes[0].id))
    log.assert(
      '★ 在途容器未被改动（仍在调入仓、状态未变、调拨单仍挂着）',
      Number(inTransitAfter.status) === Number(inTransitRow.status)
        && Number(inTransitAfter.warehouse_id) === Number(inTransitRow.warehouse_id)
        && inTransitAfter.transfer_order_id != null,
      `状态=${inTransitAfter.status} 仓库=${inTransitAfter.warehouse_id} transfer=${inTransitAfter.transfer_order_id}`,
    )

    // ══════════════════════════════════════════════════════════════════
    // §D 调出又调回（A→B→A 两张调拨单全部完成）→ 容器又回到任务仓，
    //    形态与「从未调拨」一模一样：只看当前仓库的守卫会第二次放行。
    // ══════════════════════════════════════════════════════════════════
    log.section('§D 整箱调拨 A→B→A 往返完成后的收货单 → 撤回收货必须 409')
    step = 'D:seed'
    const D = await seedReceivedTask(ctx, token, {
      supplier, warehouse: sourceWarehouse, location, label: 'D', qty: QTY,
    })
    cleanup.productIds.push(D.product.id)
    cleanup.poIds.push(D.poId)
    const dBoxes = await dbQuery(
      pool,
      `SELECT id, barcode FROM inventory_containers
        WHERE inbound_task_id=? AND deleted_at IS NULL AND status=1 ORDER BY id`,
      [D.taskId],
    )
    if (dBoxes.length !== 1) throw new Error(`§D 前置不成立：期望 1 个 ACTIVE 容器，实得 ${dBoxes.length}`)
    const dBoxId = Number(dBoxes[0].id)
    const dBarcode = dBoxes[0].barcode

    step = 'D:transfer-out'
    const dTransfer1 = await createTransfer(http, token, {
      fromWarehouse: sourceWarehouse, toWarehouse: secondWarehouse,
      product: D.product, quantity: TRANSFER_QTY,
    })
    cleanup.transferIds.push(dTransfer1)
    const dOut1 = await http.post(`/api/transfer/${dTransfer1}/scan-out`, {
      token, headers: ctx.pdaHeaders(), json: { containerBarcode: dBarcode },
    })
    log.assert('前置：第一程调出（A→B）扫码成功', dOut1.ok, JSON.stringify(dOut1.data).slice(0, 160))
    const dIn1 = await http.post(`/api/transfer/${dTransfer1}/scan-in`, {
      token, headers: second.headers(), json: { containerBarcode: dBarcode, locationId: second.locationId },
    })
    log.assert('前置：第一程调入（A→B）扫码成功', dIn1.ok, JSON.stringify(dIn1.data).slice(0, 160))

    step = 'D:transfer-back'
    const dTransfer2 = await createTransfer(http, token, {
      fromWarehouse: secondWarehouse, toWarehouse: sourceWarehouse,
      product: D.product, quantity: TRANSFER_QTY,
    })
    cleanup.transferIds.push(dTransfer2)
    const dOut2 = await http.post(`/api/transfer/${dTransfer2}/scan-out`, {
      token, headers: second.headers(), json: { containerBarcode: dBarcode },
    })
    log.assert('前置：第二程调出（B→A）扫码成功', dOut2.ok, JSON.stringify(dOut2.data).slice(0, 160))
    const dIn2 = await http.post(`/api/transfer/${dTransfer2}/scan-in`, {
      token, headers: ctx.pdaHeaders(), json: { containerBarcode: dBarcode, locationId: location.id },
    })
    log.assert('前置：第二程调入（B→A）扫码成功', dIn2.ok, JSON.stringify(dIn2.data).slice(0, 160))

    const back = await containerOf(pool, dBoxId)
    console.log(`\n[往返调拨完成后] 容器#${dBoxId} 仓库=${back.warehouse_id} 状态=${back.status} `
      + `数量=${back.remaining_qty}/${back.initial_qty} 调拨单=${back.transfer_order_id}`)
    log.assert(
      '★ 前置成立（只看当前仓库就会放行的形态）：容器已回到任务仓、状态 ACTIVE、数量未变、transfer_order_id 已清空',
      Number(back.warehouse_id) === Number(sourceWarehouse.id)
        && Number(back.status) === 1
        && Math.abs(Number(back.remaining_qty) - QTY) < 1e-6
        && back.transfer_order_id == null,
      `warehouse=${back.warehouse_id} status=${back.status} qty=${back.remaining_qty}/${back.initial_qty} transfer=${back.transfer_order_id}`,
    )
    const dTransferLogs = await dbQuery(
      pool,
      "SELECT ref_no FROM inventory_logs WHERE container_id=? AND ref_type='transfer' ORDER BY id",
      [dBoxId],
    )
    log.assert(
      '★ 前置成立：该容器在流水里留下 4 条调拨留痕（出 A / 入 B / 出 B / 入 A），这是唯一的调拨证据',
      dTransferLogs.length === 4,
      `留痕 ${dTransferLogs.length} 条：${dTransferLogs.map(r => r.ref_no).join('、')}`,
    )
    const [dTransfer2Row] = await dbQuery(
      pool, 'SELECT order_no FROM transfer_orders WHERE id=?', [dTransfer2],
    )
    const dTransfer2No = dTransfer2Row?.order_no

    step = 'D:void'
    const dStockBefore = await stockOf(pool, D.product.id, sourceWarehouse.id)
    const dPayableBefore = await payableOf(pool, D.poId)
    const dTaskBefore = await taskStatusOf(pool, D.taskId)
    const dVoidLogsBefore = await voidLogsOf(pool, D.taskId)
    const voidD = await http.post(`/api/inbound-tasks/${D.taskId}/void-receipt`, { token })
    console.log(`\n[撤回收货] HTTP ${voidD.status} ${JSON.stringify(voidD.data).slice(0, 300)}`)
    log.assert(
      '★ 往返调拨后的撤回被拒绝（409）——只看当前仓库会误放行',
      voidD.status === 409,
      `实际 HTTP ${voidD.status}：${JSON.stringify(voidD.data).slice(0, 200)}`,
    )
    log.assert(
      '★ 错误码为 INBOUND_TASK_CONTAINER_TRANSFERRED（已参与过调拨，与「已离开本仓」区分开）',
      voidD.data?.code === 'INBOUND_TASK_CONTAINER_TRANSFERRED',
      JSON.stringify(voidD.data).slice(0, 240),
    )
    log.assert(
      '★ 拒绝消息点出实际调拨单号，便于核对是哪两张单据',
      String(voidD.data?.message || '').includes(String(dTransfer2No))
        && String(voidD.data?.message || '').includes('采购退货单'),
      String(voidD.data?.message || '').slice(0, 300),
    )
    log.assert(
      '★ 拒绝消息给的是可执行处置，且不暗示「调回本仓或稍后重试就能撤回」',
      String(voidD.data?.message || '').includes('不能再撤回')
        && !String(voidD.data?.message || '').includes('再重试'),
      String(voidD.data?.message || '').slice(0, 300),
    )

    step = 'D:read-after-void'
    const dAfter = await containerOf(pool, dBoxId)
    const dStockAfter = await stockOf(pool, D.product.id, sourceWarehouse.id)
    const dPayableAfter = await payableOf(pool, D.poId)
    const dTaskAfter = await taskStatusOf(pool, D.taskId)
    const dVoidLogsAfter = await voidLogsOf(pool, D.taskId)
    console.log(`[撤回被拒后] 容器#${dBoxId} 仓库=${dAfter.warehouse_id} 状态=${dAfter.status} 数量=${dAfter.remaining_qty}`)
    console.log(`[撤回被拒后] 源仓库存=${dStockAfter} 应付=${money(dPayableAfter?.total_amount)} 任务 status=${dTaskAfter?.status}`)
    log.assert(
      '★ 容器未被作废（仍 ACTIVE、数量未变、仍在任务仓）',
      Number(dAfter.status) === 1
        && Math.abs(Number(dAfter.remaining_qty) - QTY) < 1e-6
        && Number(dAfter.warehouse_id) === Number(sourceWarehouse.id),
      `状态=${dAfter.status} 数量=${dAfter.remaining_qty} 仓库=${dAfter.warehouse_id}`,
    )
    log.assert(
      '★ 库存缓存未被清（往返调拨后回到 10，被拒的撤回不得留下半截副作用）',
      Math.abs(dStockBefore - QTY) < 1e-6 && Math.abs(dStockAfter - QTY) < 1e-6,
      `撤回前=${dStockBefore} → 撤回被拒后=${dStockAfter}`,
    )
    log.assert(
      '★ 采购应付未被反冲（total_amount 仍为 5000）',
      dPayableAfter && Math.abs(Number(dPayableAfter.total_amount) - QTY * PRICE) < 0.01
        && Math.abs(Number(dPayableAfter.total_amount) - Number(dPayableBefore?.total_amount)) < 0.01,
      `应付 ${money(dPayableBefore?.total_amount)} → ${money(dPayableAfter?.total_amount)}`,
    )
    log.assert(
      '★ 收货单未被打回（状态与审核状态均未变）',
      dTaskAfter && Number(dTaskAfter.status) === Number(dTaskBefore.status)
        && Number(dTaskAfter.audit_status) === Number(dTaskBefore.audit_status),
      `前 status=${dTaskBefore?.status}/audit=${dTaskBefore?.audit_status} → 后 status=${dTaskAfter?.status}/audit=${dTaskAfter?.audit_status}`,
    )
    log.assert(
      '★ 未新增「撤回收货」库存流水（拒绝发生在动账之前）',
      dVoidLogsAfter === dVoidLogsBefore,
      `流水条数 ${dVoidLogsBefore} → ${dVoidLogsAfter}`,
    )

    // ══════════════════════════════════════════════════════════════════
    // §E 在途异常了结（force-close）把在途容器置 VOID → 撤回仍必须被拒绝
    //    2026-09-27 二轮审阅 · 任务 1 第三条路径：撤回候选集只查
    //    ACTIVE/PENDING_PUTAWAY/EMPTY，而 forceCloseInTransit 把在途容器改成 VOID
    //    并清空 transfer_order_id —— 容器同时脱离候选集、摘掉在途标记，此时
    //    「在途」与「已不在任务仓」两道守卫都看不到它，只看候选容器就会整条漏掉。
    //    真实 API 路径：收货上架 → 调拨 scanOut → force-close → void-receipt。
    // ══════════════════════════════════════════════════════════════════
    log.section('§E 在途异常了结（容器已作废）→ 撤回收货必须 409')
    step = 'E:seed'
    const E = await seedReceivedTask(ctx, token, {
      supplier, warehouse: sourceWarehouse, location, label: 'E', qty: QTY,
    })
    cleanup.productIds.push(E.product.id)
    cleanup.poIds.push(E.poId)
    const eBoxes = await dbQuery(
      pool,
      `SELECT id, barcode FROM inventory_containers
        WHERE inbound_task_id=? AND deleted_at IS NULL AND status=1 ORDER BY id`,
      [E.taskId],
    )
    if (eBoxes.length !== 1) throw new Error(`§E 前置不成立：期望 1 个 ACTIVE 容器，实得 ${eBoxes.length}`)
    const eBoxId = Number(eBoxes[0].id)
    const eBarcode = eBoxes[0].barcode

    step = 'E:scan-out'
    const eTransferId = await createTransfer(http, token, {
      fromWarehouse: sourceWarehouse, toWarehouse: secondWarehouse,
      product: E.product, quantity: TRANSFER_QTY,
    })
    cleanup.transferIds.push(eTransferId)
    const eOut = await http.post(`/api/transfer/${eTransferId}/scan-out`, {
      token, headers: ctx.pdaHeaders(), json: { containerBarcode: eBarcode },
    })
    log.assert('前置：调拨调出（A→B）扫码成功', eOut.ok, JSON.stringify(eOut.data).slice(0, 160))
    const eInTransit = await containerOf(pool, eBoxId)
    log.assert(
      '前置：容器已在途（status=PENDING_PUTAWAY、transfer_order_id 非空、已在调入仓）',
      Number(eInTransit.status) === CONTAINER_STATUS.PENDING_PUTAWAY
        && eInTransit.transfer_order_id != null
        && Number(eInTransit.warehouse_id) === Number(second.warehouseId),
      `status=${eInTransit.status} transfer=${eInTransit.transfer_order_id} warehouse=${eInTransit.warehouse_id}`,
    )
    const eStockAfterScanOut = await stockOf(pool, E.product.id, sourceWarehouse.id)
    log.assert(
      '前置：调出已把货从源仓账面扣走（源仓现货缓存归零，货已不在这里）',
      Math.abs(eStockAfterScanOut) < 1e-6,
      `源仓库存=${eStockAfterScanOut}`,
    )

    step = 'E:force-close'
    const [eTransferRow] = await dbQuery(pool, 'SELECT order_no FROM transfer_orders WHERE id=?', [eTransferId])
    const eTransferNo = eTransferRow?.order_no
    const eForceClose = await http.post(`/api/transfer/${eTransferId}/force-close`, {
      token, json: { reason: 'IVTC 回归：在途异常了结（运输损耗核销）' },
    })
    console.log(`\n[异常了结] HTTP ${eForceClose.status} ${JSON.stringify(eForceClose.data).slice(0, 200)}`)
    log.assert(
      '前置：异常了结成功（transfer.order.force-close；超管角色 role_id=1 在权限中间件里豁免）',
      eForceClose.ok,
      `HTTP ${eForceClose.status}：${JSON.stringify(eForceClose.data).slice(0, 200)}`,
    )

    const eVoided = await containerOf(pool, eBoxId)
    const eTransferLogs = await dbQuery(
      pool,
      "SELECT move_type, ref_no FROM inventory_logs WHERE container_id=? AND ref_type='transfer' ORDER BY id",
      [eBoxId],
    )
    console.log(`[异常了结后] 容器#${eBoxId} 仓库=${eVoided.warehouse_id} 状态=${eVoided.status} `
      + `数量=${eVoided.remaining_qty}/${eVoided.initial_qty} 调拨单=${eVoided.transfer_order_id}`)
    log.assert(
      '★ 前置成立（撤回候选集天生看不见的形态）：容器已 VOID、transfer_order_id 已清空、数量仍等于 initial_qty',
      Number(eVoided.status) === CONTAINER_STATUS.VOID
        && eVoided.transfer_order_id == null
        && Math.abs(Number(eVoided.remaining_qty) - QTY) < 1e-6,
      `status=${eVoided.status} transfer=${eVoided.transfer_order_id} qty=${eVoided.remaining_qty}/${eVoided.initial_qty}`,
    )
    log.assert(
      '★ 前置成立：它既不在撤回候选状态里、也不带在途标记——只剩调拨流水这一条证据',
      ![CONTAINER_STATUS.ACTIVE, CONTAINER_STATUS.PENDING_PUTAWAY, CONTAINER_STATUS.EMPTY]
        .includes(Number(eVoided.status))
        && eTransferLogs.length === 1
        && Number(eTransferLogs[0].move_type) === Number(MOVE_TYPE.TRANSFER_OUT),
      `status=${eVoided.status} 调拨流水=${eTransferLogs.length} 条（${eTransferLogs.map(r => r.ref_no).join('、')}）`,
    )

    step = 'E:void'
    const eStockBefore = await stockOf(pool, E.product.id, sourceWarehouse.id)
    const ePayableBefore = await payableOf(pool, E.poId)
    const eTaskBefore = await taskStatusOf(pool, E.taskId)
    const eVoidLogsBefore = await voidLogsOf(pool, E.taskId)
    const voidE = await http.post(`/api/inbound-tasks/${E.taskId}/void-receipt`, { token })
    console.log(`[撤回收货] HTTP ${voidE.status} ${JSON.stringify(voidE.data).slice(0, 300)}`)
    log.assert(
      '★ 在途异常了结后的撤回被拒绝（409）——只认当前仓库/在途标记会误放行',
      voidE.status === 409,
      `实际 HTTP ${voidE.status}：${JSON.stringify(voidE.data).slice(0, 240)}`,
    )
    log.assert(
      '★ 错误码为 INBOUND_TASK_CONTAINER_TRANSFERRED（该容器有调拨流水）',
      voidE.data?.code === 'INBOUND_TASK_CONTAINER_TRANSFERRED',
      JSON.stringify(voidE.data).slice(0, 240),
    )
    log.assert(
      '★ 拒绝消息点出实际调拨单号，且给的是可执行处置（采购退货单 / 盘点），不暗示重试',
      String(voidE.data?.message || '').includes(String(eTransferNo))
        && String(voidE.data?.message || '').includes('采购退货单')
        && String(voidE.data?.message || '').includes('不能再撤回')
        && !String(voidE.data?.message || '').includes('再重试'),
      String(voidE.data?.message || '').slice(0, 320),
    )

    step = 'E:read-after-void'
    const eAfter = await containerOf(pool, eBoxId)
    const eStockAfter = await stockOf(pool, E.product.id, sourceWarehouse.id)
    const ePayableAfter = await payableOf(pool, E.poId)
    const eTaskAfter = await taskStatusOf(pool, E.taskId)
    const eVoidLogsAfter = await voidLogsOf(pool, E.taskId)
    console.log(`[撤回被拒后] 容器#${eBoxId} 状态=${eAfter.status} 数量=${eAfter.remaining_qty} `
      + `源仓库存=${eStockAfter} 应付=${money(ePayableAfter?.total_amount)} 任务 status=${eTaskAfter?.status}`)
    log.assert(
      '★ 采购应付未被反冲（否则货已按运输损耗核销、钱也一起退了，账面两头空）',
      ePayableAfter && Math.abs(Number(ePayableAfter.total_amount) - QTY * PRICE) < 0.01
        && Math.abs(Number(ePayableAfter.total_amount) - Number(ePayableBefore?.total_amount)) < 0.01,
      `应付 ${money(ePayableBefore?.total_amount)} → ${money(ePayableAfter?.total_amount)}`,
    )
    log.assert(
      '★ 收货单未被打回（未从已完成退回待收货）',
      eTaskAfter && Number(eTaskAfter.status) === Number(eTaskBefore.status)
        && Number(eTaskAfter.audit_status) === Number(eTaskBefore.audit_status),
      `前 status=${eTaskBefore?.status}/audit=${eTaskBefore?.audit_status} → 后 status=${eTaskAfter?.status}/audit=${eTaskAfter?.audit_status}`,
    )
    log.assert(
      '★ 未新增「撤回收货」库存流水（拒绝发生在动账之前）',
      eVoidLogsAfter === eVoidLogsBefore,
      `流水条数 ${eVoidLogsBefore} → ${eVoidLogsAfter}`,
    )
    log.assert(
      '★ 库存缓存未被改动（源仓仍为调出后的 0，撤回不得凭空补回）',
      Math.abs(eStockBefore - eStockAfter) < 1e-6,
      `撤回前=${eStockBefore} → 撤回被拒后=${eStockAfter}`,
    )
    log.assert(
      '★ 已作废容器未被二次处理（状态仍 VOID、数量不变）',
      Number(eAfter.status) === CONTAINER_STATUS.VOID
        && Math.abs(Number(eAfter.remaining_qty) - QTY) < 1e-6,
      `状态=${eAfter.status} 数量=${eAfter.remaining_qty}`,
    )

    // ══════════════════════════════════════════════════════════════════
    // §F 对照组：容器已作废但从未参与调拨 → 撤回照常放行（守「不误伤」）
    //    新守卫的判据必须是「有没有调拨流水」，而不是「状态是不是 VOID」。
    // ══════════════════════════════════════════════════════════════════
    log.section('§F 对照：容器已作废但无调拨流水 → 撤回收货照常放行')
    step = 'F:seed'
    const F = await seedReceivedTask(ctx, token, {
      supplier, warehouse: sourceWarehouse, location, label: 'F', qty: QTY,
    })
    cleanup.productIds.push(F.product.id)
    cleanup.poIds.push(F.poId)
    const fBoxes = await dbQuery(
      pool,
      `SELECT id FROM inventory_containers
        WHERE inbound_task_id=? AND deleted_at IS NULL AND status=1 ORDER BY id`,
      [F.taskId],
    )
    if (fBoxes.length !== 1) throw new Error(`§F 前置不成立：期望 1 个 ACTIVE 容器，实得 ${fBoxes.length}`)
    const fBoxId = Number(fBoxes[0].id)

    step = 'F:fixture-void'
    // 夹具（非真实业务路径，仅测试库）：手工把容器置 VOID 并保留数量，模拟「因其它原因作废、
    // 从未调拨」的条码。真实路径造不出「VOID + 数量仍等于 initial_qty + 无调拨流水」三者并存，
    // 但这一组正是要钉住判据：不能因为状态是 VOID 就把整单拦死。
    await pool.query('UPDATE inventory_containers SET status=? WHERE id=?', [CONTAINER_STATUS.VOID, fBoxId])
    const fVoided = await containerOf(pool, fBoxId)
    const fTransferLogs = await dbQuery(
      pool, "SELECT id FROM inventory_logs WHERE container_id=? AND ref_type='transfer'", [fBoxId],
    )
    log.assert(
      '前置：容器已作废、数量未变、且没有任何调拨流水',
      Number(fVoided.status) === CONTAINER_STATUS.VOID
        && Math.abs(Number(fVoided.remaining_qty) - QTY) < 1e-6
        && fTransferLogs.length === 0,
      `status=${fVoided.status} 数量=${fVoided.remaining_qty} 调拨流水=${fTransferLogs.length}`,
    )

    step = 'F:void'
    const fPayableBefore = await payableOf(pool, F.poId)
    const voidF = await http.post(`/api/inbound-tasks/${F.taskId}/void-receipt`, { token })
    console.log(`\n[撤回收货·对照] HTTP ${voidF.status} ${JSON.stringify(voidF.data).slice(0, 200)}`)
    log.assert(
      '★ 未参与过调拨的作废容器不触发新守卫：撤回照常放行（不误伤普通作废）',
      voidF.ok,
      `HTTP ${voidF.status}：${JSON.stringify(voidF.data).slice(0, 240)}`,
    )
    const fTaskAfter = await taskStatusOf(pool, F.taskId)
    const fPayableAfter = await payableOf(pool, F.poId)
    log.assert(
      '★ 撤回效果正常：收货单回到待收货、应付按「从未收货」反冲归零',
      fTaskAfter && Number(fTaskAfter.status) === 1
        && fPayableAfter && Math.abs(Number(fPayableAfter.total_amount)) < 0.01
        && Math.abs(Number(fPayableBefore?.total_amount) - QTY * PRICE) < 0.01,
      `任务 status=${fTaskAfter?.status} 应付 ${money(fPayableBefore?.total_amount)} → ${money(fPayableAfter?.total_amount)}`,
    )
    const fVoidedAfter = await containerOf(pool, fBoxId)
    log.assert(
      '★ 已作废容器未被二次处理（仍 VOID、数量未再变，撤回不再对它写流水）',
      Number(fVoidedAfter.status) === CONTAINER_STATUS.VOID
        && Math.abs(Number(fVoidedAfter.remaining_qty) - QTY) < 1e-6,
      `状态=${fVoidedAfter.status} 数量=${fVoidedAfter.remaining_qty}`,
    )

    // ══════════════════════════════════════════════════════════════════
    // §G 调拨扫出/扫入的商品名必须可见，且来源是商品主档
    //    `inventory_containers` 没有 product_name 列，两条路径都从 `SELECT *` 的容器行上取它，
    //    恒为 undefined：scan-out / scan-in 回执的 productName 丢失，事件描述渲染成
    //    「容器#B000123  ×10」双空格。真实来源是 product_items.name。
    //    为让断言能区分来源，这里建单后**改写主档名**：此时「明细快照名」（建单请求体写入的
    //    显示名，服务端未归一化）与主档名不同，只有真读主档才会显示新名。
    // ══════════════════════════════════════════════════════════════════
    log.section('§G 扫码出/入库的商品名可见，且取自商品主档')
    step = 'G:seed'
    const G = await seedReceivedTask(ctx, token, {
      supplier, warehouse: sourceWarehouse, location, label: 'G', qty: QTY,
    })
    cleanup.productIds.push(G.product.id)
    cleanup.poIds.push(G.poId)
    const gBoxes = await dbQuery(
      pool,
      `SELECT id, barcode FROM inventory_containers
        WHERE inbound_task_id=? AND deleted_at IS NULL AND status=1 ORDER BY id`,
      [G.taskId],
    )
    if (gBoxes.length !== 1) throw new Error(`§G 前置不成立：期望 1 个 ACTIVE 容器，实得 ${gBoxes.length}`)
    const gBarcode = gBoxes[0].barcode

    step = 'G:transfer'
    const gTransferId = await createTransfer(http, token, {
      fromWarehouse: sourceWarehouse, toWarehouse: secondWarehouse,
      product: G.product, quantity: TRANSFER_QTY,
    })
    cleanup.transferIds.push(gTransferId)
    const gRenamed = `IVTC改名后主档名-${suffix}`
    await pool.query('UPDATE product_items SET name=? WHERE id=?', [gRenamed, G.product.id])
    const [gItemRow] = await dbQuery(
      pool, 'SELECT product_name FROM transfer_order_items WHERE order_id=?', [gTransferId],
    )
    log.assert(
      '前置：主档名已改写，且与明细里的（请求体写入的）快照名不同——只有真读主档才会是新名',
      gItemRow?.product_name === G.product.name && gItemRow.product_name !== gRenamed,
      `明细快照名=${gItemRow?.product_name} 主档名=${gRenamed}`,
    )

    step = 'G:scan-out'
    const gOut = await http.post(`/api/transfer/${gTransferId}/scan-out`, {
      token, headers: ctx.pdaHeaders(), json: { containerBarcode: gBarcode },
    })
    log.assert('前置：调出扫码成功', gOut.ok, JSON.stringify(gOut.data).slice(0, 160))
    log.assert(
      '★ scan-out 回执带商品名，且取自商品主档（不是明细快照名）',
      gOut.data?.data?.productName === gRenamed,
      `回执 productName=${JSON.stringify(gOut.data?.data?.productName)}（主档名=${gRenamed}）`,
    )
    const [gOutEvent] = await dbQuery(
      pool,
      "SELECT description FROM transfer_order_events WHERE transfer_order_id=? AND title=? ORDER BY id DESC LIMIT 1",
      [gTransferId, '调出仓扫码出库'],
    )
    log.assert(
      '★ scan-out 事件描述里商品名可见（不再渲染成「容器#X  ×N」双空格）',
      String(gOutEvent?.description || '').includes(gRenamed),
      `描述=${JSON.stringify(gOutEvent?.description)}`,
    )

    step = 'G:scan-in'
    const gIn = await http.post(`/api/transfer/${gTransferId}/scan-in`, {
      token, headers: second.headers(), json: { containerBarcode: gBarcode, locationId: second.locationId },
    })
    log.assert('前置：调入扫码成功', gIn.ok, JSON.stringify(gIn.data).slice(0, 160))
    log.assert(
      '★ scan-in 回执带商品名，且取自商品主档',
      gIn.data?.data?.productName === gRenamed,
      `回执 productName=${JSON.stringify(gIn.data?.data?.productName)}（主档名=${gRenamed}）`,
    )
    const [gInEvent] = await dbQuery(
      pool,
      "SELECT description FROM transfer_order_events WHERE transfer_order_id=? AND title=? ORDER BY id DESC LIMIT 1",
      [gTransferId, '调入仓扫码入库'],
    )
    log.assert(
      '★ scan-in 事件描述里商品名可见',
      String(gInEvent?.description || '').includes(gRenamed),
      `描述=${JSON.stringify(gInEvent?.description)}`,
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
    for (const transferId of cleanup.transferIds) {
      await safe('transfer_order_events', 'DELETE FROM transfer_order_events WHERE transfer_order_id=?', [transferId])
      await safe('transfer_order_items', 'DELETE FROM transfer_order_items WHERE order_id=?', [transferId])
      await safe('inventory_logs',
        "DELETE FROM inventory_logs WHERE ref_type='transfer' AND ref_id=?", [transferId])
      await safe('transfer_orders', 'DELETE FROM transfer_orders WHERE id=?', [transferId])
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
    for (const code of cleanup.deviceCodes) {
      const devices = await dbQuery(pool, 'SELECT id FROM pda_devices WHERE device_code=?', [code])
      for (const d of devices) {
        await safe('pda_device_sessions', 'DELETE FROM pda_device_sessions WHERE device_id=?', [d.id])
      }
      await safe('pda_devices', 'DELETE FROM pda_devices WHERE device_code=?', [code])
    }
    for (const wh of cleanup.secondWarehouses) {
      await safe('warehouse_locations', 'DELETE FROM warehouse_locations WHERE warehouse_id=?', [wh.warehouseId])
      await safe('inventory_warehouses', 'DELETE FROM inventory_warehouses WHERE id=?', [wh.warehouseId])
    }

    await ctx.close()
    // 全局单例池（backend/src/config/db）自己收尾：它也是 mysql2 连接、socket 不 unref，
    // app/service 查询过一次就会留住事件循环，断言全绿、退出码已定进程却吊着不退。
    await require('../backend/src/config/db').pool.end()
    const counts = log.summary()
    if (counts.failed > 0) process.exitCode = 1
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
