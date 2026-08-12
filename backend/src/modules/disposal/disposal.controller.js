const svc = require('./disposal.service')
const { successResponse } = require('../../utils/response')
const { getOperatorFromRequest } = require('../../utils/operator')

async function suggestions(req, res, next) {
  try {
    const q = req.query || {}
    const result = await svc.getSuggestions({
      page: +q.page || 1,
      pageSize: +q.pageSize || 50,
      keyword: q.keyword || '',
      warehouseId: q.warehouseId ? +q.warehouseId : null,
      staleDays: q.staleDays ? +q.staleDays : 90,
      scopeWarehouseIds: req.user?.warehouseIds ?? null,
    })
    return successResponse(res, result, '查询成功')
  } catch (e) { next(e) }
}

async function list(req, res, next) {
  try {
    const q = req.query || {}
    const result = await svc.findAll({
      page: +q.page || 1,
      pageSize: +q.pageSize || 20,
      keyword: q.keyword || '',
      status: q.status ? +q.status : null,
      warehouseId: q.warehouseId ? +q.warehouseId : null,
      startDate: q.startDate || '',
      endDate: q.endDate || '',
      scopeWarehouseIds: req.user?.warehouseIds ?? null,
    })
    return successResponse(res, result, '查询成功')
  } catch (e) { next(e) }
}

async function detail(req, res, next) {
  try {
    const result = await svc.findById(+req.params.id, req.user?.warehouseIds ?? null)
    return successResponse(res, result, '查询成功')
  } catch (e) { next(e) }
}

async function create(req, res, next) {
  try {
    const body = req.body || {}
    const operator = getOperatorFromRequest(req)
    const result = await svc.create({
      warehouseId: body.warehouseId,
      remark: body.remark,
      items: body.items,
      operator,
      scopeWarehouseIds: req.user?.warehouseIds ?? null,
    })
    return successResponse(res, result, '创建成功')
  } catch (e) { next(e) }
}

async function update(req, res, next) {
  try {
    const body = req.body || {}
    const result = await svc.update(+req.params.id, {
      warehouseId: body.warehouseId,
      remark: body.remark,
      items: body.items,
    })
    return successResponse(res, result, '保存成功')
  } catch (e) { next(e) }
}

async function submit(req, res, next) {
  try {
    await svc.submit(+req.params.id)
    return successResponse(res, null, '已提交审批')
  } catch (e) { next(e) }
}

async function approve(req, res, next) {
  try {
    await svc.approve(+req.params.id, getOperatorFromRequest(req))
    return successResponse(res, null, '已审批通过')
  } catch (e) { next(e) }
}

async function reject(req, res, next) {
  try {
    await svc.reject(+req.params.id, {
      reason: (req.body || {}).reason,
      operator: getOperatorFromRequest(req),
    })
    return successResponse(res, null, '已驳回')
  } catch (e) { next(e) }
}

async function dispose(req, res, next) {
  try {
    const result = await svc.dispose(+req.params.id, getOperatorFromRequest(req))
    return successResponse(res, result, '处置完成')
  } catch (e) { next(e) }
}

async function cancel(req, res, next) {
  try {
    await svc.cancel(+req.params.id)
    return successResponse(res, null, '已取消')
  } catch (e) { next(e) }
}

module.exports = { suggestions, list, detail, create, update, submit, approve, reject, dispose, cancel }
