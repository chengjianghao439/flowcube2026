const svc = require('./serials.service')
const { successResponse } = require('../../utils/response')

async function list(req, res, next) {
  try {
    const result = await svc.listSerials({
      page: +req.query.page || 1,
      pageSize: +req.query.pageSize || 20,
      keyword: req.query.keyword || '',
      status: req.query.status ? +req.query.status : null,
      warehouseId: req.query.warehouseId ? +req.query.warehouseId : null,
      productId: req.query.productId ? +req.query.productId : null,
      scopeWarehouseIds: req.user?.warehouseIds ?? null,
    })
    return successResponse(res, result, '查询成功')
  } catch (e) { next(e) }
}

async function trace(req, res, next) {
  try {
    const result = await svc.traceSerial({
      serialNo: req.query.serialNo || '',
      productId: req.query.productId ? +req.query.productId : null,
      scopeWarehouseIds: req.user?.warehouseIds ?? null,
    })
    return successResponse(res, result, '查询成功')
  } catch (e) { next(e) }
}

async function checkConsistency(req, res, next) {
  try {
    const result = await svc.checkConsistency({
      warehouseId: req.query.warehouseId ? +req.query.warehouseId : null,
      scopeWarehouseIds: req.user?.warehouseIds ?? null,
    })
    return successResponse(res, result, '查询成功')
  } catch (e) { next(e) }
}

module.exports = { list, trace, checkConsistency }
