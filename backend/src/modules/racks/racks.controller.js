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
    const id = parseInt(req.params.id, 10)
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ success: false, message: '无效的货架 ID', data: null })
    }
    const slim = await racksService.enqueuePrintLabel(id, {
      tenantId: req.user?.tenantId ?? 0,
      userId: req.user?.userId ?? null,
    })
    if (!slim) {
      return successResponse(
        res,
        { queued: false, jobId: null, printerCode: null, printerName: null },
        '未配置标签机或未绑定「库存标签」用途打印机，未创建打印任务',
      )
    }
    const hint = slim.dispatchHint
    const msg =
      hint?.code === 'dispatched'
        ? '已下发至打印工作站'
        : hint?.code === 'no_print_client'
          ? '任务已入队，但未连接打印客户端（详见说明）'
          : hint?.code === 'queued_concurrency'
            ? '任务已入队，因并发上限排队中'
            : '已加入打印队列（按「库存标签 / inventory_label」绑定；需 print-client 在线才能出纸）'
    return successResponse(
      res,
      {
        queued:       true,
        jobId:        slim.id,
        printerCode:  slim.printerCode,
        printerName:  slim.printerName,
        dispatchHint: hint || null,
      },
      msg,
    )
  } catch (err) { next(err) }
}

async function scanHint(req, res, next) {
  try {
    const result = await racksService.scanHint(req.body)
    return successResponse(res, result, 'ok')
  } catch (err) { next(err) }
}

module.exports = { list, listActive, detail, create, update, remove, printLabel, scanHint }
