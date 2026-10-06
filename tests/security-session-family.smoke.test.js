'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { configureTestEnvironment } = require('./helpers/testEnvironment')
configureTestEnvironment()
const bcrypt = require('../backend/node_modules/bcryptjs')
const express = require('../backend/node_modules/express')
const jwt = require('../backend/node_modules/jsonwebtoken')
const { pool } = require('../backend/src/config/db')
const { env } = require('../backend/src/config/env')
const authRoutes = require('../backend/src/modules/auth/auth.routes')
const errorHandler = require('../backend/src/middleware/errorHandler')
const users = require('../backend/src/modules/users/users.service')
const { cleanupSessionFamilies } = require('../backend/src/modules/auth/sessionFamilies')

test('real HTTP/MySQL: isolated families, replay race, disable/reactivate, uniform login errors', async () => {
  const mark = `security_family_${crypto.randomUUID().slice(0, 8)}`, password = `Fixture_${crypto.randomUUID()}`
  let server; const ownIds = []
  try {
    const hash = await bcrypt.hash(password, 10)
    const [admin] = await pool.query('INSERT INTO sys_users(username,password,real_name,role_id,role_name,is_active) VALUES(?,?,?,1,?,1)', [`${mark}_admin`, hash, '专项管理员', '管理员'])
    const adminId = Number(admin.insertId); ownIds.push(adminId)
    const [created] = await pool.query('INSERT INTO sys_users(username,password,real_name,role_id,role_name,is_active) VALUES(?,?,?,2,?,1)', [mark, hash, '专项会话', '普通用户'])
    const userId = Number(created.insertId); ownIds.push(userId)
    const app = express(); app.use(express.json()); app.use('/api/auth', authRoutes); app.use(errorHandler)
    server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)) })
    const request = async (path, body, token) => {
      const r = await fetch(`http://127.0.0.1:${server.address().port}/api/auth/${path}`, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) })
      return { status: r.status, data: await r.json() }
    }
    const login = async () => { const r = await request('login', { username: mark, password }); assert.equal(r.status, 200); return r.data.data }
    const first = await login(), other = await login()
    assert.notEqual(jwt.decode(first.token).familyId, jwt.decode(other.token).familyId)
    assert.equal((await request('me', null, first.token)).status, 200)
    assert.equal((await request('logout', { refreshToken: first.refreshToken })).status, 200)
    assert.equal((await request('me', null, first.token)).data.code, 'AUTH_SESSION_INVALID')
    assert.equal((await request('me', null, other.token)).status, 200)
    assert.equal((await request('refresh', { refreshToken: other.refreshToken })).status, 200)

    for (const removed of [false, true]) {
      const ancestor = await login()
      const rotated = await request('refresh', { refreshToken: ancestor.refreshToken })
      assert.equal(rotated.status, 200)
      if (removed) await pool.query('DELETE FROM refresh_token_sessions WHERE jti=? AND user_id=?', [jwt.decode(ancestor.refreshToken).jti, userId])
      assert.equal((await request('logout', { refreshToken: ancestor.refreshToken })).status, 200)
      assert.equal((await request('me', null, rotated.data.data.token)).status, 401, `rotated ancestor logout (removed=${removed}) invalidates descendant access`)
      assert.equal((await request('refresh', { refreshToken: rotated.data.data.refreshToken })).data.code, 'AUTH_REFRESH_INVALID')
      assert.equal((await request('logout', { refreshToken: ancestor.refreshToken })).status, 200)
      assert.equal((await request('me', null, other.token)).status, 200)
    }
    const exiting = await login()
    const [refreshWhileExiting, exitWhileRefreshing] = await Promise.all([
      request('refresh', { refreshToken: exiting.refreshToken }),
      request('logout', { refreshToken: exiting.refreshToken }),
    ])
    assert.equal(exitWhileRefreshing.status, 200)
    assert.ok([200, 401].includes(refreshWhileExiting.status))
    assert.equal((await request('me', null, exiting.token)).status, 401)
    if (refreshWhileExiting.status === 200) {
      assert.equal((await request('me', null, refreshWhileExiting.data.data.token)).status, 401, 'refresh wins the user lock: old captured refresh logout still revokes the issued descendant')
    }
    assert.equal((await request('me', null, other.token)).status, 200)

    const racing = await login()
    const rotations = await Promise.all([request('refresh', { refreshToken: racing.refreshToken }), request('refresh', { refreshToken: racing.refreshToken })])
    assert.deepEqual(rotations.map(r => r.status).sort(), [200, 401])
    assert.equal(rotations.find(r => r.status === 401).data.code, 'AUTH_REFRESH_REPLAY')
    const descendant = rotations.find(r => r.status === 200).data.data
    assert.equal((await request('me', null, descendant.token)).status, 401)
    assert.equal((await request('refresh', { refreshToken: descendant.refreshToken })).data.code, 'AUTH_REFRESH_INVALID')
    const [[raceFamily]] = await pool.query('SELECT revoked_at FROM auth_session_families WHERE family_id=?', [jwt.decode(racing.token).familyId])
    assert.ok(raceFamily.revoked_at, 'replay revocation persisted instead of rolling back with the 401')

    const delayed = await login()
    const delayedNext = await request('refresh', { refreshToken: delayed.refreshToken })
    assert.equal(delayedNext.status, 200)
    // Simulate retention removing this test's already-rotated ancestor only.
    await pool.query('DELETE FROM refresh_token_sessions WHERE jti=? AND user_id=?', [jwt.decode(delayed.refreshToken).jti, userId])
    assert.equal((await request('refresh', { refreshToken: delayed.refreshToken })).data.code, 'AUTH_REFRESH_REPLAY')
    assert.equal((await request('me', null, delayedNext.data.data.token)).status, 401)
    assert.equal((await request('refresh', { refreshToken: delayedNext.data.data.refreshToken })).data.code, 'AUTH_REFRESH_INVALID')
    const [replayAudits] = await pool.query("SELECT payload_json FROM auth_audit_logs WHERE user_id=? AND event_type='refresh_replay_detected' ORDER BY id", [userId])
    assert.equal(replayAudits.length, 2, 'one security audit per first replay that revokes an active family')
    const auditReasons = replayAudits.map(r => (typeof r.payload_json === 'string' ? JSON.parse(r.payload_json) : r.payload_json).reason)
    assert.deepEqual(auditReasons.sort(), ['retained_ancestor_missing', 'rotated_token'])

    const oldEmpty = crypto.randomUUID(), oldRetained = crypto.randomUUID(), recentEmpty = crypto.randomUUID()
    await pool.query('INSERT INTO auth_session_families(family_id,user_id,created_at) VALUES(?,?,DATE_SUB(NOW(),INTERVAL 8 DAY)),(?,?,DATE_SUB(NOW(),INTERVAL 8 DAY)),(?,?,NOW())', [oldEmpty, userId, oldRetained, userId, recentEmpty, userId])
    await pool.query('INSERT INTO refresh_token_sessions(jti,user_id,family_id,expires_at,revoked_at) VALUES(?,?,?,DATE_ADD(NOW(),INTERVAL 1 HOUR),NOW())', [crypto.randomUUID(), userId, oldRetained])
    await cleanupSessionFamilies()
    const [kept] = await pool.query('SELECT family_id FROM auth_session_families WHERE family_id IN (?)', [[oldEmpty, oldRetained, recentEmpty]])
    assert.deepEqual(kept.map(r => r.family_id).sort(), [oldRetained, recentEmpty].sort(), 'old empty only: retain recent family and every family with a refresh row including revoked ancestors')

    const retained = await login()
    await users.update(userId, { realName: '专项会话', isActive: false }, { userId: adminId, roleId: 1 })
    const [[disabled]] = await pool.query('SELECT token_version FROM sys_users WHERE id=?', [userId])
    assert.equal(Number(disabled.token_version), 1)
    const [[activeSessions]] = await pool.query('SELECT COUNT(*) AS n FROM refresh_token_sessions WHERE user_id=? AND revoked_at IS NULL', [userId])
    assert.equal(Number(activeSessions.n), 0)
    const inactive = await request('login', { username: mark, password })
    await users.update(userId, { realName: '专项会话', isActive: true }, { userId: adminId, roleId: 1 })
    assert.equal((await request('refresh', { refreshToken: retained.refreshToken })).data.code, 'AUTH_REFRESH_INVALID')
    assert.equal((await request('me', null, retained.token)).data.code, 'AUTH_SESSION_INVALID')
    const wrong = await request('login', { username: mark, password: 'bad-password' })
    const unknown = await request('login', { username: `${mark}_unknown`, password: 'bad-password' })
    assert.deepEqual([inactive.status, wrong.status, unknown.status], [401, 401, 401])
    assert.deepEqual(inactive.data, wrong.data); assert.deepEqual(wrong.data, unknown.data)
    const fresh = await login(); assert.equal((await request('me', null, fresh.token)).status, 200)
    const legacy = jwt.sign({ userId, roleId: 2, tokenVersion: 1 }, env.JWT_SECRET, { expiresIn: '1h' })
    assert.equal((await request('me', null, legacy)).data.code, 'AUTH_SESSION_INVALID')
  } finally {
    if (server) await new Promise(resolve => server.close(resolve))
    if (ownIds.length) {
      await pool.query('DELETE FROM operation_logs WHERE user_id IN (?)', [ownIds])
      await pool.query('DELETE FROM auth_audit_logs WHERE user_id IN (?) OR username=?', [ownIds, `${mark}_unknown`])
      await pool.query('DELETE FROM refresh_token_sessions WHERE user_id IN (?)', [ownIds])
      await pool.query('DELETE FROM auth_session_families WHERE user_id IN (?)', [ownIds])
      await pool.query('DELETE FROM sys_users WHERE id IN (?)', [ownIds])
    }
    await pool.end()
  }
})
