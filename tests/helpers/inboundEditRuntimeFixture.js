'use strict'
// No app, database, dotenv, server.js or scheduler is imported until live instance ownership is proved.
const assert = require('node:assert/strict')
const { randomBytes, randomUUID } = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { configureTestEnvironment, validateTestEnvironment } = require('./testEnvironment')
const { assertOwnedRepairInstance } = require('./repairInstanceOwnership')
const { PERMISSIONS: P } = require('../../backend/src/constants/permissions')
const DATABASE = 'flowcube_inboundedit20261010_test'
function must(response, label = 'API') {
  assert.ok(response.status >= 200 && response.status < 300 && response.data?.success === true,
    `${label}: HTTP ${response.status}, code=${response.data?.code || ''}, message=${response.data?.message || ''}`)
  return response.data.data
}
function makeInboundEditRuntimeFixture() {
  const mark = `IE${randomBytes(4).toString('hex')}`
  const ctx = { mark, users: {}, owned: { products: [], purchases: [], tasks: [] }, pool: null, apiPool: null, server: null, ownership: null, concurrency: [] }
  ctx.rows = async (sql, args = []) => (await ctx.pool.query(sql, args))[0]
  ctx.one = async (sql, args = []) => (await ctx.rows(sql, args))[0]
  ctx.insert = async (sql, args) => Number((await ctx.pool.query(sql, args))[0].insertId)
  ctx.request = async (method, route, body, { user = 'editor', key = randomUUID(), headers = {} } = {}) => {
    if (user) assert.ok(ctx.users[user]?.token, `未登录合成员工 ${user}`)
    const response = await fetch(`http://127.0.0.1:${ctx.server.address().port}/api${route}`, { method, redirect: 'manual', signal: AbortSignal.timeout(45000),
      headers: { 'Content-Type': 'application/json', 'X-Client-Id': ctx.clientId, ...(user ? { Authorization: `Bearer ${ctx.users[user].token}` } : {}),
        ...(method !== 'GET' && key != null ? { 'X-Request-Key': key } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: response.status, data: await response.json() }
  }
  ctx.ok = async (method, route, body, options) => must(await ctx.request(method, route, body, options), `${method} ${route}`)
  ctx.context = id => ctx.ok('GET', `/inbound-tasks/${id}/edit-context`)
  ctx.body = (context, items, extra = {}) => ({ remark: context.task.remark || '', items: items || context.task.items.map(i => ({ purchaseItemId: i.purchaseItemId, qty: i.orderedQty })), expectedEditFingerprint: context.expectedEditFingerprint, ...extra })
  ctx.edit = (id, body, options) => ctx.request('PUT', `/inbound-tasks/${id}`, body, options)
  ctx.setup = async () => {
    configureTestEnvironment()
    const config = validateTestEnvironment()
    assert.equal(config.database, DATABASE)
    assert.equal(config.host, '127.0.0.1')
    assert.ok(![3306, 3307].includes(config.port))
    for (const key of ['FLOWCUBE_REPAIR_INSTANCE_FILE', 'FLOWCUBE_REPAIR_DOCKER_CONTEXT', 'JWT_SECRET', 'APP_UPDATE_DOWNLOADS_DIR']) assert.ok(process.env[key], `缺少专属runner环境 ${key}`)
    assert.ok(process.env.JWT_SECRET.length >= 32)
    assert.ok(path.isAbsolute(process.env.APP_UPDATE_DOWNLOADS_DIR))
    fs.accessSync(process.env.APP_UPDATE_DOWNLOADS_DIR, fs.constants.W_OK)
    assert.equal(process.env.LOGISTICS_WORKER_ENABLED, '0')
    assert.equal(process.env.DISABLE_PRINT_JOB_SWEEPER, '1')
    for (const name of ['LOKI_URL', 'SENTRY_DSN', 'DINGTALK_WEBHOOK', 'DINGTALK_ALERT_WEBHOOK']) assert.equal(process.env[name], '')
    const mysql = require('../../backend/node_modules/mysql2/promise')
    ctx.pool = mysql.createPool({ ...config, timezone: '+08:00', dateStrings: true, connectionLimit: 6 })
    const conn = await ctx.pool.getConnection()
    try {
      ctx.ownership = await assertOwnedRepairInstance(conn, { config })
      assert.equal((await conn.query('SELECT DATABASE() AS db'))[0][0].db, DATABASE)
    } finally { conn.release() }
    // First write and app import occur only after the actual live Docker/volume/runner/UUID guard.
    assert.ok(await ctx.one('SELECT id FROM acct_companies WHERE id=1'), '临时库必须完整迁移')
    ctx.clientId = `inbound-edit-${mark}`
    ctx.warehouse = { id: await ctx.insert('INSERT INTO inventory_warehouses(code,name) VALUES (?,?)', [mark, `合成仓-${mark}`]), name: `合成仓-${mark}` }
    ctx.otherWarehouse = { id: await ctx.insert('INSERT INTO inventory_warehouses(code,name) VALUES (?,?)', [mark + 'X', `合成他仓-${mark}`]), name: `合成他仓-${mark}` }
    ctx.supplier = { id: await ctx.insert('INSERT INTO supply_suppliers(code,name,settlement_type) VALUES (?,?,2)', [mark, `合成供应商-${mark}`]), name: `合成供应商-${mark}` }
    ctx.otherSupplier = { id: await ctx.insert('INSERT INTO supply_suppliers(code,name,settlement_type) VALUES (?,?,2)', [mark + 'X', `合成他供应商-${mark}`]), name: `合成他供应商-${mark}` }
    const permissions = [P.PURCHASE_ORDER_VIEW, P.PURCHASE_ORDER_CREATE, P.PURCHASE_ORDER_CONFIRM, P.INBOUND_ORDER_VIEW, P.INBOUND_ORDER_CREATE, P.INBOUND_ORDER_UPDATE, P.INBOUND_ORDER_SUBMIT]
    assert.ok(permissions.every(p => typeof p === 'string'), '必须采用实际权限常量')
    const bcrypt = require('../../backend/node_modules/bcryptjs')
    for (const name of ['editor', 'viewer', 'denied', 'scoped']) {
      const roleId = await ctx.insert('INSERT INTO sys_roles(code,name,is_system) VALUES (?,?,0)', [`${mark}-${name}`, `${mark}-${name}`])
      const granted = name === 'viewer' ? [P.INBOUND_ORDER_VIEW] : name === 'denied' ? [] : permissions
      if (granted.length) await ctx.pool.query('INSERT INTO sys_role_permissions(role_id,permission) VALUES ?', [granted.map(p => [roleId, p])])
      const password = randomBytes(24).toString('base64url'), username = `${mark}-${name}`
      const id = await ctx.insert('INSERT INTO sys_users(username,password,real_name,role_id,role_name,is_active,allow_self_approve) VALUES (?,?,?,?,?,1,0)', [username, await bcrypt.hash(password, 10), username, roleId, username])
      await ctx.pool.query('INSERT INTO user_warehouse_scope(user_id,warehouse_id) VALUES (?,?)', [id, name === 'scoped' ? ctx.otherWarehouse.id : ctx.warehouse.id])
      ctx.users[name] = { id, roleId, username, password }
    }
    // Editor may create synthetic other-warehouse sources; the scoped identity still cannot edit our task.
    await ctx.pool.query('INSERT INTO user_warehouse_scope(user_id,warehouse_id) VALUES (?,?)', [ctx.users.editor.id, ctx.otherWarehouse.id])
    ctx.apiPool = require('../../backend/src/config/db').pool
    const app = require('../../backend/src/app')
    ctx.server = await new Promise((resolve, reject) => { const server = app.listen(0, '127.0.0.1', () => resolve(server)); server.once('error', reject) })
    for (const user of Object.values(ctx.users)) {
      const data = must(await ctx.request('POST', '/auth/login', { username: user.username, password: user.password }, { user: null }), '合成身份真实登录')
      assert.ok(data.token); user.token = data.token; delete user.password
    }
  }
  ctx.product = async ({ decimal = true } = {}) => {
    const code = `${mark}P${ctx.owned.products.length}`
    const id = await ctx.insert("INSERT INTO product_items(code,name,unit,sale_price_a,cost_price,avg_cost,allow_decimal_qty) VALUES (?,?,'个',20,10,10,?)", [code, code, decimal ? 1 : 0])
    ctx.owned.products.push(id)
    return { id, code, name: code, unit: '个' }
  }
  ctx.purchase = async ({ quantity = 100, product, warehouse = ctx.warehouse, supplier = ctx.supplier, confirmed = true, lines } = {}) => {
    product ||= await ctx.product()
    const data = await ctx.ok('POST', '/purchase', { supplierId: supplier.id, supplierName: supplier.name, warehouseId: warehouse.id, warehouseName: warehouse.name,
      items: lines || [{ productId: product.id, productCode: product.code, productName: product.name, unit: product.unit, quantity, unitPrice: 10 }] })
    ctx.owned.purchases.push(data.id)
    if (confirmed) await ctx.ok('POST', `/purchase/${data.id}/confirm`, {})
    const items = await ctx.rows('SELECT * FROM purchase_order_items WHERE order_id=? ORDER BY id', [data.id])
    return { ...data, product, itemId: Number(items[0].id), items, supplier, warehouse }
  }
  ctx.createBody = (items, extra = {}) => ({ supplierId: ctx.supplier.id, supplierName: ctx.supplier.name, items, ...extra })
  ctx.draft = async (purchase, qty = 5, extra = {}) => {
    const result = await ctx.ok('POST', '/inbound-tasks', ctx.createBody([{ purchaseItemId: purchase.itemId, qty }], extra))
    assert.ok(result.taskId); ctx.owned.tasks.push(result.taskId); return result
  }
  ctx.taskFacts = async id => ({ task: await ctx.one('SELECT * FROM inbound_tasks WHERE id=?', [id]), items: await ctx.rows('SELECT * FROM inbound_task_items WHERE task_id=? ORDER BY id', [id]), events: await ctx.rows('SELECT * FROM inbound_task_events WHERE task_id=? ORDER BY id', [id]) })
  ctx.receipt = key => ctx.rows('SELECT * FROM operation_requests WHERE request_key=?', [key])
  ctx.sideEffects = async () => {
    const facts = {}
    for (const table of ['inventory_containers', 'inventory_stock', 'inventory_logs', 'payment_records', 'payment_entries', 'finance_account_transactions', 'acct_vouchers', 'acct_voucher_entries', 'print_jobs']) facts[table] = await ctx.rows(`SELECT * FROM ${table} ORDER BY id`)
    facts.costs = await ctx.rows('SELECT id,cost_price,avg_cost FROM product_items ORDER BY id')
    facts.purchaseCosts = await ctx.rows('SELECT id,unit_price,amount FROM purchase_order_items ORDER BY id')
    return facts
  }
  ctx.waitForBlocked = async (table, blockerId, count) => {
    const deadline = Date.now() + 12000
    while (Date.now() < deadline) {
      const rows = await ctx.rows(`SELECT DISTINCT rt.PROCESSLIST_ID AS connectionId FROM performance_schema.data_lock_waits w
        JOIN performance_schema.threads rt ON rt.THREAD_ID=w.REQUESTING_THREAD_ID
        JOIN performance_schema.data_locks bl ON bl.ENGINE_LOCK_ID=w.BLOCKING_ENGINE_LOCK_ID
        WHERE bl.OBJECT_SCHEMA=? AND bl.OBJECT_NAME=? AND rt.PROCESSLIST_ID<>?`, [DATABASE, table, blockerId])
      const ids = [...new Set(rows.map(r => Number(r.connectionId)))]
      if (ids.length >= count) { assert.ok(ids.every(id => id > 0 && id !== blockerId)); return ids }
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    assert.fail(`没有观察到 ${count} 个不同真实连接在 ${table} 等锁`)
  }
  ctx.withBlocked = async (kind, id, actions) => {
    const table = kind === 'task' ? 'inbound_tasks' : 'purchase_orders'
    const conn = await ctx.pool.getConnection()
    const blockerId = Number((await conn.query('SELECT CONNECTION_ID() AS id'))[0][0].id)
    const pending = []
    try {
      await conn.beginTransaction()
      await conn.query(`SELECT id FROM ${table} WHERE id=? FOR UPDATE`, [id])
      for (const action of actions) { pending.push(action()); await ctx.waitForBlocked(table, blockerId, pending.length) }
      const waiters = await ctx.waitForBlocked(table, blockerId, actions.length)
      ctx.concurrency.push({ table, id, blockerId, waiterConnectionIds: waiters })
    } catch (error) {
      await conn.rollback(); conn.release()
      await Promise.allSettled(pending)
      throw error
    }
    await conn.rollback(); conn.release()
    return Promise.all(pending)
  }
  ctx.close = async () => {
    const errors = []
    const close = async fn => { try { await fn() } catch (e) { errors.push(e) } }
    if (ctx.server) await close(async () => { ctx.server.closeAllConnections?.(); await new Promise((resolve, reject) => ctx.server.close(e => e ? reject(e) : resolve())); assert.equal(ctx.server.listening, false) })
    if (ctx.apiPool) await close(() => ctx.apiPool.end())
    if (ctx.pool) await close(() => ctx.pool.end())
    console.log('[inbound-edit-runtime]', JSON.stringify({ database: DATABASE, mark, owned: { ...ctx.owned, products: { count: ctx.owned.products.length, firstId: ctx.owned.products[0], lastId: ctx.owned.products.at(-1) } }, concurrency: ctx.concurrency, apiClosed: !ctx.server?.listening, poolsClosed: !errors.length }))
    if (errors.length) throw new AggregateError(errors, '专属API/数据库连接收尾失败')
  }
  return ctx
}
module.exports = { makeInboundEditRuntimeFixture, must, DATABASE }
