'use strict'

// 真实隔离库 + 独立 HTTP 服务；每轮专属商品/仓库，不借既有库存掩盖提前可拣资格。
const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { validateTestEnvironment } = require('./helpers/testEnvironment')
validateTestEnvironment()
const { pool } = require('../backend/src/config/db')
const inbound = require('../backend/src/modules/inbound-tasks/inbound-tasks.service')
const { getExpectedForPair } = require('../backend/src/utils/expectedStock')
const ref = `C4-${randomUUID().slice(0, 8)}`
let server, http, token, headers, warehouse, location, supplier, customer, operator, deviceId
let dropCloseKey = null
const taskIds = [], poIds = [], productIds = [], saleIds = []
const fixturePath = `/tmp/flowcube-c4-smoke-${ref}.json`
async function rows(sql, args = []) { return (await pool.query(sql, args))[0] }
async function one(sql, args) { return (await rows(sql, args))[0] }
async function insert(sql, args) { return Number((await pool.query(sql, args))[0].insertId) }
async function post(path, json, extra = {}) { return http.post(`/api${path}`, { token, json, ...extra }) }
function ok(r) { assert.ok(r.status >= 200 && r.status < 300, JSON.stringify(r.data)); return r.data.data }
before(async () => {
  const user = await one('SELECT id, username, token_version FROM sys_users WHERE role_id=1 AND is_active=1 AND deleted_at IS NULL LIMIT 1')
  assert.ok(user, '隔离库必须已有管理员')
  operator = { userId: user.id, realName: ref }
  token = require('../backend/node_modules/jsonwebtoken').sign({ userId: user.id, tokenVersion: Number(user.token_version || 0) }, require('../backend/src/config/env').env.JWT_SECRET, { expiresIn: '1h' })
  warehouse = { id: await insert('INSERT INTO inventory_warehouses (code,name) VALUES (?,?)', [ref, ref]), name: ref }
  location = { id: await insert('INSERT INTO warehouse_locations (warehouse_id,code,name) VALUES (?,?,?)', [warehouse.id, ref, ref]) }
  supplier = { id: await insert('INSERT INTO supply_suppliers (code,name,settlement_type,payment_terms_days) VALUES (?,?,2,30)', [ref, ref]), name: ref }
  customer = { id: await insert('INSERT INTO sale_customers (code,name,credit_limit) VALUES (?,?,NULL)', [ref, ref]), name: ref }
  const secret = randomUUID()
  deviceId = await insert("INSERT INTO pda_devices (device_code,device_name,warehouse_id,status,secret_hash) VALUES (?,?,?,'active',?)", [ref, ref, warehouse.id, require('../backend/node_modules/bcryptjs').hashSync(secret, 4)])
  const s = await require('../backend/src/modules/pda/pda.sessions.service').createSession({ deviceCode: ref, deviceSecret: secret, userId: user.id })
  headers = { 'X-Client': 'pda', 'X-PDA-Session': s.sessionToken }
  server = await new Promise((resolve, reject) => { const s = require('../backend/src/app').listen(0, '127.0.0.1', () => resolve(s)); s.once('error', reject) })
  // 仅本轮关闭原键：业务已200提交后真正丢弃HTTP响应，验证网络未知下原回执。
  server.prependListener('request', (req, res) => {
    if (!dropCloseKey || req.headers['x-request-key'] !== dropCloseKey || !req.url.endsWith('/close-receiving')) return
    const originalEnd = res.end
    res.end = function (...args) {
      if (this.statusCode === 200) { dropCloseKey = null; this.destroy(); return this }
      return originalEnd.apply(this, args)
    }
  })
  const request = async (method, path, opts = {}) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { method, headers: { ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}), 'Content-Type': 'application/json', ...opts.headers }, body: opts.json === undefined ? undefined : JSON.stringify(opts.json), signal: AbortSignal.timeout(20000) })
    return { status: response.status, data: await response.json() }
  }
  http = { get: (p, o) => request('GET', p, o), post: (p, o) => request('POST', p, o), put: (p, o) => request('PUT', p, o) }
})
// 清理只按本轮捕获的 ID；业务事实保留供失败诊断，不做全表/前缀清理。
after(async () => {
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
  require('node:fs').writeFileSync(fixturePath, JSON.stringify({ ref, warehouse, location, supplier, customer, taskIds, poIds, productIds, saleIds }, null, 2), { mode: 0o600 })
  console.log(`[fixtures] ${fixturePath}`)
  try { if (deviceId) {
    await pool.query('DELETE FROM pda_device_sessions WHERE device_id=?', [deviceId])
    await pool.query('DELETE FROM pda_devices WHERE id=?', [deviceId])
  }
  } finally { await pool.end() }
})
async function fixture(qty = 100, { product, price = 10, taskQty, skipTask = false } = {}) {
  if (!product) {
    const code = `${ref}-${productIds.length}`
    product = { id: await insert("INSERT INTO product_items (code,name,unit,sale_price_a,cost_price,allow_decimal_qty) VALUES (?,?,'个',20,10,0)", [code, code]), code, name: code, unit: '个' }
    productIds.push(product.id)
  }
  const po = ok(await post('/purchase', { supplierId: supplier.id, supplierName: supplier.name, warehouseId: warehouse.id, warehouseName: warehouse.name, expectedDate: '2026-12-01', items: [{ productId: product.id, productCode: product.code, productName: product.name, unit: '个', quantity: qty, unitPrice: price }] }))
  poIds.push(po.id)
  ok(await post(`/purchase/${po.id}/confirm`))
  const pi = await one('SELECT id FROM purchase_order_items WHERE order_id=?', [po.id])
  if (skipTask) return { poId: po.id, purchaseItemId: pi.id, product }
  const task = taskQty ? ok(await post('/inbound-tasks', { supplierId: supplier.id, supplierName: supplier.name, items: [{ purchaseItemId: pi.id, qty: taskQty }] })) : ok(await post('/inbound-tasks', { poId: po.id }))
  taskIds.push(task.taskId)
  ok(await post(`/inbound-tasks/${task.taskId}/submit`))
  return { taskId: task.taskId, poId: po.id, purchaseItemId: pi.id, product }
}
async function receive(f, qty, key = randomUUID(), options = {}) {
  return ok(await post(`/inbound-tasks/${f.taskId}/receive`, { productId: f.product.id, packages: [{ qty }], ...options }, { headers: { ...headers, 'X-Request-Key': key } }))
}
async function put(f, c, key = randomUUID()) { return ok(await post(`/inbound-tasks/${f.taskId}/putaway`, { containerId: c.containerId, locationId: location.id }, { headers: { ...headers, 'X-Request-Key': key } })) }
async function task(f) { return one('SELECT status,audit_status,closed_reason FROM inbound_tasks WHERE id=?', [f.taskId]) }
async function ap(f) { return one('SELECT * FROM payment_records WHERE type=1 AND order_id=?', [f.poId]) }
async function snapshot(f) { return one(`SELECT (SELECT COUNT(*) FROM inbound_task_events WHERE task_id=?) AS events, (SELECT COUNT(*) FROM inventory_logs WHERE ref_type='inbound_task' AND ref_id=?) AS logs, (SELECT COUNT(*) FROM payment_records WHERE type=1 AND order_id=?) AS aps`, [f.taskId, f.taskId, f.poId]) }
test('100→20提前上架供真实销售占库派发拣货；继续30/50后仅末箱统一结算', async () => {
  const f = await fixture()
  const r20 = await receive(f, 20)
  await put(f, r20.containers[0])
  assert.deepEqual(await task(f), { status: 2, audit_status: 0, closed_reason: null })
  assert.equal(await ap(f), undefined)
  assert.equal(Number((await one('SELECT quantity FROM inventory_stock WHERE product_id=? AND warehouse_id=?', [f.product.id, warehouse.id])).quantity), 20)
  assert.equal(await getExpectedForPair(pool, f.product.id, warehouse.id), 80)
  const sale = ok(await post('/sale', { customerId: customer.id, customerName: customer.name, warehouseId: warehouse.id, warehouseName: warehouse.name, items: [{ productId: f.product.id, productCode: f.product.code, productName: f.product.name, unit: '个', quantity: 5, unitPrice: 20 }] }))
  saleIds.push(sale.id)
  const si = await one('SELECT id FROM sale_order_items WHERE order_id=?', [sale.id])
  ok(await post(`/sale/${sale.id}/reserve`, { items: [{ id: si.id, warehouseId: warehouse.id, warehouseName: warehouse.name, qty: 5 }] }))
  ok(await post(`/sale/${sale.id}/ship`))
  const wt = await one('SELECT id FROM warehouse_tasks WHERE sale_order_id=?', [sale.id])
  ok(await http.put(`/api/warehouse-tasks/${wt.id}/start-picking`, { token, json: {}, headers }))
  const wi = await one('SELECT id FROM warehouse_task_items WHERE task_id=?', [wt.id])
  const pick = await post('/scan-logs', { taskId: wt.id, itemId: wi.id, containerId: r20.containers[0].containerId, productId: f.product.id, barcode: r20.containers[0].containerCode, qty: 5, scanMode: '散件' }, { headers })
  ok(pick)
  assert.equal(Number((await one('SELECT picked_qty FROM warehouse_task_items WHERE task_id=?', [wt.id])).picked_qty), 5)
  await assert.rejects(inbound.voidReceipt(f.taskId, operator), /使用|拣货|锁定|改动|占用/)
  const r30 = await receive(f, 30)
  await put(f, r30.containers[0])
  assert.equal((await task(f)).status, 2); assert.equal(await ap(f), undefined)
  const r50 = await receive(f, 50)
  assert.equal((await task(f)).status, 3); assert.equal(await ap(f), undefined)
  await put(f, r50.containers[0])
  assert.equal((await task(f)).status, 4); assert.equal((await task(f)).audit_status, 1)
  assert.equal(Number((await ap(f)).total_amount), 1000)
  assert.equal(await getExpectedForPair(pool, f.product.id, warehouse.id), 0)
})
test('已收全部提前上架→短装结案即完成；丢响应同键重放原阶段无副作用，scope重放也校验', async () => {
  const f = await fixture()
  const r = await receive(f, 20); await put(f, r.containers[0])
  const buildSpecs = () => require('../backend/src/modules/accounting/voucher-engine').buildPurchaseSettle(pool, new Map())
  assert.equal((await buildSpecs()).find(spec => Number(spec.sourceId) === f.poId), undefined, '开放收货没有本次采购结算凭证规格')
  const key = randomUUID()
  dropCloseKey = key
  await assert.rejects(post(`/inbound-tasks/${f.taskId}/close-receiving`, {}, { headers: { 'X-Request-Key': key } }), /fetch failed/)
  const first = { taskId: f.taskId, status: 4 }
  assert.equal((await task(f)).status, 4)
  const before = await snapshot(f)
  const replay = ok(await post(`/inbound-tasks/${f.taskId}/close-receiving`, {}, { headers: { 'X-Request-Key': key } }))
  assert.deepEqual(replay, first); assert.deepEqual(await snapshot(f), before)
  const payable = await ap(f)
  assert.equal(Number(payable.total_amount), 200)
  const spec = (await buildSpecs()).find(spec => Number(spec.sourceId) === f.poId)
  assert.ok(spec); assert.equal(spec.legs.find(leg => leg.code === '2202').amount, 200)
  assert.equal(new Date(spec.voucherDate).getTime(), new Date(payable.created_at).getTime(), '凭证日期仍为首次应付时刻')
  await assert.rejects(inbound.closeReceiving(f.taskId, operator, [], { requestKey: key }), { statusCode: 403 })
  // 通用回执查询通过 action 参数精确定位。
  const scoped = await http.get(`/api/system/request-status/${key}?action=inbound.closeReceiving.${f.taskId}`, { token })
  assert.equal(scoped.data.data.status, 'success'); assert.deepEqual(scoped.data.data.data, first)
})
test('短装尚有待上架保持3→末箱4；零实收拒绝；普通收满上架保持兼容', async () => {
  const f = await fixture(10)
  const r = await receive(f, 8)
  const close = ok(await post(`/inbound-tasks/${f.taskId}/close-receiving`, {}, { headers: { 'X-Request-Key': randomUUID() } }))
  assert.equal(close.status, 3); assert.equal(await ap(f), undefined)
  await put(f, r.containers[0]); assert.equal((await task(f)).status, 4); assert.equal(Number((await ap(f)).total_amount), 80)
  const zero = await fixture(10)
  assert.equal((await post(`/inbound-tasks/${zero.taskId}/close-receiving`)).status, 409)
  const normal = await fixture(10); const receiveKey = randomUUID(), putawayKey = randomUUID()
  const nr = await receive(normal, 10, receiveKey); await put(normal, nr.containers[0], putawayKey); assert.equal(Number((await ap(normal)).total_amount), 100)
  const completed = await snapshot(normal)
  await put(normal, nr.containers[0], putawayKey)
  assert.deepEqual(await receive(normal, 10, receiveKey), nr)
  assert.deepEqual(await snapshot(normal), completed, '已完成任务原键回放不重结算/打印/库存流水')
})

