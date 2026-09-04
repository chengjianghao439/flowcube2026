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
  // 初始单占用并拣走 2 件，另留 1 件未预占现货供本次增量改单追加。
  await seedActiveContainer(ctx.pool, { product: ctx.product, warehouse: ctx.warehouse, qty: 1, locationId: ctx.location.id })
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
  await seedActiveContainer(ctx.pool, { product: ctx.product, warehouse: ctx.warehouse, qty: 3, locationId: ctx.location.id })
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
  const [finalQty] = await dbQuery(ctx.pool, 'SELECT reserved_qty,dispatched_qty FROM sale_order_items WHERE order_id=?', [saleId])
  log.assert('归还确认后数量账对齐为1', Number(finalQty.reserved_qty) === 1 && Number(finalQty.dispatched_qty) === 1, JSON.stringify(finalQty))
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

  const [pendingQty] = await dbQuery(ctx.pool, 'SELECT reserved_qty,dispatched_qty FROM sale_order_items WHERE order_id=?', [saleId])
  log.assert('归还确认前仍记录实际占库2，目标派发1', Number(pendingQty.reserved_qty) === 2 && Number(pendingQty.dispatched_qty) === 1, JSON.stringify(pendingQty))
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
  await seedActiveContainer(ctx.pool, { product: ctx.product, warehouse: ctx.warehouse, qty: 3, locationId: ctx.location.id })
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

// ── 场景：装箱闭合强校验 —— 装箱总量必须等于复核量才能进入待出库（业务决策 2026-07-28）──
async function scenarioPackagingClosure(log, ctx, token) {
  log.section('Scenario: 装箱闭合 — 装不满不得进入待出库')
  const container = await seedActiveContainer(ctx.pool, { product: ctx.product, warehouse: ctx.warehouse, qty: 5, locationId: ctx.location.id })
  const saleCreate = await createSaleOrder(ctx.http, token, { customer: ctx.customer, warehouse: ctx.warehouse, product: ctx.product, quantity: 5 })
  const saleId = Number(saleCreate.data?.data?.id)
  const taskId = await shipToTask(ctx.http, token, ctx.pool, saleId)
  const [itemRow] = await dbQuery(ctx.pool, 'SELECT id FROM warehouse_task_items WHERE task_id=?', [taskId])

  await pickWholeContainer(ctx, token, { taskId, itemId: itemRow.id, container, product: ctx.product, qty: 5 })
  await ctx.http.put(`/api/warehouse-tasks/${taskId}/ready`, { token, headers: ctx.pdaHeaders() })
  await ctx.http.put(`/api/warehouse-tasks/${taskId}/sort-done`, { token, headers: ctx.pdaHeaders(), json: {} })
  const [containerRow] = await dbQuery(ctx.pool, 'SELECT barcode FROM inventory_containers WHERE id=?', [container.containerId])
  const checkScan = await ctx.http.post('/api/scan-logs/check', { token, headers: ctx.pdaHeaders(), json: { taskId, barcode: containerRow.barcode } })
  log.assert('全量复核收口进待打包(5)', checkScan.ok, JSON.stringify(checkScan.data))

  // 只装 3 件（复核 5）→ pack-done 应被装箱闭合拦下
  const pkgResp = await ctx.http.post('/api/packages', { token, headers: ctx.pdaHeaders(), json: { warehouseTaskId: taskId } })
  const packageId = Number(pkgResp.data?.data?.id)
  await ctx.http.post(`/api/packages/${packageId}/add-item`, { token, headers: ctx.pdaHeaders(), json: { productCode: ctx.product.code, qty: 3 } })
  await ctx.http.put(`/api/packages/${packageId}/finish`, { token, headers: ctx.pdaHeaders() })
  const shortPack = await ctx.http.put(`/api/warehouse-tasks/${taskId}/pack-done`, { token, headers: ctx.pdaHeaders() })
  log.assert('★ 装箱3件<复核5件时 pack-done 被拒(400)（装箱闭合强校验）',
    shortPack.status === 400, `status=${shortPack.status} ${JSON.stringify(shortPack.data?.message || '')}`)

  // 补装到 5 件 → pack-done 通过，进入待出库(6)
  const pkg2 = await ctx.http.post('/api/packages', { token, headers: ctx.pdaHeaders(), json: { warehouseTaskId: taskId } })
  const packageId2 = Number(pkg2.data?.data?.id)
  await ctx.http.post(`/api/packages/${packageId2}/add-item`, { token, headers: ctx.pdaHeaders(), json: { productCode: ctx.product.code, qty: 2 } })
  await ctx.http.put(`/api/packages/${packageId2}/finish`, { token, headers: ctx.pdaHeaders() })
  const fullPack = await ctx.http.put(`/api/warehouse-tasks/${taskId}/pack-done`, { token, headers: ctx.pdaHeaders() })
  // 装满后不应再被「装箱闭合」拦下：要么直接成功，要么卡在其后的箱贴打印闭合(409)——后者是打印
  // 链路前置、与本用例无关（测试环境无真实打印客户端回执），关键是不再报「装箱数量不一致」。
  log.assert('装满5件后越过装箱闭合校验（不再报装箱数量不一致）',
    fullPack.ok || (fullPack.status === 409 && /箱贴|打印/.test(String(fullPack.data?.message || ''))),
    `status=${fullPack.status} ${JSON.stringify(fullPack.data?.message || '')}`)
}

