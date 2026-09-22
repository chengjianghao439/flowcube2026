'use strict'
// Real HTTP negative authorization cases. Run only against an isolated synthetic test DB.
const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
process.env.DISABLE_PRINT_JOB_SWEEPER = '1'
const { prepareSmokeContext, login } = require('./helpers/smokeTestKit')
const bcrypt = require('../backend/node_modules/bcryptjs')
const { pool: appPool } = require('../backend/src/config/db')
const print = require('../backend/src/modules/print-jobs/print-jobs.service')
const prefix = 'AUDITFIX_' + Date.now()
let ctx, admin, limited, editor, applicant, peer, whB, foreignJob
const ownUsers = [], ownRoles = []
async function user(name, permissions, roleId = null) {
  const password = crypto.randomBytes(24).toString('hex')
  if (!roleId) {
    const [r] = await ctx.pool.query('INSERT INTO sys_roles (code,name,is_system) VALUES (?,?,0)', [prefix + name, name])
    roleId = r.insertId; ownRoles.push(roleId)
    if (permissions.length) await ctx.pool.query('INSERT INTO sys_role_permissions (role_id,permission) VALUES ?', [permissions.map(p => [roleId, p])])
  }
  const [u] = await ctx.pool.query('INSERT INTO sys_users (username,password,real_name,role_id,role_name,is_active) VALUES (?,?,?,?,?,1)', [prefix + name, bcrypt.hashSync(password, 10), name, roleId, name])
  ownUsers.push(u.insertId)
  if (roleId !== 1) await ctx.pool.query('INSERT INTO user_warehouse_scope (user_id,warehouse_id) VALUES (?,?)', [u.insertId, ctx.warehouse.id])
  const logged = await login(ctx.http, prefix + name, password)
  assert.ok(logged.token)
  return { id: u.insertId, token: logged.token, roleId }
}
before(async () => {
  require('./helpers/testEnvironment').validateTestEnvironment()
  ctx = await prepareSmokeContext()
  admin = await user('admin', [], 1)
  limited = await user('limited', ['pda.device.view', 'pda.device.manage', 'print.job.view', 'print.job.create', 'print.job.reprint', 'print.job.retry', 'print.client.consume'])
  editor = await user('editor', ['user.update', 'user.create'])
  applicant = await user('applicant', ['sale.credit.override.apply'])
  peer = await user('peer', ['sale.credit.override.apply'])
  const [w] = await ctx.pool.query('INSERT INTO inventory_warehouses (code,name) VALUES (?,?)', [prefix, 'Audit foreign warehouse'])
  whB = w.insertId
  foreignJob = await print.create({ printerId: ctx.printer.id, warehouseId: whB, jobType: 'waybill', title: 'Audit synthetic', contentType: 'zpl', content: '^XA^FDAUDIT^FS^XZ', refType: 'waybill', refId: 999999 })
})
after(async () => {
  if (ctx) {
    if (ownUsers.length) {
      await ctx.pool.query('DELETE FROM user_warehouse_scope WHERE user_id IN (?)', [ownUsers])
      await ctx.pool.query('UPDATE sys_users SET is_active=0,deleted_at=NOW() WHERE id IN (?)', [ownUsers])
    }
    if (ownRoles.length) {
      await ctx.pool.query('DELETE FROM sys_role_permissions WHERE role_id IN (?)', [ownRoles])
      await ctx.pool.query('DELETE FROM sys_roles WHERE id IN (?)', [ownRoles])
    }
    await ctx.close()
  }
  await appPool.end()
})
test('print reprint rejects foreign warehouse before enqueue', async () => {
  assert.equal((await ctx.http.get('/api/print-jobs/' + foreignJob.id, { token: limited.token })).status, 403)
  const r = await ctx.http.post('/api/print-jobs/barcodes/reprint', { token: limited.token, json: { category: 'logistics', recordId: foreignJob.id } })
  assert.equal(r.status, 403)
})
test('all print completion routes require resource scope even with matching station', async () => {
  for (const action of ['complete-local', 'complete-client', 'fail-client', 'retry']) {
    const r = await ctx.http.post(`/api/print-jobs/${foreignJob.id}/${action}`, { token: limited.token, headers: { 'X-Client-Id': ctx.printer.clientId }, json: { ackToken: 'audit-invalid' } })
    assert.equal(r.status, 403, action)
  }
})
test('claim only consumes authorized jobs and preserves foreign pending job', async () => {
  const own = await print.create({ printerId: ctx.printer.id, warehouseId: ctx.warehouse.id, jobType: 'waybill', title: 'Audit own', contentType: 'zpl', content: '^XA^FDAUDIT^FS^XZ' })
  const r = await ctx.http.post('/api/print-jobs/claim-client', { token: limited.token, json: { clientId: ctx.printer.clientId, limit: 10 } })
  assert.equal(r.status, 200)
  assert.ok(r.data.data.some(j => j.id === own.id))
  assert.ok(r.data.data.every(j => j.warehouseId === ctx.warehouse.id))
  const [[job]] = await ctx.pool.query('SELECT status FROM print_jobs WHERE id=?', [foreignJob.id])
  assert.equal(job.status, 0)
})
test('manual print creation rejects caller-supplied foreign warehouse', async () => {
  const r = await ctx.http.post('/api/print-jobs', { token: limited.token, json: { printerId: ctx.printer.id, warehouseId: whB, contentType: 'zpl', content: '^XA^XZ', title: 'Audit denied' } })
  assert.equal(r.status, 403)
})
test('manual print cannot forge business references or use a foreign printer', async () => {
  const body = { printerId: ctx.printer.id, warehouseId: ctx.warehouse.id, contentType: 'zpl', content: '^XA^XZ', title: 'Audit raw' }
  const forged = await ctx.http.post('/api/print-jobs', { token: limited.token, json: { ...body, refType: 'outbound_package', refId: 999999 } })
  assert.equal(forged.status, 400)
  const [printer] = await ctx.pool.query('INSERT INTO printers (name,code,type,warehouse_id,status) VALUES (?,?,?,?,1)', ['Audit foreign', prefix + '_PR', 1, whB])
  const denied = await ctx.http.post('/api/print-jobs', { token: limited.token, json: { ...body, printerId: printer.insertId } })
  assert.equal(denied.status, 403)
  const own = await ctx.http.post('/api/print-jobs', { token: limited.token, json: body })
  assert.equal(own.status, 201)
})
test('assignable roles reflect permission subset; unknown roles never silently fall back', async () => {
  const allowed = await ctx.http.get('/api/users/assignable-roles', { token: editor.token })
  assert.equal(allowed.status, 200)
  assert.ok(allowed.data.data.some(r => r.id === editor.roleId))
  assert.ok(!allowed.data.data.some(r => r.id === limited.roleId || r.id === 1))
  const denied = await ctx.http.get('/api/users/assignable-roles', { token: applicant.token })
  assert.equal(denied.status, 403)
  const missing = await ctx.http.put('/api/users/' + peer.id, { token: admin.token, json: { realName: 'Audit peer', roleId: 99999999, isActive: true } })
  assert.equal(missing.status, 400)
})
test('limited users cannot create global devices or remove a device warehouse', async () => {
  const r = await ctx.http.post('/api/pda-devices', { token: limited.token, json: { deviceName: 'Audit global', warehouseId: null } })
  assert.equal(r.status, 403)
  const own = await ctx.http.post('/api/pda-devices', { token: limited.token, json: { deviceName: 'Audit own', warehouseId: ctx.warehouse.id } })
  assert.equal(own.status, 201)
  const moved = await ctx.http.put('/api/pda-devices/' + own.data.data.id, { token: limited.token, json: { warehouseId: null } })
  assert.equal(moved.status, 403)
})
test('non-admin cannot change own role but can edit own profile without role change', async () => {
  const forbidden = await ctx.http.put('/api/users/' + editor.id, { token: editor.token, json: { realName: 'Audit editor', roleId: 2, isActive: true } })
  assert.equal(forbidden.status, 403)
  const profile = await ctx.http.put('/api/users/' + editor.id, { token: editor.token, json: { realName: 'Audit editor renamed', roleId: editor.roleId, isActive: true } })
  assert.equal(profile.status, 200)
})
test('admin can assign a valid custom role; ordinary editor cannot grant permissions they do not own', async () => {
  const assigned = await ctx.http.put('/api/users/' + peer.id, { token: admin.token, json: { realName: 'Audit peer', roleId: limited.roleId, isActive: true } })
  assert.equal(assigned.status, 200)
  const escalated = await ctx.http.put('/api/users/' + peer.id, { token: editor.token, json: { realName: 'Audit peer', roleId: 2, isActive: true } })
  assert.equal(escalated.status, 403)
})
test('credit overrides without a matching approval flow fail closed and leave draft intact', async () => {
  const [flows] = await ctx.pool.query("SELECT id,is_active FROM approval_flows WHERE biz_type='sale_credit_override'")
  const [[customer]] = await ctx.pool.query('SELECT credit_limit FROM sale_customers WHERE id=?', [ctx.customer.id])
  try {
    await ctx.pool.query("UPDATE approval_flows SET is_active=0 WHERE biz_type='sale_credit_override'")
    await ctx.pool.query('UPDATE sale_customers SET credit_limit=1 WHERE id=?', [ctx.customer.id])
    const [order] = await ctx.pool.query('INSERT INTO sale_orders (order_no,customer_id,customer_name,warehouse_id,warehouse_name,total_amount,discount_amount,status,operator_id,operator_name) VALUES (?,?,?,?,?,100,0,1,?,?)', [prefix + 'SO', ctx.customer.id, 'Audit synthetic', ctx.warehouse.id, 'Audit warehouse', applicant.id, 'Audit applicant'])
    const created = await ctx.http.post('/api/credit-overrides', { token: applicant.token, json: { saleOrderId: order.insertId, reason: 'Audit missing flow' } })
    assert.equal(created.status, 201)
    const id = created.data.data.id
    const submitted = await ctx.http.post(`/api/credit-overrides/${id}/submit`, { token: applicant.token, json: {} })
    assert.equal(submitted.status, 409)
    const [[row]] = await ctx.pool.query('SELECT status FROM sale_credit_overrides WHERE id=?', [id])
    assert.equal(row.status, 1)
    // Existing legacy pending row must also refuse the missing-instance fallback.
    await ctx.pool.query('UPDATE sale_credit_overrides SET status=2 WHERE id=?', [id])
    const approved = await ctx.http.post(`/api/credit-overrides/${id}/approve`, { token: admin.token, json: {} })
    assert.equal(approved.status, 409)
    const rejected = await ctx.http.post(`/api/credit-overrides/${id}/reject`, { token: admin.token, json: { reason: 'audit' } })
    assert.equal(rejected.status, 409)
  } finally {
    for (const f of flows) await ctx.pool.query('UPDATE approval_flows SET is_active=? WHERE id=?', [f.is_active, f.id])
    await ctx.pool.query('UPDATE sale_customers SET credit_limit=? WHERE id=?', [customer.credit_limit, ctx.customer.id])
  }
})

