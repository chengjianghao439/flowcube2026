'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm')
const { createRequire } = require('node:module')
const AppError = require('../backend/src/utils/AppError')
const file = path.resolve(__dirname, '../backend/src/modules/users/users.service.js')
const source = fs.readFileSync(file, 'utf8')
function service(code = source) {
  const module = { exports: {} }
  vm.runInNewContext(code, { module, require: name => name === '../../utils/AppError' ? AppError : name === 'bcryptjs' ? { hash() { throw Error('Credential generation is forbidden in this test') } } : name === '../../config/db' ? { pool: { getConnection() { throw Error('Actual password mutation is forbidden in this test') } } } : {} }, { filename: file })
  return module.exports
}
function fixture({ actorPermissions = ['user.reset_password', 'report.view'], targetPermissions = ['report.view'], actorScope = [1, 2], targetScope = [1], actorRole = 5, targetRole = 6, roleMissing = false, targetActive = 1 } = {}) {
  const calls = [], roles = new Map([[actorRole, new Set(actorPermissions)], [targetRole, new Set(targetPermissions)]])
  if (actorRole === targetRole) roles.set(actorRole, new Set(actorPermissions))
  const actor = { userId: 10, roleId: actorRole }, target = { id: 20, role_id: targetRole, is_active: targetActive }
  const conn = { async query(sql, params) {
    assert.match(sql, /^SELECT/, 'authorization models never write users, credentials or sessions')
    calls.push({ sql, params })
    if (sql.includes('FROM sys_roles') && sql.includes(' IN ')) return [[...new Set(params)].filter(id => roles.has(id)).map(id => ({ id }))]
    if (sql.includes('FROM sys_roles')) return [roleMissing ? [] : [{ id: params[0] }]]
    if (sql.includes("permission='user.reset_password'")) return [roles.get(params[0])?.has('user.reset_password') ? [{ permission: 'user.reset_password' }] : []]
    if (sql.includes('permission NOT IN')) return [[...roles.get(params[0])].filter(p => !roles.get(params[1])?.has(p)).map(permission => ({ permission }))]
    if (sql.includes('FROM user_warehouse_scope')) return [[...actorScope.map(warehouse_id => ({ user_id: 10, warehouse_id })), ...targetScope.map(warehouse_id => ({ user_id: 20, warehouse_id }))]]
    throw Error('Unmodeled authorization read: ' + sql)
  } }
  return { conn, actor, target, calls }
}
for (const row of [
  { label: 'permission and warehouse subset' },
  { label: 'equal permission sets and equal scopes', targetPermissions: ['user.reset_password', 'report.view'], targetScope: [1, 2] },
  { label: 'same role id, narrower warehouse', actorRole: 5, targetRole: 5 },
  { label: 'unrestricted actor can manage a restricted target', actorScope: [], targetScope: [9] },
  { label: 'both unrestricted', actorScope: [], targetScope: [] },
  { label: 'disabled target does not acquire new authority', targetScope: [1], targetActive: 0 },
]) test('delegated reset authorization allows existing subset relationship: ' + row.label, async () => {
  const f = fixture(row); await service().assertCanResetTarget(f.conn, f.target, f.actor)
  assert.match(f.calls[0].sql, /ORDER BY id FOR UPDATE/)
  assert.ok(f.calls.some(c => c.sql.includes('permission NOT IN')))
})
for (const row of [
  { label: 'target has an extra role permission', targetPermissions: ['report.view', 'user.update'], code: 'ROLE_ASSIGN_DENIED' },
  { label: 'restricted actor cannot reset unrestricted target', targetScope: [], code: 'USER_SCOPE_GRANT_DENIED' },
  { label: 'outside warehouse', targetScope: [3], code: 'USER_SCOPE_GRANT_DENIED' },
  { label: 'overlapping scopes are insufficient', targetScope: [1, 3], code: 'USER_SCOPE_GRANT_DENIED' },
  { label: 'current actor role lost reset authority', actorPermissions: ['report.view'], code: 'PERMISSION_DENIED' },
  { label: 'role was removed', roleMissing: true, code: 'ROLE_NOT_FOUND' },
  { label: 'role1 target remains protected', targetRole: 1, code: 'USER_ADMIN_PROTECTED' },
]) test('delegated reset authorization denies ' + row.label, async () => {
  const f = fixture(row); await assert.rejects(service().assertCanResetTarget(f.conn, f.target, f.actor), { statusCode: row.code === 'ROLE_NOT_FOUND' ? 400 : 403, code: row.code })
})
test('superadmin current role preserves existing exception without querying role/scope', async () => {
  const f = fixture({ actorRole: 1, targetRole: 1 }); await service().assertCanResetTarget(f.conn, f.target, f.actor); assert.equal(f.calls.length, 0)
})
test('cached warehouseIds cannot replace the actual current scopes', async () => {
  const f = fixture({ targetScope: [3] }); f.actor.warehouseIds = null
  await assert.rejects(service().assertCanResetTarget(f.conn, f.target, f.actor), { code: 'USER_SCOPE_GRANT_DENIED' })
})
test('guard is inside locked reset callback and before the existing UPDATE; actual reset is never called', () => {
  const body = service().resetPassword.toString()
  assert.match(body, /withLockedTarget\(id, operator, async \(conn, target, actor\)/)
  assert.ok(body.indexOf('await assertCanResetTarget(conn, target, actor)') < body.indexOf('UPDATE sys_users'))
  assert.match(body, /token_version = COALESCE\(token_version, 0\) \+ 1/)
})
test('removing either subset gate is detected by an actual pure authorization counterexample', async () => {
  const roleBroken = source.replace('await assertCanAssignRole(actor, Number(target.role_id), conn)', '')
  assert.notEqual(roleBroken, source)
  const role = fixture({ targetPermissions: ['report.view', 'user.update'] })
  await service(roleBroken).assertCanResetTarget(role.conn, role.target, role.actor)
  const scopeBroken = source.replace('if (allowed.size && (!requested.length', 'if (false && (!requested.length')
  assert.notEqual(scopeBroken, source)
  const scope = fixture({ targetScope: [] })
  await service(scopeBroken).assertCanResetTarget(scope.conn, scope.target, scope.actor)
})
test('actual reset route retains permission and schema gates with the entire password service mocked', async () => {
  const controllerFile = path.resolve(__dirname, '../backend/src/modules/users/users.controller.js'), routeFile = path.resolve(__dirname, '../backend/src/modules/users/users.routes.js')
  const captured = [], routes = [], real = createRequire(routeFile), mocked = { resetPassword: async (...args) => { captured.push(args) } }
  const controller = { exports: {} }
  vm.runInNewContext(fs.readFileSync(controllerFile, 'utf8'), { module: controller, require: name => name === './users.service' ? mocked : createRequire(controllerFile)(name) }, { filename: controllerFile })
  const router = { use() {}, get() {}, post() {}, delete() {}, put(path, ...handlers) { routes.push({ path, handlers }) } }, module = { exports: {} }
  vm.runInNewContext(fs.readFileSync(routeFile, 'utf8'), { module, require: name => name === 'express' ? { Router: () => router } : name === './users.controller' ? controller.exports : name === '../../middleware/auth' ? { authMiddleware() {}, requirePermission: permission => (req, res, next) => req.user.permissions.includes(permission) ? next() : next(new AppError('denied', 403)) } : real(name) }, { filename: routeFile })
  const handlers = routes.find(r => r.path === '/:id/password').handlers
  async function run(permissions, newPassword) {
    let error, response
    const req = { params: { id: '20' }, body: { newPassword, roleId: 1, warehouseIds: null }, user: { userId: 10, roleId: 5, permissions } }
    const res = { status() { return this }, json(value) { response = value; return this } }
    for (const fn of handlers) { let continued = false; await fn(req, res, e => { error = e; continued = !e }); if (error || !continued) break }
    return { error, response }
  }
  assert.equal((await run([], 'schema-only')).error.statusCode, 403); assert.equal(captured.length, 0)
  assert.equal((await run(['user.reset_password'], 'x')).response.success, false); assert.equal(captured.length, 0)
  await run(['user.reset_password'], 'schema-only'); assert.equal(captured.length, 1); assert.equal(captured[0][0], 20); assert.equal(captured[0][2].roleId, 5)
})
