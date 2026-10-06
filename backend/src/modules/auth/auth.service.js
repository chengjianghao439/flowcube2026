const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')
const crypto = require('crypto')
const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const logger = require('../../utils/logger')
const { env } = require('../../config/env')
const { getCurrentAuthUser, buildAccessTokenPayload } = require('./currentAuthUser')
const { recordAuthAudit, AUTH_AUDIT_EVENT } = require('./auth-audit.service')
const { validFamilyId, assertActiveFamily, revokeFamily, revokeAllFamilies } = require('./sessionFamilies')
// A fixed cost-10 dummy hash makes unknown accounts do the same password work.
const DUMMY_PASSWORD_HASH = '$2b$10$7EqJtq98hPqEX7fNZaFWoO5Kx5LrmM1lkJg.IaTZSmBDnpdEyfzvi'

/**
 * 签发一个 refresh token 并落库一条会话记录（jti 一次性轮换，迁移 221）。
 * 返回 { jti, refreshToken, expiresAt }，expiresAt 取 JWT 解码后的 exp（秒），
 * 落库时用 FROM_UNIXTIME 由 MySQL 按会话时区（+08:00）转 DATETIME，与 NOW() 同基准。
 */
function issueRefreshToken(user, familyId) {
  const jti = crypto.randomUUID()
  const payload = buildAccessTokenPayload(user)
  const refreshToken = jwt.sign(
    { ...payload, tokenType: 'refresh', jti, familyId },
    env.JWT_SECRET,
    { expiresIn: env.JWT_REFRESH_EXPIRES_IN },
  )
  const decoded = jwt.decode(refreshToken)
  return { jti, refreshToken, expiresAt: Number(decoded.exp) }
}

function verifySignedToken(tokenStr) {
  try {
    return jwt.verify(tokenStr, env.JWT_SECRET)
  } catch (firstErr) {
    if (!env.JWT_SECRET_PREVIOUS) throw firstErr
    return jwt.verify(tokenStr, env.JWT_SECRET_PREVIOUS)
  }
}

/**
 * 原子作废一个 jti：仅当该 jti 尚未作废且未过期时才成功（affectedRows=1）。
 * 这是「一次性轮换」的核心——同一 refresh token 重放时第二次调用 affectedRows=0，被拒。
 */
async function revokeJti(conn, jti) {
  const [r] = await conn.query(
    'UPDATE refresh_token_sessions SET revoked_at = NOW() WHERE jti = ? AND revoked_at IS NULL AND expires_at > NOW()',
    [jti],
  )
  return r.affectedRows === 1
}

async function listRolePermissions(roleId) {
  try {
    const [rows] = await pool.query(
      'SELECT permission FROM sys_role_permissions WHERE role_id=? ORDER BY permission ASC',
      [roleId],
    )
    return rows.map((row) => row.permission)
  } catch (error) {
    if (error && error.code === 'ER_NO_SUCH_TABLE') return []
    throw error
  }
}

async function login(username, password) {
  const [rows] = await pool.query(
    'SELECT * FROM sys_users WHERE username = ? AND deleted_at IS NULL',
    [username],
  )

  const candidate = rows[0]
  const isMatch = await bcrypt.compare(password, candidate?.password || DUMMY_PASSWORD_HASH)
  if (!candidate || !candidate.is_active || !isMatch) {
    await recordAuthAudit({
      eventType: candidate && !candidate.is_active ? AUTH_AUDIT_EVENT.INACTIVE_USER_DENIED : AUTH_AUDIT_EVENT.LOGIN_FAILED,
      title: '登录失败', description: '账号不存在、不可用或密码错误',
      userId: candidate?.id ?? null, username,
      payload: { reason: !candidate ? 'user_not_found' : !candidate.is_active ? 'inactive_user' : 'password_mismatch' },
    })
    throw new AppError('账号或密码错误', 401, 'AUTH_INVALID_CREDENTIALS')
  }

  // Lock user first, as refresh/logout/disable do: a concurrent disable or password
  // reset cannot mint a session from the password snapshot checked above.
  const conn = await pool.getConnection()
  let user, token, refreshToken
  try {
    await conn.beginTransaction()
    const [[locked]] = await conn.query('SELECT * FROM sys_users WHERE id = ? AND deleted_at IS NULL FOR UPDATE', [candidate.id])
    if (!locked?.is_active || locked.password !== candidate.password) {
      throw new AppError('账号或密码错误', 401, 'AUTH_INVALID_CREDENTIALS')
    }
    user = locked
    const familyId = crypto.randomUUID()
    token = jwt.sign({ ...buildAccessTokenPayload(user), familyId }, env.JWT_SECRET, { expiresIn: env.JWT_ACCESS_EXPIRES_IN })
    const issued = issueRefreshToken(user, familyId)
    refreshToken = issued.refreshToken
    await conn.query('INSERT INTO auth_session_families (family_id, user_id) VALUES (?, ?)', [familyId, user.id])
    await conn.query(
      'INSERT INTO refresh_token_sessions (jti, user_id, family_id, expires_at) VALUES (?, ?, ?, FROM_UNIXTIME(?))',
      [issued.jti, user.id, familyId, issued.expiresAt],
    )
    await conn.commit()
  } catch (error) {
    await conn.rollback()
    throw error
  } finally { conn.release() }

  const permissions = await listRolePermissions(user.role_id)

  await recordAuthAudit({
    eventType: AUTH_AUDIT_EVENT.LOGIN_SUCCESS,
    title: '登录成功',
    description: '用户成功登录系统',
    userId: user.id,
    username: user.username,
    payload: {
      roleId: user.role_id,
      permissionCount: permissions.length,
    },
  })

  return {
    token,
    refreshToken,
    user: {
      id: user.id,
      username: user.username,
      realName: user.real_name,
      roleId: user.role_id,
      roleName: user.role_name,
      avatar: user.avatar,
      permissions,
    },
  }
}