// ── 场景：销售退货按实际合格入库量冲减应收（业务决策 2026-07-28）——质检不合格部分不退客户 ──
async function scenarioSaleReturnQualifiedQty(log, ctx, token) {
  log.section('Scenario: 销售退货按合格量冲减应收（不合格不退）')
  const { http, pool } = ctx
  const container = await seedActiveContainer(pool, { product: ctx.product, warehouse: ctx.warehouse, qty: 10, locationId: ctx.location.id })
  const saleCreate = await createSaleOrder(http, token, { customer: ctx.customer, warehouse: ctx.warehouse, product: ctx.product, quantity: 10 })
  const saleId = Number(saleCreate.data?.data?.id)
  const taskId = await shipToTask(http, token, pool, saleId)
  const [itemRow] = await dbQuery(pool, 'SELECT id FROM warehouse_task_items WHERE task_id=?', [taskId])

  // 完整出库链到已出库(7)
  await pickWholeContainer(ctx, token, { taskId, itemId: itemRow.id, container, product: ctx.product, qty: 10 })
  await http.put(`/api/warehouse-tasks/${taskId}/ready`, { token, headers: ctx.pdaHeaders() })
  await http.put(`/api/warehouse-tasks/${taskId}/sort-done`, { token, headers: ctx.pdaHeaders(), json: {} })
  const [cRow] = await dbQuery(pool, 'SELECT barcode FROM inventory_containers WHERE id=?', [container.containerId])
  await http.post('/api/scan-logs/check', { token, headers: ctx.pdaHeaders(), json: { taskId, barcode: cRow.barcode } })
  const pkg = await http.post('/api/packages', { token, headers: ctx.pdaHeaders(), json: { warehouseTaskId: taskId } })
  const pkgId = Number(pkg.data?.data?.id)
  await http.post(`/api/packages/${pkgId}/add-item`, { token, headers: ctx.pdaHeaders(), json: { productCode: ctx.product.code, qty: 10 } })
  await http.put(`/api/packages/${pkgId}/finish`, { token, headers: ctx.pdaHeaders() })
  // 造数据跨过箱贴打印闭合（测试环境无真实打印客户端回执）：把该箱的箱贴打印任务标记完成(status=2)
  await pool.query("UPDATE print_jobs SET status=2 WHERE ref_type='package' AND ref_id=?", [pkgId])
  const packDone = await http.put(`/api/warehouse-tasks/${taskId}/pack-done`, { token, headers: ctx.pdaHeaders() })
  log.assert('装满并跨过箱贴打印后进入待出库(6)', packDone.ok, `status=${packDone.status} ${JSON.stringify(packDone.data?.message || '')}`)
  const shipResp = await http.put(`/api/warehouse-tasks/${taskId}/ship`, { token, headers: ctx.pdaHeaders() })
  log.assert('出库成功进入已出库(7)', shipResp.ok, `status=${shipResp.status} ${JSON.stringify(shipResp.data?.message || '')}`)

  const [ar0] = await dbQuery(pool, 'SELECT id, total_amount FROM payment_records WHERE type=2 AND order_id=?', [saleId])
  log.assert('出库后生成应收 = 10×10 = 100', !!ar0 && Number(ar0.total_amount) === 100, JSON.stringify(ar0))

  // 销售退货 4 件，质检 3 合格 / 1 不合格 → 应收只冲减合格 3 件
  const [srItemRow] = await dbQuery(pool, 'SELECT id FROM sale_order_items WHERE order_id=? AND product_id=? LIMIT 1', [saleId, ctx.product.id])
  const srCreate = await http.post('/api/returns/sale', {
    token,
    json: {
      customerId: Number(ctx.customer.id), customerName: ctx.customer.name,
      warehouseId: Number(ctx.warehouse.id), warehouseName: ctx.warehouse.name,
      saleOrderId: saleId,
      remark: randomRef('adj-sr'),
      items: [{ sourceItemId: Number(srItemRow.id), productId: Number(ctx.product.id), productCode: ctx.product.code, productName: ctx.product.name, unit: ctx.product.unit, quantity: 4, unitPrice: 10 }],
    },
  })
  log.assert('创建销售退货单成功(201)', srCreate.status === 201, `status=${srCreate.status} ${JSON.stringify(srCreate.data?.message || '')}`)
  const srId = Number(srCreate.data?.data?.id)
  await http.post(`/api/returns/sale/${srId}/confirm`, { token })
  const [srTask] = await dbQuery(pool, "SELECT id FROM return_tasks WHERE return_id=? AND return_type='sale' ORDER BY id DESC LIMIT 1", [srId])
  const srTaskId = srTask.id
  const recv = await http.post(`/api/return-tasks/${srTaskId}/receive`, { token, headers: ctx.pdaHeaders(), json: { productId: Number(ctx.product.id), packages: [{ qty: 4 }] } })
  const srContainerId = recv.data?.data?.containers?.[0]?.containerId
  await http.post(`/api/return-tasks/${srTaskId}/check`, { token, headers: ctx.pdaHeaders(), json: { productId: Number(ctx.product.id), passedQty: 3, rejectedQty: 1 } })
  await http.post(`/api/return-tasks/${srTaskId}/putaway`, { token, headers: ctx.pdaHeaders(), json: { containerId: srContainerId, locationId: Number(ctx.location.id) } })

  const [ar1] = await dbQuery(pool, 'SELECT total_amount, confirm_status FROM payment_records WHERE id=?', [ar0.id])
  log.assert('★ 销售退货只按合格量(3)冲减应收：100 − 3×10 = 70（不合格1件不退，业务决策）',
    Number(ar1.total_amount) === 70, `total=${ar1.total_amount}`)
  log.assert('★ 销售退货冲减应收后 confirm_status 打回 0（业务决策）',
    Number(ar1.confirm_status) === 0, `confirm_status=${ar1.confirm_status}`)
}