test('提前上架兑现销售预计绑定；库存20+预计80守恒，兑现后可真实派发', async () => {
  const f = await fixture()
  const sale = ok(await post('/sale', { customerId: customer.id, customerName: customer.name, warehouseId: warehouse.id, warehouseName: warehouse.name, items: [{ productId: f.product.id, productCode: f.product.code, productName: f.product.name, unit: '个', quantity: 20, unitPrice: 20 }] }))
  saleIds.push(sale.id)
  const si = await one('SELECT id FROM sale_order_items WHERE order_id=?', [sale.id])
  ok(await post(`/sale/${sale.id}/reserve`, { items: [{ id: si.id, warehouseId: warehouse.id, warehouseName: warehouse.name, qty: 20 }] }))
  assert.equal(Number((await one('SELECT SUM(qty) AS qty FROM sale_order_expected_bindings WHERE purchase_order_id=? AND released_at IS NULL', [f.poId])).qty), 20)
  const r = await receive(f, 20); await put(f, r.containers[0])
  assert.equal(await getExpectedForPair(pool, f.product.id, warehouse.id), 80)
  assert.equal(Number((await one('SELECT SUM(qty) AS qty FROM sale_order_expected_bindings WHERE purchase_order_id=? AND released_at IS NULL', [f.poId])).qty), 0)
  ok(await post(`/sale/${sale.id}/ship`))
  assert.equal((await task(f)).status, 2); assert.equal(await ap(f), undefined)
})
test('混合来源不同采购价仍按容器归属上架结算，重复确认沿旧闸门', async () => {
  const a = await fixture(10, { price: 10, skipTask: true })
  const b = await fixture(10, { product: a.product, price: 30, skipTask: true })
  const made = ok(await post('/inbound-tasks', { supplierId: supplier.id, supplierName: supplier.name, items: [{ purchaseItemId: a.purchaseItemId, qty: 10 }, { purchaseItemId: b.purchaseItemId, qty: 10 }] }))
  taskIds.push(made.taskId); a.taskId = b.taskId = made.taskId
  ok(await post(`/inbound-tasks/${a.taskId}/submit`))
  const first = await receive(a, 10); await put(a, first.containers[0])
  assert.equal((await task(a)).status, 2); assert.equal(await ap(a), undefined); assert.equal(await ap(b), undefined)
  const duplicate = await post(`/inbound-tasks/${a.taskId}/receive`, { productId: a.product.id, packages: [{ qty: 10 }] }, { headers })
  assert.equal(duplicate.status, 409); assert.equal(duplicate.data.code, 'DUPLICATE_SCAN_CONFIRM_REQUIRED')
  const second = await receive(a, 10, randomUUID(), { confirmDuplicate: true }); await put(a, second.containers[0])
  assert.equal(Number((await ap(a)).total_amount), 100); assert.equal(Number((await ap(b)).total_amount), 300)
  const costs = await rows("SELECT unit_price FROM inventory_logs WHERE ref_type='inbound_task' AND ref_id=? ORDER BY id", [a.taskId])
  assert.deepEqual(costs.map(r => Number(r.unit_price)), [10, 30])
})
test('同采购跨批结算保留已付与首次账期，并扣已执行退货来源金额', async () => {
  const f = await fixture(100, { taskQty: 40 })
  const first = await receive(f, 40); await put(f, first.containers[0])
  const paid = await ap(f)
  // 已付/已执行退货作为既有账款夹具；这里只验证新批结算不抹掉原事实，不声称出款/退货实操。
  await pool.query('UPDATE payment_records SET paid_amount=50, balance=350, status=2 WHERE id=?', [paid.id])
  await pool.query('UPDATE supply_suppliers SET settlement_type=1,payment_terms_days=5 WHERE id=?', [supplier.id])
  const returnId = await insert("INSERT INTO purchase_returns (return_no,purchase_order_id,purchase_order_no,supplier_id,supplier_name,warehouse_id,warehouse_name,total_amount,status,operator_id,operator_name) VALUES (?,?,?,?,?,?,?,?,3,?,?)", [randomUUID().slice(0, 20), f.poId, paid.order_no, supplier.id, supplier.name, warehouse.id, warehouse.name, 20, operator.userId, ref])
  const secondTask = ok(await post('/inbound-tasks', { supplierId: supplier.id, supplierName: supplier.name, items: [{ purchaseItemId: f.purchaseItemId, qty: 60 }] }))
  taskIds.push(secondTask.taskId); const second = { ...f, taskId: secondTask.taskId }
  ok(await post(`/inbound-tasks/${second.taskId}/submit`))
  const r = await receive(second, 20); await put(second, r.containers[0]); assert.equal(Number((await ap(f)).total_amount), 400)
  const close = ok(await post(`/inbound-tasks/${second.taskId}/close-receiving`, {}, { headers: { 'X-Request-Key': randomUUID() } }))
  assert.equal(close.status, 4)
  const final = await ap(f)
  assert.equal(Number(final.total_amount), 580); assert.equal(Number(final.paid_amount), 50); assert.equal(Number(final.balance), 530)
  assert.equal(final.settlement_type, paid.settlement_type); assert.deepEqual(final.due_date, paid.due_date)
  await pool.query('DELETE FROM purchase_returns WHERE id=?', [returnId])
})
test('同任务收货/上架/结案并发按任务锁串行；同键并发结案一次', async () => {
  const f = await fixture()
  const r = await receive(f, 20)
  const key = randomUUID()
  const results = await Promise.all([
    post(`/inbound-tasks/${f.taskId}/putaway`, { containerId: r.containers[0].containerId, locationId: location.id }, { headers: { ...headers, 'X-Request-Key': randomUUID() } }),
    post(`/inbound-tasks/${f.taskId}/receive`, { productId: f.product.id, packages: [{ qty: 30 }] }, { headers: { ...headers, 'X-Request-Key': randomUUID() } }),
    post(`/inbound-tasks/${f.taskId}/close-receiving`, {}, { headers: { 'X-Request-Key': key } }),
    post(`/inbound-tasks/${f.taskId}/close-receiving`, {}, { headers: { 'X-Request-Key': key } }),
  ])
  ok(results[0]); ok(results[2]); ok(results[3]); assert.deepEqual(results[2].data.data, results[3].data.data)
  assert.ok([200, 400].includes(results[1].status))
  const received = Number((await one('SELECT SUM(received_qty) AS qty FROM inbound_task_items WHERE task_id=?', [f.taskId])).qty)
  assert.ok([20, 50].includes(received))
  const waiting = await rows('SELECT id FROM inventory_containers WHERE inbound_task_id=? AND status=4', [f.taskId])
  for (const c of waiting) await put(f, { containerId: c.id })
  assert.equal((await task(f)).status, 4); assert.equal(Number((await ap(f)).total_amount), received * 10)
  assert.equal(Number((await one("SELECT COUNT(*) AS n FROM inbound_task_events WHERE task_id=? AND event_type='receiving_closed'", [f.taskId])).n), 1)
  assert.equal((await post(`/inbound-tasks/${f.taskId}/receive`, { productId: f.product.id, packages: [{ qty: 1 }] }, { headers })).status, 400)
})
test('错误任务/非法阶段/他仓与设备仓拒绝，提前上架同键回放也不绕过范围', async () => {
  const f = await fixture(); const other = await fixture()
  for (const qty of [1.5, 1.001]) {
    const rejected = await post(`/inbound-tasks/${f.taskId}/receive`, { productId: f.product.id, packages: [{ qty }] }, { headers })
    assert.equal(rejected.status, 400)
    assert.ok(['QTY_INTEGER_REQUIRED', 'QTY_DECIMALS_EXCEEDED'].includes(rejected.data.code))
  }
  const r = await receive(f, 20); const otherR = await receive(other, 20)
  assert.equal((await post(`/inbound-tasks/${f.taskId}/putaway`, { containerId: otherR.containers[0].containerId, locationId: location.id }, { headers })).status, 400)
  await assert.rejects(inbound.putaway(f.taskId, { containerId: r.containers[0].containerId, locationId: location.id }, operator, { scopeWarehouseIds: [] }), { statusCode: 403 })
  await assert.rejects(inbound.putaway(f.taskId, { containerId: r.containers[0].containerId, locationId: location.id }, operator, { pdaWarehouseId: warehouse.id + 999 }), { statusCode: 403 })
  const key = randomUUID(); await put(f, r.containers[0], key)
  const before = await snapshot(f)
  await put(f, r.containers[0], key); assert.deepEqual(await snapshot(f), before)
  await assert.rejects(inbound.putaway(f.taskId, { containerId: r.containers[0].containerId, locationId: location.id }, operator, { requestKey: key, scopeWarehouseIds: [] }), { statusCode: 403 })
})

test('收货阶段、上架进度和打印异常独立，收货中不被覆盖', () => {
  const { buildReceiptStatus } = require('../backend/src/modules/inbound-tasks/inbound-tasks.status')
  assert.deepEqual(buildReceiptStatus({ status: 2, auditStatus: 0, putawayStatus: { key: 'putting_away' }, exceptionFlags: { hasException: true } }), { key: 'receiving', label: '收货中' })
  assert.deepEqual(buildReceiptStatus({ status: 4, auditStatus: 1, exceptionFlags: { hasException: true } }), { key: 'audited', label: '已完成' })
})
