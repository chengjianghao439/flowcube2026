const jwt = require('jsonwebtoken')
const AppError = require('../utils/AppError')

/**
 * JWT 认证中间件。
 * 从 Authorization header 中提取并校验 Token。
 * 验证通过后将解码的 payload 挂载到 req.user。
 */
function authMiddleware(req, res, next) {
  const authHeader = req.headers['authorization']
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next(new AppError('未提供认证 Token', 401))
  }

  const token = authHeader.slice(7)
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET)
    req.user = payload
    next()
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return next(new AppError('Token 已过期，请重新登录', 401))
    }
    return next(new AppError('Token 无效', 401))
  }
}

/**
 * 权限校验中间件工厂。
 * 用法：router.delete('/:id', authMiddleware, permissionMiddleware('inventory:delete'), controller.delete)
 * @param {string} permissionCode 格式：[模块]:[动作]，如 inventory:delete
 */
function permissionMiddleware(permissionCode) {
  return (req, res, next) => {
    const userPermissions = req.user?.permissions ?? []
    if (!userPermissions.includes(permissionCode)) {
      return next(new AppError('无操作权限', 403))
    }
    next()
  }
}

module.exports = { authMiddleware, permissionMiddleware }
