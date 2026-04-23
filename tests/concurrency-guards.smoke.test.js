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

async function seedActiveContainer(pool, { product, warehouse, qty }) {
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
    headers: { 'X-Request-Key': requestKey },
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

async function scenarioInboundReceiveRollback(log, ctx, adminToken) {
  log.section('Scenario: inbound receive rollback on print task failure')
  const { inboundTaskId } = await createSubmittedInboundTask(ctx.http, adminToken, {
    supplier: ctx.supplier,
    warehouse: ctx.warehouse,
    product: ctx.product,
    quantity: 5,
  })
  const response = await withDisabledLabelPrinters(ctx.pool, () => ctx.http.post(`/api/inbound-tasks/${inboundTaskId}/receive`, {
    token: adminToken,
    headers: { 'X-Request-Key': randomRef('recv-fail') },
    json: {
      productId: Number(ctx.product.id),
      packages: [{ qty: 5 }],
    },
  }))
  log.assert('打印任务创建失败时 receive 返回失败', !response.ok, `status=${response.status}`)
  const containers = await dbQuery(
    ctx.pool,
    'SELECT id FROM inventory_containers WHERE inbound_task_id = ? AND deleted_at IS NULL',
    [inboundTaskId],
  )
  log.assert('receive 回滚后不生成容器', containers.length === 0, `count=${containers.length}`)
  const items = await dbQuery(
    ctx.pool,
    'SELECT received_qty FROM inbound_task_items WHERE task_id = ?',
    [inboundTaskId],
  )
  const received = items.reduce((sum, row) => sum + Number(row.received_qty || 0), 0)
  log.assert('receive 回滚后不落收货数量', received === 0, `received=${received}`)
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

    await scenarioInboundReceiveIdempotent(log, ctx, adminToken)
    await scenarioInboundReceiveRollback(log, ctx, adminToken)
    await scenarioSplitConcurrent(log, ctx)
    await scenarioSplitRollback(log, ctx)
    await scenarioWarehouseCancel(log, ctx, adminToken)
  } finally {
    const summary = log.summary()
    await ctx.close()
    if (summary.failed > 0) process.exitCode = 1
  }
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error?.message || String(error)}\n`)
  process.exit(1)
})
