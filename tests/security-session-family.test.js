'use strict'
// Real auth/users/middleware code with an in-memory SQL adapter: no network database is used.
const { test, beforeEach } = require('node:test')
const assert = require('node:assert/strict')
const bcrypt = require('../backend/node_modules/bcryptjs')
const express = require('../backend/node_modules/express')
process.env.JWT_SECRET = 'security-session-offline-fixture-secret-only-20261006'
const user = { id: 41, username: 'session-fixture', real_name: '测试', password: bcrypt.hashSync('fixture-password', 10), role_id: 1, role_name: '管理员', is_active: 1, token_version: 0, deleted_at: null }
const state = { users: [], sessions: [], families: [], audit: [], commits: 0, rollbacks: 0, failAudit: false }
async function query(sql, args = []) {
  const q = sql.replace(/\s+/g, ' ').trim()
  if (q.startsWith('SELECT permission')) return [[]]
  if (q.startsWith('SELECT * FROM sys_users WHERE id IN')) return [state.users.filter(u => args.includes(u.id))]
  if (q.includes('FROM sys_users')) {
    const found = q.includes('username = ?') ? state.users.find(u => u.username === args[0]) : state.users.find(u => u.id === args[0])
    return [found ? [{ ...found }] : []]
  }
  if (q.startsWith('INSERT INTO auth_session_families')) { state.families.push({ family_id: args[0], user_id: args[1], revoked_at: null }); return [{ affectedRows: 1 }] }
  if (q.startsWith('INSERT INTO refresh_token_sessions')) {
    const family = q.includes('family_id')
    state.sessions.push({ jti: args[0], user_id: args[1], family_id: family ? args[2] : null, revoked_at: null, expires_at: new Date(Date.now() + 3600000) })
    return [{ affectedRows: 1 }]
  }
  if (q.includes('FROM auth_session_families')) return [state.families.filter(f => f.family_id === args[0] && f.user_id === args[1] && (!q.includes('revoked_at IS NULL') || !f.revoked_at)).map(f => ({ ...f }))]
  if (q.includes('FROM refresh_token_sessions s JOIN sys_users')) {
    const s = state.sessions.find(s => s.jti === args[0] && s.user_id === args[1] && !s.revoked_at)
    const u = state.users.find(u => u.id === args[1])
    return [s && u ? [{ ...u, family_id: s.family_id }] : []]
  }
  if (q.includes('FROM refresh_token_sessions')) return [state.sessions.filter(s => s.jti === args[0] && (args.length < 2 || s.user_id === args[1])).map(s => ({ ...s }))]
  if (q.startsWith('UPDATE auth_session_families')) {
    let n = 0
    for (const f of state.families) if (!f.revoked_at && (q.includes('family_id = ?') ? f.family_id === args[0] && f.user_id === args[1] : f.user_id === args[0])) { f.revoked_at = new Date(); n++ }
    return [{ affectedRows: n }]
  }
  if (q.startsWith('UPDATE refresh_token_sessions')) {
    let n = 0
    for (const s of state.sessions) if (!s.revoked_at && (q.includes('jti = ?') ? s.jti === args[0] : q.includes('family_id = ?') ? s.family_id === args[0] && s.user_id === args[1] : s.user_id === args[0])) { s.revoked_at = new Date(); n++ }
    return [{ affectedRows: n }]
  }
  if (q.startsWith('UPDATE sys_users SET username')) {
    const u = state.users.find(u => u.id === args.at(-1))
    u.username = args[0]; u.real_name = args[1]; u.role_id = args[2]; u.role_name = args[3]; u.is_active = args[4]
    if (q.includes('token_version')) u.token_version += Number(args[7])
    return [{ affectedRows: 1 }]
  }
  throw new Error(`Unexpected fixture SQL: ${q}`)
}
const pool = { query, getConnection: async () => ({ query, beginTransaction: async () => {}, commit: async () => { state.commits++ }, rollback: async () => { state.rollbacks++ }, release() {} }) }
function substitute(relative, exports) { const id = require.resolve(relative); require.cache[id] = { id, filename: id, loaded: true, exports } }
substitute('../backend/src/config/db', { pool })
substitute('../backend/src/modules/auth/auth-audit.service', { recordAuthAudit: async event => {
  state.audit.push({ ...event, committed: state.commits, revoked: state.families.some(f => f.revoked_at) })
  if (event.eventType === 'refresh_replay_detected' && state.failAudit) throw new Error('CONTROLLED_AUDIT_FAILURE')
}, AUTH_AUDIT_EVENT: { REFRESH_REPLAY_DETECTED: 'refresh_replay_detected' } })
substitute('../backend/src/utils/warehouseScope', { loadUserWarehouseScope: async () => null })
substitute('../backend/src/middleware/opLogger', (_req, _res, next) => next())
const auth = require('../backend/src/modules/auth/auth.service')
const users = require('../backend/src/modules/users/users.service')
const { authMiddleware } = require('../backend/src/middleware/auth')
beforeEach(() => { state.users = [{ ...user }, { ...user, id: 42, username: 'session-admin' }]; state.sessions = []; state.families = []; state.audit = []; state.commits = 0; state.rollbacks = 0; state.failAudit = false })
async function probe(token) {
  const app = express(); app.get('/probe', authMiddleware, (_req, res) => res.json({ ok: true })); app.use((e, _req, res, _next) => res.status(e.statusCode || 500).json({ code: e.code }))
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)) })
  try { const res = await fetch(`http://127.0.0.1:${server.address().port}/probe`, { headers: { authorization: `Bearer ${token}` } }); return { status: res.status, body: await res.json() } }
  finally { await new Promise(resolve => server.close(resolve)) }
}
test('logout immediately rejects its access token while another device remains valid', async () => {
  const first = await auth.login(user.username, 'fixture-password'); const second = await auth.login(user.username, 'fixture-password')
  assert.equal((await probe(first.token)).status, 200)
  assert.equal((await auth.logout(first.refreshToken)).userId, user.id)
  assert.equal((await probe(first.token)).status, 401)
  assert.equal((await probe(second.token)).status, 200)
  assert.equal(await auth.logout(first.refreshToken), null)
})
for (const removed of [false, true]) test(`logout with a rotated ancestor (retention removed=${removed}) revokes descendants only`, async () => {
  const first = await auth.login(user.username, 'fixture-password')
  const other = await auth.login(user.username, 'fixture-password')
  const next = await auth.refreshAccessToken(first.refreshToken)
  if (removed) state.sessions = state.sessions.filter(s => !s.revoked_at)
  assert.equal((await auth.logout(first.refreshToken))?.userId, user.id)
  assert.equal((await probe(next.token)).status, 401)
  await assert.rejects(auth.refreshAccessToken(next.refreshToken), e => e.code === 'AUTH_REFRESH_INVALID')
  assert.equal((await probe(other.token)).status, 200)
  assert.equal(await auth.logout(first.refreshToken), null)
})
test('refresh replay audits only after committed revocation, even when the audit fails', async () => {
  const first = await auth.login(user.username, 'fixture-password')
  const next = await auth.refreshAccessToken(first.refreshToken)
  const before = state.commits
  state.failAudit = true
  await assert.rejects(auth.refreshAccessToken(first.refreshToken), e => e.code === 'AUTH_REFRESH_REPLAY')
  const replay = state.audit.find(e => e.eventType === 'refresh_replay_detected')
  assert.ok(replay, 'a dedicated replay security audit is attempted')
  assert.equal(replay.committed, before + 1)
  assert.equal(replay.revoked, true)
  assert.equal(state.rollbacks, 0, 'audit failure cannot roll back committed revocation')
  assert.equal((await probe(next.token)).status, 401)
})
test('refresh replay commits revocation of the rotated descendant and its access token', async () => {
  const first = await auth.login(user.username, 'fixture-password'); const other = await auth.login(user.username, 'fixture-password')
  const next = await auth.refreshAccessToken(first.refreshToken)
  await assert.rejects(auth.refreshAccessToken(first.refreshToken), e => e.code === 'AUTH_REFRESH_REPLAY')
  await assert.rejects(auth.refreshAccessToken(next.refreshToken), e => e.code === 'AUTH_REFRESH_INVALID')
  assert.equal((await probe(next.token)).status, 401)
  assert.equal((await probe(other.token)).status, 200)
})
test('disable permanently revokes all retained sessions through reactivation', async () => {
  const first = await auth.login(user.username, 'fixture-password')
  await users.update(user.id, { realName: user.real_name, isActive: false }, { userId: 42, roleId: 1 })
  assert.equal(state.users[0].token_version, 1)
  assert.equal(state.sessions.every(s => s.revoked_at), true)
  await users.update(user.id, { realName: user.real_name, isActive: true }, { userId: 42, roleId: 1 })
  await assert.rejects(auth.refreshAccessToken(first.refreshToken), e => e.code === 'AUTH_REFRESH_INVALID')
})
test('unknown, disabled and wrong-password login share response and one cost-10 password check', async () => {
  const compare = bcrypt.compare; const checks = []
  bcrypt.compare = async (...args) => { checks.push(bcrypt.getRounds(args[1])); return compare(...args) }
  try {
    const errors = []
    for (const [username, password, active] of [['unknown-fixture', 'bad', 1], [user.username, 'fixture-password', 0], [user.username, 'bad', 1]]) {
      state.users[0].is_active = active
      try { await auth.login(username, password); assert.fail('login unexpectedly succeeded') } catch (e) { errors.push({ code: e.code, status: e.statusCode, message: e.message }) }
    }
    assert.deepEqual(errors, Array(3).fill({ code: 'AUTH_INVALID_CREDENTIALS', status: 401, message: '账号或密码错误' }))
    assert.deepEqual(checks, [10, 10, 10])
  } finally { bcrypt.compare = compare }
})
test('a signed ancestor removed by retention still revokes its live descendant family', async () => {
  const first = await auth.login(user.username, 'fixture-password')
  const next = await auth.refreshAccessToken(first.refreshToken)
  state.sessions = state.sessions.filter(s => !s.revoked_at)
  await assert.rejects(auth.refreshAccessToken(first.refreshToken), e => e.code === 'AUTH_REFRESH_REPLAY')
  await assert.rejects(auth.refreshAccessToken(next.refreshToken), e => e.code === 'AUTH_REFRESH_INVALID')
})
