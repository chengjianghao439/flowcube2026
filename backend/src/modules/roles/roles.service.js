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

async function replacePermissions(roleId, permissions) {
  await pool.query('DELETE FROM sys_role_permissions WHERE role_id=?', [roleId])
  for (const permission of permissions) {
    await pool.query(
      'INSERT IGNORE INTO sys_role_permissions (role_id,permission) VALUES (?,?)',
      [roleId, permission],
    )
  }
}

module.exports = {
  findAll,
  listPermissions,
  replacePermissions,
}
