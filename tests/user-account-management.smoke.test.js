'use strict'

// 只在独立测试库运行：通过真实 HTTP 和 MySQL 验证账号修改的权限与登录行为。
const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
process.env.DISABLE_PRINT_JOB_SWEEPER = '1'
const bcrypt = require('../backend/node_modules/bcryptjs')
const { prepareSmokeContext, login } = require('./helpers/smokeTestKit')
const { pool: appPool } = require('../backend/src/config/db')

const prefix = `smoke_rename_${Date.now().toString(36)}_`
const ownUsers = []
let ctx, adminToken, editorToken, editorRoleId, targetId, targetToken, targetPassword

async function createUser(suffix, roleId, password) {
  const username = prefix + suffix
  const [result] = await ctx.pool.query(
    'INSERT INTO sys_users(username,password,real_name,role_id,role_name,is_active) VALUES(?,?,?,?,?,1)',
    [username, bcrypt.hashSync(password, 10), suffix, roleId, suffix],
  )
  ownUsers.push(result.insertId)
  return { id: result.insertId, username }
}

before(async () => {
  require('./helpers/testEnvironment').validateTestEnvironment()
  ctx = await prepareSmokeContext()
  adminToken = (await login(ctx.http, 'smoke_admin', 'SmokeAdmin123!')).token
  assert.ok(adminToken)
  const [role] = await ctx.pool.query('INSERT INTO sys_roles(code,name,is_system) VALUES(?,?,0)', [prefix + 'role', '账号编辑测试'])
  editorRoleId = role.insertId
  await ctx.pool.query('INSERT INTO sys_role_permissions(role_id,permission) VALUES(?,?)', [editorRoleId, 'user.update'])
  const editorPassword = crypto.randomBytes(24).toString('hex')
  const editor = await createUser('editor', editorRoleId, editorPassword)
  editorToken = (await login(ctx.http, editor.username, editorPassword)).token
  assert.ok(editorToken)
  targetPassword = crypto.randomBytes(24).toString('hex')
  const target = await createUser('target', 2, targetPassword)
  targetId = target.id
  targetToken = (await login(ctx.http, target.username, targetPassword)).token
  assert.ok(targetToken)
  await createUser('duplicate', 2, crypto.randomBytes(24).toString('hex'))
})

after(async () => {
  if (ctx) {
    if (ownUsers.length) {
      await ctx.pool.query('DELETE FROM refresh_token_sessions WHERE user_id IN (?)', [ownUsers])
      await ctx.pool.query('DELETE FROM auth_audit_logs WHERE user_id IN (?) OR username LIKE ?', [ownUsers, `${prefix}%`])
      await ctx.pool.query('DELETE FROM sys_users WHERE id IN (?)', [ownUsers])
    }
    if (editorRoleId) {
      await ctx.pool.query('DELETE FROM sys_role_permissions WHERE role_id=?', [editorRoleId])
      await ctx.pool.query('DELETE FROM sys_roles WHERE id=?', [editorRoleId])
    }
    await ctx.close()
  }
  await appPool.end()
})

test('only superadmin can rename a login account; current sessions resolve its new name', async () => {
  const renamed = prefix + 'renamed'
  const body = { username: renamed, realName: 'target', isActive: true }
  const denied = await ctx.http.put(`/api/users/${targetId}`, { token: editorToken, json: body })
  assert.equal(denied.status, 403)

  const saved = await ctx.http.put(`/api/users/${targetId}`, { token: adminToken, json: body })
  assert.equal(saved.status, 200)
  const detail = await ctx.http.get(`/api/users/${targetId}`, { token: adminToken })
  assert.equal(detail.data.data.username, renamed)
  assert.equal(Object.hasOwn(detail.data.data, 'password'), false)
  const me = await ctx.http.get('/api/users/me', { token: targetToken })
  assert.equal(me.data.data.username, renamed)
  assert.equal((await login(ctx.http, prefix + 'target', targetPassword)).response.status, 401)
  assert.ok((await login(ctx.http, renamed, targetPassword)).token)
})

test('duplicate and empty account names are rejected without changing the saved name', async () => {
  const duplicate = await ctx.http.put(`/api/users/${targetId}`, {
    token: adminToken,
    json: { username: prefix + 'duplicate', realName: 'target', isActive: true },
  })
  assert.equal(duplicate.status, 400)
  const empty = await ctx.http.put(`/api/users/${targetId}`, {
    token: adminToken,
    json: { username: '  ', realName: 'target', isActive: true },
  })
  assert.equal(empty.status, 400)
  const [[target]] = await ctx.pool.query('SELECT username FROM sys_users WHERE id=?', [targetId])
  assert.equal(target.username, prefix + 'renamed')
})

test('administrator can include development accounts in the list without exposing passwords', async () => {
  const query = `keyword=${encodeURIComponent(prefix)}&pageSize=20`
  const hidden = await ctx.http.get(`/api/users?${query}&hideDevelopment=1`, { token: adminToken })
  assert.equal(hidden.status, 200)
  assert.equal(hidden.data.data.pagination.total, 0)

  const visible = await ctx.http.get(`/api/users?${query}&hideDevelopment=0`, { token: adminToken })
  assert.equal(visible.status, 200)
  assert.equal(visible.data.data.pagination.total, ownUsers.length)
  assert.ok(visible.data.data.list.some(user => user.username === prefix + 'renamed'))
  assert.ok(visible.data.data.list.every(user => !Object.hasOwn(user, 'password')))
})
