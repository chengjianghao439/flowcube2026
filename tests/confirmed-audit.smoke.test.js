'use strict'
const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
require('./helpers/testEnvironment').validateTestEnvironment()
process.env.DISABLE_PRINT_JOB_SWEEPER = '1'
const { prepareSmokeContext, login } = require('./helpers/smokeTestKit')
const { pool } = require('../backend/src/config/db')
const sale = require('../backend/src/modules/sale/sale.service')
const stock = require('../backend/src/modules/inventory/inventory.service')
const checks = require('../backend/src/modules/stockcheck/stockcheck.service')
const engine = require('../backend/src/engine/containerEngine')
let ctx, operator, token, limited, productId, wh2, containers, taskId
const saleIds = []
const prefix = 'CONF' + crypto.randomBytes(5).toString('hex')
const q = (sql, params) => pool.query(sql, params)
before(async () => {
  ctx = await prepareSmokeContext()
  const admin = await login(ctx.http, 'smoke_admin', 'SmokeAdmin123!')
  token = admin.token; operator = { userId: Number(admin.user.id), realName: '测试' }
  assert.ok(Number.isSafeInteger(operator.userId) && operator.userId > 0)
  limited = await login(ctx.http, 'smoke_limited', 'SmokeLimited123!')
  const [p] = await q('INSERT INTO product_items(code,name,unit,allow_decimal_qty) VALUES(?,?,?,1)', [prefix, '审计回归商品', '件'])
  productId = p.insertId
  const [w] = await q('INSERT INTO inventory_warehouses(code,name) VALUES(?,?)', [prefix, '审计回归仓库'])
  wh2 = w.insertId; containers = []
  const c = await pool.getConnection()
  try {
    await c.beginTransaction()
    for (const warehouseId of [ctx.warehouse.id, wh2]) {
      await engine.lockStockDimension(c, productId, warehouseId)
      containers.push(await engine.createContainer(c, { productId, warehouseId, initialQty: 10, unit: '件', sourceType: engine.SOURCE_TYPE.MANUAL, sourceRefId: operator.userId, containerStatus: engine.CONTAINER_STATUS.PENDING_PUTAWAY }))
      await engine.promotePendingContainerToActive(c, containers.at(-1).containerId, productId, warehouseId)
      await engine.syncStockFromContainers(c, productId, warehouseId)
    }
    await c.commit()
  } catch (e) { await c.rollback(); throw e } finally { c.release() }
})
after(async () => {
  // 部分发货金额夹具只模拟本用例所需状态，不进入其他会计套件的全库来源审计。
  if (saleIds.length) {
    await q('UPDATE inventory_containers SET locked_by_task_id=NULL WHERE locked_by_task_id IN (SELECT id FROM warehouse_tasks WHERE sale_order_id IN (?))', [saleIds])
    await q('UPDATE sale_order_items SET shipped_qty=0,dispatched_qty=0 WHERE order_id IN (?)', [saleIds])
    await q('UPDATE warehouse_tasks SET deleted_at=NOW() WHERE sale_order_id IN (?)', [saleIds])
    await q('UPDATE sale_orders SET deleted_at=NOW() WHERE id IN (?)', [saleIds])
  }
  if (ctx) await ctx.close()
  await pool.end()
})
const payload = () => ({ customerId: ctx.customer.id, warehouseId: ctx.warehouse.id, items: [{ productId, quantity: 2, unitPrice: 1.2345 }], operator })
test('sale draft identical update replays without replacing line IDs or adding events', async () => {
  const order = await sale.create({ ...payload(), requestKey: prefix + 'create' }); saleIds.push(order.id)
  const input = { ...payload(), remark: 'edit', requestKey: prefix + 'edit' }
  await sale.update(order.id, input)
  const [before] = await q('SELECT id FROM sale_order_items WHERE order_id=?', [order.id])
  await sale.update(order.id, input)
  const [after] = await q('SELECT id FROM sale_order_items WHERE order_id=?', [order.id])
  assert.deepEqual(after, before)
  const [[events]] = await q("SELECT COUNT(*) n FROM sale_order_events WHERE sale_order_id=? AND event_type='updated'", [order.id])
  assert.equal(events.n, 1)
})
test('partially shipped close uses the same rounded line amount as a one-unit sale', async () => {
  const order = await sale.create({ ...payload(), requestKey: prefix + 'partial' }); saleIds.push(order.id)
  await q('UPDATE sale_order_items SET shipped_qty=1,dispatched_qty=1 WHERE order_id=?', [order.id])
  await q('UPDATE sale_orders SET status=3 WHERE id=?', [order.id])
  const [task] = await q("INSERT INTO warehouse_tasks(task_no,task_type,sale_order_id,warehouse_id,warehouse_name,status,sale_order_no,customer_id,customer_name) VALUES(?,'sale_out',?,?,?,7,?,?,?)", [prefix, order.id, ctx.warehouse.id, ctx.warehouse.name, order.orderNo, ctx.customer.id, ctx.customer.name])
  taskId = task.insertId
  await sale.cancel(order.id, operator, null, prefix + 'close')
  const [[row]] = await q('SELECT amount FROM sale_order_items WHERE order_id=?', [order.id])
  assert.equal(row.amount, '1.2300')
})
test('PDA ticket rejects other JWT for work and renewal while owner works', async () => {
  const headers = ctx.pdaHeaders()
  assert.equal((await ctx.http.get('/api/pda/todo-counts', { token, headers })).status, 200)
  assert.equal((await ctx.http.get('/api/pda/todo-counts', { token: limited.token, headers })).status, 403)
  assert.equal((await ctx.http.post('/api/pda/sessions/renew', { token: limited.token, headers, json: {} })).status, 403)
})
test('outbound retries once, same key on another warehouse performs its own deduction', async () => {
  const input = { type: 2, productId, warehouseId: ctx.warehouse.id, quantity: 1, operator, requestKey: prefix + 'out' }
  await stock.changeStock(input); await stock.changeStock(input)
  await stock.changeStock({ ...input, warehouseId: wh2 })
  const [rows] = await q('SELECT quantity FROM inventory_stock WHERE product_id=? ORDER BY warehouse_id', [productId])
  assert.deepEqual(rows.map(r => Number(r.quantity)), [9, 9])
  await assert.rejects(stock.getContainerByBarcode(containers[1].barcode, [ctx.warehouse.id]), e => e.statusCode === 403)
})
test('stockcheck rejects standard and scanned loss without changing counts or reservations', async () => {
  await q('UPDATE inventory_stock SET reserved=8 WHERE product_id=? AND warehouse_id=?', [productId, ctx.warehouse.id])
  for (const scanned of [false, true]) {
    const check = await checks.create({ warehouseId: ctx.warehouse.id, warehouseName: ctx.warehouse.name, checkType: 2, productIds: [productId], operator })
    const [[item]] = await q('SELECT id FROM inventory_check_items WHERE check_id=? AND product_id=?', [check.id, productId])
    await q('UPDATE inventory_check_items SET actual_qty=5,diff_qty=-4 WHERE id=?', [item.id])
    if (scanned) await q('INSERT INTO inventory_check_item_containers(check_item_id,container_id,barcode,counted_qty) VALUES(?,?,?,5)', [item.id, containers[0].containerId, containers[0].barcode])
    await assert.rejects(checks.submit(check.id, operator, null, prefix + 'check' + scanned), e => e.code === 'STOCKCHECK_RESERVED_SHORTAGE')
    const [[row]] = await q('SELECT quantity,reserved FROM inventory_stock WHERE product_id=? AND warehouse_id=?', [productId, ctx.warehouse.id])
    assert.equal(Number(row.quantity), 9); assert.equal(Number(row.reserved), 8)
    const [[saved]] = await q('SELECT actual_qty FROM inventory_check_items WHERE id=?', [item.id])
    assert.equal(Number(saved.actual_qty), 5)
  }
})

