const { successResponse } = require('../../utils/response')
const svc = require('./roles.service')

async function list(req, res, next) {
  try {
    return successResponse(res, await svc.findAll(), '查询成功')
  } catch (error) {
    next(error)
  }
}

async function permissions(req, res, next) {
  try {
    return successResponse(res, await svc.listPermissions(req.params.roleId), '查询成功')
  } catch (error) {
    next(error)
  }
}

async function updatePermissions(req, res, next) {
  try {
    await svc.replacePermissions(req.params.roleId, req.body.permissions)
    return successResponse(res, null, '权限更新成功')
  } catch (error) {
    next(error)
  }
}

module.exports = {
  list,
  permissions,
  updatePermissions,
}
