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

  const token = jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN,
  })

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
 * 在 Token 仍有效时签发新 Token，供打印客户端等长期进程续期。
 */
async function refreshAccessToken(userId) {
  const user = await getCurrentAuthUser(userId)
  const payload = buildAccessTokenPayload(user)

  const token = jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN,
  })

  await recordAuthAudit({
    eventType: AUTH_AUDIT_EVENT.TOKEN_REFRESHED,
    title: '访问令牌已刷新',
    description: '刷新访问令牌成功',
    userId: user.id,
    username: user.username,
    payload: { roleId: user.role_id },
  })

  return { token }
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

module.exports = { login, getMe, refreshAccessToken, changePassword }
