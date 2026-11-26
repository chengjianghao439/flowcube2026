'use strict'
const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { prepareSmokeContext, dbQuery } = require('./helpers/smokeTestKit')
const { issueFixtureAccessToken, cleanupFixtureSessionFamilies } = require('./helpers/fixtureAuthSession')
const { createContainer, syncStockFromContainers, SOURCE_TYPE, CONTAINER_STATUS } = require('../backend/src/engine/containerEngine')

let ctx, token, product, customer, primaryWarehouse, otherWarehouse
async function post(path, json = {}, requestKey = randomUUID()) {
  return ctx.http.post('/api/sale' + path, { token, json, headers: { 'X-Request-Key': requestKey } })
}
function ok(response) {
  assert.ok(response.ok, JSON.stringify(response.data))
  return response.data.data
}
before(async () => {
  ctx = await prepareSmokeContext({ requestTimeoutMs: 15000 })
  const [user] = await dbQuery(ctx.pool, "SELECT id FROM sys_users WHERE username='smoke_admin'")
  token = await issueFixtureAccessToken(ctx.pool, user.id)
  const code = 'W0-' + randomUUID().slice(0, 8)
  const [p] = await ctx.pool.query("INSERT INTO product_items (code,name,unit,sale_price_a) VALUES (?,?,'个',5)", [code, code])
  product = { productId: p.insertId, productCode: code, productName: code, unit: '个', quantity: 10, unitPrice: 5 }
  const [customerRow] = await ctx.pool.query('INSERT INTO sale_customers (code,name) VALUES (?,?)', [code, code])
  customer = { id: customerRow.insertId, name: code }
  const warehouses = []
  for (const name of [code + '-A', code + '-B']) {
    const [row] = await ctx.pool.query('INSERT INTO inventory_warehouses (code,name) VALUES (?,?)', [name, name])
    warehouses.push({ id: row.insertId, name })
  }
  primaryWarehouse = warehouses[0]
  otherWarehouse = warehouses[1]
  const conn = await ctx.pool.getConnection()
  try {
    await conn.beginTransaction()
    for (const warehouse of [primaryWarehouse, otherWarehouse]) {
      await createContainer(conn, { productId: p.insertId, warehouseId: warehouse.id, initialQty: 100,
        unit: '个', sourceType: SOURCE_TYPE.TRANSFER, sourceRefId: p.insertId,
        sourceRefType: 'test_seed', sourceRefNo: code, containerStatus: CONTAINER_STATUS.ACTIVE })
      await syncStockFromContainers(conn, p.insertId, warehouse.id)
    }
    await conn.commit()
  } catch (error) { await conn.rollback(); throw error } finally { conn.release() }
})
after(async () => {
  try { if (ctx) await cleanupFixtureSessionFamilies(ctx.pool) }
  finally { if (ctx) await ctx.close(); await require('../backend/src/config/db').pool.end() }
})
async function order(warehouses = [primaryWarehouse]) {
  const { id } = ok(await post('', { customerId: customer.id, customerName: customer.name,
    warehouseId: primaryWarehouse.id, warehouseName: primaryWarehouse.name,
    items: warehouses.map(w => ({ ...product, warehouseId: w.id, warehouseName: w.name })) }))
  const lines = await dbQuery(ctx.pool, 'SELECT id FROM sale_order_items WHERE order_id=? ORDER BY id', [id])
  return { id, lines }
}
async function snapshot(id) {
  const lines = await dbQuery(ctx.pool, 'SELECT warehouse_id,reserved_qty,dispatched_qty FROM sale_order_items WHERE order_id=? ORDER BY id', [id])
  const tasks = await dbQuery(ctx.pool, 'SELECT id FROM warehouse_tasks WHERE sale_order_id=? ORDER BY id', [id])
  const events = await dbQuery(ctx.pool, 'SELECT id FROM sale_order_events WHERE sale_order_id=? ORDER BY id', [id])
  return { lines, tasks, events }
}
test('占库拒绝重复明细，即使分配仓库不同或总量未超限', async () => {
  const { id, lines: [line] } = await order()
  const before = await snapshot(id)
  for (const warehouse of [primaryWarehouse, otherWarehouse]) {
    const response = await post('/' + id + '/reserve', { items: [
      { id: line.id, qty: 1, warehouseId: primaryWarehouse.id, warehouseName: primaryWarehouse.name },
      { id: line.id, qty: 1, warehouseId: warehouse.id, warehouseName: warehouse.name },
    ] })
    assert.equal(response.status, 400)
    assert.match(response.data.message, /重复/)
    assert.deepEqual(await snapshot(id), before)
  }
})
test('换仓占库覆盖未选行和单头回退仓，同时保留合法分仓', async () => {
  const { id, lines } = await order([primaryWarehouse, otherWarehouse])
  await ctx.pool.query('UPDATE sale_order_items SET warehouse_id=NULL WHERE id=?', [lines[0].id])
  const before = await snapshot(id)
  const response = await post('/' + id + '/reserve', { items: [{ id: lines[1].id, qty: 1, warehouseId: primaryWarehouse.id, warehouseName: primaryWarehouse.name }] })
  assert.equal(response.status, 400)
  assert.match(response.data.message, /重复明细/)
  assert.deepEqual(await snapshot(id), before)
  const items = [primaryWarehouse, otherWarehouse].map((warehouse, i) => ({
    id: lines[i].id, qty: 1, warehouseId: warehouse.id, warehouseName: warehouse.name,
  }))
  ok(await post('/' + id + '/reserve', { items }))
})
for (const flag of ['adjustment_requested_at', 'cancel_requested_at']) {
  test('挂起任务拒绝新的出库并保留原键回执 ' + flag, async () => {
    const { id, lines: [line] } = await order()
    ok(await post('/' + id + '/reserve'))
    const payload = { items: [{ id: line.id, qty: 1 }] }
    const key = randomUUID()
    ok(await post('/' + id + '/ship', payload, key))
    // 原任务挂起时，最近任务可能指向同单另一个批次。
    const first = (await snapshot(id)).tasks[0]
    ok(await post('/' + id + '/ship', payload))
    await ctx.pool.query('UPDATE warehouse_tasks SET ' + flag + '=NOW() WHERE id=?', [first.id])
    const before = await snapshot(id)
    ok(await post('/' + id + '/ship', payload, key))
    const response = await post('/' + id + '/ship', payload)
    assert.equal(response.status, 409)
    assert.match(response.data.message, /取消|改单/)
    assert.deepEqual(await snapshot(id), before)
  })
}
test('减量后的显式、整单派发均受当前订单量约束', async () => {
  const { id, lines: [line] } = await order()
  ok(await post('/' + id + '/reserve'))
  ok(await post('/' + id + '/ship', { items: [{ id: line.id, qty: 2 }] }))
  await ctx.pool.query('UPDATE sale_order_items SET quantity=3 WHERE id=?', [line.id])
  const before = await snapshot(id)
  const response = await post('/' + id + '/ship', { items: [{ id: line.id, qty: 2 }] })
  assert.equal(response.status, 400)
  assert.deepEqual(await snapshot(id), before)
  ok(await post('/' + id + '/ship'))
  const after = await snapshot(id)
  assert.equal(Number(after.lines[0].dispatched_qty), 3)
  assert.equal(after.tasks.length, 2)
  assert.equal((await post('/' + id + '/ship')).status, 400)
  assert.deepEqual(await snapshot(id), after)
})

