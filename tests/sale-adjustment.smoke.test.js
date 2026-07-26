#!/usr/bin/env node
'use strict'

const {
  createLogger,
  prepareSmokeContext,
  dbQuery,
  login,
  randomRef,
} = require('./helpers/smokeTestKit')

const { createContainer, syncStockFromContainers, SOURCE_TYPE, CONTAINER_STATUS } = require('../backend/src/engine/containerEngine')

async function seedActiveContainer(pool, { product, warehouse, qty, locationId = null }) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const sourceRefId = Math.floor(Date.now() / 1000) + Math.floor(Math.random() * 1000)
    const { containerId, barcode } = await createContainer(conn, {
      productId: Number(product.id),
      warehouseId: Number(warehouse.id),
      initialQty: Number(qty),
      unit: product.unit,
      sourceType: SOURCE_TYPE.TRANSFER,
      sourceRefId,
      sourceRefType: 'test_seed',
      sourceRefNo: randomRef('SEED'),
      remark: 'sale-adjustment smoke seed',
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

async function createSaleOrder(http, token, { customer, warehouse, product, quantity }) {
  return http.post('/api/sale', {
    token,
    json: {
      customerId: Number(customer.id),
      customerName: customer.name,
      warehouseId: Number(warehouse.id),
      warehouseName: warehouse.name,
      remark: randomRef('adj-sale'),
      items: [{
        productId: Number(product.id),
        productCode: product.code,
        productName: product.name,
        unit: product.unit,
        quantity,
        unitPrice: 10,
      }],
    },
  })
}

async function shipToTask(http, token, pool, saleId) {
  await http.post(`/api/sale/${saleId}/reserve`, { token })
  const shipResp = await http.post(`/api/sale/${saleId}/ship`, { token })
  if (!shipResp.ok) throw new Error(`ship failed: ${JSON.stringify(shipResp.data)}`)
  const [saleRow] = await dbQuery(pool, 'SELECT task_id FROM sale_orders WHERE id=?', [saleId])
  return Number(saleRow.task_id)
}

async function pickWholeContainer(ctx, token, { taskId, itemId, container, product, qty }) {
  const resp = await ctx.http.post('/api/scan-logs', {
    token, headers: ctx.pdaHeaders(),
    json: { taskId, itemId, containerId: container.containerId, barcode: container.barcode, productId: Number(product.id), qty, scanMode: '整件' },
  })
  if (!resp.ok) throw new Error(`pick scan failed: ${JSON.stringify(resp.data)}`)
  return resp
}

// 提交改单：整表替换明细，沿用现有订单的客户/仓库信息 + 新的 items 数组
async function requestAdjustment(ctx, token, saleId, newItems, extraHeaders = {}) {
  const detail = await ctx.http.get(`/api/sale/${saleId}`, { token })
  const order = detail.data.data
  return ctx.http.put(`/api/sale/${saleId}/adjust`, {
    token,
    headers: extraHeaders,
    json: {
      customerId: order.customerId,
      customerName: order.customerName,
      warehouseId: order.warehouseId,
      warehouseName: order.warehouseName,
      remark: order.remark || '',
      items: newItems,
    },
  })
}

function itemsFrom(product, quantity) {
  return [{
    productId: Number(product.id),
    productCode: product.code,
    productName: product.name,
    unit: product.unit,
    quantity,
    unitPrice: 10,
  }]
}

// ── 场景①：增量——task 已推进到待复核(4)后加数量，应回退到拣货中(2)让 PDA 补拣 ──
async function scenarioIncrease(log, ctx, token) {
  log.section('Scenario: 改单增量 — 待复核阶段加数量，回退拣货中补拣')
  const container = await seedActiveContainer(ctx.pool, { product: ctx.product, warehouse: ctx.warehouse, qty: 2, locationId: ctx.location.id })
  const saleCreate = await createSaleOrder(ctx.http, token, { customer: ctx.customer, warehouse: ctx.warehouse, product: ctx.product, quantity: 2 })
  const saleId = Number(saleCreate.data?.data?.id)
  const taskId = await shipToTask(ctx.http, token, ctx.pool, saleId)
  const [itemRow] = await dbQuery(ctx.pool, 'SELECT id FROM warehouse_task_items WHERE task_id=?', [taskId])

  await pickWholeContainer(ctx, token, { taskId, itemId: itemRow.id, container, product: ctx.product, qty: 2 })
  const readyResp = await ctx.http.put(`/api/warehouse-tasks/${taskId}/ready`, { token, headers: ctx.pdaHeaders() })
  log.assert('拣货完成推进到待分拣(3)', readyResp.ok, JSON.stringify(readyResp.data))
  const sortDoneResp = await ctx.http.put(`/api/warehouse-tasks/${taskId}/sort-done`, { token, headers: ctx.pdaHeaders(), json: {} })
  log.assert('分拣完成推进到待复核(4)', sortDoneResp.ok, JSON.stringify(sortDoneResp.data))

  const [taskBefore] = await dbQuery(ctx.pool, 'SELECT status FROM warehouse_tasks WHERE id=?', [taskId])
  log.assert('改单前任务确实在待复核(4)', Number(taskBefore.status) === 4, JSON.stringify(taskBefore))

  const adjResp = await requestAdjustment(ctx, token, saleId, itemsFrom(ctx.product, 3))
  log.assert('增量改单提交成功', adjResp.ok, JSON.stringify(adjResp.data))
  log.assert('增量改单无需物理确认(pending=false)', adjResp.data?.data?.pending === false, JSON.stringify(adjResp.data?.data))

  const [itemAfter] = await dbQuery(ctx.pool, 'SELECT required_qty, picked_qty FROM warehouse_task_items WHERE id=?', [itemRow.id])
  log.assert('required_qty已上调为3', Number(itemAfter.required_qty) === 3, JSON.stringify(itemAfter))

  const [taskAfter] = await dbQuery(ctx.pool, 'SELECT status FROM warehouse_tasks WHERE id=?', [taskId])
  log.assert('任务已回退到拣货中(2)', Number(taskAfter.status) === 2, JSON.stringify(taskAfter))

  const [resv] = await dbQuery(ctx.pool, "SELECT SUM(qty) AS total FROM stock_reservations WHERE ref_type='sale_order' AND ref_id=? AND status=1", [saleId])
  log.assert('预占已追加到3', Number(resv.total) === 3, JSON.stringify(resv))

  // 补拣剩余1件，验证正常流程能重新走通
  const extraContainer = await seedActiveContainer(ctx.pool, { product: ctx.product, warehouse: ctx.warehouse, qty: 1, locationId: ctx.location.id })
  await pickWholeContainer(ctx, token, { taskId, itemId: itemRow.id, container: extraContainer, product: ctx.product, qty: 1 })
  const ready2 = await ctx.http.put(`/api/warehouse-tasks/${taskId}/ready`, { token, headers: ctx.pdaHeaders() })
  log.assert('补拣完成后可重新推进到待分拣(3)', ready2.ok, JSON.stringify(ready2.data))
}

// ── 场景②：减量——仅命中未拣部分，无需物理确认，立即生效 ──
async function scenarioDecreaseImmediate(log, ctx, token) {
  log.section('Scenario: 改单减量 — 仅命中未拣部分，立即生效')
  const saleCreate = await createSaleOrder(ctx.http, token, { customer: ctx.customer, warehouse: ctx.warehouse, product: ctx.product, quantity: 3 })
  const saleId = Number(saleCreate.data?.data?.id)
  const taskId = await shipToTask(ctx.http, token, ctx.pool, saleId)
  const [itemRow] = await dbQuery(ctx.pool, 'SELECT id, required_qty, picked_qty FROM warehouse_task_items WHERE task_id=?', [taskId])
  log.assert('初始required=3, picked=0', Number(itemRow.required_qty) === 3 && Number(itemRow.picked_qty) === 0, JSON.stringify(itemRow))

  const adjResp = await requestAdjustment(ctx, token, saleId, itemsFrom(ctx.product, 1))
  log.assert('减量改单提交成功', adjResp.ok, JSON.stringify(adjResp.data))
  log.assert('未拣部分减量无需物理确认(pending=false)', adjResp.data?.data?.pending === false, JSON.stringify(adjResp.data?.data))

  const [itemAfter] = await dbQuery(ctx.pool, 'SELECT required_qty FROM warehouse_task_items WHERE id=?', [itemRow.id])
  log.assert('required_qty已立即下调为1', Number(itemAfter.required_qty) === 1, JSON.stringify(itemAfter))

  const [taskAfter] = await dbQuery(ctx.pool, 'SELECT status, adjustment_requested_at FROM warehouse_tasks WHERE id=?', [taskId])
  log.assert('任务状态未变(仍拣货中2)，无挂起标记', Number(taskAfter.status) === 2 && taskAfter.adjustment_requested_at === null, JSON.stringify(taskAfter))

  const [resv] = await dbQuery(ctx.pool, "SELECT SUM(qty) AS total FROM stock_reservations WHERE ref_type='sale_order' AND ref_id=? AND status=1", [saleId])
  log.assert('预占已释放到1', Number(resv.total) === 1, JSON.stringify(resv))
}

// ── 场景③：减量——命中已打包部分，需要PDA拆箱+归还双重确认才真正生效 ──
async function scenarioDecreasePendingConfirm(log, ctx, token) {
  log.section('Scenario: 改单减量 — 命中已打包部分，PDA确认后生效')
  const container = await seedActiveContainer(ctx.pool, { product: ctx.product, warehouse: ctx.warehouse, qty: 2, locationId: ctx.location.id })
  const saleCreate = await createSaleOrder(ctx.http, token, { customer: ctx.customer, warehouse: ctx.warehouse, product: ctx.product, quantity: 2 })
  const saleId = Number(saleCreate.data?.data?.id)
  const taskId = await shipToTask(ctx.http, token, ctx.pool, saleId)
  const [itemRow] = await dbQuery(ctx.pool, 'SELECT id FROM warehouse_task_items WHERE task_id=?', [taskId])

  await pickWholeContainer(ctx, token, { taskId, itemId: itemRow.id, container, product: ctx.product, qty: 2 })
  await ctx.http.put(`/api/warehouse-tasks/${taskId}/ready`, { token, headers: ctx.pdaHeaders() })
  await ctx.http.put(`/api/warehouse-tasks/${taskId}/sort-done`, { token, headers: ctx.pdaHeaders(), json: {} })
  const [containerRow] = await dbQuery(ctx.pool, 'SELECT id, barcode, location_id FROM inventory_containers WHERE id=?', [container.containerId])
  const checkScan = await ctx.http.post('/api/scan-logs/check', { token, headers: ctx.pdaHeaders(), json: { taskId, barcode: containerRow.barcode } })
  log.assert('复核扫码成功(全量复核，自动收口进待打包)', checkScan.ok, JSON.stringify(checkScan.data))

  const pkgResp = await ctx.http.post('/api/packages', { token, headers: ctx.pdaHeaders(), json: { warehouseTaskId: taskId } })
  const packageId = Number(pkgResp.data?.data?.id)
  await ctx.http.post(`/api/packages/${packageId}/add-item`, { token, headers: ctx.pdaHeaders(), json: { productCode: ctx.product.code, qty: 2 } })
  const finishResp = await ctx.http.put(`/api/packages/${packageId}/finish`, { token, headers: ctx.pdaHeaders() })
  log.assert('装箱2件并finish成功', finishResp.ok, JSON.stringify(finishResp.data))

  const [taskBefore] = await dbQuery(ctx.pool, 'SELECT status FROM warehouse_tasks WHERE id=?', [taskId])
  log.assert('改单前任务在待打包(5)', Number(taskBefore.status) === 5, JSON.stringify(taskBefore))

  const adjResp = await requestAdjustment(ctx, token, saleId, itemsFrom(ctx.product, 1))
  log.assert('减量改单提交成功', adjResp.ok, JSON.stringify(adjResp.data))
  log.assert('命中已打包部分需要物理确认(pending=true)', adjResp.data?.data?.pending === true, JSON.stringify(adjResp.data?.data))
  const adjustmentId = Number(adjResp.data?.data?.adjustmentId)

  const [pkgAfter] = await dbQuery(ctx.pool, 'SELECT status FROM packages WHERE id=?', [packageId])
  log.assert('箱子已被作废(3)', Number(pkgAfter.status) === 3, JSON.stringify(pkgAfter))

  const [taskAfter] = await dbQuery(ctx.pool, 'SELECT status, adjustment_requested_at FROM warehouse_tasks WHERE id=?', [taskId])
  log.assert('任务已回退到待复核(4)且挂起标记非空', Number(taskAfter.status) === 4 && !!taskAfter.adjustment_requested_at, JSON.stringify(taskAfter))

  // 挂起期间，推进性接口一律应被拒绝
  const blockedCheck = await ctx.http.put(`/api/warehouse-tasks/${taskId}/check-done`, { token, headers: ctx.pdaHeaders() })
  log.assert('挂起期间check-done应返回409', blockedCheck.status === 409, `status=${blockedCheck.status}`)

  const detailResp = await ctx.http.get(`/api/warehouse-tasks/adjustments/${adjustmentId}`, { token })
  const detailItems = detailResp.data?.data?.items || []
  log.assert('改单详情能查到待确认项', detailItems.length === 1, JSON.stringify(detailItems))
  const voidId = detailItems[0]?.packageVoids?.[0]?.id
  const returnId = detailItems[0]?.containerReturns?.[0]?.id
  log.assert('详情包含1个待拆箱项和1个待归还项', !!voidId && !!returnId, JSON.stringify(detailItems[0]))

  const pendingListResp = await ctx.http.get('/api/warehouse-tasks/adjustments/pending', { token })
  log.assert('待处理列表能查到该任务', (pendingListResp.data?.data || []).some(t => Number(t.id) === taskId), JSON.stringify(pendingListResp.data?.data))

  const confirmVoidResp = await ctx.http.post(`/api/warehouse-tasks/adjustments/package-voids/${voidId}/confirm`, { token, headers: ctx.pdaHeaders() })
  log.assert('确认拆箱成功但尚未finalize(还有容器待归还)', confirmVoidResp.ok && confirmVoidResp.data?.data?.finalized === false, JSON.stringify(confirmVoidResp.data))

  const confirmReturnResp = await ctx.http.post(`/api/warehouse-tasks/adjustments/container-returns/${returnId}/confirm`, {
    token, headers: ctx.pdaHeaders(), json: { targetLocationId: Number(containerRow.location_id) },
  })
  log.assert('确认归还成功且finalize=true(最后一项)', confirmReturnResp.ok && confirmReturnResp.data?.data?.finalized === true, JSON.stringify(confirmReturnResp.data))

  const [itemFinal] = await dbQuery(ctx.pool, 'SELECT required_qty, picked_qty, sorted_qty, checked_qty FROM warehouse_task_items WHERE task_id=?', [taskId])
  log.assert('picked_qty已降到新目标1', Number(itemFinal.picked_qty) === 1, JSON.stringify(itemFinal))
  log.assert('checked_qty已清零等待重新复核', Number(itemFinal.checked_qty) === 0, JSON.stringify(itemFinal))

  const [taskFinal] = await dbQuery(ctx.pool, 'SELECT status, adjustment_requested_at FROM warehouse_tasks WHERE id=?', [taskId])
  log.assert('挂起标记已清空，任务仍在待复核(4)', taskFinal.adjustment_requested_at === null && Number(taskFinal.status) === 4, JSON.stringify(taskFinal))

  const [resv] = await dbQuery(ctx.pool, "SELECT COALESCE(SUM(qty),0) AS total FROM stock_reservations WHERE ref_type='sale_order' AND ref_id=? AND status=1", [saleId])
  log.assert('预占已释放到1', Number(resv.total) === 1, JSON.stringify(resv))

  // 重新复核并推进，验证任务能正常收尾（不残留坏状态）
  const recheckScan = await ctx.http.post('/api/scan-logs/check', { token, headers: ctx.pdaHeaders(), json: { taskId, barcode: containerRow.barcode } })
  log.assert('重新复核扫码成功', recheckScan.ok, JSON.stringify(recheckScan.data))
  const [taskRecheck] = await dbQuery(ctx.pool, 'SELECT status FROM warehouse_tasks WHERE id=?', [taskId])
  log.assert('重新复核后推进到待打包(5)', Number(taskRecheck.status) === 5, JSON.stringify(taskRecheck))
}

// ── 场景④：增量——任务还没离开拣货中(2)就改单，回退动作必须是no-op而不是报错 ──
// 复现并回归 finalizeTaskStatusAfterAdjustment 曾经的 bug：目标状态就是当前状态时
// 直接调用 assertWarehouseTaskAction 会因为 PICKING(2) 不在 adjustReopenPicking 的
// allowed 列表里而误抛异常，把一次单纯的加数量请求搞崩。
async function scenarioIncreaseWhileStillPicking(log, ctx, token) {
  log.section('Scenario: 改单增量 — 任务仍在拣货中(2)时加数量')
  const saleCreate = await createSaleOrder(ctx.http, token, { customer: ctx.customer, warehouse: ctx.warehouse, product: ctx.product, quantity: 2 })
  const saleId = Number(saleCreate.data?.data?.id)
  const taskId = await shipToTask(ctx.http, token, ctx.pool, saleId)

  const [taskBefore] = await dbQuery(ctx.pool, 'SELECT status FROM warehouse_tasks WHERE id=?', [taskId])
  log.assert('改单前任务在拣货中(2)，尚未拣货', Number(taskBefore.status) === 2, JSON.stringify(taskBefore))

  const adjResp = await requestAdjustment(ctx, token, saleId, itemsFrom(ctx.product, 3))
  log.assert('拣货中阶段加数量不应报错', adjResp.ok, JSON.stringify(adjResp.data))

  const [taskAfter] = await dbQuery(ctx.pool, 'SELECT status FROM warehouse_tasks WHERE id=?', [taskId])
  log.assert('任务仍在拣货中(2)，无需回退', Number(taskAfter.status) === 2, JSON.stringify(taskAfter))

  const [itemAfter] = await dbQuery(ctx.pool, 'SELECT required_qty FROM warehouse_task_items WHERE task_id=?', [taskId])
  log.assert('required_qty已上调为3', Number(itemAfter.required_qty) === 3, JSON.stringify(itemAfter))
}

// ── 场景⑤：减量命中已拣但任务仍在拣货中(2)——回退动作必须是no-op，且归还库位强校验生效 ──
async function scenarioDecreaseWhileStillPicking(log, ctx, token) {
  log.section('Scenario: 改单减量 — 已拣满但任务仍在拣货中(2)时减数量')
  const container = await seedActiveContainer(ctx.pool, { product: ctx.product, warehouse: ctx.warehouse, qty: 3, locationId: ctx.location.id })
  const saleCreate = await createSaleOrder(ctx.http, token, { customer: ctx.customer, warehouse: ctx.warehouse, product: ctx.product, quantity: 3 })
  const saleId = Number(saleCreate.data?.data?.id)
  const taskId = await shipToTask(ctx.http, token, ctx.pool, saleId)
  const [itemRow] = await dbQuery(ctx.pool, 'SELECT id FROM warehouse_task_items WHERE task_id=?', [taskId])
  await pickWholeContainer(ctx, token, { taskId, itemId: itemRow.id, container, product: ctx.product, qty: 3 })

  const [taskBefore] = await dbQuery(ctx.pool, 'SELECT status FROM warehouse_tasks WHERE id=?', [taskId])
  log.assert('改单前任务仍在拣货中(2)（已拣满但未点ready）', Number(taskBefore.status) === 2, JSON.stringify(taskBefore))

  const adjResp = await requestAdjustment(ctx, token, saleId, itemsFrom(ctx.product, 1))
  log.assert('拣货中阶段减数量命中已拣部分不应报错', adjResp.ok, JSON.stringify(adjResp.data))
  log.assert('命中已拣部分需要物理确认(pending=true)', adjResp.data?.data?.pending === true, JSON.stringify(adjResp.data?.data))
  const adjustmentId = Number(adjResp.data?.data?.adjustmentId)

  const [taskAfter] = await dbQuery(ctx.pool, 'SELECT status, adjustment_requested_at FROM warehouse_tasks WHERE id=?', [taskId])
  log.assert('任务仍在拣货中(2)，无需回退，但挂起标记已写入', Number(taskAfter.status) === 2 && !!taskAfter.adjustment_requested_at, JSON.stringify(taskAfter))

  const detailResp = await ctx.http.get(`/api/warehouse-tasks/adjustments/${adjustmentId}`, { token })
  const returnItem = (detailResp.data?.data?.items || [])[0]?.containerReturns?.[0]
  log.assert('详情包含1个待归还容器项', !!returnItem, JSON.stringify(detailResp.data?.data))

  const [containerRow] = await dbQuery(ctx.pool, 'SELECT location_id FROM inventory_containers WHERE id=?', [container.containerId])

  const wrongLocationResp = await ctx.http.post(`/api/warehouse-tasks/adjustments/container-returns/${returnItem.id}/confirm`, {
    token, headers: ctx.pdaHeaders(), json: { targetLocationId: Number(containerRow.location_id) + 999999 },
  })
  log.assert('扫描非原库位应被拒绝(不允许操作员自选库位)', wrongLocationResp.status === 400, `status=${wrongLocationResp.status} body=${JSON.stringify(wrongLocationResp.data)}`)

  const rightLocationResp = await ctx.http.post(`/api/warehouse-tasks/adjustments/container-returns/${returnItem.id}/confirm`, {
    token, headers: ctx.pdaHeaders(), json: { targetLocationId: Number(containerRow.location_id) },
  })
  log.assert('扫回原库位归还成功且finalize=true', rightLocationResp.ok && rightLocationResp.data?.data?.finalized === true, JSON.stringify(rightLocationResp.data))

  const [itemFinal] = await dbQuery(ctx.pool, 'SELECT required_qty, picked_qty FROM warehouse_task_items WHERE task_id=?', [taskId])
  log.assert('picked_qty已降到新目标1', Number(itemFinal.picked_qty) === 1 && Number(itemFinal.required_qty) === 1, JSON.stringify(itemFinal))

  const readyResp = await ctx.http.put(`/api/warehouse-tasks/${taskId}/ready`, { token, headers: ctx.pdaHeaders() })
  log.assert('归还完成后任务能正常推进到待分拣(3)', readyResp.ok, JSON.stringify(readyResp.data))
}

async function main() {
  const log = createLogger()
  const ctx = await prepareSmokeContext()
  try {
    const adminLogin = await login(ctx.http, 'smoke_admin', 'SmokeAdmin123!')
    const token = adminLogin.token
    log.assert('smoke_admin 登录成功', !!token, `status=${adminLogin.response.status}`)

    await scenarioIncrease(log, ctx, token)
    await scenarioDecreaseImmediate(log, ctx, token)
    await scenarioDecreasePendingConfirm(log, ctx, token)
    await scenarioIncreaseWhileStillPicking(log, ctx, token)
    await scenarioDecreaseWhileStillPicking(log, ctx, token)
  } finally {
    const summary = log.summary()
    await ctx.close()
    process.exit(summary.failed > 0 ? 1 : 0)
  }
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error?.message || String(error)}\n`)
  process.exit(1)
})
