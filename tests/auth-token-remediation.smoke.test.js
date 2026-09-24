'use strict'

const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
process.env.JWT_SECRET_PREVIOUS = 'audit-previous-test-key-20260924-only'
process.env.DISABLE_PRINT_JOB_SWEEPER = '1'

const bcrypt = require('../backend/node_modules/bcryptjs')
const jwt = require('../backend/node_modules/jsonwebtoken')
const { prepareSmokeContext } = require('./helpers/smokeTestKit')
const { pool: appPool } = require('../backend/src/config/db')
const { env } = require('../backend/src/config/env')
const { buildAccessTokenPayload } = require('../backend/src/modules/auth/currentAuthUser')
const auth = require('../backend/src/modules/auth/auth.service')
const users = require('../backend/src/modules/users/users.service')

let ctx, userId, adminId
const username = `smoke_auth_fix_${crypto.randomUUID().slice(0, 8)}`
const oldPassword = crypto.randomBytes(18).toString('hex')

before(async () => {
  require('./helpers/testEnvironment').validateTestEnvironment()
  ctx = await prepareSmokeContext()
  const [[admin]] = await ctx.pool.query("SELECT id FROM sys_users WHERE username='smoke_admin'")
  adminId = Number(admin.id)
  const [row] = await ctx.pool.query(
    "INSERT INTO sys_users(username,password,real_name,role_id,role_name,is_active) VALUES(?,?,?,2,'普通用户',1)",
    [username, bcrypt.hashSync(oldPassword, 10), '认证回归'],
  )
  userId = Number(row.insertId)
})

after(async () => {
  if (ctx) {
    if (userId) {
      await ctx.pool.query('DELETE FROM refresh_token_sessions WHERE user_id=?', [userId])
      await ctx.pool.query('DELETE FROM auth_audit_logs WHERE user_id=?', [userId])
      await ctx.pool.query('DELETE FROM sys_users WHERE id=?', [userId])
    }
    await ctx.close()
  }
  await appPool.end()
})

test('管理员重置与旧密码修改交错时，最终保留管理员重置的密码', async () => {
  const replacement = crypto.randomBytes(18).toString('hex')
  const adminPassword = crypto.randomBytes(18).toString('hex')
  const originalCompare = bcrypt.compare
  let enteredCompare
  const entered = new Promise(resolve => { enteredCompare = resolve })
  let releaseCompare
  const released = new Promise(resolve => { releaseCompare = resolve })
  bcrypt.compare = async (...args) => {
    if (args[0] === oldPassword) {
      enteredCompare()
      await released
    }
    return originalCompare(...args)
  }
  try {
    const personal = auth.changePassword(userId, oldPassword, replacement)
    await entered
    const reset = users.resetPassword(userId, adminPassword, { userId: adminId, roleId: 1 })
    await new Promise(resolve => setTimeout(resolve, 150))
    releaseCompare()
    await Promise.all([personal, reset])
  } finally {
    bcrypt.compare = originalCompare
    releaseCompare()
  }
  const [[user]] = await ctx.pool.query('SELECT password FROM sys_users WHERE id=?', [userId])
  assert.equal(await originalCompare(adminPassword, user.password), true)
  assert.equal(await originalCompare(replacement, user.password), false)
})

test('旧密钥签发的 refresh token 登出后会话确实撤销', async () => {
  const [[user]] = await ctx.pool.query('SELECT * FROM sys_users WHERE id=?', [userId])
  const jti = crypto.randomUUID()
  const token = jwt.sign({ ...buildAccessTokenPayload(user), tokenType: 'refresh', jti }, env.JWT_SECRET_PREVIOUS, { expiresIn: '1h' })
  await ctx.pool.query('INSERT INTO refresh_token_sessions(jti,user_id,expires_at) VALUES(?,?,DATE_ADD(NOW(),INTERVAL 1 HOUR))', [jti, userId])
  await auth.logout(token)
  const [[session]] = await ctx.pool.query('SELECT revoked_at FROM refresh_token_sessions WHERE jti=?', [jti])
  assert.notEqual(session.revoked_at, null)
})

test('没有 jti 的旧版 refresh token 不能反复换票', async () => {
  const [[user]] = await ctx.pool.query('SELECT * FROM sys_users WHERE id=?', [userId])
  const token = jwt.sign({ ...buildAccessTokenPayload(user), tokenType: 'refresh', refreshVersion: Number(user.token_version || 0) }, env.JWT_SECRET, { expiresIn: '1h' })
  await assert.rejects(auth.refreshAccessToken(token), error => error.code === 'AUTH_REFRESH_INVALID')
})