test('部分释占、原键重放和原释放批次续占共用真实明细', async () => {
  const { id, lines: [line] } = await order()
  ok(await post('/' + id + '/reserve'))
  const before = await snapshot(id)
  const item = { id: line.id, qty: 3 }
  const repeated = await post('/' + id + '/release', { items: [item, item] })
  assert.equal(repeated.status, 400)
  assert.match(repeated.data.message, /重复/)
  assert.deepEqual(await snapshot(id), before)

  const releaseKey = randomUUID()
  ok(await post('/' + id + '/release', { items: [item] }, releaseKey))
  const released = await snapshot(id)
  assert.equal(Number(released.lines[0].reserved_qty), 7)
  ok(await post('/' + id + '/release', { items: [item] }, releaseKey))
  assert.deepEqual(await snapshot(id), released)
  const detail = async () => ok(await ctx.http.get('/api/sale/' + id, { token }))
  const [batch] = (await detail()).releaseBatches
  assert.ok(batch)
  assert.deepEqual(batch.lines, [{ itemId: line.id, warehouseId: primaryWarehouse.id, unit: '个', qty: 3, remaining: 3 }])
  const preview = ok(await ctx.http.get('/api/sale/' + id + '/reserve-preview', { token }))
  ok(await post('/' + id + '/reserve', {
    releaseEventId: batch.id, releaseProofVersion: batch.proofVersion,
    expectedReserveFingerprint: preview.reserveFingerprint, expectedReservationEventId: preview.reservationEventId,
    items: [{ ...item, warehouseId: primaryWarehouse.id, warehouseName: primaryWarehouse.name }],
  }))
  assert.equal(Number((await snapshot(id)).lines[0].reserved_qty), 10)
  assert.equal((await detail()).releaseBatches[0].lines[0].remaining, 0)
})