async function scenarioDiscountGuard(log, ctx, token) {
  log.section('Scenario: 改单后原折扣不得超过新货款')
  await seedActiveContainer(ctx.pool, {
    product: ctx.product, warehouse: ctx.warehouse, qty: 20, locationId: ctx.location.id,
  })
  const createDiscountedSale = () => ctx.http.post('/api/sale', {
    token,
    json: {
      customerId: Number(ctx.customer.id), customerName: ctx.customer.name,
      warehouseId: Number(ctx.warehouse.id), warehouseName: ctx.warehouse.name,
      discountAmount: 90,
      items: [{
        productId: Number(ctx.product.id), productCode: ctx.product.code,
        productName: ctx.product.name, unit: ctx.product.unit, quantity: 10, unitPrice: 10,
      }],
    },
  })

  const reservedSale = await createDiscountedSale()
  const reservedSaleId = Number(reservedSale.data?.data?.id)
  await ctx.http.post(`/api/sale/${reservedSaleId}/reserve`, { token })
  const reservedAdjust = await requestAdjustment(ctx, token, reservedSaleId, itemsFrom(ctx.product, 1))
  log.assert('占库期减量导致折扣超过新货款时拒绝且返回明确错误码',
    reservedAdjust.status === 400 && reservedAdjust.data?.code === 'SALE_DISCOUNT_EXCEEDS_TOTAL',
    `status=${reservedAdjust.status} code=${reservedAdjust.data?.code}`)
  const [reservedAfter] = await dbQuery(ctx.pool, 'SELECT total_amount, discount_amount FROM sale_orders WHERE id=?', [reservedSaleId])
  log.assert('占库期折扣校验失败后订单金额保持不变',
    Number(reservedAfter.total_amount) === 100 && Number(reservedAfter.discount_amount) === 90,
    JSON.stringify(reservedAfter))

  const pickingSale = await createDiscountedSale()
  const pickingSaleId = Number(pickingSale.data?.data?.id)
  await shipToTask(ctx.http, token, ctx.pool, pickingSaleId)
  const pickingAdjust = await requestAdjustment(ctx, token, pickingSaleId, itemsFrom(ctx.product, 1))
  log.assert('执行期减量导致折扣超过新货款时拒绝且返回明确错误码',
    pickingAdjust.status === 400 && pickingAdjust.data?.code === 'SALE_DISCOUNT_EXCEEDS_TOTAL',
    `status=${pickingAdjust.status} code=${pickingAdjust.data?.code}`)
  const [pickingAfter] = await dbQuery(ctx.pool, 'SELECT total_amount, discount_amount FROM sale_orders WHERE id=?', [pickingSaleId])
  log.assert('执行期折扣校验失败后订单金额保持不变',
    Number(pickingAfter.total_amount) === 100 && Number(pickingAfter.discount_amount) === 90,
    JSON.stringify(pickingAfter))
}

