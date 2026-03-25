const { pool } = require('../config/db')
const AppError = require('../utils/AppError')

/**
 * 登录 JWT 仅含 userId/roleId，权限在 sys_role_permissions。
 * 在需要 permissionMiddleware 的路由上，放在 authMiddleware 之后。
 */
async function loadRolePermissions(req, res, next) {
  try {
    const roleId = req.user?.roleId
    if (roleId == null) return next(new AppError('无效凭证', 401))
    const [rows] = await pool.query(
      'SELECT permission FROM sys_role_permissions WHERE role_id=?',
      [roleId],
    )
    req.user.permissions = rows.map((r) => r.permission)
    next()
  } catch (err) {
    if (err.code === 'ER_NO_SUCH_TABLE') {
      req.user.permissions = []
      return next()
    }
    next(err)
  }
}

module.exports = { loadRolePermissions }
