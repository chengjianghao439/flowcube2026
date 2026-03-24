const locationsService = require('./locations.service')
const { successResponse } = require('../../utils/response')

async function list(req, res, next) {
  try {
    const { page, pageSize, keyword, warehouseId } = req.query
    const result = await locationsService.findAll({
      page: parseInt(page) || 1,
      pageSize: parseInt(pageSize) || 20,
      keyword: keyword || '',
      warehouseId: warehouseId ? parseInt(warehouseId) : null,
    })
    return successResponse(res, result, '查询成功')
  } catch (err) { next(err) }
}

async function detail(req, res, next) {
  try {
    const data = await locationsService.findById(parseInt(req.params.id))
    return successResponse(res, data, '查询成功')
  } catch (err) { next(err) }
}

async function create(req, res, next) {
  try {
    const result = await locationsService.create(req.body)
    return successResponse(res, result, '创建成功', 201)
  } catch (err) { next(err) }
}

async function update(req, res, next) {
  try {
    const result = await locationsService.update(parseInt(req.params.id), req.body)
    return successResponse(res, result, '更新成功')
  } catch (err) { next(err) }
}

async function remove(req, res, next) {
  try {
    await locationsService.softDelete(parseInt(req.params.id))
    return successResponse(res, null, '删除成功')
  } catch (err) { next(err) }
}

async function findByCode(req, res, next) {
  try {
    const data = await locationsService.findByCode(req.params.code)
    return successResponse(res, data, '查询成功')
  } catch (err) { next(err) }
}

module.exports = { list, detail, create, update, remove, findByCode }