async function scenarioIntegrity(log, ctx, token) {
  log.section('Scenario: 分批改单边界、数量守恒和补占授信')
  await seedActiveContainer(ctx.pool, { product: ctx.product, warehouse: ctx.warehouse, qty: 100, locationId: ctx.location.id })
  const create = async () => {
    const r = await createSaleOrder(ctx.http, token, { customer: ctx.customer, warehouse: ctx.warehouse, product: ctx.product, quantity: 10 })
    return Number(r.data.data.id)
  }
  const id = await create()
  await shipToTask(ctx.http, token, ctx.pool, id)
  const key = randomRef('adjust-retry')
  const result = await requestAdjustment(ctx, token, id, itemsFrom(ctx.product, 9), { 'X-Request-Key': key })
  log.assert('完整派发单任务改单成功', result.ok, JSON.stringify(result.data))
  const [row] = await dbQuery(ctx.pool, 'SELECT quantity,reserved_qty,dispatched_qty FROM sale_order_items WHERE order_id=?', [id])
  log.assert('改单后订单数量账保持9/9/9', [row.quantity,row.reserved_qty,row.dispatched_qty].every(v => Number(v) === 9), JSON.stringify(row))
  const replay = await requestAdjustment(ctx, token, id, itemsFrom(ctx.product, 9), { 'X-Request-Key': key })
  log.assert('同键重试返回原回执', replay.ok && JSON.stringify(replay.data.data) === JSON.stringify(result.data.data), JSON.stringify(replay.data))
  const splitId = await create()
  await ctx.http.post(`/api/sale/${splitId}/reserve`, { token })
  const [splitRow] = await dbQuery(ctx.pool, 'SELECT id FROM sale_order_items WHERE order_id=?', [splitId])
  const dispatch = qty => ctx.http.post(`/api/sale/${splitId}/ship`, { token, json: { items: [{ id: Number(splitRow.id), qty }] } })
  await dispatch(4)
  const partial = await requestAdjustment(ctx, token, splitId, itemsFrom(ctx.product, 8))
  log.assert('单任务只派发部分数量时禁止执行期改单', partial.status === 409, JSON.stringify(partial.data))
  await dispatch(6)
  const multi = await requestAdjustment(ctx, token, splitId, itemsFrom(ctx.product, 3))
  log.assert('同仓多任务禁止执行期改单', multi.status === 409, JSON.stringify(multi.data))
  const [sum] = await dbQuery(ctx.pool, 'SELECT SUM(required_qty) AS qty FROM warehouse_task_items WHERE task_id IN (SELECT id FROM warehouse_tasks WHERE sale_order_id=?)', [splitId])
  log.assert('拒绝改单后任务合计仍为10', Number(sum.qty) === 10, JSON.stringify(sum))

  const creditId = await create()
  const [creditRow] = await dbQuery(ctx.pool, 'SELECT id FROM sale_order_items WHERE order_id=?', [creditId])
  const { getCustomerCreditUsed } = require('../backend/src/utils/creditExposure')
  const used = await getCustomerCreditUsed(ctx.pool, Number(ctx.customer.id))
  await ctx.pool.query('UPDATE sale_customers SET credit_limit=? WHERE id=?', [used + 100, ctx.customer.id])
  try {
    const reserve = qty => ctx.http.post(`/api/sale/${creditId}/reserve`, { token, json: { items: [{ id: Number(creditRow.id), warehouseId: Number(ctx.warehouse.id), warehouseName: ctx.warehouse.name, qty }] } })
    const first = await reserve(4)
    log.assert('额度刚好足够时首次部分占库成功', first.ok, JSON.stringify(first.data))
    const preview = await ctx.http.get(`/api/sale/${creditId}/reserve-preview`, { token })
    log.assert('补占预检不重复计算本单', preview.data?.data?.credit?.willExceed === false, JSON.stringify(preview.data?.data?.credit))
    const second = await reserve(6)
    log.assert('补占不需要额外授信放行', second.ok, JSON.stringify(second.data))
  } finally {
    await ctx.pool.query('UPDATE sale_customers SET credit_limit=NULL WHERE id=?', [ctx.customer.id])
  }
}

