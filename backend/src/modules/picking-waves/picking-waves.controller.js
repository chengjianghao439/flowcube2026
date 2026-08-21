const svc = require('./picking-waves.service')
const { successResponse } = require('../../utils/response')
const { getOperatorFromRequest } = require('../../utils/operator')

// 仓库数据权限（2026-08-21 审计 A.3 修复）：限仓用户只能看/操作自己仓库的波次
const scopeOf = (req) => req.user?.warehouseIds ?? null

exports.list = async (req, res, next) => {
  try {
    const { page = 1, pageSize = 20, keyword = '', status, warehouseId, startDate, endDate } = req.query
    const data = await svc.findAll({
      page: +page, pageSize: +pageSize, keyword,
      status: status ? +status : null,
      warehouseId: warehouseId ? +warehouseId : null,
      startDate: startDate || '',
      endDate: endDate || '',
      scopeWarehouseIds: scopeOf(req),
    })
    return successResponse(res, data, '查询成功')
  } catch (e) { next(e) }
}

exports.detail = async (req, res, next) => {
  try { return successResponse(res, await svc.findById(+req.params.id, scopeOf(req)), '查询成功') }
  catch (e) { next(e) }
}

exports.create = async (req, res, next) => {
  try {
    const data = await svc.create(req.body, scopeOf(req))
    return successResponse(res, data, '波次已创建')
  } catch (e) { next(e) }
}

exports.start = async (req, res, next) => {
  try {
    await svc.startPicking(+req.params.id, getOperatorFromRequest(req), scopeOf(req))
    return successResponse(res, null, '拣货已开始')
  } catch (e) { next(e) }
}

exports.finishPicking = async (req, res, next) => {
  try {
    await svc.finishPicking(+req.params.id, scopeOf(req))
    return successResponse(res, null, '拣货完成，进入待分拣')
  } catch (e) { next(e) }
}

exports.finish = async (req, res, next) => {
  try {
    await svc.finish(+req.params.id, scopeOf(req))
    return successResponse(res, null, '波次已完成')
  } catch (e) { next(e) }
}

exports.cancel = async (req, res, next) => {
  try {
    await svc.cancel(+req.params.id, scopeOf(req))
    return successResponse(res, null, '波次已取消')
  } catch (e) { next(e) }
}
