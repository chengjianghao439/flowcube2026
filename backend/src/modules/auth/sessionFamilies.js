const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
function validFamilyId(value) { return typeof value === 'string' && UUID.test(value) }

async function assertActiveFamily(userId, familyId, db = pool, lock = false) {
  if (!validFamilyId(familyId)) throw new AppError('登录状态已升级，请重新登录', 401, 'AUTH_SESSION_INVALID')
  const [[family]] = await db.query(
    `SELECT family_id FROM auth_session_families
      WHERE family_id = ? AND user_id = ? AND revoked_at IS NULL${lock ? ' FOR UPDATE' : ''}`,
    [familyId, userId],
  )
  if (!family) throw new AppError('登录状态已失效，请重新登录', 401, 'AUTH_SESSION_INVALID')
}

async function revokeFamily(conn, userId, familyId) {
  await conn.query('UPDATE auth_session_families SET revoked_at = NOW() WHERE family_id = ? AND user_id = ? AND revoked_at IS NULL', [familyId, userId])
  await conn.query('UPDATE refresh_token_sessions SET revoked_at = NOW() WHERE family_id = ? AND user_id = ? AND revoked_at IS NULL', [familyId, userId])
}

async function revokeAllFamilies(conn, userId) {
  await conn.query('UPDATE auth_session_families SET revoked_at = NOW() WHERE user_id = ? AND revoked_at IS NULL', [userId])
  await conn.query('UPDATE refresh_token_sessions SET revoked_at = NOW() WHERE user_id = ? AND revoked_at IS NULL', [userId])
}

async function cleanupSessionFamilies(db = pool) {
  // Retain a family while any ancestor/descendant row remains, even a revoked one.
  await db.query(`DELETE f FROM auth_session_families f
    WHERE f.created_at < DATE_SUB(NOW(), INTERVAL 7 DAY)
      AND NOT EXISTS (SELECT 1 FROM refresh_token_sessions s WHERE s.family_id = f.family_id)`)
}

module.exports = { validFamilyId, assertActiveFamily, revokeFamily, revokeAllFamilies, cleanupSessionFamilies }