test('unsupported import file returns a business 400 rather than a server error', async () => {
  const form = new FormData()
  form.append('file', new Blob(['fixture'], { type: 'application/octet-stream' }), 'fixture.bin')
  const result = await ctx.http.post('/api/import/products', { token, formData: form })
  assert.equal(result.status, 400)
  assert.equal(result.data.code, 'IMPORT_FILE_TYPE_INVALID')
})

test('scanned stockcheck keeps picked containers and checks actual shelf loss only', async () => {
  const c = await pool.getConnection()
  let picked
  try {
    await c.beginTransaction()
    await engine.lockStockDimension(c, productId, ctx.warehouse.id)
    picked = await engine.createContainer(c, { productId, warehouseId: ctx.warehouse.id, initialQty: 6, unit: '件', sourceType: engine.SOURCE_TYPE.MANUAL, sourceRefId: operator.userId, containerStatus: engine.CONTAINER_STATUS.PENDING_PUTAWAY })
    await engine.promotePendingContainerToActive(c, picked.containerId, productId, ctx.warehouse.id)
    await c.query('UPDATE inventory_containers SET locked_by_task_id=? WHERE id=?', [taskId, picked.containerId])
    await engine.syncStockFromContainers(c, productId, ctx.warehouse.id)
    await c.query('UPDATE inventory_stock SET reserved=6 WHERE product_id=? AND warehouse_id=?', [productId, ctx.warehouse.id])
    await c.commit()
  } catch (e) { await c.rollback(); throw e } finally { c.release() }
  const check = await checks.create({ warehouseId: ctx.warehouse.id, warehouseName: ctx.warehouse.name, checkType: 2, productIds: [productId], operator })
  const [[item]] = await q('SELECT id FROM inventory_check_items WHERE check_id=?', [check.id])
  await q('UPDATE inventory_check_items SET actual_qty=9,diff_qty=-6 WHERE id=?', [item.id])
  await q('INSERT INTO inventory_check_item_containers(check_item_id,container_id,barcode,counted_qty) VALUES(?,?,?,9)', [item.id, containers[0].containerId, containers[0].barcode])
  await checks.submit(check.id, operator, null, prefix + 'picked')
  const [[row]] = await q('SELECT quantity,reserved FROM inventory_stock WHERE product_id=? AND warehouse_id=?', [productId, ctx.warehouse.id])
  assert.equal(Number(row.quantity), 15); assert.equal(Number(row.reserved), 6)
  const [[saved]] = await q('SELECT remaining_qty,locked_by_task_id FROM inventory_containers WHERE id=?', [picked.containerId])
  assert.equal(Number(saved.remaining_qty), 6); assert.equal(Number(saved.locked_by_task_id), taskId)
})

