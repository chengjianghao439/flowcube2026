const jwt = require('jsonwebtoken')
const AppError = require('../utils/AppError')
const { loadRolePermissions } = require('./loadRolePermissions')
const { env } = require('../config/env')
const { getCurrentAuthUser } = require('../modules/auth/currentAuthUser')

/**
 * JWT 认证中间件。
 * 从 Authorization header 中提取并校验 Token。
 * 验证通过后将解码的 payload 挂载到 req.user。
 */
async function authMiddleware(req, res, next) {
  const authHeader = req.headers['authorization']
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next(new AppError('未提供认证 Token', 401))
  }

  const token = authHeader.slice(7)
  try {
    const payload = jwt.verify(token, env.JWT_SECRET)
    const user = await getCurrentAuthUser(payload.userId)
    req.user = {
      ...payload,
      userId: user.id,
      roleId: user.role_id,
      username: user.username,
      realName: user.real_name,
      roleName: user.role_name,
    }
    next()
  } catch (err) {
    if (err instanceof AppError) {
      return next(err)
    }
    if (err.name === 'TokenExpiredError') {
      return next(new AppError('Token 已过期，请重新登录', 401))
    }
    if (err.name === 'JsonWebTokenError' || err.name === 'NotBeforeError') {
      return next(new AppError('Token 无效', 401))
    }
    return next(err)
  }
}

/**
 * 权限校验中间件工厂。
 * @param {string} permissionCode 格式：module.resource.action，如 inventory.container.move
 * @param {{ superAdminRoleIds?: number[] }} [options] superAdminRoleIds 默认 [1]，拥有任一角色则跳过权限表校验
 */
function permissionMiddleware(permissionCode, options = {}) {
  const superAdminRoleIds = options.superAdminRoleIds ?? [1]
  return (req, res, next) => {
    if (superAdminRoleIds.includes(req.user?.roleId)) return next()
    const userPermissions = req.user?.permissions ?? []
    if (!userPermissions.includes(permissionCode)) {
      return next(new AppError('无操作权限', 403))
    }
    next()
  }
}

function requirePermission(permissionCode, options = {}) {
  const checker = permissionMiddleware(permissionCode, options)
  return (req, res, next) => {
    loadRolePermissions(req, res, (error) => {
      if (error) return next(error)
      return checker(req, res, next)
    })
  }
}

module.exports = { authMiddleware, permissionMiddleware, requirePermission }
