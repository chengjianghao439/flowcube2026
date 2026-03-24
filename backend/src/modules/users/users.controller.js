const usersService = require('./users.service')
const { successResponse } = require('../../utils/response')

async function list(req, res, next) {
  try {
    const { page, pageSize, keyword } = req.query
    const result = await usersService.findAll({
      page: parseInt(page) || 1,
      pageSize: parseInt(pageSize) || 20,
      keyword: keyword || '',
    })
    return successResponse(res, result, '查询成功')
  } catch (err) {
    next(err)
  }
}

async function detail(req, res, next) {
  try {
    const user = await usersService.findById(parseInt(req.params.id))
    return successResponse(res, user, '查询成功')
  } catch (err) {
    next(err)
  }
}

async function create(req, res, next) {
  try {
    const result = await usersService.create(req.body)
    return successResponse(res, result, '创建成功', 201)
  } catch (err) {
    next(err)
  }
}

async function update(req, res, next) {
  try {
    await usersService.update(parseInt(req.params.id), req.body)
    return successResponse(res, null, '更新成功')
  } catch (err) {
    next(err)
  }
}

async function resetPassword(req, res, next) {
  try {
    await usersService.resetPassword(parseInt(req.params.id), req.body.newPassword)
    return successResponse(res, null, '密码重置成功')
  } catch (err) {
    next(err)
  }
}

async function remove(req, res, next) {
  try {
    await usersService.softDelete(parseInt(req.params.id), req.user.userId)
    return successResponse(res, null, '删除成功')
  } catch (err) {
    next(err)
  }
}

module.exports = { list, detail, create, update, resetPassword, remove }
