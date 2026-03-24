const warehousesService = require('./warehouses.service')
const { successResponse } = require('../../utils/response')

async function list(req, res, next) {
  try {
    const { page, pageSize, keyword } = req.query
    const result = await warehousesService.findAll({
      page: parseInt(page) || 1,
      pageSize: parseInt(pageSize) || 20,
      keyword: keyword || '',
    })
    return successResponse(res, result, '查询成功')
  } catch (err) { next(err) }
}

async function listActive(req, res, next) {
  try {
    const list = await warehousesService.findAllActive()
    return successResponse(res, list, '查询成功')
  } catch (err) { next(err) }
}

async function detail(req, res, next) {
  try {
    const data = await warehousesService.findById(parseInt(req.params.id))
    return successResponse(res, data, '查询成功')
  } catch (err) { next(err) }
}

async function create(req, res, next) {
  try {
    const result = await warehousesService.create(req.body)
    return successResponse(res, result, '创建成功', 201)
  } catch (err) { next(err) }
}

async function update(req, res, next) {
  try {
    await warehousesService.update(parseInt(req.params.id), req.body)
    return successResponse(res, null, '更新成功')
  } catch (err) { next(err) }
}

async function remove(req, res, next) {
  try {
    await warehousesService.softDelete(parseInt(req.params.id))
    return successResponse(res, null, '删除成功')
  } catch (err) { next(err) }
}

module.exports = { list, listActive, detail, create, update, remove }
