#!/usr/bin/env node
'use strict'

// 独立回环测试库上的真实 HTTP + MySQL 鉴权操作日志回归；仅清理本次创建的用户与日志。
const assert = require('node:assert/strict')
const bcrypt = require('../backend/node_modules/bcryptjs')
const express = require('../backend/node_modules/express')
const { configureTestEnvironment } = require('./helpers/testEnvironment')
configureTestEnvironment()
const { pool } = require('../backend/src/config/db')
const requestLogger = require('../backend/src/middleware/requestLogger')
const opLogger = require('../backend/src/middleware/opLogger')
const authRoutes = require('../backend/src/modules/auth/auth.routes')
const errorHandler = require('../backend/src/middleware/errorHandler')
const { runMigrations } = require('../backend/src/database/migrate')
const ownOperationIds = []

async function waitForOperation(afterId, path, predicate = () => true) {
  for (let attempt = 0; attempt < 50; attempt++) {
    const [rows] = await pool.query(
      'SELECT * FROM operation_logs WHERE id>? AND path=? ORDER BY id DESC', [afterId, path],
    )
    const found = rows.find(predicate)
    if (found) {
      ownOperationIds.push(found.id)
      return found
    }
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  throw new Error(`operation_logs 未写入 ${path}`)
}

async function main() {
  await runMigrations()
  const mark = `authlog_${Date.now().toString(36)}`
  const password = `TestOnly_${mark}!`
  const app = express()
  app.use(express.json())
  app.use(requestLogger)
  app.use(opLogger)
  app.use('/api/auth', authRoutes)
  app.use(errorHandler)
  let server
  let userId
  let baselineId
  try {
    const [[baseline]] = await pool.query('SELECT COALESCE(MAX(id), 0) AS id FROM operation_logs')
    baselineId = Number(baseline.id)
    const [created] = await pool.query(
      'INSERT INTO sys_users (username,password,real_name,role_id,role_name,is_active) VALUES (?,?,?,?,?,1)',
      [mark, await bcrypt.hash(password, 10), `测试身份${mark}`, 1, '管理员'],
    )
    userId = created.insertId
    server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)) })
    const baseUrl = `http://127.0.0.1:${server.address().port}`
    const request = async (path, json, token) => {
      const response = await fetch(baseUrl + path, {
        method: path.endsWith('/profile') ? 'PUT' : 'POST',
        headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(json),
      })
      return { status: response.status, data: await response.json() }
    }

    const badLogin = await request('/api/auth/login', { username: mark, password: 'wrong-password' })
    assert.equal(badLogin.status, 401)
    const badLog = await waitForOperation(baselineId, '/api/auth/login', r => r.status_code === 401)
    assert.equal(badLog.user_id, null, '失败登录不能相信请求体账号')
    assert.equal(badLog.user_name, null)

    const login = await request('/api/auth/login', { username: mark, password })
    assert.equal(login.status, 200)
    const loginLog = await waitForOperation(badLog.id, '/api/auth/login', r => r.status_code === 200)
    assert.equal(Number(loginLog.user_id), userId, '成功登录必须记录已验证身份')
    assert.equal(loginLog.user_name, mark)
    const [loginAudit] = await pool.query(
      "SELECT * FROM auth_audit_logs WHERE user_id=? AND event_type='login_success' ORDER BY id DESC LIMIT 1", [userId],
    )
    assert.equal(loginAudit[0]?.username, loginLog.user_name)

    const changed = await request('/api/auth/profile', { realName: `新姓名${mark}` }, login.data.data.token)
    assert.equal(changed.status, 200)
    const profileLog = await waitForOperation(loginLog.id, '/api/auth/profile')
    assert.equal(Number(profileLog.user_id), userId, '普通写操作仍使用认证中间件身份')

    const refreshed = await request('/api/auth/refresh', { refreshToken: login.data.data.refreshToken })
    assert.equal(refreshed.status, 200)
    const refreshLog = await waitForOperation(profileLog.id, '/api/auth/refresh')
    assert.equal(refreshLog.status_code, 200)
    const [refreshAudit] = await pool.query(
      "SELECT * FROM auth_audit_logs WHERE user_id=? AND event_type='token_refreshed' ORDER BY id DESC LIMIT 1", [userId],
    )
    assert.equal(refreshAudit[0]?.username, mark)

    const invalidLogout = await request('/api/auth/logout', { refreshToken: 'invalid', username: mark })
    assert.equal(invalidLogout.status, 200)
    const invalidLog = await waitForOperation(refreshLog.id, '/api/auth/logout')
    assert.equal(invalidLog.user_id, null, '无效退出不能信任请求体账号')
    assert.equal(invalidLog.user_name, null)

    const accessTokenLogout = await request('/api/auth/logout', { refreshToken: refreshed.data.data.token })
    assert.equal(accessTokenLogout.status, 200)
    const accessTokenLog = await waitForOperation(invalidLog.id, '/api/auth/logout')
    assert.equal(accessTokenLog.user_id, null, 'access token 不得被当成有效退出票据')

    const logout = await request('/api/auth/logout', { refreshToken: refreshed.data.data.refreshToken })
    assert.equal(logout.status, 200)
    const logoutLog = await waitForOperation(accessTokenLog.id, '/api/auth/logout')
    assert.equal(Number(logoutLog.user_id), userId, '有效退出需记录已验证身份')
    assert.equal(logoutLog.user_name, mark)
    const [logoutAudit] = await pool.query(
      "SELECT * FROM auth_audit_logs WHERE user_id=? AND event_type='logout_success' ORDER BY id DESC LIMIT 1", [userId],
    )
    assert.equal(logoutAudit[0]?.username, logoutLog.user_name)

    const repeatedLogout = await request('/api/auth/logout', { refreshToken: refreshed.data.data.refreshToken })
    assert.equal(repeatedLogout.status, 200)
    const repeatedLog = await waitForOperation(logoutLog.id, '/api/auth/logout')
    assert.equal(repeatedLog.user_id, null, '重复退出不能冒充首次成功的身份')
    assert.equal(repeatedLog.user_name, null)
    const [[logoutAuditCount]] = await pool.query(
      "SELECT COUNT(*) AS n FROM auth_audit_logs WHERE user_id=? AND event_type='logout_success'", [userId],
    )
    assert.equal(Number(logoutAuditCount.n), 1, '重复退出不能新增成功审计事件')

    const [logs] = await pool.query('SELECT request_body FROM operation_logs WHERE id>? AND id<=?', [baselineId, repeatedLog.id])
    for (const row of logs) {
      assert.equal(String(row.request_body || '').includes(password), false, '不能写入明文密码')
      assert.equal(String(row.request_body || '').includes(login.data.data.refreshToken), false, '不能写入 refresh token')
      assert.equal(String(row.request_body || '').includes(refreshed.data.data.refreshToken), false, '不能写入轮换后的 refresh token')
    }
    const [auditPayloads] = await pool.query('SELECT payload_json FROM auth_audit_logs WHERE user_id=?', [userId])
    for (const row of auditPayloads) {
      const payload = JSON.stringify(row.payload_json || '')
      assert.equal(payload.includes(password) || payload.includes(login.data.data.refreshToken), false, '鉴权审计也不能记录凭据')
    }
    console.log('auth-session-remediation: 登录/退出可信身份、失败与重放匿名、轮换、普通写操作、脱敏均通过')
  } finally {
    if (server) await new Promise(resolve => server.close(resolve))
    if (userId) {
      if (ownOperationIds.length) await pool.query('DELETE FROM operation_logs WHERE id IN (?)', [ownOperationIds])
      await pool.query('DELETE FROM operation_logs WHERE id>? AND user_id=?', [baselineId, userId])
      await pool.query('DELETE FROM operation_logs WHERE id>? AND path IN (?,?,?) AND request_body LIKE ?', [baselineId, '/api/auth/login', '/api/auth/logout', '/api/auth/refresh', `%${mark}%`])
      await pool.query('DELETE FROM auth_audit_logs WHERE user_id=? OR username=?', [userId, mark])
      await pool.query('DELETE FROM refresh_token_sessions WHERE user_id=?', [userId])
      await pool.query('DELETE FROM sys_users WHERE id=?', [userId])
    }
    await pool.end()
  }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
