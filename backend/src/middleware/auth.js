const jwt = require('jsonwebtoken')
const AppError = require('../utils/AppError')
const { loadRolePermissions } = require('./loadRolePermissions')
const { env } = require('../config/env')
const { getCurrentAuthUser } = require('../modules/auth/currentAuthUser')
const { recordAuthAudit, AUTH_AUDIT_EVENT } = require('../modules/auth/auth-audit.service')
const { updateRequestContext } = require('../utils/requestContext')

/**
 * JWT 认证中间件。
 * 从 Authorization header 中提取并校验 Token。
 * 验证通过后将解码的 payload 挂载到 req.user。
 */
async function authMiddleware(req, res, next) {
  const authHeader = req.headers['authorization']
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next(new AppError('未提供认证 Token', 401, 'AUTH_TOKEN_MISSING'))
  }

  const token = authHeader.slice(7)
  try {
    // 密钥轮换（P2-15）：优先用新密钥校验；失败时若配置了旧密钥（JWT_SECRET_PREVIOUS）则兜底，
    // 保证轮换过渡期旧 token 仍有效、用户不被迫重登。只有新旧都失败才判无效。
    let payload
    try {
      payload = jwt.verify(token, env.JWT_SECRET)
    } catch (firstErr) {
      if (!env.JWT_SECRET_PREVIOUS) throw firstErr
      payload = jwt.verify(token, env.JWT_SECRET_PREVIOUS)
    }
    const user = await getCurrentAuthUser(payload.userId)
    const currentTokenVersion = Number(user.token_version || 0)
    const tokenVersion = Number(payload.tokenVersion)
    if (!Number.isFinite(tokenVersion) || tokenVersion !== currentTokenVersion) {
      return next(new AppError('登录状态已失效，请重新登录', 401, 'AUTH_SESSION_INVALID'))
    }
    // refresh token 不能访问业务接口（2026-08-21 权衡修复）：它只能调 /auth/refresh
    // 换新 access；拿 refresh 直接访问数据 = 越权
    if (payload.tokenType === 'refresh') {
      return next(new AppError('请使用登录后获取的访问令牌', 401, 'AUTH_SESSION_INVALID'))
    }
    req.user = {
      ...payload,
      userId: user.id,
      roleId: user.role_id,
      username: user.username,
      realName: user.real_name,
      roleName: user.role_name,
      tokenVersion: currentTokenVersion,
      // 仓库数据权限：null=不限仓，number[]=只能访问这些仓库（超管恒 null，60s 缓存）
      warehouseIds: await require('../utils/warehouseScope').loadUserWarehouseScope(user.id, user.role_id),
    }
    updateRequestContext({ userId: user.id, username: user.username })
    next()
  } catch (err) {
    if (err instanceof AppError) {
      return next(err)
    }
    if (err.name === 'TokenExpiredError') {
      return next(new AppError('Token 已过期，请重新登录', 401, 'AUTH_TOKEN_EXPIRED'))
    }
    if (err.name === 'JsonWebTokenError' || err.name === 'NotBeforeError') {
      return next(new AppError('Token 无效', 401, 'AUTH_TOKEN_INVALID'))
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
      void recordAuthAudit({
        eventType: AUTH_AUDIT_EVENT.PERMISSION_DENIED,
        title: '权限校验拒绝',
        description: `请求缺少权限 ${permissionCode}`,
        userId: req.user?.userId ?? null,
        username: req.user?.username ?? null,
        payload: {
          permission: permissionCode,
          roleId: req.user?.roleId ?? null,
        },
      })
      return next(new AppError('无操作权限', 403, 'PERMISSION_DENIED', { permission: permissionCode }))
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
