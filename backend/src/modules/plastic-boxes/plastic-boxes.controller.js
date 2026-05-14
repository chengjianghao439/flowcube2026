const svc = require('./plastic-boxes.service')
const { successResponse } = require('../../utils/response')

const list = async (req, res, next) => {
  try { return successResponse(res, await svc.findAll(req.query), '查询成功') } catch (e) { next(e) }
}
const detail = async (req, res, next) => {
  try { return successResponse(res, await svc.findById(+req.params.id), '查询成功') } catch (e) { next(e) }
}
const movements = async (req, res, next) => {
  try { return successResponse(res, await svc.findMovements(+req.params.id), '查询成功') } catch (e) { next(e) }
}
const create = async (req, res, next) => {
  try { return successResponse(res, await svc.create(req.body), '创建成功', 201) } catch (e) { next(e) }
}
const remove = async (req, res, next) => {
  try { await svc.remove(+req.params.id); return successResponse(res, null, '删除成功') } catch (e) { next(e) }
}

module.exports = { list, detail, movements, create, remove }
