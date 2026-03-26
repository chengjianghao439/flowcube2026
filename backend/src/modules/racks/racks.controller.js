const racksService = require('./racks.service')
const { successResponse } = require('../../utils/response')

async function list(req, res, next) {
  try {
    const { page, pageSize, keyword, warehouseId, zone } = req.query
    const result = await racksService.findAll({
      page:        parseInt(page)     || 1,
      pageSize:    parseInt(pageSize) || 20,
      keyword:     keyword            || '',
      warehouseId: warehouseId ? parseInt(warehouseId) : null,
      zone:        zone               || null,
    })
    return successResponse(res, result, '查询成功')
  } catch (err) { next(err) }
}

async function listActive(req, res, next) {
  try {
    const warehouseId = req.query.warehouseId ? parseInt(req.query.warehouseId) : null
    const data = await racksService.findActive(warehouseId)
    return successResponse(res, data, '查询成功')
  } catch (err) { next(err) }
}

async function detail(req, res, next) {
  try {
    const data = await racksService.findById(parseInt(req.params.id))
    return successResponse(res, data, '查询成功')
  } catch (err) { next(err) }
}

async function create(req, res, next) {
  try {
    const result = await racksService.create(req.body)
    return successResponse(res, result, '创建成功', 201)
  } catch (err) { next(err) }
}

async function update(req, res, next) {
  try {
    const result = await racksService.update(parseInt(req.params.id), req.body)
    return successResponse(res, result, '更新成功')
  } catch (err) { next(err) }
}

async function remove(req, res, next) {
  try {
    await racksService.softDelete(parseInt(req.params.id))
    return successResponse(res, null, '删除成功')
  } catch (err) { next(err) }
}

async function printLabel(req, res, next) {
  try {
    const job = await racksService.enqueuePrintLabel(parseInt(req.params.id, 10), {
      tenantId: req.user.tenantId ?? 0,
      userId: req.user.userId,
    })
    return successResponse(res, { queued: !!job, job: job ?? null }, job ? '已加入打印队列' : '未配置标签机，未创建打印任务')
  } catch (err) { next(err) }
}

module.exports = { list, listActive, detail, create, update, remove, printLabel }