async function getMe(userId) {
  const user = await getCurrentAuthUser(userId)

  const permissions = await listRolePermissions(user.role_id)
  return {
    id: user.id,
    username: user.username,
    realName: user.real_name,
    roleId: user.role_id,
    roleName: user.role_name,
    avatar: user.avatar,
    permissions,
  }
}

/**
 * 用 refresh token 换新 access + 新 refresh（一次性轮换，迁移 221）。
 *
 * 安全边界：
 * - refresh token 带 tokenType='refresh'，authMiddleware 拒绝用它访问业务接口
 *   （refresh 只能调 /auth/refresh 换 access，不能直接读数据）
 * - tokenVersion 校验：用户改密码/被禁用（token_version 递增）后，旧 refresh 立即失效
 * - **一次性轮换**：refresh 携带 jti，落库 refresh_token_sessions；刷新时在同一事务里
 *   先原子作废旧 jti（UPDATE ... WHERE revoked_at IS NULL），affectedRows=0 即说明该
 *   refresh 已被用过或祖先记录被清理 → 提交撤销整个 family 后拒绝重放。
 * - familyId 在 access/refresh 中一致；退出或重放后 access 也立即失效，其他设备不受影响。
 * - 每次刷新签发新 refresh（轮换），access 保持 2h 短窗口
 */
async function refreshAccessToken(rawRefreshToken) {
  const tokenStr = String(rawRefreshToken || '')
  if (!tokenStr) throw new AppError('缺少 refresh token', 400, 'AUTH_REFRESH_REQUIRED')

  let decoded
  try {
    decoded = verifySignedToken(tokenStr)
  } catch {
    throw new AppError('refresh token 无效或已过期，请重新登录', 401, 'AUTH_REFRESH_INVALID')
  }
  if (decoded.tokenType !== 'refresh') {
    throw new AppError('该令牌不是 refresh token', 401, 'AUTH_REFRESH_INVALID')
  }
  // 迁移前的无 jti 令牌无法被一次性作废。必须重登，不能允许它在有效期内无限换票。
  if (!decoded.jti) {
    throw new AppError('登录状态已升级，请重新登录', 401, 'AUTH_REFRESH_INVALID')
  }

  if (!validFamilyId(decoded.familyId)) {
    throw new AppError('登录状态已升级，请重新登录', 401, 'AUTH_REFRESH_INVALID')
  }
  const conn = await pool.getConnection()
  let committed = false
  try {
    await conn.beginTransaction()
    const [[user]] = await conn.query('SELECT * FROM sys_users WHERE id = ? AND deleted_at IS NULL FOR UPDATE', [decoded.userId])
    if (!user?.is_active || Number(decoded.tokenVersion) !== Number(user.token_version || 0)) {
      throw new AppError('登录状态已失效，请重新登录', 401, 'AUTH_REFRESH_INVALID')
    }
    try { await assertActiveFamily(user.id, decoded.familyId, conn, true) }
    catch (e) { if (e instanceof AppError) throw new AppError('登录状态已失效，请重新登录', 401, 'AUTH_REFRESH_INVALID'); throw e }
    const [[session]] = await conn.query('SELECT family_id, revoked_at, expires_at FROM refresh_token_sessions WHERE jti = ? AND user_id = ? FOR UPDATE', [decoded.jti, user.id])
    if (session && session.family_id !== decoded.familyId) {
      throw new AppError('refresh token 无效，请重新登录', 401, 'AUTH_REFRESH_INVALID')
    }
    if (!session || !await revokeJti(conn, decoded.jti)) {
      // Persist the security consequence before rejecting replay. Rolling back this
      // branch would leave the already-issued descendant usable by the attacker.
      await revokeFamily(conn, user.id, decoded.familyId)
      await conn.commit()
      committed = true
      try {
        await recordAuthAudit({
          eventType: AUTH_AUDIT_EVENT.REFRESH_REPLAY_DETECTED,
          title: '刷新令牌重放已撤销会话', description: '旧刷新令牌再次使用，已撤销同族访问和刷新令牌',
          userId: user.id, username: user.username,
          payload: { familyId: decoded.familyId, reason: session ? 'rotated_token' : 'retained_ancestor_missing' },
        })
      } catch (auditError) {
        // Revocation is committed; an audit failure cannot replace the replay 401.
        logger.error('重放撤销后的安全审计失败', auditError, { userId: user.id }, 'AUTH_AUDIT')
      }
      throw new AppError('该 refresh token 已被使用，请重新登录', 401, 'AUTH_REFRESH_REPLAY')
    }
    const token = jwt.sign({ ...buildAccessTokenPayload(user), familyId: decoded.familyId }, env.JWT_SECRET, { expiresIn: env.JWT_ACCESS_EXPIRES_IN })
    const { jti, refreshToken, expiresAt } = issueRefreshToken(user, decoded.familyId)
    await conn.query(
      'INSERT INTO refresh_token_sessions (jti, user_id, family_id, expires_at) VALUES (?, ?, ?, FROM_UNIXTIME(?))',
      [jti, user.id, decoded.familyId, expiresAt],
    )
    await conn.commit()
    committed = true
    await recordAuthAudit({ eventType: AUTH_AUDIT_EVENT.TOKEN_REFRESHED, title: '访问令牌已刷新', description: '刷新访问令牌成功', userId: user.id, username: user.username, payload: { roleId: user.role_id } })
    return { token, refreshToken }
  } catch (e) {
    if (!committed) await conn.rollback()
    throw e
  } finally { conn.release() }
}

