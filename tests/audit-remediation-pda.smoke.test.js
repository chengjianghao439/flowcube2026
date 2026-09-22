'use strict'
const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
process.env.DISABLE_PRINT_JOB_SWEEPER = '1'
const { prepareSmokeContext, login } = require('./helpers/smokeTestKit')
const bcrypt = require('../backend/node_modules/bcryptjs')
const { pool } = require('../backend/src/config/db')
const devices = require('../backend/src/modules/pda-devices/pda-devices.service')
const sessions = require('../backend/src/modules/pda/pda.sessions.service')
let ctx, token, uid, whB
before(async () => {
  require('./helpers/testEnvironment').validateTestEnvironment()
  ctx = await prepareSmokeContext()
  const name = 'auditpda_' + Date.now(), password = crypto.randomBytes(24).toString('hex')
  const [u] = await ctx.pool.query('INSERT INTO sys_users (username,password,real_name,role_id,role_name) VALUES (?,?,?,1,?)', [name, bcrypt.hashSync(password, 10), 'Audit PDA', 'Audit admin'])
  uid = u.insertId; token = (await login(ctx.http, name, password)).token
  const [w] = await ctx.pool.query('INSERT INTO inventory_warehouses (code,name) VALUES (?,?)', [name, 'Audit PDA B'])
  whB = w.insertId
})
after(async () => { if (ctx) { await ctx.pool.query('UPDATE sys_users SET is_active=0,deleted_at=NOW() WHERE id=?', [uid]); await ctx.close() } await pool.end() })
test('createSession waits for device mutation lock and reads committed warehouse', async () => {
  const d = await devices.create({ deviceName: 'Audit race', warehouseId: ctx.warehouse.id })
  const c = await pool.getConnection()
  let pending, result, settled = false
  try {
    await c.beginTransaction()
    await c.query('SELECT id FROM pda_devices WHERE id=? FOR UPDATE', [d.id])
    pending = sessions.createSession({ deviceCode: d.deviceCode, deviceSecret: d.deviceSecret, userId: uid }).then(v => { settled = true; result = v; return v })
    await new Promise(r => setTimeout(r, 200))
    assert.equal(settled, false, 'must not issue a stale ticket while a device mutation owns the lock')
    await c.query('UPDATE pda_devices SET warehouse_id=? WHERE id=?', [whB, d.id])
    await devices.revokeSessions(d.id, 'audit change', c)
    await c.commit()
    result = await pending
    assert.equal(result.warehouseId, whB)
  } finally { await c.rollback(); c.release(); if (pending) await pending }
})
test('device secret and session revocation roll back together on revoke failure', async () => {
  const d = await devices.create({ deviceName: 'Audit reset', warehouseId: ctx.warehouse.id })
  const ticket = await sessions.createSession({ deviceCode: d.deviceCode, deviceSecret: d.deviceSecret, userId: uid })
  const originalQuery = pool.query.bind(pool), originalGet = pool.getConnection.bind(pool)
  const rejectRevoke = (sql) => { if (String(sql).startsWith('UPDATE pda_device_sessions SET revoked_at')) throw new Error('audit revoke failure') }
  pool.query = function (sql, args) { rejectRevoke(sql); return originalQuery(sql, args) }
  pool.getConnection = async () => {
    const c = await originalGet()
    return new Proxy(c, { get(target, key) { if (key === 'query') return (sql, args) => { rejectRevoke(sql); return target.query(sql, args) }; const v = target[key]; return typeof v === 'function' ? v.bind(target) : v } })
  }
  try { await assert.rejects(devices.resetSecret(d.id), /audit revoke failure/) } finally { pool.query = originalQuery; pool.getConnection = originalGet }
  const [[row]] = await pool.query('SELECT secret_hash FROM pda_devices WHERE id=?', [d.id])
  assert.equal(await bcrypt.compare(d.deviceSecret, row.secret_hash), true, 'failed reset must preserve old secret')
  const ok = await ctx.http.get('/api/pda/todo-counts', { token, headers: { 'X-Client': 'pda', 'X-PDA-Session': ticket.sessionToken } })
  assert.equal(ok.status, 200)
  await devices.resetSecret(d.id)
  const denied = await ctx.http.get('/api/pda/todo-counts', { token, headers: { 'X-Client': 'pda', 'X-PDA-Session': ticket.sessionToken } })
  assert.equal(denied.status, 403)
})
test('session warehouse mismatch is rejected even when a legacy ticket was not revoked', async () => {
  const d = await devices.create({ deviceName: 'Audit stale', warehouseId: ctx.warehouse.id })
  const ticket = await sessions.createSession({ deviceCode: d.deviceCode, deviceSecret: d.deviceSecret, userId: uid })
  await ctx.pool.query('UPDATE pda_devices SET warehouse_id=? WHERE id=?', [whB, d.id])
  const r = await ctx.http.get('/api/pda/todo-counts', { token, headers: { 'X-Client': 'pda', 'X-PDA-Session': ticket.sessionToken } })
  assert.equal(r.status, 403)
  await assert.rejects(sessions.renewSession({ sessionToken: ticket.sessionToken }), e => e.statusCode === 403)
})
test('PDA counts require a current user login in addition to device identity', async () => {
  const r = await ctx.http.get('/api/pda/todo-counts', { headers: ctx.pdaHeaders() })
  assert.equal(r.status, 401)
})
test('PDA device pagination is finite, positive and integral', async () => {
  for (const [page, pageSize] of [[1, 1000000], [-2, -1], [1.5, 2.5], [Infinity, Infinity], ["invalid", "invalid"]]) {
    const r = await ctx.http.get(`/api/pda-devices?page=${page}&pageSize=${pageSize}`, { token })
    assert.equal(r.status, 200)
    const p = r.data.data.pagination
    assert.ok(Number.isInteger(p.page) && p.page >= 1)
    assert.ok(Number.isInteger(p.pageSize) && p.pageSize >= 1 && p.pageSize <= 500)
  }
})

test('todo counts intersect device and user warehouse scope and mask unauthorized operations', async () => {
  const todo = require('../backend/src/modules/pda/todo-counts.service')
  const permissions = require('../backend/src/constants/permissions').PERMISSIONS
  const n = Date.now().toString()
  for (const [suffix, warehouseId] of [['A', ctx.warehouse.id], ['B', whB]]) {
    await ctx.pool.query('INSERT INTO inbound_tasks (task_no,purchase_order_id,warehouse_id,status,submitted_at) VALUES (?,0,?,1,NOW())', ['AC' + n + suffix, warehouseId])
  }
  const global = await todo.getTodoCounts(null, null, { roleId: 1 })
  const a = await todo.getTodoCounts(null, [ctx.warehouse.id], { roleId: 1 })
  const b = await todo.getTodoCounts(whB, null, { roleId: 1 })
  assert.ok(a.inbound >= 1 && b.inbound >= 1)
  assert.ok(global.inbound >= a.inbound + b.inbound)
  assert.deepEqual(await todo.getTodoCounts(whB, [ctx.warehouse.id], { roleId: 1 }), Object.fromEntries(Object.keys(a).map(k => [k, 0])))
  const masked = await todo.getTodoCounts(null, [ctx.warehouse.id], { roleId: 201, permissions: [permissions.INBOUND_ORDER_VIEW] })
  assert.equal(masked.inbound, a.inbound)
  assert.ok(Object.entries(masked).every(([key, value]) => key === 'inbound' || value === 0))
  const none = await todo.getTodoCounts(null, [ctx.warehouse.id], { roleId: 201, permissions: [] })
  assert.ok(Object.values(none).every(value => value === 0))
})
