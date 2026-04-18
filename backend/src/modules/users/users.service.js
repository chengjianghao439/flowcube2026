const bcrypt = require('bcryptjs')
const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')

async function findAll({ page = 1, pageSize = 20, keyword = '' }) {
  const offset = (page - 1) * pageSize
  const like = `%${keyword}%`

  const [rows] = await pool.query(
    `SELECT id, username, real_name, role_id, role_name, is_active, created_at
     FROM sys_users
     WHERE deleted_at IS NULL
       AND (username LIKE ? OR real_name LIKE ?)
     ORDER BY created_at DESC
     LIMIT ? OFFSET ?`,
    [like, like, pageSize, offset],
  )

  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) AS total FROM sys_users
     WHERE deleted_at IS NULL AND (username LIKE ? OR real_name LIKE ?)`,
    [like, like],
  )

  return {
    list: rows.map((u) => ({
      id: u.id,
      username: u.username,
      realName: u.real_name,
      roleId: u.role_id,
      roleName: u.role_name,
      isActive: !!u.is_active,
      createdAt: u.created_at,
    })),
    pagination: { page, pageSize, total },
  }
}

async function findById(id) {
  const [rows] = await pool.query(
    `SELECT id, username, real_name, role_id, role_name, is_active
     FROM sys_users WHERE id = ? AND deleted_at IS NULL`,
    [id],
  )
  const user = rows[0]
  if (!user) throw new AppError('用户不存在', 404)
  return {
    id: user.id,
    username: user.username,
    realName: user.real_name,
    roleId: user.role_id,
    roleName: user.role_name,
    isActive: !!user.is_active,
  }
}

async function resolveRoleName(roleId) {
  try {
    const [[role]] = await pool.query(
      'SELECT name FROM sys_roles WHERE id=? LIMIT 1',
      [roleId],
    )
    if (role?.name) return role.name
  } catch (error) {
    if (!error || error.code !== 'ER_NO_SUCH_TABLE') throw error
  }

  const ROLE_NAMES = {
    1: '管理员',
    2: '仓库管理员',
    3: '采购员',
    4: '销售员',
    5: '只读用户',
  }
  return ROLE_NAMES[roleId] ?? '普通用户'
}

async function create({ username, password, realName, roleId }) {
  const [exists] = await pool.query(
    'SELECT id FROM sys_users WHERE username = ? AND deleted_at IS NULL',
    [username],
  )
  if (exists.length > 0) throw new AppError('账号已存在', 400)

  const roleName = await resolveRoleName(roleId)
  const hashed = await bcrypt.hash(password, 10)

  const [result] = await pool.query(
    `INSERT INTO sys_users (username, password, real_name, role_id, role_name)
     VALUES (?, ?, ?, ?, ?)`,
    [username, hashed, realName, roleId, roleName],
  )
  return { id: result.insertId }
}

async function update(id, { realName, roleId, isActive }) {
  const user = await findById(id)
  const roleName = roleId !== undefined ? await resolveRoleName(roleId) : user.roleName

  await pool.query(
    `UPDATE sys_users SET real_name = ?, role_id = ?, role_name = ?, is_active = ?
     WHERE id = ? AND deleted_at IS NULL`,
    [realName, roleId, roleName, isActive ? 1 : 0, id],
  )
}

async function resetPassword(id, newPassword) {
  await findById(id)
  const hashed = await bcrypt.hash(newPassword, 10)
  await pool.query(
    'UPDATE sys_users SET password = ? WHERE id = ? AND deleted_at IS NULL',
    [hashed, id],
  )
}

async function softDelete(id, currentUserId) {
  if (id === currentUserId) throw new AppError('不能删除自己的账号', 400)
  await findById(id)
  await pool.query(
    'UPDATE sys_users SET deleted_at = NOW() WHERE id = ? AND deleted_at IS NULL',
    [id],
  )
}

module.exports = { findAll, findById, create, update, resetPassword, softDelete }
