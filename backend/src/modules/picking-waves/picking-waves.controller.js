const svc = require('./picking-waves.service')
const { successResponse } = require('../../utils/response')

exports.list = async (req, res, next) => {
  try {
    const { page = 1, pageSize = 20, keyword = '', status, warehouseId } = req.query
    const data = await svc.findAll({
      page: +page, pageSize: +pageSize, keyword,
      status: status ? +status : null,
      warehouseId: warehouseId ? +warehouseId : null,
    })
    return successResponse(res, data, '查询成功')
  } catch (e) { next(e) }
}

exports.detail = async (req, res, next) => {
  try { return successResponse(res, await svc.findById(+req.params.id), '查询成功') }
  catch (e) { next(e) }
}

exports.create = async (req, res, next) => {
  try {
    const data = await svc.create(req.body)
    return successResponse(res, data, '波次已创建')
  } catch (e) { next(e) }
}

exports.start = async (req, res, next) => {
  try {
    await svc.startPicking(+req.params.id, {
      userId: req.user.userId,
      userName: req.user.realName || req.user.username,
    })
    return successResponse(res, null, '拣货已开始')
  } catch (e) { next(e) }
}

exports.finishPicking = async (req, res, next) => {
  try {
    await svc.finishPicking(+req.params.id)
    return successResponse(res, null, '拣货完成，进入待分拣')
  } catch (e) { next(e) }
}

exports.finish = async (req, res, next) => {
  try {
    await svc.finish(+req.params.id)
    return successResponse(res, null, '波次已完成')
  } catch (e) { next(e) }
}

exports.cancel = async (req, res, next) => {
  try {
    await svc.cancel(+req.params.id)
    return successResponse(res, null, '波次已取消')
  } catch (e) { next(e) }
}

exports.pickRoute = async (req, res, next) => {
  try { return successResponse(res, await svc.getPickRoute(+req.params.id)) }
  catch (e) { next(e) }
}

exports.markRouteCompleted = async (req, res, next) => {
  try {
    await svc.markRouteContainerCompleted(+req.params.id, req.body.barcode)
    return successResponse(res, null, '路线步骤已更新')
  } catch (e) { next(e) }
}