test('new users inherit creator warehouse scope and delegated scope cannot exceed creator', async () => {
  const password = crypto.randomBytes(24).toString('hex'), username = prefix + 'child'
  const created = await ctx.http.post('/api/users', { token: editor.token, json: { username, password, realName: 'Audit child', roleId: editor.roleId } })
  assert.equal(created.status, 201)
  const id = created.data.data.id; ownUsers.push(id)
  const [scopes] = await ctx.pool.query('SELECT warehouse_id FROM user_warehouse_scope WHERE user_id=?', [id])
  assert.deepEqual(scopes.map(r => Number(r.warehouse_id)), [ctx.warehouse.id])
  for (const warehouseIds of [[], [whB], [ctx.warehouse.id, whB]]) {
    const denied = await ctx.http.put(`/api/users/${id}/warehouse-scope`, { token: editor.token, json: { warehouseIds } })
    assert.equal(denied.status, 403)
  }
  const allowed = await ctx.http.put(`/api/users/${id}/warehouse-scope`, { token: editor.token, json: { warehouseIds: [ctx.warehouse.id] } })
  assert.equal(allowed.status, 200)
  const createdPrinterUser = await ctx.http.post('/api/users', { token: admin.token, json: { username: prefix + 'printerchild', password, realName: 'Audit print child', roleId: limited.roleId } })
  assert.equal(createdPrinterUser.status, 201)
  const printerChild = createdPrinterUser.data.data.id; ownUsers.push(printerChild)
  await ctx.http.put(`/api/users/${printerChild}/warehouse-scope`, { token: editor.token, json: { warehouseIds: [ctx.warehouse.id] } })
  const logged = await login(ctx.http, prefix + 'printerchild', password)
  assert.equal((await ctx.http.get('/api/print-jobs/' + foreignJob.id, { token: logged.token })).status, 403)
})
test('role assignment waits for deletion lock and refuses a deleted custom role', async () => {
  const svc = require('../backend/src/modules/users/users.service')
  const [role] = await ctx.pool.query('INSERT INTO sys_roles(code,name,is_system) VALUES (?,?,0)', [prefix + 'race-role', 'Audit race'])
  ownRoles.push(role.insertId)
  const c = await appPool.getConnection()
  let pending, settled = false
  try {
    await c.beginTransaction()
    await c.query('SELECT id FROM sys_roles WHERE id=? FOR UPDATE', [role.insertId])
    pending = svc.update(peer.id, { realName: 'Audit peer', roleId: role.insertId, isActive: true }, { userId: admin.id, roleId: 1 }).then(value => ({ value }), error => ({ error })).then(result => { settled = true; return result })
    await new Promise(resolve => setTimeout(resolve, 150))
    assert.equal(settled, false, 'role assignment must wait for role lock')
    await c.query('DELETE FROM sys_roles WHERE id=?', [role.insertId]); await c.commit()
    assert.equal((await pending).error?.code, 'ROLE_NOT_FOUND')
  } finally { await c.rollback(); c.release(); if (pending) await pending }
})
test('role deletion rechecks committed user references after waiting for role lock', async () => {
  const roles = require('../backend/src/modules/roles/roles.service')
  const [role] = await ctx.pool.query('INSERT INTO sys_roles(code,name,is_system) VALUES (?,?,0)', [prefix + 'delete-role', 'Audit delete'])
  ownRoles.push(role.insertId)
  const c = await appPool.getConnection()
  let pending
  try {
    await c.beginTransaction()
    await c.query('SELECT id FROM sys_roles WHERE id=? FOR UPDATE', [role.insertId])
    const [u] = await c.query('INSERT INTO sys_users(username,password,real_name,role_id,role_name) VALUES (?,?,?,?,?)', [prefix + 'pendingchild', 'synthetic-disabled', 'Audit pending', role.insertId, 'Audit delete'])
    ownUsers.push(u.insertId)
    pending = roles.remove(role.insertId).then(() => null, error => error)
    await new Promise(resolve => setTimeout(resolve, 150))
    await c.commit()
    assert.equal((await pending)?.statusCode, 409)
    const [[present]] = await ctx.pool.query('SELECT id FROM sys_roles WHERE id=?', [role.insertId])
    assert.ok(present)
  } finally { await c.rollback(); c.release(); if (pending) await pending }
})
