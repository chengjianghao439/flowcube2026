const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')
const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')

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

  const tenantId = Number(user.tenant_id) >= 0 ? Number(user.tenant_id) : 0
  const payload = {
    userId: user.id,
    roleId: user.role_id,
    tenantId,
  }

  const token = jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
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
      tenantId,
    },
  }
}

async function getMe(userId) {
  const [rows] = await pool.query(
    'SELECT id, username, real_name, role_id, role_name, avatar, tenant_id FROM sys_users WHERE id = ? AND deleted_at IS NULL',
    [userId],
  )

  const user = rows[0]
  if (!user) {
    throw new AppError('用户不存在', 404)
  }

  const tenantId = Number(user.tenant_id) >= 0 ? Number(user.tenant_id) : 0
  return {
    id: user.id,
    username: user.username,
    realName: user.real_name,
    roleId: user.role_id,
    roleName: user.role_name,
    avatar: user.avatar,
    tenantId,
  }
}

/**
 * 在 Token 仍有效时签发新 Token，供打印客户端等长期进程续期。
 */
async function refreshAccessToken(userId) {
  const [rows] = await pool.query(
    'SELECT id, role_id, is_active, tenant_id FROM sys_users WHERE id = ? AND deleted_at IS NULL',
    [userId],
  )
  const user = rows[0]
  if (!user) {
    throw new AppError('用户不存在', 404)
  }
  if (!user.is_active) {
    throw new AppError('账号已被禁用，请联系管理员', 403)
  }

  const tenantId = Number(user.tenant_id) >= 0 ? Number(user.tenant_id) : 0
  const payload = {
    userId: user.id,
    roleId: user.role_id,
    tenantId,
  }

  const token = jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  })

  return { token }
}

module.exports = { login, getMe, refreshAccessToken }
