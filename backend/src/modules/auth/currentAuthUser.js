const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')

async function getCurrentAuthUser(userId, options = {}) {
  const { allowInactive = false } = options
  const [[user]] = await pool.query(
    `SELECT id, username, real_name, role_id, role_name, avatar, is_active
       FROM sys_users
      WHERE id = ? AND deleted_at IS NULL`,
    [userId],
  )

  if (!user) {
    throw new AppError('用户不存在或已被删除，请重新登录', 401)
  }

  if (!allowInactive && !user.is_active) {
    throw new AppError('账号已被禁用，请重新登录', 401)
  }

  return user
}

function buildAccessTokenPayload(user) {
  return {
    userId: user.id,
    roleId: user.role_id,
  }
}

module.exports = { getCurrentAuthUser, buildAccessTokenPayload }
