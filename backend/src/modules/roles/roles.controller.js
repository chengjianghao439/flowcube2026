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

async function duplicate(req, res, next) {
  try {
    const result = await svc.duplicate(req.params.roleId, req.body)
    return successResponse(res, result, '角色复制成功', 201)
  } catch (error) {
    next(error)
  }
}

async function create(req, res, next) {
  try {
    const result = await svc.create(req.body)
    return successResponse(res, result, '角色创建成功', 201)
  } catch (error) {
    next(error)
  }
}

async function remove(req, res, next) {
  try {
    await svc.remove(req.params.roleId)
    return successResponse(res, null, '角色删除成功')
  } catch (error) {
    next(error)
  }
}

module.exports = {
  list,
  permissions,
  updatePermissions,
  duplicate,
  create,
  remove,
}
