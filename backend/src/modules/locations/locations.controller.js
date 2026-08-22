const locationsService = require('./locations.service')
const { successResponse } = require('../../utils/response')

async function list(req, res, next) {
  try {
    const { page, pageSize, keyword, warehouseId, status, zone } = req.query
    const result = await locationsService.findAll({
      page: parseInt(page) || 1,
      pageSize: parseInt(pageSize) || 20,
      keyword: keyword || '',
      warehouseId: warehouseId ? parseInt(warehouseId) : null,
      status: status || '',
      zone: zone || '',
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

async function listByWarehouse(req, res, next) {
  try {
    const data = await locationsService.findAllByWarehouseId(req.params.warehouseId)
    return successResponse(res, data, '查询成功')
  } catch (err) { next(err) }
}

async function printLabel(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10)
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ success: false, message: '无效的库位 ID', data: null })
    }
    const slim = await locationsService.enqueuePrintLabel(id, {
      userId: req.user?.userId ?? null,
    })
    if (!slim) {
      return successResponse(
        res,
        { queued: false, jobId: null, printerCode: null, printerName: null },
        '未绑定打印机',
      )
    }
    const hint = slim.dispatchHint
    const msg =
      hint?.code === 'dispatched'
        ? '已下发至打印工作站'
        : hint?.code === 'no_print_client'
          ? '打印客户端离线'
          : hint?.code === 'queued_concurrency'
            ? '任务排队中'
            : '已加入打印队列'
    return successResponse(
      res,
      {
        queued:       true,
        jobId:        slim.id,
        printerCode:  slim.printerCode,
        printerName:  slim.printerName,
        dispatchHint: hint || null,
        contentType:  slim.contentType ?? null,
        content:      slim.content ?? null,
      },
      msg,
    )
  } catch (err) { next(err) }
}

module.exports = { list, detail, create, update, remove, findByCode, listByWarehouse, printLabel }
