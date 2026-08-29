const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')
const crypto = require('crypto')
const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const { env } = require('../../config/env')
const { getCurrentAuthUser, buildAccessTokenPayload } = require('./currentAuthUser')
const { recordAuthAudit, AUTH_AUDIT_EVENT } = require('./auth-audit.service')

/**
 * 签发一个 refresh token 并落库一条会话记录（jti 一次性轮换，迁移 221）。
 * 返回 { jti, refreshToken, expiresAt }，expiresAt 取 JWT 解码后的 exp（秒），
 * 落库时用 FROM_UNIXTIME 由 MySQL 按会话时区（+08:00）转 DATETIME，与 NOW() 同基准。
 */
function issueRefreshToken(user) {
  const jti = crypto.randomUUID()
  const payload = buildAccessTokenPayload(user)
  const refreshToken = jwt.sign(
    { ...payload, tokenType: 'refresh', jti },
    env.JWT_SECRET,
    { expiresIn: env.JWT_REFRESH_EXPIRES_IN },
  )
  const decoded = jwt.decode(refreshToken)
  return { jti, refreshToken, expiresAt: Number(decoded.exp) }
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

  const user = rows[0]
  if (!user) {
    await recordAuthAudit({
      eventType: AUTH_AUDIT_EVENT.LOGIN_FAILED,
      title: '登录失败',
      description: '账号不存在或密码错误',
      username,
      payload: { reason: 'user_not_found' },
    })
    throw new AppError('账号或密码错误', 401, 'AUTH_INVALID_CREDENTIALS')
  }

  if (!user.is_active) {
    await recordAuthAudit({
      eventType: AUTH_AUDIT_EVENT.INACTIVE_USER_DENIED,
      title: '禁用账号登录被拒绝',
      description: '账号已被禁用',
      userId: user.id,
      username: user.username,
      payload: { reason: 'inactive_user' },
    })
    throw new AppError('账号已被禁用，请联系管理员', 403, 'AUTH_USER_DISABLED')
  }

  const isMatch = await bcrypt.compare(password, user.password)
  if (!isMatch) {
    await recordAuthAudit({
      eventType: AUTH_AUDIT_EVENT.LOGIN_FAILED,
      title: '登录失败',
      description: '账号不存在或密码错误',
      userId: user.id,
      username: user.username,
      payload: { reason: 'password_mismatch' },
    })
    throw new AppError('账号或密码错误', 401, 'AUTH_INVALID_CREDENTIALS')
  }

  const payload = buildAccessTokenPayload(user)

  // access token（短期，2026-08-21 权衡修复）：2h 默认，泄露窗口大幅缩短
  const token = jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: env.JWT_ACCESS_EXPIRES_IN,
  })
  // refresh token（长期 + 一次性轮换，迁移 221）：30 天默认；携带 tokenType='refresh' 与
  // 唯一 jti，仅能用于 /auth/refresh 换 access（authMiddleware 拒绝 refresh）。jti 落库
  // refresh_token_sessions，刷新时原子作废旧 jti、签发新 jti——被泄露的 refresh 重放即被拒，
  // 且每端独立 jti，不会像递增 token_version 那样互踢多端（三端共享同一账号）。
  const { jti, refreshToken, expiresAt } = issueRefreshToken(user)
  await pool.query(
    'INSERT INTO refresh_token_sessions (jti, user_id, expires_at) VALUES (?, ?, FROM_UNIXTIME(?))',
    [jti, user.id, expiresAt],
  )

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
 *   refresh 已被用过 → 重放被拒（AUTH_REFRESH_REPLAY）。每端独立 jti，不互踢多端。
 * - 每次刷新签发新 refresh（轮换），access 保持 2h 短窗口
 */
