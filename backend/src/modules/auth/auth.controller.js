const authService = require('./auth.service')
const { successResponse } = require('../../utils/response')

async function login(req, res, next) {
  try {
    const { username, password } = req.body
    const result = await authService.login(username, password)
    // 公开登录路由没有 req.user；只把 service 已验证的用户传给操作日志。
    req.operationActor = {
      userId: result.user.id,
      username: result.user.username,
      realName: result.user.realName,
    }
    return successResponse(res, result, '登录成功')
  } catch (err) {
    next(err)
  }
}

async function getMe(req, res, next) {
  try {
    const user = await authService.getMe(req.user.userId)
    return successResponse(res, user, '获取成功')
  } catch (err) {
    next(err)
  }
}

async function refresh(req, res, next) {
  try {
    // refresh token 从请求体取（2026-08-21 权衡修复：不再依赖 authMiddleware，
    // access 过期后仍能用 refresh 换新 access）
    const result = await authService.refreshAccessToken(req.body?.refreshToken)
    return successResponse(res, result, 'Token 已刷新')
  } catch (err) {
    next(err)
  }
}

async function logout(req, res, next) {
  try {
    // 作废当前 refresh token（一次性轮换配套）：jti 在服务端标记 revoked，
    // 即使 refresh 已泄露也无法再续期。access 短效（2h）自然失效。
    const actor = await authService.logout(req.body?.refreshToken)
    // 无效、过期或已用过的票据仍按公开退出接口返回，但日志必须保持匿名。
    if (actor) req.operationActor = actor
    return successResponse(res, null, '已退出登录')
  } catch (err) {
    next(err)
  }
}

module.exports = { login, getMe, refresh, logout }
