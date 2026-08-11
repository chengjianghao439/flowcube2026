const svc = require('./procurement.service')
const { successResponse } = require('../../utils/response')
const { getOperatorFromRequest } = require('../../utils/operator')

const rk = req => req.headers['x-request-key'] || null
const scope = req => req.user?.warehouseIds ?? null

async function generate(req, res, next) {
  try {
    const data = await svc.generatePlan({
      window: req.body.window, horizon: req.body.horizon,
      warehouseId: req.body.warehouseId ? Number(req.body.warehouseId) : null,
      name: req.body.name || null, defaultLeadTime: req.body.defaultLeadTime, forecastMethod: req.body.forecastMethod || 'sma', remark: req.body.remark || null,
      operator: getOperatorFromRequest(req), requestKey: rk(req), scopeWarehouseIds: scope(req),
    })
    return successResponse(res, data, '采购计划已生成', 201)
  } catch (e) { next(e) }
}
async function list(req, res, next) {
  try {
    return successResponse(res, await svc.listPlans({
      page: +req.query.page || 1, pageSize: +req.query.pageSize || 20,
      keyword: req.query.keyword || '', status: req.query.status ? +req.query.status : null, scopeWarehouseIds: scope(req),
    }), '查询成功')
  } catch (e) { next(e) }
}
async function detail(req, res, next) {
  try { return successResponse(res, await svc.getPlan(+req.params.id, scope(req)), '查询成功') } catch (e) { next(e) }
}
async function updateItem(req, res, next) {
  try {
    return successResponse(res, await svc.updatePlanItem(+req.params.id, +req.params.itemId, {
      adjustedQty: req.body.adjustedQty, supplierId: req.body.supplierId, ignore: req.body.ignore,
    }, scope(req)), '已保存')
  } catch (e) { next(e) }
}
async function convert(req, res, next) {
  try {
    return successResponse(res, await svc.convert(+req.params.id, {
      itemIds: req.body.itemIds, target: req.body.target || 'purchase',
      operator: getOperatorFromRequest(req), requestKey: rk(req), scopeWarehouseIds: scope(req),
    }), '转采购成功')
  } catch (e) { next(e) }
}
async function cancel(req, res, next) {
  try { await svc.cancel(+req.params.id, scope(req)); return successResponse(res, null, '已作废') } catch (e) { next(e) }
}

module.exports = { generate, list, detail, updateItem, convert, cancel }
