const usersService = require('./users.service')
const { successResponse } = require('../../utils/response')

async function assignableRoles(req, res, next) {
  try { return successResponse(res, await usersService.listAssignableRoles(req.user)) } catch (err) { next(err) }
}

async function list(req, res, next) {
  try {
    const { page, pageSize, keyword, hideDevelopment } = req.query
    const result = await usersService.findAll({
      page: parseInt(page) || 1,
      pageSize: parseInt(pageSize) || 20,
      keyword: keyword || '',
      hideDevelopment: hideDevelopment === '1',
    })
    return successResponse(res, result, '查询成功')
  } catch (err) {
    next(err)
  }
}

async function options(req, res, next) {
  try {
    const result = await usersService.listOptions(req.user?.userId ?? null, req.query.hideDevelopment === '1')
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

async function myDetail(req, res, next) {
  try { return successResponse(res, await usersService.findById(req.user.userId), '查询成功') } catch (err) { next(err) }
}

async function myWarehouseScope(req, res, next) {
  try { return successResponse(res, await usersService.getWarehouseScope(req.user.userId), '查询成功') } catch (err) { next(err) }
}

async function create(req, res, next) {
  try {
    const result = await usersService.create(req.body, req.user)
    return successResponse(res, result, '创建成功', 201)
  } catch (err) {
    next(err)
  }
}

async function update(req, res, next) {
  try {
    await usersService.update(parseInt(req.params.id), req.body, req.user)
    return successResponse(res, null, '更新成功')
  } catch (err) {
    next(err)
  }
}

async function resetPassword(req, res, next) {
  try {
    await usersService.resetPassword(parseInt(req.params.id), req.body.newPassword, req.user)
    return successResponse(res, null, '密码重置成功')
  } catch (err) {
    next(err)
  }
}

async function remove(req, res, next) {
  try {
    await usersService.softDelete(parseInt(req.params.id), req.user)
    return successResponse(res, null, '删除成功')
  } catch (err) {
    next(err)
  }
}

const warehouseScope = async(req,res,next)=>{ try{return successResponse(res,await usersService.getWarehouseScope(+req.params.id),'查询成功')}catch(e){next(e)} }
const setWarehouseScope = async(req,res,next)=>{ try{return successResponse(res,await usersService.setWarehouseScope(+req.params.id,req.body.warehouseIds,req.user),'仓库数据权限已更新')}catch(e){next(e)} }

module.exports = { assignableRoles, list, options, detail, myDetail, myWarehouseScope, create, update, resetPassword, remove, warehouseScope, setWarehouseScope }
