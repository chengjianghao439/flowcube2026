const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')
const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const { env } = require('../../config/env')
const { getCurrentAuthUser, buildAccessTokenPayload } = require('./currentAuthUser')
const { recordAuthAudit, AUTH_AUDIT_EVENT } = require('./auth-audit.service')

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
  // refresh token（长期 + 一次性轮换）：30 天默认；携带 tokenType='refresh' 与
  // refreshVersion（= 用户 token_version），refresh 时递增 token_version 使旧
  // refresh 立即失效——被泄露的 refresh 重放即被拒
  const refreshToken = jwt.sign(
    { ...payload, tokenType: 'refresh', refreshVersion: Number(payload.tokenVersion) },
    env.JWT_SECRET,
    { expiresIn: env.JWT_REFRESH_EXPIRES_IN },
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
 * 用 refresh token 换新 access + 新 refresh（2026-08-21 权衡修复）。
 *
 * 安全边界：
 * - refresh token 带 tokenType='refresh'，authMiddleware 拒绝用它访问业务接口
 *   （refresh 只能调 /auth/refresh 换 access，不能直接读数据）
 * - tokenVersion 校验：用户改密码/被禁用（token_version 递增）后，旧 refresh
 *   立即失效——「无限续期」被切断
 * - 每次刷新签发新 refresh（轮换），access 保持 2h 短窗口
 */
async function refreshAccessToken(rawRefreshToken) {
  const tokenStr = String(rawRefreshToken || '')
  if (!tokenStr) throw new AppError('缺少 refresh token', 400, 'AUTH_REFRESH_REQUIRED')

  let decoded
  try {
    decoded = jwt.verify(tokenStr, env.JWT_SECRET)
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

  const payload = buildAccessTokenPayload(user)
  const token = jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: env.JWT_ACCESS_EXPIRES_IN,
  })
  const refreshToken = jwt.sign(
    { ...payload, tokenType: 'refresh', refreshVersion: Number(payload.tokenVersion) },
    env.JWT_SECRET,
    { expiresIn: env.JWT_REFRESH_EXPIRES_IN },
  )

  await recordAuthAudit({
    eventType: AUTH_AUDIT_EVENT.TOKEN_REFRESHED,
    title: '访问令牌已刷新',
    description: '刷新访问令牌成功',
    userId: user.id,
    username: user.username,
    payload: { roleId: user.role_id },
  })

  return { token, refreshToken }
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

module.exports = { login, getMe, refreshAccessToken, changePassword, updateProfile }
