'use strict'

// Only synthetic test actors may use this helper. Business suites still pass the
// real auth middleware and current-user lookup; authentication tests use login.
const { randomUUID } = require('node:crypto')
const { validateTestEnvironment } = require('./testEnvironment')
const jwt = require('../../backend/node_modules/jsonwebtoken')
const { buildAccessTokenPayload } = require('../../backend/src/modules/auth/currentAuthUser')
const owned = new WeakMap()

async function issueFixtureAccessToken(pool, userId, options = {}) {
  validateTestEnvironment()
  if (!Number.isSafeInteger(Number(userId)) || Number(userId) <= 0) throw new Error('Fixture actor ID is invalid')
  let actors = owned.get(pool)
  if (!actors) { actors = new Map(); owned.set(pool, actors) }
  if (!actors.has(Number(userId))) {
    actors.set(Number(userId), (async () => {
      const [[user]] = await pool.query('SELECT * FROM sys_users WHERE id=? AND deleted_at IS NULL', [userId])
      if (!user) throw new Error('Fixture actor does not exist')
      const familyId = randomUUID()
      await pool.query('INSERT INTO auth_session_families (family_id,user_id) VALUES (?,?)', [familyId, user.id])
      return { userId: Number(user.id), familyId, payload: buildAccessTokenPayload(user) }
    })())
  }
  const session = await actors.get(Number(userId))
  return jwt.sign({ ...session.payload, familyId: session.familyId }, process.env.JWT_SECRET, { expiresIn: options.expiresIn || '30m' })
}

async function cleanupFixtureSessionFamilies(pool) {
  const actors = owned.get(pool)
  if (!actors) return
  const results = await Promise.allSettled(actors.values())
  let failure
  for (const result of results) {
    if (result.status !== 'fulfilled') { failure ||= result.reason; continue }
    const session = result.value
    try {
      await pool.query('DELETE FROM refresh_token_sessions WHERE family_id=? AND user_id=?', [session.familyId, session.userId])
      await pool.query('DELETE FROM auth_session_families WHERE family_id=? AND user_id=?', [session.familyId, session.userId])
    } catch (error) { failure ||= error }
  }
  owned.delete(pool)
  if (failure) throw failure
}
module.exports = { issueFixtureAccessToken, cleanupFixtureSessionFamilies }
