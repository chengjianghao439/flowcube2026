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
      // 仓库数据权限：null=不限仓，number[]=只能访问这些仓库（超管恒 null，请求级权限读取）
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
 * 判定请求是否具备某权限：超管角色（默认 role 1）恒真，其余看 req.user.permissions
 * （由 loadRolePermissions 填充）。
 *
 * 抽成独立函数是为了让**条件性权限校验**与路由中间件共用同一份超管豁免规则：
 * 跨期补录只在显式请求补录时才要求 finance.period.backfill（做成路由中间件会让没有补录
 * 权限的出纳连正常付款都做不了），若那里自己再写一遍 `roleId === 1` 判定，两处规则会漂移。
 */
function hasPermission(req, permissionCode, options = {}) {
  const superAdminRoleIds = options.superAdminRoleIds ?? [1]
  if (superAdminRoleIds.includes(req.user?.roleId)) return true
  return (req.user?.permissions ?? []).includes(permissionCode)
}

/**
 * 权限校验中间件工厂。
 * @param {string} permissionCode 格式：module.resource.action，如 inventory.container.move
 * @param {{ superAdminRoleIds?: number[] }} [options] superAdminRoleIds 默认 [1]，拥有任一角色则跳过权限表校验
 */
function permissionMiddleware(permissionCode, options = {}) {
  return (req, res, next) => {
    if (hasPermission(req, permissionCode, options)) return next()
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

/**
 * 任一权限点通过即放行（OR 语义）。
 *
 * 用于「同一份数据、两类不同角色都要看/都要动」的接口：跨期补录审批页既要有审批权限的人
 * 看全量队列，也要让只持申请权限的出纳回查自己提交的单子、撤回待审批的申请。
 * 若卡死单个码，持另一码的人会被挡在门外——审批人看不到队列、申请人撤不回自己的申请。
 *
 * 超管豁免与失败时的审计记录都与 permissionMiddleware 同一套（复用 hasPermission 与
 * recordAuthAudit），不另写判定，避免两处规则漂移。
 */
function requireAnyPermission(permissionCodes = [], options = {}) {
  const codes = permissionCodes.filter(Boolean)
  return (req, res, next) => {
    loadRolePermissions(req, res, (error) => {
      if (error) return next(error)
      if (codes.some((code) => hasPermission(req, code, options))) return next()
      const listed = codes.join(' | ')
      void recordAuthAudit({
        eventType: AUTH_AUDIT_EVENT.PERMISSION_DENIED,
        title: '权限校验拒绝',
        description: `请求缺少权限 ${listed}`,
        userId: req.user?.userId ?? null,
        username: req.user?.username ?? null,
        payload: { permission: listed, roleId: req.user?.roleId ?? null },
      })
      return next(new AppError('无操作权限', 403, 'PERMISSION_DENIED', { permission: listed }))
    })
  }
}

module.exports = {
  authMiddleware, permissionMiddleware, requirePermission, requireAnyPermission, hasPermission,
}
