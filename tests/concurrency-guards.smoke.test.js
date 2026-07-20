#!/usr/bin/env node
'use strict'

const {
  createLogger,
  prepareSmokeContext,
  dbQuery,
  login,
  createPurchaseOrder,
  confirmPurchaseOrder,
  createInboundTaskFromPurchase,
  randomRef,
} = require('./helpers/smokeTestKit')

const inventoryService = require('../backend/src/modules/inventory/inventory.service')
const warehouseTaskService = require('../backend/src/modules/warehouse-tasks/warehouse-tasks.service')
const printJobsService = require('../backend/src/modules/print-jobs/print-jobs.service')
const { createContainer, syncStockFromContainers, SOURCE_TYPE, CONTAINER_STATUS } = require('../backend/src/engine/containerEngine')

async function bindPrinter(pool, { warehouseId, printType, printerId, printerCode }) {
  await pool.query(
    `INSERT INTO printer_bindings (warehouse_id, print_type, printer_id, printer_code)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE printer_id = VALUES(printer_id), printer_code = VALUES(printer_code)`,
    [warehouseId, printType, printerId, printerCode],
  )
}

async function createSaleOrder(http, token, { customer, warehouse, product, quantity }) {
  return http.post('/api/sale', {
    token,
    json: {
      customerId: Number(customer.id),
      customerName: customer.name,
      warehouseId: Number(warehouse.id),
      warehouseName: warehouse.name,
      remark: randomRef('concurrency-sale'),
      items: [{
        productId: Number(product.id),
        productCode: product.code,
        productName: product.name,
        unit: product.unit,
        quantity,
        unitPrice: 12,
      }],
    },
  })
}

async function createSubmittedInboundTask(http, token, { supplier, warehouse, product, quantity }) {
  const purchaseCreate = await createPurchaseOrder(http, token, {
    supplier,
    warehouse,
    product,
    quantity,
  })
  if (!purchaseCreate.ok) {
    throw new Error(`createPurchaseOrder failed: ${JSON.stringify(purchaseCreate.data)}`)
  }
  const purchaseId = Number(purchaseCreate.data?.data?.id)
  const purchaseConfirm = await confirmPurchaseOrder(http, token, purchaseId)
  if (!purchaseConfirm.ok) {
    throw new Error(`confirmPurchaseOrder failed: ${JSON.stringify(purchaseConfirm.data)}`)
  }
  const inboundCreate = await createInboundTaskFromPurchase(http, token, purchaseId)
  if (!inboundCreate.ok) {
    throw new Error(`createInboundTaskFromPurchase failed: ${JSON.stringify(inboundCreate.data)}`)
  }
  const inboundTaskId = Number(inboundCreate.data?.data?.taskId)
  const submitRes = await http.post(`/api/inbound-tasks/${inboundTaskId}/submit`, { token })
  if (!submitRes.ok) {
    throw new Error(`submit inbound task failed: ${JSON.stringify(submitRes.data)}`)
  }
  return { inboundTaskId, purchaseId }
}