async function main() {
  const log = createLogger()
  const ctx = await prepareSmokeContext()
  try {
    const adminLogin = await login(ctx.http, 'smoke_admin', 'SmokeAdmin123!')
    const token = adminLogin.token
    log.assert('smoke_admin 登录成功', !!token, `status=${adminLogin.response.status}`)
    await ctx.pool.query(
      `INSERT INTO printer_bindings (warehouse_id, print_type, printer_id, printer_code)
       VALUES (?, 'package_label', ?, ?)
       ON DUPLICATE KEY UPDATE printer_id=VALUES(printer_id), printer_code=VALUES(printer_code)`,
      [Number(ctx.warehouse.id), Number(ctx.printer.id), ctx.printer.code],
    )

    await scenarioIncrease(log, ctx, token)
    await scenarioDecreaseImmediate(log, ctx, token)
    await scenarioDecreasePendingConfirm(log, ctx, token)
    await scenarioIncreaseWhileStillPicking(log, ctx, token)
    await scenarioDecreaseWhileStillPicking(log, ctx, token)
    await scenarioPackagingClosure(log, ctx, token)
    await scenarioSaleReturnQualifiedQty(log, ctx, token)
    await scenarioDiscountGuard(log, ctx, token)
    await scenarioIntegrity(log, ctx, token)
  } catch (error) {
    log.assert('销售改单烟雾测试无未捕获异常', false, error?.stack || error?.message || String(error))
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