/**
 * 登出：签名有效且与当前启用用户版本、活跃族匹配的 refresh 可退出同族。
 * 已轮换或清理的祖先仍能退出，防止前端在续期竞态中捕获旧票据后留下子代。
 * 已撤销族、无效/过期 token 静默成功返回 null，不用请求体账号回填日志。
 */
async function logout(rawRefreshToken) {
  const tokenStr = String(rawRefreshToken || '')
  if (!tokenStr) return null
  let decoded
  try {
    decoded = verifySignedToken(tokenStr)
  } catch {
    return null
  }
  if (decoded.tokenType !== 'refresh' || typeof decoded.jti !== 'string' || !decoded.jti || !validFamilyId(decoded.familyId)) return null
  const userId = Number(decoded.userId)
  const tokenVersion = Number(decoded.tokenVersion)
  if (!Number.isSafeInteger(userId) || userId <= 0 || !Number.isSafeInteger(tokenVersion)) return null
  const conn = await pool.getConnection()
  let actor = null
  try {
    await conn.beginTransaction()
    const [[user]] = await conn.query('SELECT * FROM sys_users WHERE id = ? AND deleted_at IS NULL FOR UPDATE', [userId])
    if (user?.is_active && tokenVersion === Number(user.token_version || 0)) {
      let active = false
      try { await assertActiveFamily(userId, decoded.familyId, conn, true); active = true }
      catch (error) { if (!(error instanceof AppError)) throw error }
      if (active) {
        const [[session]] = await conn.query('SELECT family_id FROM refresh_token_sessions WHERE jti = ? AND user_id = ? FOR UPDATE', [decoded.jti, userId])
        // Signature/expiry, user epoch and owned active family are authoritative.
        // A retained row must agree; a missing signed ancestor is still trusted.
        if (!session || session.family_id === decoded.familyId) {
          await revokeFamily(conn, userId, decoded.familyId)
          actor = { userId: user.id, username: user.username, realName: user.real_name }
        }
      }
    }
    await conn.commit()
  } catch (error) {
    await conn.rollback()
    throw error
  } finally { conn.release() }

  if (actor) {
    await recordAuthAudit({
      eventType: AUTH_AUDIT_EVENT.LOGOUT_SUCCESS,
      title: '退出登录',
      description: '有效会话已退出登录',
      userId: actor.userId,
      username: actor.username,
    })
  }
  return actor
}

async function changePassword(userId, oldPassword, newPassword) {
  const hash = await bcrypt.hash(newPassword, 10)
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const [[user]] = await conn.query(
      'SELECT id, password FROM sys_users WHERE id=? AND deleted_at IS NULL FOR UPDATE',
      [userId],
    )
    if (!user) throw new AppError('用户不存在', 404, 'USER_NOT_FOUND')
    if (!await bcrypt.compare(oldPassword, user.password)) {
      throw new AppError('旧密码错误', 400, 'AUTH_OLD_PASSWORD_INVALID')
    }
    await conn.query(
      `UPDATE sys_users
          SET password = ?, token_version = COALESCE(token_version, 0) + 1
        WHERE id = ? AND deleted_at IS NULL`,
      [hash, userId],
    )
    await revokeAllFamilies(conn, userId)
    await conn.commit()
  } catch (error) {
    await conn.rollback()
    throw error
  } finally {
    conn.release()
  }
}

/** 修改个人资料（真实姓名）——原 auth.routes 路由层直写 SQL，收编进 service（2026-08-22） */
async function updateProfile(userId, { realName }) {
  const [[user]] = await pool.query(
    'SELECT id FROM sys_users WHERE id=? AND deleted_at IS NULL',
    [userId],
  )
  if (!user) throw new AppError('用户不存在', 404, 'USER_NOT_FOUND')
  await pool.query('UPDATE sys_users SET real_name=? WHERE id=?', [String(realName).trim(), userId])
}

module.exports = { login, getMe, refreshAccessToken, logout, changePassword, updateProfile }
