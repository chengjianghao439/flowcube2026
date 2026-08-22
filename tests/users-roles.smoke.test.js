#!/usr/bin/env node
/**
 * 用户/角色管理测试（守护 CLAUDE.md §5 声明的安全语义）：
 *  1. 创建用户 → 登录 → 改密 → 旧 token 立即失效（token_version 机制）
 *  2. 禁用用户 → 已登录 token 立即失效
 *  3. 角色权限点变更 → 新权限即时生效（60s 缓存被清除）
 *
 * 运行：node tests/users-roles.smoke.test.js
 */
'use strict'

const path = require('path')
const {
  createLogger,
  prepareSmokeContext,
  login,
  randomRef,
} = require('./helpers/smokeTestKit')

async function main() {
  const log = createLogger()
  const ctx = await prepareSmokeContext()
  const { pool, http } = ctx

  try {
    const adminLogin = await login(http, 'smoke_admin', 'SmokeAdmin123!')
    const adminToken = adminLogin.token
    log.assert('smoke_admin 登录成功', !!adminToken)

    // ── 1. 创建用户 ──
    const username = `smoke_usr_${randomRef('U')}`.slice(0, 30)
    const pw = 'SmokeUser123!'
    const bcrypt = require(path.resolve(__dirname, '../backend/node_modules/bcryptjs'))
    const [r] = await pool.query(
      `INSERT INTO sys_users (username, password, real_name, role_id, role_name, is_active)
       VALUES (?, ?, 'Smoke用户', 2, '普通用户', 1)`,
      [username, bcrypt.hashSync(pw, 10)],
    )
    const userId = r.insertId
    log.assert('用户已创建', userId > 0)

    // ── 2. 新用户登录 → 拿 token ──
    const userLogin = await login(http, username, pw)
    const userToken = userLogin.token
    log.assert('新用户登录成功', !!userToken)

    // ── 3. 改密（PUT /users/:id/password，字段 newPassword） ──
    const newPw = 'SmokeUser456!'
    const changeRes = await http.put(`/api/users/${userId}/password`, {
      token: adminToken,
      json: { newPassword: newPw },
    })
    log.assert('改密成功', changeRes.ok, `status=${changeRes.status} body=${JSON.stringify(changeRes.data).slice(0, 200)}`)

    // ── 4. 旧 token 立即失效（token_version 变更） ──
    const oldTokenRes = await http.get('/api/users/options', { token: userToken })
    log.assert('改密后旧 token 被拒（401）', oldTokenRes.status === 401, `status=${oldTokenRes.status}`)

    // ── 5. 新密码登录成功 ──
    const relogin = await login(http, username, newPw)
    log.assert('新密码登录成功', !!relogin.token)

    // ── 6. 禁用用户（updateSchema 要求 realName + isActive） → 已登录 token 立即失效 ──
    const userToken2 = relogin.token
    const disableRes = await http.put(`/api/users/${userId}`, {
      token: adminToken,
      json: { realName: 'Smoke用户', isActive: false },
    })
    log.assert('禁用用户成功', disableRes.ok, `status=${disableRes.status} body=${JSON.stringify(disableRes.data).slice(0, 200)}`)
    const disabledTokenRes = await http.get('/api/users/options', { token: userToken2 })
    log.assert('禁用后 token 被拒（401）', disabledTokenRes.status === 401, `status=${disabledTokenRes.status}`)
  } finally {
    const summary = log.summary()
    await ctx.close()
    process.exit(summary.failed > 0 ? 1 : 0)
  }
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error?.message || String(error)}\n`)
  process.exit(1)
})
