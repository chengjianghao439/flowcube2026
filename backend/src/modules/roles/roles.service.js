const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const { clearRolePermissionsCache } = require('../../middleware/loadRolePermissions')

async function findAll() {
  const [rows] = await pool.query(
    'SELECT id, code, name, remark FROM sys_roles ORDER BY id ASC',
  )
  return rows
}

async function listPermissions(roleId) {
  const [rows] = await pool.query(
    'SELECT permission FROM sys_role_permissions WHERE role_id=? ORDER BY permission ASC',
    [roleId],
  )
  return rows.map((row) => row.permission)
}

/**
 * 覆盖式保存角色权限。
 *
 * 必须在事务里：这是「先 DELETE 清空、再逐条写回」的操作，中途失败会让该角色的权限
 * 只剩一部分甚至全空——这是访问控制，不是普通业务数据，半套权限意味着一整批用户
 * 突然打不开页面或越权，且不会有任何报错提示。并发保存同一角色时，事务也保证不会
 * 出现两次保存交错成的混合结果。
 *
 * 同时把逐条 INSERT 改成单条多值：权限码有 144 个，原来的写法就是 144 次往返。
 */
async function replacePermissions(roleId, permissions) {
  const list = [...new Set((permissions || []).filter(Boolean))]
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    await conn.query('DELETE FROM sys_role_permissions WHERE role_id=?', [roleId])
    if (list.length) {
      // 传空数组是合法操作（把角色权限清空），此时只执行上面的 DELETE
      const placeholders = list.map(() => '(?,?)').join(',')
      const params = list.flatMap(permission => [roleId, permission])
      await conn.query(
        `INSERT IGNORE INTO sys_role_permissions (role_id,permission) VALUES ${placeholders}`,
        params,
      )
    }
    await conn.commit()
    // 权限缓存失效：60s TTL 之外，改完立即让下一个请求看到新权限
    clearRolePermissionsCache(roleId)
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }
}

/**
 * 复制角色：新建角色 + 复制源角色的全部权限（INSERT SELECT 单条 SQL）。
 *
 * 必须在事务里：插入角色与复制权限是两步，中途失败会留下一个「有壳没权限」的角色
 * ——新角色一旦被赋给用户，就会表现为整批页面打不开且无任何报错。事务保证要么
 * 两步都成、要么都不成。
 *
 * 权限复制用 INSERT SELECT，一步完成，权限码有 184 个也不会有 N 次往返。
 * 新角色 id 走 AUTO_INCREMENT 自然增长（sys_users.role_id 是 TINYINT UNSIGNED，
 * 上限 255，超过即建不出来——这是数据库层的硬防线，代码不需要也不应该硬编码 id）。
 */
async function duplicate(sourceRoleId, { code, name, remark = null } = {}) {
  const sid = Number(sourceRoleId)
  if (!Number.isFinite(sid) || sid <= 0) throw new AppError('roleId 无效', 400)
  const roleCode = String(code || '').trim()
  const roleName = String(name || '').trim()
  if (!roleCode) throw new AppError('角色编码不能为空', 400)
  if (!roleName) throw new AppError('角色名称不能为空', 400)

  const [[source]] = await pool.query(
    'SELECT id, code, name FROM sys_roles WHERE id = ?',
    [sid],
  )
  if (!source) throw new AppError('源角色不存在', 404)

  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()

    const [dup] = await conn.query(
      'SELECT id FROM sys_roles WHERE code = ?',
      [roleCode],
    )
    if (dup[0]) throw new AppError(`角色编码 ${roleCode} 已存在`, 409)

    const [insert] = await conn.query(
      `INSERT INTO sys_roles (code, name, remark, is_system)
       VALUES (?, ?, ?, 0)`,
      [roleCode, roleName, remark || null],
    )
    const newRoleId = insert.insertId
    if (!Number.isFinite(newRoleId) || newRoleId <= 0) {
      throw new AppError('角色创建失败', 500)
    }

    await conn.query(
      `INSERT IGNORE INTO sys_role_permissions (role_id, permission)
       SELECT ?, permission FROM sys_role_permissions WHERE role_id = ?`,
      [newRoleId, sid],
    )

    await conn.commit()
    return { id: newRoleId, code: roleCode, name: roleName, remark: remark || null }
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }
}

module.exports = {
  findAll,
  listPermissions,
  replacePermissions,
  duplicate,
}
