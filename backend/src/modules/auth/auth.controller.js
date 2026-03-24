const authService = require('./auth.service')
const { successResponse } = require('../../utils/response')

async function login(req, res, next) {
  try {
    const { username, password } = req.body
    const result = await authService.login(username, password)
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

module.exports = { login, getMe }