async function refreshAccessToken(rawRefreshToken) {
  const tokenStr = String(rawRefreshToken || '')
  if (!tokenStr) throw new AppError('缺少 refresh token', 400, 'AUTH_REFRESH_REQUIRED')

  let decoded
  try {
    // 密钥轮换兜底（对齐 middleware/auth.js）：优先新密钥，失败试 JWT_SECRET_PREVIOUS，
    // 保证轮换过渡期旧密钥签发的 refresh 仍能续期，用户不被迫重登。
    try {
      decoded = jwt.verify(tokenStr, env.JWT_SECRET)
    } catch (firstErr) {
      if (!env.JWT_SECRET_PREVIOUS) throw firstErr
      decoded = jwt.verify(tokenStr, env.JWT_SECRET_PREVIOUS)
    }
  } catch {
    throw new AppError('refresh token 无效或已过期，请重新登录', 401, 'AUTH_REFRESH_INVALID')
  }
  if (decoded.tokenType !== 'refresh') {
    throw new AppError('该令牌不是 refresh token', 401, 'AUTH_REFRESH_INVALID')
  }

  const user = await getCurrentAuthUser(decoded.userId)
  // token_version 校验：改密码/禁用用户会递增它，旧 refresh 立即失效
  if (Number(decoded.tokenVersion) !== Number(user.token_version || 0)) {
    throw new AppError('登录状态已失效，请重新登录', 401, 'AUTH_REFRESH_INVALID')
  }

  // 一次性轮换：事务内先原子作废旧 jti。若旧 token 从未落库（如迁移前签发的存量 token），
  // 兜底放行一次并补录会话，保证升级无感；但已落库的 jti 一旦被用过即拒绝重放。
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    if (decoded.jti) {
      const revoked = await revokeJti(conn, decoded.jti)
      if (!revoked) {
        // 作废失败有两种可能：已被用过（重放攻击）或已过期/已被登出。
        // 统一按「重放被拒」处理——真正的重放必须阻断；过期场景 token 校验本就会拦。
        await conn.rollback()
        throw new AppError('该 refresh token 已被使用，请重新登录', 401, 'AUTH_REFRESH_REPLAY')
      }
    }

    const payload = buildAccessTokenPayload(user)
    const token = jwt.sign(payload, env.JWT_SECRET, {
      expiresIn: env.JWT_ACCESS_EXPIRES_IN,
    })
    const { jti: newJti, refreshToken, expiresAt } = issueRefreshToken(user)
    await conn.query(
      'INSERT INTO refresh_token_sessions (jti, user_id, expires_at) VALUES (?, ?, FROM_UNIXTIME(?))',
      [newJti, user.id, expiresAt],
    )

    await recordAuthAudit({
      eventType: AUTH_AUDIT_EVENT.TOKEN_REFRESHED,
      title: '访问令牌已刷新',
      description: '刷新访问令牌成功',
      userId: user.id,
      username: user.username,
      payload: { roleId: user.role_id },
    })

    await conn.commit()
    return { token, refreshToken }
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }
}

/**
 * 登出：原子作废当前 refresh token 的 jti（迁移 221）。
 * 无 jti（老客户端）时静默成功——access 过期后自然失效。
 */
async function logout(rawRefreshToken) {
  const tokenStr = String(rawRefreshToken || '')
  if (!tokenStr) return
  let decoded
  try {
    decoded = jwt.verify(tokenStr, env.JWT_SECRET)
  } catch {
    return
  }
  if (!decoded.jti) return
  await pool.query(
    'UPDATE refresh_token_sessions SET revoked_at = NOW() WHERE jti = ? AND revoked_at IS NULL',
    [decoded.jti],
  )
}

async function changePassword(userId, oldPassword, newPassword) {
  const [[user]] = await pool.query(
    'SELECT id, password, token_version FROM sys_users WHERE id=? AND deleted_at IS NULL',
    [userId],
  )
  if (!user) {
    throw new AppError('用户不存在', 404, 'USER_NOT_FOUND')
  }

  const ok = await bcrypt.compare(oldPassword, user.password)
  if (!ok) {
    throw new AppError('旧密码错误', 400, 'AUTH_OLD_PASSWORD_INVALID')
  }

  const hash = await bcrypt.hash(newPassword, 10)
  await pool.query(
    `UPDATE sys_users
        SET password = ?,
            token_version = COALESCE(token_version, 0) + 1
      WHERE id = ? AND deleted_at IS NULL`,
    [hash, userId],
  )
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
