const { pool } = require('../../config/db')

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
}
