const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')
const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')

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
    throw new AppError('账号或密码错误', 401)
  }

  if (!user.is_active) {
    throw new AppError('账号已被禁用，请联系管理员', 403)
  }

  const isMatch = await bcrypt.compare(password, user.password)
  if (!isMatch) {
    throw new AppError('账号或密码错误', 401)
  }

  const payload = {
    userId: user.id,
    roleId: user.role_id,
  }

  const token = jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  })

  const permissions = await listRolePermissions(user.role_id)

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
  const [rows] = await pool.query(
    'SELECT id, username, real_name, role_id, role_name, avatar FROM sys_users WHERE id = ? AND deleted_at IS NULL',
    [userId],
  )

  const user = rows[0]
  if (!user) {
    throw new AppError('用户不存在', 404)
  }

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
  const [rows] = await pool.query(
    'SELECT id, role_id, is_active FROM sys_users WHERE id = ? AND deleted_at IS NULL',
    [userId],
  )
  const user = rows[0]
  if (!user) {
    throw new AppError('用户不存在', 404)
  }
  if (!user.is_active) {
    throw new AppError('账号已被禁用，请联系管理员', 403)
  }

  const payload = {
    userId: user.id,
    roleId: user.role_id,
  }

  const token = jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  })

  return { token }
}

module.exports = { login, getMe, refreshAccessToken }
