const bcrypt = require('bcryptjs')
const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const { normalizePagination } = require('../../utils/pagination')

// roleId=1 是超管，跳过全部权限校验（前后端都是）。允许创建/改到超管的唯一入口是
// 调用方自己就是超管——否则任何一个有 user.create / user.update 权限的普通角色
// 都能把自己的账号（或同伙的）提到超管，等于绕开整个权限体系。
function assertCanAssignRole(operator, targetRoleId) {
  if (Number(targetRoleId) !== 1) return
  if (Number(operator?.roleId) === 1) return
  throw new AppError('只有超级管理员可以授予或变更为超级管理员角色', 403, 'ROLE_ASSIGN_DENIED')
}

// 「允许自行审批」豁免的是全站审批内控（申请人不得批自己的单），与角色授予同属提权动作：
// 不锁死的话，任何持 user.update 权限的人都能给自己开这个开关，等于单方面取消内控。
// 未传该字段 = 不改动（普通管理员照常编辑姓名/部门等，不会被这道校验挡住）。
function assertCanGrantSelfApprove(operator, value) {
  if (value === undefined) return
  if (Number(operator?.roleId) === 1) return
  throw new AppError('只有超级管理员可以设置「允许自行审批」', 403, 'SELF_APPROVE_GRANT_DENIED')
}

async function findAll({ page = 1, pageSize = 20, keyword = '' }) {
  // clamp：防止 pageSize=99999 全表拉取（此前手写 offset 无上限）
  const { pageSize: ps, offset } = normalizePagination({ page, pageSize })
  const like = `%${keyword}%`

  const [rows] = await pool.query(
    `SELECT u.id, u.username, u.real_name, u.role_id, u.role_name, u.is_active, u.allow_self_approve,
            u.department_id, d.name AS department_name, u.created_at
     FROM sys_users u
     LEFT JOIN sys_departments d ON d.id = u.department_id AND d.deleted_at IS NULL
     WHERE u.deleted_at IS NULL
       AND (u.username LIKE ? OR u.real_name LIKE ?)
     ORDER BY u.created_at DESC
     LIMIT ? OFFSET ?`,
    [like, like, ps, offset],
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
      allowSelfApprove: !!u.allow_self_approve,
      departmentId: u.department_id != null ? Number(u.department_id) : null,
      departmentName: u.department_name || null,
      createdAt: u.created_at,
    })),
    pagination: { page, pageSize: ps, total },
  }
}

/** 精简用户列表：仅供下拉选择（如采购单"经办人"筛选），不受 user.view 权限限制
 *  包含已禁用用户（历史单据仍需按其筛选），当前登录用户排最前，其余按姓名排序 */
async function listOptions(currentUserId = null) {
  const [rows] = await pool.query(
    `SELECT id, real_name, is_active FROM sys_users
     WHERE deleted_at IS NULL
     ORDER BY (id = ?) DESC, is_active DESC, real_name ASC`,
    [currentUserId],
  )
  return rows.map((u) => ({ id: u.id, realName: u.real_name, isActive: !!u.is_active }))
}

async function findById(id) {
  const [rows] = await pool.query(
    `SELECT u.id, u.username, u.real_name, u.role_id, u.role_name, u.is_active, u.allow_self_approve,
            u.department_id, d.name AS department_name
     FROM sys_users u
     LEFT JOIN sys_departments d ON d.id = u.department_id AND d.deleted_at IS NULL
     WHERE u.id = ? AND u.deleted_at IS NULL`,
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
    allowSelfApprove: !!user.allow_self_approve,
    departmentId: user.department_id != null ? Number(user.department_id) : null,
    departmentName: user.department_name || null,
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

async function create({ username, password, realName, roleId, departmentId = null }, operator = null) {
  assertCanAssignRole(operator, roleId)
  const [exists] = await pool.query(
    'SELECT id FROM sys_users WHERE username = ? AND deleted_at IS NULL',
    [username],
  )
  if (exists.length > 0) throw new AppError('账号已存在', 400)

  const roleName = await resolveRoleName(roleId)
  const hashed = await bcrypt.hash(password, 10)
  if (departmentId) await assertDepartmentExists(departmentId)

  const [result] = await pool.query(
    `INSERT INTO sys_users (username, password, real_name, role_id, role_name, department_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [username, hashed, realName, roleId, roleName, departmentId || null],
  )
  return { id: result.insertId }
}

async function update(id, { realName, roleId, isActive, departmentId, allowSelfApprove }, operator = null) {
  assertCanAssignRole(operator, roleId)
  assertCanGrantSelfApprove(operator, allowSelfApprove)
  const user = await findById(id)
  // roleId 可省略（编辑超管账号时不传）；省略则保持原角色不动
  const finalRoleId = roleId !== undefined ? roleId : user.roleId
  const roleName = roleId !== undefined ? await resolveRoleName(roleId) : user.roleName
  const finalDeptId = departmentId !== undefined ? departmentId : (user.departmentId ?? null)
  const finalSelfApprove = allowSelfApprove !== undefined ? (allowSelfApprove ? 1 : 0) : (user.allowSelfApprove ? 1 : 0)
  if (finalDeptId) await assertDepartmentExists(finalDeptId)

  await pool.query(
    `UPDATE sys_users SET real_name = ?, role_id = ?, role_name = ?, is_active = ?, department_id = ?, allow_self_approve = ?
     WHERE id = ? AND deleted_at IS NULL`,
    [realName, finalRoleId, roleName, isActive ? 1 : 0, finalDeptId || null, finalSelfApprove, id],
  )
}

async function assertDepartmentExists(departmentId) {
  const [[d]] = await pool.query('SELECT id FROM sys_departments WHERE id=? AND deleted_at IS NULL', [Number(departmentId)])
  if (!d) throw new AppError('部门不存在', 400)
}

async function resetPassword(id, newPassword) {
  await findById(id)
  const hashed = await bcrypt.hash(newPassword, 10)
  await pool.query(
    `UPDATE sys_users
        SET password = ?,
            token_version = COALESCE(token_version, 0) + 1
      WHERE id = ? AND deleted_at IS NULL`,
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

/** 用户仓库数据权限（user_warehouse_scope）：空数组=清空(不限仓) */
async function getWarehouseScope(userId) {
  const [rows] = await pool.query(
    `SELECT s.warehouse_id, w.name AS warehouse_name
     FROM user_warehouse_scope s
     JOIN inventory_warehouses w ON w.id = s.warehouse_id AND w.deleted_at IS NULL
     WHERE s.user_id = ?`,
    [userId],
  )
  return rows.map(r => ({ warehouseId: Number(r.warehouse_id), warehouseName: r.warehouse_name }))
}

async function setWarehouseScope(userId, warehouseIds) {
  await findById(userId)
  const ids = [...new Set((warehouseIds || []).map(Number).filter(n => Number.isFinite(n) && n > 0))]
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    await conn.query('DELETE FROM user_warehouse_scope WHERE user_id = ?', [userId])
    for (const wid of ids) {
      await conn.query('INSERT INTO user_warehouse_scope (user_id, warehouse_id) VALUES (?, ?)', [userId, wid])
    }
    await conn.commit()
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }
  require('../../utils/warehouseScope').clearScopeCache(userId)
  return { userId: Number(userId), warehouseIds: ids }
}

module.exports = { findAll, listOptions, findById, create, update, resetPassword, softDelete, getWarehouseScope, setWarehouseScope }
