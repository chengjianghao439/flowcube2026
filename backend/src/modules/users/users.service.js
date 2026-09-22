const bcrypt = require('bcryptjs')
const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const { normalizePagination } = require('../../utils/pagination')

// roleId=1 是超管，跳过全部权限校验（前后端都是）。允许创建/改到超管的唯一入口是
// 调用方自己就是超管——否则任何一个有 user.create / user.update 权限的普通角色
// 都能把自己的账号（或同伙的）提到超管，等于绕开整个权限体系。
async function assertCanAssignRole(operator, targetRoleId, db = pool) {
  if (targetRoleId === undefined) return
  const [[role]] = await db.query('SELECT id FROM sys_roles WHERE id=? FOR UPDATE', [targetRoleId])
  if (!role) throw new AppError('角色不存在，请刷新后重试', 400, 'ROLE_NOT_FOUND')
  if (Number(operator?.roleId) === 1) return
  if (Number(targetRoleId) === 1) throw new AppError('只有超级管理员可以授予管理员角色', 403, 'ROLE_ASSIGN_DENIED')
  const [missing] = await db.query(
    `SELECT permission FROM sys_role_permissions
     WHERE role_id=? AND permission NOT IN (SELECT permission FROM sys_role_permissions WHERE role_id=?) LIMIT 1`,
    [targetRoleId, Number(operator?.roleId) || 0],
  )
  if (missing.length) throw new AppError('不能授予超出自身权限的角色，请联系超级管理员', 403, 'ROLE_ASSIGN_DENIED')
}

async function listAssignableRoles(operator) {
  if (Number(operator?.roleId) === 1) {
    const [rows] = await pool.query('SELECT id,name FROM sys_roles WHERE id<>1 ORDER BY id')
    return rows
  }
  const [allowed] = await pool.query(
    "SELECT permission FROM sys_role_permissions WHERE role_id=? AND permission IN ('user.create','user.update') LIMIT 1", [operator?.roleId],
  )
  if (!allowed.length) throw new AppError('无用户管理权限', 403, 'PERMISSION_DENIED')
  const [rows] = await pool.query(
    `SELECT r.id,r.name FROM sys_roles r WHERE r.id<>1 AND NOT EXISTS (
      SELECT 1 FROM sys_role_permissions target WHERE target.role_id=r.id AND NOT EXISTS (
        SELECT 1 FROM sys_role_permissions actor WHERE actor.role_id=? AND actor.permission=target.permission
      )
    ) ORDER BY r.id`, [operator.roleId],
  )
  return rows
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
     ORDER BY u.created_at DESC, u.id DESC
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

async function resolveRoleName(roleId, db = pool) {
  const [[role]] = await db.query('SELECT name FROM sys_roles WHERE id=?', [roleId])
  if (!role) throw new AppError('角色不存在，请刷新后重试', 400, 'ROLE_NOT_FOUND')
  return role.name
}

async function create({ username, password, realName, roleId, departmentId = null }, operator = null) {
  const hashed = await bcrypt.hash(password, 10)
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const [[actor]] = await conn.query('SELECT role_id,is_active,deleted_at FROM sys_users WHERE id=? FOR UPDATE', [operator?.userId])
    if (!actor || !actor.is_active || actor.deleted_at) throw new AppError('操作人账号不可用', 403, 'USER_OPERATOR_INACTIVE')
    await assertCanAssignRole({ ...operator, roleId: Number(actor.role_id) }, roleId, conn)
    const [exists] = await conn.query('SELECT id FROM sys_users WHERE username=? AND deleted_at IS NULL', [username])
    if (exists.length) throw new AppError('账号已存在', 400)
    const roleName = await resolveRoleName(roleId, conn)
    if (departmentId) await assertDepartmentExists(departmentId, conn)
    const [result] = await conn.query(
      'INSERT INTO sys_users (username,password,real_name,role_id,role_name,department_id) VALUES (?,?,?,?,?,?)',
      [username, hashed, realName, roleId, roleName, departmentId || null],
    )
    // 范围无行代表不限仓：限仓操作人新建账号必须继承范围，不能借新账号绕过限仓。
    if (Number(actor.role_id) !== 1) {
      await conn.query(`INSERT INTO user_warehouse_scope (user_id, warehouse_id)
        SELECT ?, warehouse_id FROM user_warehouse_scope WHERE user_id=?`, [result.insertId, operator.userId])
    }
    await conn.commit()
    return { id: result.insertId }
  } catch (e) { await conn.rollback(); throw e } finally { conn.release() }
}

// 锁定操作人和目标账号后读取真实角色；顺序一致避免双方互相编辑时 ABBA 死锁。
// 不能信任请求开始时缓存的 roleId，也不能在行锁之外先查目标再写密码。
async function withLockedTarget(id, operator, action) {
  const actorId = Number(operator?.userId)
  if (!Number.isInteger(actorId) || actorId <= 0) throw new AppError('缺少有效操作人', 403, 'USER_OPERATOR_REQUIRED')
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const [rows] = await conn.query(
      'SELECT * FROM sys_users WHERE id IN (?, ?) ORDER BY id FOR UPDATE', [actorId, Number(id)],
    )
    const actor = rows.find(u => Number(u.id) === actorId)
    if (!actor || actor.deleted_at || !actor.is_active) throw new AppError('操作人账号不可用，请重新登录', 403, 'USER_OPERATOR_INACTIVE')
    const target = rows.find(u => Number(u.id) === Number(id))
    if (!target || target.deleted_at) throw new AppError('用户不存在', 404)
    if (Number(target.role_id) === 1 && Number(actor.role_id) !== 1) {
      throw new AppError('只有超级管理员可以修改、重置密码或删除超级管理员账号', 403, 'USER_ADMIN_PROTECTED')
    }
    const result = await action(conn, target, { ...operator, roleId: Number(actor.role_id) })
    await conn.commit()
    return result
  } catch (e) { await conn.rollback(); throw e } finally { conn.release() }
}

