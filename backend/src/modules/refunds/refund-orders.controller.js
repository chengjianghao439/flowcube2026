const svc = require('./refund-orders.service')
const { successResponse } = require('../../utils/response')
const { getOperatorFromRequest } = require('../../utils/operator')

async function list(req, res, next) {
  try {
    const q = req.query || {}
    const result = await svc.findAll({
      page: +q.page || 1,
      pageSize: +q.pageSize || 20,
      keyword: q.keyword || '',
      status: q.status ? +q.status : null,
      startDate: q.startDate || null,
      endDate: q.endDate || null,
      scopeWarehouseIds: req.user?.warehouseIds ?? null,
    })
    return successResponse(res, result, '查询成功')
  } catch (e) { next(e) }
}

async function detail(req, res, next) {
  try {
    return successResponse(res, await svc.findById(+req.params.id, req.user?.warehouseIds ?? null), '查询成功')
  } catch (e) { next(e) }
}

async function create(req, res, next) {
  try {
    const result = await svc.create(req.body || {}, getOperatorFromRequest(req), req.user?.warehouseIds ?? null)
    return successResponse(res, result, '退款单已创建')
  } catch (e) { next(e) }
}

async function submit(req, res, next) {
  try {
    await svc.submit(+req.params.id, getOperatorFromRequest(req), req.user?.warehouseIds ?? null)
    return successResponse(res, null, '退款单已确认')
  } catch (e) { next(e) }
}

async function execute(req, res, next) {
  try {
    const result = await svc.execute(+req.params.id, getOperatorFromRequest(req), req.user?.warehouseIds ?? null)
    return successResponse(res, result, '退款已完成')
  } catch (e) { next(e) }
}

async function cancel(req, res, next) {
  try {
    await svc.cancel(+req.params.id, req.user?.warehouseIds ?? null)
    return successResponse(res, null, '退款单已取消')
  } catch (e) { next(e) }
}

module.exports = { list, detail, create, submit, execute, cancel }