test('a later stockcheck shortage is rejected before the first container write', async () => {
  const [p] = await q('INSERT INTO product_items(code,name,unit) VALUES(?,?,?)', [prefix + 'B', '第二行测试商品', '件'])
  const secondId = p.insertId, c = await pool.getConnection()
  try {
    await c.beginTransaction()
    await engine.lockStockDimension(c, secondId, ctx.warehouse.id)
    const item = await engine.createContainer(c, { productId: secondId, warehouseId: ctx.warehouse.id, initialQty: 5, unit: '件', sourceType: engine.SOURCE_TYPE.MANUAL, sourceRefId: operator.userId, containerStatus: engine.CONTAINER_STATUS.PENDING_PUTAWAY })
    await engine.promotePendingContainerToActive(c, item.containerId, secondId, ctx.warehouse.id)
    await engine.syncStockFromContainers(c, secondId, ctx.warehouse.id)
    await c.commit()
  } catch (e) { await c.rollback(); throw e } finally { c.release() }
  const check = await checks.create({ warehouseId: ctx.warehouse.id, warehouseName: ctx.warehouse.name, checkType: 2, productIds: [productId, secondId], operator })
  const [items] = await q('SELECT id,product_id,book_qty FROM inventory_check_items WHERE check_id=? ORDER BY id', [check.id])
  assert.equal(items.length, 2)
  for (const [index, item] of items.entries()) {
    await q('UPDATE inventory_check_items SET actual_qty=book_qty-1,diff_qty=-1 WHERE id=?', [item.id])
    await q('UPDATE inventory_stock SET reserved=? WHERE product_id=? AND warehouse_id=?', [index === 1 ? item.book_qty : 0, item.product_id, ctx.warehouse.id])
  }
  const originalGet = pool.getConnection.bind(pool)
  let writes = 0
  pool.getConnection = async () => {
    const conn = await originalGet()
    return new Proxy(conn, { get(target, key) {
      if (key === 'query') return (sql, values) => { if (/UPDATE inventory_containers/.test(sql)) writes++; return target.query(sql, values) }
      return typeof target[key] === 'function' ? target[key].bind(target) : target[key]
    } })
  }
  try { await assert.rejects(checks.submit(check.id, operator, null, prefix + 'all-lines'), e => e.code === 'STOCKCHECK_RESERVED_SHORTAGE') }
  finally { pool.getConnection = originalGet }
  assert.equal(writes, 0)
})
