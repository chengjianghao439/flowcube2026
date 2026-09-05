const svc = require('./plastic-boxes.service')
const { successResponse } = require('../../utils/response')

const list = async (req, res, next) => {
  try { return successResponse(res, await svc.findAll({ ...req.query, scopeWarehouseIds: req.user.warehouseIds }), '查询成功') } catch (e) { next(e) }
}
const detail = async (req, res, next) => {
  try { return successResponse(res, await svc.findById(+req.params.id, req.user.warehouseIds), '查询成功') } catch (e) { next(e) }
}
const movements = async (req, res, next) => {
  try { return successResponse(res, await svc.findMovements(+req.params.id, req.user.warehouseIds), '查询成功') } catch (e) { next(e) }
}
const create = async (req, res, next) => {
  try { return successResponse(res, await svc.create(req.body, req.user.warehouseIds), '创建成功', 201) } catch (e) { next(e) }
}
const remove = async (req, res, next) => {
  try { await svc.remove(+req.params.id, req.user.warehouseIds); return successResponse(res, null, '删除成功') } catch (e) { next(e) }
}

module.exports = { list, detail, movements, create, remove }