async function seedActiveContainer(pool, { product, warehouse, qty, locationId = null }) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const sourceRefId = Math.floor(Date.now() / 1000)
    const { containerId, barcode } = await createContainer(conn, {
      productId: Number(product.id),
      warehouseId: Number(warehouse.id),
      initialQty: Number(qty),
      unit: product.unit,
      sourceType: SOURCE_TYPE.TRANSFER,
      sourceRefId,
      sourceRefType: 'test_seed',
      sourceRefNo: randomRef('SEED'),
      remark: 'concurrency guard seed',
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

async function withDisabledLabelPrinters(pool, fn) {
  const rows = await dbQuery(pool, 'SELECT id, status FROM printers WHERE type = 1')
  try {
    await pool.query('UPDATE printers SET status = 0 WHERE type = 1')
    return await fn()
  } finally {
    for (const row of rows) {
      await pool.query('UPDATE printers SET status = ? WHERE id = ?', [row.status, row.id])
    }
  }
}

async function scenarioInboundReceiveIdempotent(log, ctx, adminToken) {
  log.section('Scenario: inbound receive idempotency')
  const { inboundTaskId } = await createSubmittedInboundTask(ctx.http, adminToken, {
    supplier: ctx.supplier,
    warehouse: ctx.warehouse,
    product: ctx.product,
    quantity: 4,
  })
  const requestKey = randomRef('recv-idem')
  const request = () => ctx.http.post(`/api/inbound-tasks/${inboundTaskId}/receive`, {
    token: adminToken,
    headers: ctx.pdaHeaders({ 'X-Request-Key': requestKey }),
    json: {
      productId: Number(ctx.product.id),
      packages: [{ qty: 4 }],
    },
  })
  const [a, b] = await Promise.all([request(), request()])
  log.assert('receive 并发重复提交均返回成功', a.ok && b.ok, `a=${a.status} b=${b.status}`)
  const containers = await dbQuery(
    ctx.pool,
    'SELECT id FROM inventory_containers WHERE inbound_task_id = ? AND deleted_at IS NULL',
    [inboundTaskId],
  )
  log.assert('重复 receive 只生成一个容器', containers.length === 1, `count=${containers.length}`)
  const jobs = await dbQuery(
    ctx.pool,
    `SELECT id FROM print_jobs
     WHERE ref_type = 'inventory_container' AND ref_id = ?`,
    [containers[0]?.id || 0],
  )
  log.assert('重复 receive 只生成一个标签任务', jobs.length === 1, `count=${jobs.length}`)
}

async function scenarioInboundReceiveNoPrinterStillRecords(log, ctx, adminToken) {
  // 收货是"货已经在库"这个事实的记录，不应该因为打印基础设施暂时没就绪而回滚
  // （见 inbound-tasks.command.js receive() 的设计注释）：无可用打印机时 receive 仍应
  // 成功、正常入库，只是跳过该容器的打印任务，noPrinterCount 会如实反映跳过数量。
  log.section('Scenario: inbound receive still records stock when no printer available')
  const { inboundTaskId } = await createSubmittedInboundTask(ctx.http, adminToken, {
    supplier: ctx.supplier,
    warehouse: ctx.warehouse,
    product: ctx.product,
    quantity: 5,
  })
  const response = await withDisabledLabelPrinters(ctx.pool, () => ctx.http.post(`/api/inbound-tasks/${inboundTaskId}/receive`, {
    token: adminToken,
    headers: ctx.pdaHeaders({ 'X-Request-Key': randomRef('recv-no-printer') }),
    json: {
      productId: Number(ctx.product.id),
      packages: [{ qty: 5 }],
    },
  }))
  log.assert('无可用打印机时 receive 仍返回成功', response.ok, `status=${response.status}`)
  log.assert('响应体如实上报 noPrinterCount', Number(response.data?.data?.noPrinterCount) === 1, JSON.stringify(response.data?.data))
  const containers = await dbQuery(
    ctx.pool,
    'SELECT id FROM inventory_containers WHERE inbound_task_id = ? AND deleted_at IS NULL',
    [inboundTaskId],
  )
  log.assert('收货正常生成容器', containers.length === 1, `count=${containers.length}`)
  const items = await dbQuery(
    ctx.pool,
    'SELECT received_qty FROM inbound_task_items WHERE task_id = ?',
    [inboundTaskId],
  )
  const received = items.reduce((sum, row) => sum + Number(row.received_qty || 0), 0)
  log.assert('收货数量正常落地', received === 5, `received=${received}`)
  const jobs = await dbQuery(
    ctx.pool,
    `SELECT id FROM print_jobs WHERE ref_type = 'inventory_container' AND ref_id = ?`,
    [containers[0]?.id || 0],
  )
  log.assert('无打印机时不生成打印任务', jobs.length === 0, `count=${jobs.length}`)
}

async function scenarioSplitConcurrent(log, ctx) {
  log.section('Scenario: split container concurrent guard')
  const seeded = await seedActiveContainer(ctx.pool, {
    product: ctx.product,
    warehouse: ctx.warehouse,
    qty: 10,
  })
  const split = () => inventoryService.splitContainerOp(seeded.containerId, {
    qty: 6,
    remark: randomRef('split'),
    printLabel: true,
    userId: 1,
  })
  const [a, b] = await Promise.allSettled([split(), split()])
  const successCount = [a, b].filter(r => r.status === 'fulfilled').length
  const failCount = [a, b].filter(r => r.status === 'rejected').length
  log.assert('并发 split 只允许一条成功', successCount === 1 && failCount === 1, `success=${successCount} fail=${failCount}`)
  const children = await dbQuery(
    ctx.pool,
    'SELECT id, remaining_qty FROM inventory_containers WHERE parent_id = ? AND deleted_at IS NULL',
    [seeded.containerId],
  )
  log.assert('并发 split 只生成一个新容器', children.length === 1, `count=${children.length}`)
  const [[source]] = await ctx.pool.query(
    'SELECT remaining_qty FROM inventory_containers WHERE id = ?',
    [seeded.containerId],
  )
  log.assert('源容器数量按一次成功拆分扣减', Number(source.remaining_qty) === 4, `remaining=${source.remaining_qty}`)
}

async function scenarioSplitRollback(log, ctx) {
  log.section('Scenario: split rollback on print task failure')
  const seeded = await seedActiveContainer(ctx.pool, {
    product: ctx.product,
    warehouse: ctx.warehouse,
    qty: 9,
  })
  const originalEnqueue = printJobsService.enqueueContainerLabelJob
  printJobsService.enqueueContainerLabelJob = async () => null
  try {
    let failed = false
    try {
      await inventoryService.splitContainerOp(seeded.containerId, {
        qty: 3,
        remark: randomRef('split-fail'),
        printLabel: true,
        userId: 1,
      })
    } catch (_) {
      failed = true
    }
    log.assert('split 打印任务创建失败时返回失败', failed)
  } finally {
    printJobsService.enqueueContainerLabelJob = originalEnqueue
  }

  const [[source]] = await ctx.pool.query(
    'SELECT remaining_qty FROM inventory_containers WHERE id = ?',
    [seeded.containerId],
  )
  log.assert('split 回滚后源容器数量不变', Number(source.remaining_qty) === 9, `remaining=${source.remaining_qty}`)
  const children = await dbQuery(
    ctx.pool,
    'SELECT id FROM inventory_containers WHERE parent_id = ? AND deleted_at IS NULL',
    [seeded.containerId],
  )
  log.assert('split 回滚后不生成新容器', children.length === 0, `count=${children.length}`)
}

async function scenarioWarehouseCancel(log, ctx, adminToken) {
  log.section('Scenario: warehouse task cancel concurrency & rollback')
  const saleCreate = await createSaleOrder(ctx.http, adminToken, {
    customer: ctx.customer,
    warehouse: ctx.warehouse,
    product: ctx.product,
    quantity: 2,
  })
  log.assert('创建销售单成功', saleCreate.ok, `status=${saleCreate.status}`)
  const saleId = Number(saleCreate.data?.data?.id)
  const reserve = await ctx.http.post(`/api/sale/${saleId}/reserve`, { token: adminToken })
  log.assert('销售单占库成功', reserve.ok, `status=${reserve.status}`)
  const shipRequest = await ctx.http.post(`/api/sale/${saleId}/ship`, { token: adminToken })
  log.assert('销售单创建仓库任务成功', shipRequest.ok, `status=${shipRequest.status}`)
  const [saleRows] = await ctx.pool.query('SELECT task_id FROM sale_orders WHERE id = ?', [saleId])
  const taskId = Number(saleRows[0]?.task_id)
  log.assert('销售单已关联仓库任务', Number.isFinite(taskId) && taskId > 0, `taskId=${taskId}`)

  const cancelCall = () => ctx.http.put(`/api/warehouse-tasks/${taskId}/cancel`, { token: adminToken })
  const [a, b] = await Promise.all([cancelCall(), cancelCall()])
  const successCount = [a, b].filter(r => r.ok).length
  const failureCount = [a, b].filter(r => !r.ok).length
  log.assert('并发 cancel 只有一条成功', successCount === 1 && failureCount === 1, `success=${successCount} fail=${failureCount}`)

  const [taskRows] = await ctx.pool.query('SELECT status FROM warehouse_tasks WHERE id = ?', [taskId])
  const [saleStatusRows] = await ctx.pool.query('SELECT status FROM sale_orders WHERE id = ?', [saleId])
  log.assert('cancel 成功后任务为已取消', Number(taskRows[0]?.status) === 8, `status=${taskRows[0]?.status}`)
  log.assert('cancel 成功后销售单同步为已取消', Number(saleStatusRows[0]?.status) === 5, `status=${saleStatusRows[0]?.status}`)

  const saleCreate2 = await createSaleOrder(ctx.http, adminToken, {
    customer: ctx.customer,
    warehouse: ctx.warehouse,
    product: ctx.product,
    quantity: 2,
  })
  const saleId2 = Number(saleCreate2.data?.data?.id)
  await ctx.http.post(`/api/sale/${saleId2}/reserve`, { token: adminToken })
  await ctx.http.post(`/api/sale/${saleId2}/ship`, { token: adminToken })
  const [saleRows2] = await ctx.pool.query('SELECT task_id FROM sale_orders WHERE id = ?', [saleId2])
  const taskId2 = Number(saleRows2[0]?.task_id)
  await ctx.pool.query('UPDATE sale_orders SET status = 4 WHERE id = ?', [saleId2])
  const blocked = await ctx.http.put(`/api/warehouse-tasks/${taskId2}/cancel`, { token: adminToken })
  log.assert('销售单已出库时 cancel 被拒绝', !blocked.ok, `status=${blocked.status}`)
  const [taskRows2] = await ctx.pool.query('SELECT status FROM warehouse_tasks WHERE id = ?', [taskId2])
  log.assert('cancel 被拒绝时任务状态不落地', Number(taskRows2[0]?.status) === 2, `status=${taskRows2[0]?.status}`)
}

// 建单→占库→ship→PDA拣一个容器，返回 { taskId, container, itemId }。
// 供下面「取消逆向归还」系列场景复用：这些场景都需要一个「已经拣了至少一个容器」的任务
// 作为起点，才会触发新的取消分流分支（0容器仍走老的立即取消逻辑，不在这里覆盖）。
async function setupTaskWithLockedContainer(ctx, token) {
  // 专门为本容器指定一个真实库位（locationId），不复用共享 product/warehouse 池子里
  // 其它场景（如 seedActiveContainer 默认调用）留下的无库位容器——取消逆向归还必须
  // 校验"扫回原库位"，容器没有库位这个前置条件本身就不成立，会跟真实生产路径（收货
  // 上架/调拨入库/退货入库均写入 location_id）脱节。
  const seeded = await seedActiveContainer(ctx.pool, {
    product: ctx.product, warehouse: ctx.warehouse, qty: 1, locationId: ctx.location.id,
  })
  const saleCreate = await createSaleOrder(ctx.http, token, {
    customer: ctx.customer, warehouse: ctx.warehouse, product: ctx.product, quantity: 1,
  })
  const saleId = Number(saleCreate.data?.data?.id)
  await ctx.http.post(`/api/sale/${saleId}/reserve`, { token })
  await ctx.http.post(`/api/sale/${saleId}/ship`, { token })
  const [saleRow] = await dbQuery(ctx.pool, 'SELECT task_id FROM sale_orders WHERE id=?', [saleId])
  const taskId = Number(saleRow.task_id)
  const [itemRow] = await dbQuery(ctx.pool, 'SELECT id FROM warehouse_task_items WHERE task_id=?', [taskId])
  const [container] = await dbQuery(ctx.pool,
    'SELECT id, barcode, location_id FROM inventory_containers WHERE id=?',
    [seeded.containerId],
  )
  await ctx.http.post('/api/scan-logs', {
    token, headers: ctx.pdaHeaders(),
    json: { taskId, itemId: itemRow.id, containerId: container.id, barcode: container.barcode, productId: Number(ctx.product.id), qty: 1, scanMode: '整件' },
  })
  return { taskId, itemId: itemRow.id, container, saleId }
}

// 取消逆向归还：新分支基本行为 + 正向拦截。
// 覆盖：容器已拣的任务被取消时，不批量解锁，而是立即释放预占/推进销售单状态，
// 但保留容器锁定等待逐容器扫码归还；此时继续拣货/ready/pick-suggestions 均应被拒绝。
async function scenarioCancelReverseReturnBasics(log, ctx, adminToken) {
  log.section('Scenario: 取消逆向归还 — 新分支基本行为')
  const { taskId, itemId, container, saleId } = await setupTaskWithLockedContainer(ctx, adminToken)

  const [containerAfterPick] = await dbQuery(ctx.pool, 'SELECT locked_by_task_id FROM inventory_containers WHERE id=?', [container.id])
  log.assert('容器已被拣货锁定', Number(containerAfterPick.locked_by_task_id) === taskId)

  const cancelResp = await ctx.http.put(`/api/warehouse-tasks/${taskId}/cancel`, { token: adminToken })
  log.assert('ERP取消成功（有容器锁定，应走新分支）', cancelResp.ok, `status=${cancelResp.status}`)

  const [taskAfterCancel] = await dbQuery(ctx.pool, 'SELECT status, cancel_requested_at FROM warehouse_tasks WHERE id=?', [taskId])
  log.assert('任务status未变(仍为2拣货中)', Number(taskAfterCancel.status) === 2, JSON.stringify(taskAfterCancel))
  log.assert('cancel_requested_at已写入', !!taskAfterCancel.cancel_requested_at)

  const [saleAfterCancel] = await dbQuery(ctx.pool, 'SELECT status FROM sale_orders WHERE id=?', [saleId])
  log.assert('销售单已立即标记为已取消(5)', Number(saleAfterCancel.status) === 5)

  const [containerAfterCancel] = await dbQuery(ctx.pool, 'SELECT locked_by_task_id FROM inventory_containers WHERE id=?', [container.id])
  log.assert('容器仍然锁定，未被批量解锁', Number(containerAfterCancel.locked_by_task_id) === taskId)

  const reservationRows = await dbQuery(ctx.pool, "SELECT * FROM stock_reservations WHERE ref_type='sale_order' AND ref_id=? AND status=1", [saleId])
  log.assert('库存预占已立即释放', reservationRows.length === 0)

  const [itemAfterCancel] = await dbQuery(ctx.pool, 'SELECT required_qty, picked_qty FROM warehouse_task_items WHERE id=?', [itemId])
  log.assert('required_qty已clamp到picked_qty', Number(itemAfterCancel.required_qty) === Number(itemAfterCancel.picked_qty))

  const readyResp = await ctx.http.put(`/api/warehouse-tasks/${taskId}/ready`, { token: adminToken, headers: ctx.pdaHeaders() })
  log.assert('取消收尾中的任务，ready接口应返回409', readyResp.status === 409, `status=${readyResp.status}`)

  const rescanResp = await ctx.http.post('/api/scan-logs', {
    token: adminToken, headers: ctx.pdaHeaders(),
    json: { taskId, itemId, containerId: container.id, barcode: container.barcode, productId: Number(ctx.product.id), qty: 1, scanMode: '整件' },
  })
  log.assert('取消收尾中的任务，拣货扫码应返回409', rescanResp.status === 409, `status=${rescanResp.status}`)

  const doubleCancel = await ctx.http.put(`/api/warehouse-tasks/${taskId}/cancel`, { token: adminToken })
  log.assert('对已在收尾中的任务重复cancel应返回409', doubleCancel.status === 409, `status=${doubleCancel.status}`)

  const suggestResp = await ctx.http.get(`/api/warehouse-tasks/${taskId}/pick-suggestions`, { token: adminToken })
  log.assert('取消收尾中的任务，pick-suggestions应返回409', suggestResp.status === 409, `status=${suggestResp.status}`)
}

// 取消逆向归还：端到端全流程（列表→详情→逐容器扫码归还→finalize→分拣格释放）+ 可见性补丁
async function scenarioCancelReverseReturnFinalize(log, ctx, adminToken) {
  log.section('Scenario: 取消逆向归还 — 端到端全流程与可见性')
  const { taskId, container } = await setupTaskWithLockedContainer(ctx, adminToken)
  const [taskRowBefore] = await dbQuery(ctx.pool, 'SELECT sorting_bin_id FROM warehouse_tasks WHERE id=?', [taskId])

  // 取消前：拣货池/SKU汇总里应该能看到
  const poolBefore = await ctx.http.get('/api/warehouse-tasks/my', { token: adminToken })
  log.assert('取消前，任务在拣货池可见', (poolBefore.data?.data || []).some(t => Number(t.id) === taskId))

  const cancelResp = await ctx.http.put(`/api/warehouse-tasks/${taskId}/cancel`, { token: adminToken })
  log.assert('ERP取消成功', cancelResp.ok, `status=${cancelResp.status}`)

  // 可见性补丁：拣货池/SKU汇总/分拣扫商品/pick-route 都不应再看到这个任务
  const poolAfter = await ctx.http.get('/api/warehouse-tasks/my', { token: adminToken })
  log.assert('取消后，任务不再出现在拣货池', !(poolAfter.data?.data || []).some(t => Number(t.id) === taskId),
    JSON.stringify(poolAfter.data?.data?.map(t => t.id)))

  const skuSummary = await ctx.http.get('/api/warehouse-tasks/my-sku-summary', { token: adminToken })
  const skuTaskIds = (skuSummary.data?.data || []).flatMap(s => String(s.taskIds || '').split(',').map(Number))
  log.assert('取消后，任务不再出现在SKU汇总池', !skuTaskIds.includes(taskId))

  const scanProductResp = await ctx.http.get(`/api/sorting-bins/scan?code=${encodeURIComponent(ctx.product.code)}`, { token: adminToken })
  log.assert('取消后，分拣扫商品查不到该任务', Number(scanProductResp.data?.data?.taskId) !== taskId)

  const routeResp = await ctx.http.get(`/api/warehouse-tasks/${taskId}/pick-route`, { token: adminToken })
  log.assert('取消后，pick-route应返回409', routeResp.status === 409, `status=${routeResp.status}`)

  // 列表接口能查到这个收尾中任务
  const pendingList = await ctx.http.get('/api/warehouse-tasks/cancel-returns/pending', { token: adminToken })
  log.assert('任务出现在取消收尾任务池列表里', (pendingList.data?.data || []).some(t => Number(t.id) === taskId))

  // 详情接口
  const detailResp = await ctx.http.get(`/api/warehouse-tasks/${taskId}/cancel-return-detail`, { token: adminToken })
  const containers = detailResp.data?.data?.containers || []
  log.assert('详情里包含待归还容器', containers.length === 1 && containers[0].containerId === container.id, JSON.stringify(containers))

  // 逆向归还扫码：仓库侧只能执行，不能决定放哪——必须扫回容器原本的库位。
  // 专门造一个跟容器原库位确定不同的库位，验证"自选库位"会被拒绝，不依赖巧合。
  const [insertResult] = await ctx.pool.query(
    "INSERT INTO warehouse_locations (warehouse_id, code, name) VALUES (?, ?, '诱饵库位（测试用）')",
    [ctx.warehouse.id, randomRef('DECOY-LOC')],
  )
  const decoyLocationId = insertResult.insertId
  const wrongLocationResp = await ctx.http.post('/api/scan-logs/cancel-return', {
    token: adminToken, headers: ctx.pdaHeaders(),
    json: { taskId, containerId: container.id, barcode: container.barcode, locationId: decoyLocationId },
  })
  log.assert('扫描非原库位应被拒绝（不允许操作员自选库位）',
    !wrongLocationResp.ok && wrongLocationResp.status === 400,
    `status=${wrongLocationResp.status} body=${JSON.stringify(wrongLocationResp.data)}`)

  const returnResp = await ctx.http.post('/api/scan-logs/cancel-return', {
    token: adminToken, headers: ctx.pdaHeaders(),
    json: { taskId, containerId: container.id, barcode: container.barcode, locationId: Number(container.location_id) },
  })
  log.assert('扫回原库位归还扫码成功且finalized=true（唯一容器）',
    returnResp.ok && returnResp.data?.data?.remaining === 0 && returnResp.data?.data?.finalized === true,
    JSON.stringify(returnResp.data?.data))

  const [containerAfter] = await dbQuery(ctx.pool, 'SELECT locked_by_task_id, location_id FROM inventory_containers WHERE id=?', [container.id])
  log.assert('容器已解锁', containerAfter.locked_by_task_id === null)
  log.assert('容器location_id确认为原库位（未被改到别处）', Number(containerAfter.location_id) === Number(container.location_id))

  const [taskAfterFinalize] = await dbQuery(ctx.pool,
    'SELECT status, cancel_requested_at, sorting_bin_id, sorting_bin_code FROM warehouse_tasks WHERE id=?', [taskId])
  log.assert('任务已真正变为已取消(8)', Number(taskAfterFinalize.status) === 8, JSON.stringify(taskAfterFinalize))
  log.assert('cancel_requested_at已清空', taskAfterFinalize.cancel_requested_at === null)
  log.assert('分拣格已释放', taskAfterFinalize.sorting_bin_id === null && taskAfterFinalize.sorting_bin_code === null)

  if (taskRowBefore.sorting_bin_id) {
    const [binRow] = await dbQuery(ctx.pool, 'SELECT status, current_task_id FROM sorting_bins WHERE id=?', [taskRowBefore.sorting_bin_id])
    log.assert('分拣格本身状态已回到空闲(1)', Number(binRow.status) === 1 && binRow.current_task_id === null)
  }
}

// 取消逆向归还：并发/幂等专项
async function scenarioCancelReverseReturnConcurrency(log, ctx, adminToken) {
  log.section('Scenario: 取消逆向归还 — 并发/幂等专项')

  // 1) 并发双击"取消"只有一条成功
  {
    const { taskId } = await setupTaskWithLockedContainer(ctx, adminToken)
    const cancelCall = () => ctx.http.put(`/api/warehouse-tasks/${taskId}/cancel`, { token: adminToken })
    const [a, b] = await Promise.all([cancelCall(), cancelCall()])
    const successCount = [a, b].filter(r => r.ok).length
    log.assert('并发双击取消只有一条成功', successCount === 1, `a=${a.status} b=${b.status}`)
  }

  // 2) 同 requestKey 重复归还扫码走 replay，不重复插入 scan_logs
  {
    const { taskId, container } = await setupTaskWithLockedContainer(ctx, adminToken)
    await ctx.http.put(`/api/warehouse-tasks/${taskId}/cancel`, { token: adminToken })
    const requestKey = randomRef('idem-cancel-return')
    const call = () => ctx.http.post('/api/scan-logs/cancel-return', {
      token: adminToken, headers: ctx.pdaHeaders({ 'X-Request-Key': requestKey }),
      json: { taskId, containerId: container.id, barcode: container.barcode, locationId: Number(container.location_id) },
    })
    const r1 = await call()
    const r2 = await call()
    log.assert('第一次归还扫码成功', r1.ok && r1.data?.data?.finalized === true)
    log.assert('第二次(同requestKey)走replay返回相同记录id', r2.ok && r2.data?.data?.id === r1.data?.data?.id)
    const [scanCount] = await dbQuery(ctx.pool, 'SELECT COUNT(*) n FROM scan_logs WHERE task_id=? AND scan_purpose=3', [taskId])
    log.assert('scan_logs只有一条归还记录（未重复插入）', Number(scanCount.n) === 1)
  }

  // 3) 两个并发请求归还最后一个容器，finalize 只触发一次
  {
    const { taskId, container } = await setupTaskWithLockedContainer(ctx, adminToken)
    await ctx.http.put(`/api/warehouse-tasks/${taskId}/cancel`, { token: adminToken })
    const call = () => ctx.http.post('/api/scan-logs/cancel-return', {
      token: adminToken, headers: ctx.pdaHeaders(),
      json: { taskId, containerId: container.id, barcode: container.barcode, locationId: Number(container.location_id) },
    })
    const [a, b] = await Promise.all([call(), call()])
    const successCount = [a, b].filter(r => r.ok).length
    log.assert('并发归还同一容器只有一条成功', successCount === 1, `a=${a.status} b=${b.status}`)

    const [task] = await dbQuery(ctx.pool, 'SELECT status FROM warehouse_tasks WHERE id=?', [taskId])
    log.assert('任务正确变为已取消(8)', Number(task.status) === 8)

    const [finalizedEvents] = await dbQuery(ctx.pool,
      "SELECT COUNT(*) n FROM warehouse_task_events WHERE task_id=? AND event_type='CANCEL_FINALIZED'", [taskId])
    log.assert('CANCEL_FINALIZED事件只记一条（finalize未重复触发）', Number(finalizedEvents.n) === 1)
  }
}

// 把 setupTaskWithLockedContainer 建好的任务从拣货中推进到 stage 指定的阶段：
// 'checking' → 分拣已完成，任务处于 CHECKING，尚未做复核扫码（本轮 fixture 只有
//              1 个单位的量，复核扫满就会自动收口进 PACKING，没法卡在"扫过但未完成"
//              这个中间态，因此测复核阶段的取消要在扫码之前）
// 'packing'  → 复核扫码已做（自动收口触发 checkDone），任务处于 PACKING，尚未创建任何箱子
async function advanceTaskToStage(ctx, token, { taskId, itemId, container }, stage) {
  const ready = await ctx.http.put(`/api/warehouse-tasks/${taskId}/ready`, { token, headers: ctx.pdaHeaders() })
  if (!ready.ok) throw new Error(`advanceTaskToStage: ready failed: ${JSON.stringify(ready.data)}`)
  const sortDone = await ctx.http.put(`/api/warehouse-tasks/${taskId}/sort-done`, { token, headers: ctx.pdaHeaders(), json: {} })
  if (!sortDone.ok) throw new Error(`advanceTaskToStage: sort-done failed: ${JSON.stringify(sortDone.data)}`)
  if (stage === 'checking') return
  // 复核扫码：本轮 fixture 只有 1 个单位，扫满即自动收口进 PACKING（同 createCheckScanLog
  // 内部的 checkDoneWithinTransaction 自动触发逻辑），不需要再单独调用 check-done 接口。
  const checkScan = await ctx.http.post('/api/scan-logs/check', {
    token, headers: ctx.pdaHeaders(),
    json: { taskId, barcode: container.barcode },
  })
  if (!checkScan.ok) throw new Error(`advanceTaskToStage: check scan failed: ${JSON.stringify(checkScan.data)}`)
}

// 取消逆向归还：待打包(PACKING)阶段——混合"打包中未完成的箱子"与"已完成/已打印箱贴的箱子"
async function scenarioCancelReverseReturnPacking(log, ctx, adminToken) {
  log.section('Scenario: 取消逆向归还 — 待打包阶段')
  const setup = await setupTaskWithLockedContainer(ctx, adminToken)
  const { taskId, container } = setup
  await advanceTaskToStage(ctx, adminToken, setup, 'packing')

  const [taskAtPacking] = await dbQuery(ctx.pool, 'SELECT status FROM warehouse_tasks WHERE id=?', [taskId])
  log.assert('任务已推进到待打包(5)', Number(taskAtPacking.status) === 5, JSON.stringify(taskAtPacking))

  // 未完成的空箱：从未加过商品、从未打印过箱贴，取消时应被系统自动作废，不进入待处理清单
  const openPkgResp = await ctx.http.post('/api/packages', { token: adminToken, json: { warehouseTaskId: taskId } })
  const openPkgId = Number(openPkgResp.data?.data?.id)

  // 已完成的箱子：装满、finish（触发箱贴打印任务），取消时需要人工扫码确认拆箱
  const sealedPkgResp = await ctx.http.post('/api/packages', { token: adminToken, json: { warehouseTaskId: taskId } })
  const sealedPkgId = Number(sealedPkgResp.data?.data?.id)
  const sealedPkgBarcode = sealedPkgResp.data?.data?.barcode
  await ctx.http.post(`/api/packages/${sealedPkgId}/add-item`, {
    token: adminToken, json: { productCode: ctx.product.code, qty: 1 },
  })
  const finishResp = await ctx.http.put(`/api/packages/${sealedPkgId}/finish`, { token: adminToken })
  log.assert('已完成箱子finish成功（含箱贴打印任务）', finishResp.ok, `status=${finishResp.status}`)

  const cancelResp = await ctx.http.put(`/api/warehouse-tasks/${taskId}/cancel`, { token: adminToken })
  log.assert('待打包阶段取消成功（有容器锁定，走逆向归还分支）', cancelResp.ok, `status=${cancelResp.status}`)

  const [openPkgAfter] = await dbQuery(ctx.pool, 'SELECT status FROM packages WHERE id=?', [openPkgId])
  log.assert('未完成的空箱已被系统自动作废(3)', Number(openPkgAfter.status) === 3, JSON.stringify(openPkgAfter))

  const [sealedPkgAfter] = await dbQuery(ctx.pool, 'SELECT status FROM packages WHERE id=?', [sealedPkgId])
  log.assert('已完成的箱子仍保持完成(2)，等待人工拆箱确认', Number(sealedPkgAfter.status) === 2, JSON.stringify(sealedPkgAfter))

  const detailResp = await ctx.http.get(`/api/warehouse-tasks/${taskId}/cancel-return-detail`, { token: adminToken })
  const detailPkgs = detailResp.data?.data?.packages || []
  log.assert('待处理清单只包含已完成的箱子（未完成的箱子已自动清零）',
    detailPkgs.length === 1 && detailPkgs[0].packageId === sealedPkgId, JSON.stringify(detailPkgs))

  // 取消收尾期间，打包相关操作一律应被拒绝
  const addItemAfterCancel = await ctx.http.post('/api/packages', { token: adminToken, json: { warehouseTaskId: taskId } })
  log.assert('取消收尾中禁止新建箱子', addItemAfterCancel.status === 409, `status=${addItemAfterCancel.status}`)

  // 容器归还（复用既有流程，未受箱子分支影响）
  const containerReturn = await ctx.http.post('/api/scan-logs/cancel-return', {
    token: adminToken, headers: ctx.pdaHeaders(),
    json: { taskId, containerId: container.id, barcode: container.barcode, locationId: Number(container.location_id) },
  })
  log.assert('容器归还成功但任务尚未finalize（箱子还没处理）',
    containerReturn.ok && containerReturn.data?.data?.finalized === false, JSON.stringify(containerReturn.data?.data))

  // 箱子条码不匹配应被拒绝
  const wrongBarcode = await ctx.http.post('/api/scan-logs/cancel-return/box', {
    token: adminToken, headers: ctx.pdaHeaders(),
    json: { taskId, packageId: sealedPkgId, barcode: 'L999999' },
  })
  log.assert('拆箱确认条码不匹配应被拒绝', !wrongBarcode.ok && wrongBarcode.status === 400, `status=${wrongBarcode.status}`)

  const boxScan = await ctx.http.post('/api/scan-logs/cancel-return/box', {
    token: adminToken, headers: ctx.pdaHeaders(),
    json: { taskId, packageId: sealedPkgId, barcode: sealedPkgBarcode },
  })
  log.assert('拆箱确认成功且finalized=true（最后一项处理完）',
    boxScan.ok && boxScan.data?.data?.finalized === true, JSON.stringify(boxScan.data?.data))

  const [taskFinal] = await dbQuery(ctx.pool, 'SELECT status, cancel_requested_at FROM warehouse_tasks WHERE id=?', [taskId])
  log.assert('任务已真正变为已取消(8)', Number(taskFinal.status) === 8 && taskFinal.cancel_requested_at === null, JSON.stringify(taskFinal))

  const [printJobAfter] = await dbQuery(ctx.pool,
    "SELECT status FROM print_jobs WHERE ref_type='package' AND ref_id=? ORDER BY id DESC LIMIT 1", [sealedPkgId])
  log.assert('箱子的箱贴打印任务已被取消', Number(printJobAfter.status) === 3, JSON.stringify(printJobAfter))
}

// 取消逆向归还：待出库(SHIPPING)阶段——打包完成后分拣格已释放，取消仍需正确处理已封箱子 + 拦截出库
async function scenarioCancelReverseReturnShipping(log, ctx, adminToken) {
  log.section('Scenario: 取消逆向归还 — 待出库阶段')
  const setup = await setupTaskWithLockedContainer(ctx, adminToken)
  const { taskId, container } = setup
  await advanceTaskToStage(ctx, adminToken, setup, 'packing')

  const pkgResp = await ctx.http.post('/api/packages', { token: adminToken, json: { warehouseTaskId: taskId } })
  const pkgId = Number(pkgResp.data?.data?.id)
  const pkgBarcode = pkgResp.data?.data?.barcode
  await ctx.http.post(`/api/packages/${pkgId}/add-item`, {
    token: adminToken, json: { productCode: ctx.product.code, qty: 1 },
  })
  const finishResp = await ctx.http.put(`/api/packages/${pkgId}/finish`, { token: adminToken })
  // pack-done 要求箱贴打印任务已收口完成（assertTaskPackagePrintClosure），
  // 本机没有真机打印客户端在跑，直接用 complete-local 模拟"已打印完成"。
  const printJobId = Number(finishResp.data?.data?.printJobId)
  await ctx.http.post(`/api/print-jobs/${printJobId}/complete-local`, { token: adminToken, json: {} })

  const packDoneResp = await ctx.http.put(`/api/warehouse-tasks/${taskId}/pack-done`, { token: adminToken, headers: ctx.pdaHeaders() })
  log.assert('打包完成成功，推进到待出库(6)', packDoneResp.ok, `status=${packDoneResp.status}`)

  const [taskAtShipping] = await dbQuery(ctx.pool, 'SELECT status, sorting_bin_id FROM warehouse_tasks WHERE id=?', [taskId])
  log.assert('任务已在待出库(6)，分拣格已随打包完成释放', Number(taskAtShipping.status) === 6, JSON.stringify(taskAtShipping))

  const cancelResp = await ctx.http.put(`/api/warehouse-tasks/${taskId}/cancel`, { token: adminToken })
  log.assert('待出库阶段取消成功（走逆向归还分支）', cancelResp.ok, `status=${cancelResp.status}`)

  const shipAfterCancel = await ctx.http.put(`/api/warehouse-tasks/${taskId}/ship`, { token: adminToken, headers: ctx.pdaHeaders() })
  log.assert('取消收尾中禁止出库', shipAfterCancel.status === 409, `status=${shipAfterCancel.status}`)

  const containerReturn = await ctx.http.post('/api/scan-logs/cancel-return', {
    token: adminToken, headers: ctx.pdaHeaders(),
    json: { taskId, containerId: container.id, barcode: container.barcode, locationId: Number(container.location_id) },
  })
  log.assert('容器归还成功但任务尚未finalize', containerReturn.ok && containerReturn.data?.data?.finalized === false)

  const boxScan = await ctx.http.post('/api/scan-logs/cancel-return/box', {
    token: adminToken, headers: ctx.pdaHeaders(),
    json: { taskId, packageId: pkgId, barcode: pkgBarcode },
  })
  log.assert('拆箱确认成功且finalized=true', boxScan.ok && boxScan.data?.data?.finalized === true, JSON.stringify(boxScan.data?.data))

  const [taskFinal] = await dbQuery(ctx.pool, 'SELECT status, sorting_bin_id FROM warehouse_tasks WHERE id=?', [taskId])
  log.assert('任务已真正变为已取消(8)，分拣格释放逻辑未重复出错', Number(taskFinal.status) === 8, JSON.stringify(taskFinal))
}

// 取消逆向归还：复核(CHECKING)阶段正向流程守卫——任务进入取消收尾后，复核扫码/复核完成均应被拒绝
async function scenarioCancelReverseReturnForwardGuards(log, ctx, adminToken) {
  log.section('Scenario: 取消逆向归还 — 复核阶段正向守卫')
  const setup = await setupTaskWithLockedContainer(ctx, adminToken)
  const { taskId, container } = setup
  await advanceTaskToStage(ctx, adminToken, setup, 'checking')

  const [taskAtChecking] = await dbQuery(ctx.pool, 'SELECT status FROM warehouse_tasks WHERE id=?', [taskId])
  log.assert('任务处于待复核(4)', Number(taskAtChecking.status) === 4, JSON.stringify(taskAtChecking))

  const cancelResp = await ctx.http.put(`/api/warehouse-tasks/${taskId}/cancel`, { token: adminToken })
  log.assert('复核阶段取消成功（走逆向归还分支）', cancelResp.ok, `status=${cancelResp.status}`)

  const rescanCheck = await ctx.http.post('/api/scan-logs/check', {
    token: adminToken, headers: ctx.pdaHeaders(),
    json: { taskId, barcode: container.barcode },
  })
  log.assert('取消收尾中的任务，复核扫码应返回409', rescanCheck.status === 409, `status=${rescanCheck.status}`)

  const checkDoneAfterCancel = await ctx.http.put(`/api/warehouse-tasks/${taskId}/check-done`, { token: adminToken, headers: ctx.pdaHeaders() })
  log.assert('取消收尾中的任务，复核完成应返回409', checkDoneAfterCancel.status === 409, `status=${checkDoneAfterCancel.status}`)

  const detailResp = await ctx.http.get(`/api/warehouse-tasks/${taskId}/cancel-return-detail`, { token: adminToken })
  log.assert('复核阶段取消无任何箱子待处理', (detailResp.data?.data?.packages || []).length === 0)

  const containerReturn = await ctx.http.post('/api/scan-logs/cancel-return', {
    token: adminToken, headers: ctx.pdaHeaders(),
    json: { taskId, containerId: container.id, barcode: container.barcode, locationId: Number(container.location_id) },
  })
  log.assert('复核阶段容器归还成功且直接finalize（无箱子需处理）',
    containerReturn.ok && containerReturn.data?.data?.finalized === true, JSON.stringify(containerReturn.data?.data))
}

async function main() {
  const log = createLogger()
  const ctx = await prepareSmokeContext()
  try {
    const adminLogin = await login(ctx.http, 'smoke_admin', 'SmokeAdmin123!')
    const adminToken = adminLogin.token
    log.assert('smoke_admin 登录成功', !!adminToken, `status=${adminLogin.response.status}`)
    await bindPrinter(ctx.pool, {
      warehouseId: Number(ctx.warehouse.id),
      printType: 'container_label',
      printerId: Number(ctx.printer.id),
      printerCode: ctx.printer.code,
    })
    await bindPrinter(ctx.pool, {
      warehouseId: Number(ctx.warehouse.id),
      printType: 'rack_label',
      printerId: Number(ctx.printer.id),
      printerCode: ctx.printer.code,
    })
    await bindPrinter(ctx.pool, {
      warehouseId: Number(ctx.warehouse.id),
      printType: 'package_label',
      printerId: Number(ctx.printer.id),
      printerCode: ctx.printer.code,
    })

    await scenarioInboundReceiveIdempotent(log, ctx, adminToken)
    await scenarioInboundReceiveNoPrinterStillRecords(log, ctx, adminToken)
    await scenarioSplitConcurrent(log, ctx)
    await scenarioSplitRollback(log, ctx)
    await scenarioWarehouseCancel(log, ctx, adminToken)
    await scenarioCancelReverseReturnBasics(log, ctx, adminToken)
    await scenarioCancelReverseReturnFinalize(log, ctx, adminToken)
    await scenarioCancelReverseReturnConcurrency(log, ctx, adminToken)
    await scenarioCancelReverseReturnPacking(log, ctx, adminToken)
    await scenarioCancelReverseReturnShipping(log, ctx, adminToken)
    await scenarioCancelReverseReturnForwardGuards(log, ctx, adminToken)
  } finally {
    const summary = log.summary()
    await ctx.close()
    // 强制退出：避免残留句柄导致进程挂住 CI（process.exitCode 不强制退出）
    process.exit(summary.failed > 0 ? 1 : 0)
  }
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error?.message || String(error)}\n`)
  process.exit(1)
})
