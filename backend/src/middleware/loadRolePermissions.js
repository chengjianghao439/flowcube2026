const { pool } = require('../config/db')
const AppError = require('../utils/AppError')

/**
 * 登录 JWT 仅含 userId/roleId，权限在 sys_role_permissions。
 * 在需要 permissionMiddleware 的路由上，放在 authMiddleware 之后。
 *
 * 权限每次从数据库读取，使另一进程提交的权限回收在下一次请求生效。
 * 不保留无法跨实例失效的进程级缓存。
 */
const requestPermissions = new WeakMap()

// 兼容既有变更调用方；权限已不跨请求缓存。
function clearRolePermissionsCache() {}

async function loadRolePermissions(req, res, next) {
  try {
    const roleId = req.user?.roleId
    if (roleId == null) return next(new AppError('无效凭证', 401))
    const key = Number(roleId)
    const cached = requestPermissions.get(req)
    if (cached?.roleId === key) { req.user.permissions = cached.permissions; return next() }
    const [rows] = await pool.query(
      'SELECT permission FROM sys_role_permissions WHERE role_id=?',
      [key],
    )
    const permissions = rows.map((r) => r.permission)
    requestPermissions.set(req, { roleId: key, permissions })
    req.user.permissions = permissions
    next()
  } catch (err) {
    if (err.code === 'ER_NO_SUCH_TABLE') {
      // 2026-08-22 加固：缺表继续服务会让所有接口 403（安全方向）但排查困难——显式告警
      const logger = require('../utils/logger')
      logger.error(`[auth] sys_role_permissions 表缺失——所有需权限接口将 403，请检查迁移`, {}, 'Auth')
      req.user.permissions = []
      return next()
    }
    next(err)
  }
}

module.exports = { loadRolePermissions, clearRolePermissionsCache }
