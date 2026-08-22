const { pool } = require('../config/db')
const AppError = require('../utils/AppError')

/**
 * 登录 JWT 仅含 userId/roleId，权限在 sys_role_permissions。
 * 在需要 permissionMiddleware 的路由上，放在 authMiddleware 之后。
 *
 * 性能：按 roleId 做 60s 内存缓存（同 warehouseScope 范式）——权限挂在每个业务
 * 请求上（含桌面 claim-client 4s 轮询、PDA 30s 轮询），无缓存时每次请求都查表。
 * 角色权限变更后调 clearRolePermissionsCache()。
 */
const CACHE = new Map()
const TTL_MS = 60 * 1000

function clearRolePermissionsCache(roleId) {
  if (roleId != null) CACHE.delete(Number(roleId))
  else CACHE.clear()
}

async function loadRolePermissions(req, res, next) {
  try {
    const roleId = req.user?.roleId
    if (roleId == null) return next(new AppError('无效凭证', 401))
    const key = Number(roleId)
    const hit = CACHE.get(key)
    if (hit && Date.now() - hit.ts < TTL_MS) {
      req.user.permissions = hit.permissions
      return next()
    }
    const [rows] = await pool.query(
      'SELECT permission FROM sys_role_permissions WHERE role_id=?',
      [key],
    )
    const permissions = rows.map((r) => r.permission)
    CACHE.set(key, { permissions, ts: Date.now() })
    req.user.permissions = permissions
    next()
  } catch (err) {
    if (err.code === 'ER_NO_SUCH_TABLE') {
      req.user.permissions = []
      return next()
    }
    next(err)
  }
}

module.exports = { loadRolePermissions, clearRolePermissionsCache }
