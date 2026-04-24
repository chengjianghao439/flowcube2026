const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const { recordAuthAudit, AUTH_AUDIT_EVENT } = require('./auth-audit.service')

async function getCurrentAuthUser(userId, options = {}) {
  const { allowInactive = false } = options
  const [[user]] = await pool.query(
    `SELECT id, username, real_name, role_id, role_name, avatar, is_active, token_version
       FROM sys_users
      WHERE id = ? AND deleted_at IS NULL`,
    [userId],
  )

  if (!user) {
    throw new AppError('用户不存在或已被删除，请重新登录', 401, 'AUTH_USER_NOT_FOUND')
  }

  if (!allowInactive && !user.is_active) {
    void recordAuthAudit({
      eventType: AUTH_AUDIT_EVENT.INACTIVE_USER_DENIED,
      title: '禁用账号访问被拒绝',
      description: '禁用用户尝试访问受保护资源',
      userId: user.id,
      username: user.username,
      payload: { roleId: user.role_id },
    })
    throw new AppError('账号已被禁用，请重新登录', 401, 'AUTH_USER_DISABLED')
  }

  return user
}

function buildAccessTokenPayload(user) {
  return {
    userId: user.id,
    roleId: user.role_id,
    tokenVersion: Number(user.token_version || 0),
  }
}

module.exports = { getCurrentAuthUser, buildAccessTokenPayload }