async function update(id, { realName, roleId, isActive, departmentId, allowSelfApprove }, operator = null) {
  return withLockedTarget(id, operator, async (conn, user, actor) => {
    const changingRole = roleId !== undefined && Number(roleId) !== Number(user.role_id)
    if (changingRole && Number(actor.roleId) !== 1 && Number(actor.userId) === Number(user.id)) {
      throw new AppError('不能修改自己的角色，请联系超级管理员', 403, 'USER_ROLE_SELF_FORBIDDEN')
    }
    if (changingRole) await assertCanAssignRole(actor, roleId, conn)
    assertCanGrantSelfApprove(actor, allowSelfApprove)
    // roleId 可省略（编辑超管账号时不传）；省略则保持锁定读取的原角色。
    const finalRoleId = roleId !== undefined ? roleId : user.role_id
    const roleName = roleId !== undefined ? await resolveRoleName(roleId, conn) : user.role_name
    const finalDeptId = departmentId !== undefined ? departmentId : (user.department_id ?? null)
    const finalSelfApprove = allowSelfApprove !== undefined ? (allowSelfApprove ? 1 : 0) : (user.allow_self_approve ? 1 : 0)
    if (finalDeptId) await assertDepartmentExists(finalDeptId, conn)
    await conn.query(
      `UPDATE sys_users SET real_name = ?, role_id = ?, role_name = ?, is_active = ?, department_id = ?, allow_self_approve = ?
       WHERE id = ? AND deleted_at IS NULL`,
      [realName, finalRoleId, roleName, isActive ? 1 : 0, finalDeptId || null, finalSelfApprove, id],
    )
  })
}

async function assertDepartmentExists(departmentId, db = pool) {
  const [[d]] = await db.query('SELECT id FROM sys_departments WHERE id=? AND deleted_at IS NULL', [Number(departmentId)])
  if (!d) throw new AppError('部门不存在', 400)
}

async function resetPassword(id, newPassword, operator = null) {
  // 计算哈希在锁外；所有权限判断和写入仍在同一锁定事务内完成。
  const hashed = await bcrypt.hash(newPassword, 10)
  return withLockedTarget(id, operator, async conn => conn.query(
    `UPDATE sys_users
        SET password = ?,
            token_version = COALESCE(token_version, 0) + 1
      WHERE id = ? AND deleted_at IS NULL`,
    [hashed, id],
  ))
}

async function softDelete(id, operator = null) {
  if (Number(id) === Number(operator?.userId)) throw new AppError('不能删除自己的账号', 400)
  return withLockedTarget(id, operator, async conn => conn.query(
    'UPDATE sys_users SET deleted_at = NOW() WHERE id = ? AND deleted_at IS NULL',
    [id],
  ))
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

async function setWarehouseScope(userId, warehouseIds, operator = null) {
  const ids = [...new Set((warehouseIds || []).map(Number).filter(n => Number.isFinite(n) && n > 0))]
  // 走 withLockedTarget：它会同时锁定操作人/目标、拒绝非超管改超管（USER_ADMIN_PROTECTED）。
  // 这里再补一条自我提权守卫（2026-09-18 审计 P1）：仓库范围是「无行 = 不限仓」的语义，
  // 持 user.update 的限仓用户只要把自己那行清空就变成不限仓，从而在没有任何超管参与的情况下
  // 获得全部仓库的读写（库存、单据、报表、导出），而操作日志里只留一条普通的授权变更记录。
  return withLockedTarget(userId, operator, async (conn, target, actor) => {
    if (Number(actor.roleId) !== 1 && Number(target.id) === Number(actor.userId)) {
      throw new AppError('不能修改自己的仓库数据权限，请联系超级管理员', 403, 'USER_SCOPE_SELF_FORBIDDEN')
    }
    if (Number(actor.roleId) !== 1) {
      const [scope] = await conn.query('SELECT warehouse_id FROM user_warehouse_scope WHERE user_id=?', [actor.userId])
      const allowed = new Set(scope.map(row => Number(row.warehouse_id)))
      if (allowed.size && (!ids.length || ids.some(id => !allowed.has(id)))) {
        throw new AppError('不能授予超出自身仓库范围的数据权限', 403, 'USER_SCOPE_GRANT_DENIED')
      }
    }
    await conn.query('DELETE FROM user_warehouse_scope WHERE user_id = ?', [target.id])
    if (ids.length) await conn.query('INSERT INTO user_warehouse_scope (user_id, warehouse_id) VALUES ?', [ids.map(wid => [target.id, wid])])
    return { userId: Number(target.id), warehouseIds: ids }
  }).then((result) => {
    require('../../utils/warehouseScope').clearScopeCache(userId)
    return result
  })
}

module.exports = { listAssignableRoles, findAll, listOptions, findById, create, update, resetPassword, softDelete, getWarehouseScope, setWarehouseScope }
